/**
 * codeExecution.ts — Sandboxed Python code execution tool.
 *
 * Runs Python snippets in a restricted subprocess with layered defences:
 *
 *   Layer 0 — subprocess isolation (process boundary)
 *     User code runs in a completely separate Python child process.
 *     The child environment is sanitised (no DATABASE_URL, API keys, etc.).
 *     Even a total Python-sandbox escape only affects the child process, not
 *     the server process or its in-memory state.
 *
 *   Layer 1 — stdlib pre-warm + import hook
 *     All safe stdlib modules are pre-imported before the hook is installed.
 *     This populates sys.modules so transitive imports of internal C modules
 *     (_io, types, gc, etc.) never go through the hook.  After the hook is
 *     installed any NEW import attempted by user code is checked against
 *     BLOCKED_MODULES; blocked modules raise ImportError.
 *     Blocked: sys, os, builtins, _io, socket, ssl, subprocess, pathlib, etc.
 *
 *   Layer 2 — builtins.open globally patched + os function stubs
 *     builtins.open is replaced with a PermissionError stub globally in the
 *     child interpreter (not just removed from exec globals).  All dangerous
 *     os.* methods (system, popen, fork, execv*, listdir, stat, remove,
 *     mkdir, open, read, write…) are also replaced with stubs.
 *
 *   Layer 3 — io / _io file-class patching
 *     io.open, io.FileIO, io.BufferedReader/Writer/Random, TextIOWrapper and
 *     their _io C-module equivalents replaced with stubs; StringIO/BytesIO kept.
 *
 *   Layer 4 — AST transformation (attribute blocklist)
 *     The user's source is parsed and an AST transformer rewrites every
 *     `x.ATTR` access where ATTR is in a denylist.  This closes the
 *     `__import__.__globals__` / `__closure__` / `__subclasses__` family of
 *     escape paths at the syntax level, before any code runs.
 *
 *   Layer 5 — restricted exec globals
 *     The builtins dict passed to exec() strips dangerous callables.
 *     `getattr` and `hasattr` are replaced with safe wrappers that reject
 *     the same attribute denylist, closing the runtime `getattr(f,'__globals__')`
 *     escape route.  `vars` and `dir` are also replaced.
 *
 *   Layer 6 — REPL-style output
 *     The last expression is auto-printed (like Python's interactive shell).
 *
 *   Layer 7 — OS-level resource limits (rlimits applied in child process)
 *     • RLIMIT_AS   = 128 MB virtual memory cap
 *     • RLIMIT_FSIZE = 0 — prevents any file writes (kernel-enforced)
 *     • RLIMIT_NPROC = 0 — prevents fork/exec of child processes
 *     • RLIMIT_CPU  enforced indirectly by wall-clock SIGKILL (Layer 8)
 *
 *   Layer 8 — SIGKILL timeout
 *     Subprocess is killed after timeout_ms (default 10 s, max 30 s).
 *
 *   Layer 9 — output cap
 *     Combined stdout+stderr truncated at 8 000 chars.
 *
 * Threat model:
 *   Subprocess-isolated sandbox.  No OS namespaces or seccomp available in
 *   the Replit environment (prctl/unshare return EPERM).
 *
 *   Process isolation (Layer 0) is the primary defence:
 *     • Server memory and in-process state are never reachable.
 *     • Sensitive env vars are stripped before spawn.
 *
 *   OS-level enforcement:
 *     • RLIMIT_FSIZE=0 makes any open(..., 'w') / write() syscall fail with
 *       SIGXFSZ — file writes are kernel-enforced, not just blocked by policy.
 *     • RLIMIT_NPROC=0 prevents fork/exec of further processes.
 *     • SIGKILL after timeout enforces wall-clock CPU bound.
 *
 *   Python-level enforcement (defence-in-depth):
 *     • builtins.open globally replaced in child (Layer 2).
 *     • Import hook blocks dangerous modules (Layer 1).
 *     • AST transformer blocks frame-escape attributes (Layer 4).
 *     • Exec globals strip open/eval/exec (Layer 5).
 *
 *   Residual risk (accepted):
 *     • File reads: no kernel mechanism prevents open()-for-read in this
 *       environment.  Mitigated by: (a) no sensitive data on disk in the
 *       child's working directory, (b) env vars cleared so no API keys are
 *       readable via /proc/self/environ, (c) builtins.open globally patched.
 *     • Network: import blocking prevents socket/urllib; no network namespace
 *       isolation available.  API keys are not in child env so accidental
 *       network calls cannot authenticate.
 *
 *   Gated behind the `can_run_code` permission flag (opt-in only).
 *
 * Each call is fully stateless — no state persists between invocations.
 */

import { spawn } from "child_process";
import type { AgentTool } from "../types";

// ── Layer 1: modules blocked for user-code imports ────────────────────────────

const BLOCKED_MODULES = [
  // ── sys — exposes sys.modules (path to builtins/os/etc.) ─────────────────
  "sys", "_sys",
  // ── Entire OS / system access ─────────────────────────────────────────────
  "os", "posix", "posixpath", "nt",
  // ── Built-in introspection ────────────────────────────────────────────────
  "builtins", "_builtins_",
  "importlib", "importlib.util", "importlib.machinery",
  "types",           // can fabricate code objects / functions
  "gc",              // exposes all live Python objects
  "inspect",         // reads source files from disk
  "linecache",       // reads source files from disk
  // ── Low-level C I/O ───────────────────────────────────────────────────────
  "_io",
  // ── Network I/O ───────────────────────────────────────────────────────────
  "socket", "_socket",
  "socketserver",
  "ssl", "_ssl",
  "http", "urllib",
  "ftplib", "smtplib", "poplib", "imaplib",
  "telnetlib", "xmlrpc",
  "select", "_select", "selectors",
  // ── Process / concurrency execution ───────────────────────────────────────
  "subprocess",
  "multiprocessing", "_multiprocessing",
  "concurrent",
  "asyncio", "_asyncio", "asynchat", "asyncore",
  // ── Native extensions ─────────────────────────────────────────────────────
  "ctypes", "_ctypes", "cffi",
  // ── Terminal / TTY ────────────────────────────────────────────────────────
  "pty", "tty", "termios", "fcntl",
  // ── Filesystem helpers ────────────────────────────────────────────────────
  "pathlib", "shutil", "tempfile", "glob", "fnmatch",
  // ── Dangerous serialisation ───────────────────────────────────────────────
  "pickle", "_pickle", "shelve", "marshal",
  // ── Signals ───────────────────────────────────────────────────────────────
  "signal", "_signal",
  // ── Third-party network libraries ─────────────────────────────────────────
  "requests", "aiohttp", "httpx", "paramiko", "pycurl", "urllib3", "httplib2",
];

// ── Layer 2: os function stubs ────────────────────────────────────────────────

const OS_PATCHED_FUNCTIONS = [
  "system", "popen", "execv", "execve", "execvp", "execvpe",
  "spawnl", "spawnle", "spawnlp", "spawnlpe",
  "spawnv", "spawnve", "spawnvp", "spawnvpe",
  "fork", "forkpty",
  "listdir", "scandir", "stat", "lstat", "access",
  "getcwd", "getenv", "readlink", "realpath",
  "remove", "unlink", "rmdir", "removedirs", "makedirs", "mkdir",
  "rename", "replace", "symlink", "link", "chmod", "chown", "lchown",
  "open", "read", "write", "close", "dup", "dup2",
  "truncate", "ftruncate",
];

// ── Layer 3: io / _io file classes to patch ───────────────────────────────────

const IO_FILE_ATTRS = [
  "open", "FileIO", "BufferedReader", "BufferedWriter",
  "BufferedRandom", "BufferedRWPair", "TextIOWrapper",
];

// ── Layer 4: attributes denied at the AST level and via safe_getattr ─────────

const BLOCKED_ATTRS = [
  // Function / closure internals → expose preamble globals & _real_import
  "__globals__", "__builtins__", "__closure__", "__code__",
  "__func__", "__self__", "__wrapped__",
  // Attribute access overrides
  "__getattribute__", "__getattr__", "__setattr__", "__delattr__",
  // Class hierarchy introspection → walk to dangerous base classes
  "__mro__", "__bases__", "__subclasses__", "__class_getitem__",
  // Attribute dict → exposes module/class namespace
  "__dict__",
  // Import machinery
  "__loader__", "__spec__", "__package__",
  // Exception / traceback frame traversal (e.__traceback__.tb_frame.f_back.f_globals)
  "__traceback__",
  "tb_frame", "tb_next", "tb_lineno",
  "f_back", "f_globals", "f_locals", "f_builtins", "f_code",
  "f_lineno", "f_lasti", "f_trace",
  // Generator / coroutine / async-generator frames
  "gi_frame", "gi_code", "gi_yieldfrom",
  "cr_frame", "cr_code", "cr_await",
  "ag_frame", "ag_code",
];

// ── Limits ────────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 8_000;
const SANDBOX_MEM_BYTES = 128 * 1024 * 1024;

// ── Build the sandboxed Python script ─────────────────────────────────────────

function buildScript(userCode: string): string {
  const b64 = Buffer.from(userCode, "utf8").toString("base64");
  const blocked = JSON.stringify(BLOCKED_MODULES);
  const patched = JSON.stringify(OS_PATCHED_FUNCTIONS);
  const ioAttrs = JSON.stringify(IO_FILE_ATTRS);
  const blockedAttrs = JSON.stringify(BLOCKED_ATTRS);

  return `import base64 as _b64, sys as _sys, traceback as _traceback, ast as _ast

# ── 1. Pre-warm sys.modules with safe stdlib (before hook is installed) ────────
import math, cmath, json, re, csv, io, collections, itertools, functools
import decimal, fractions, statistics, random, ast, textwrap, string, pprint
import hashlib, base64, struct, copy, time, calendar, heapq, bisect, array
import datetime, enum, dataclasses
try:
    import typing
except Exception:
    pass

# ── 2. Import internal modules the preamble needs ─────────────────────────────
import builtins as _builtins_mod
import os as _os
import io as _io_mod
import _io as _raw_io

# ── Layer 7: OS-level resource limits (applied before any user code runs) ──────
def _sandbox_blocked(*a, **kw):
    raise PermissionError("This operation is not permitted in the sandbox.")

try:
    import resource as _resource
    # 128 MB virtual memory cap
    _resource.setrlimit(_resource.RLIMIT_AS, (${SANDBOX_MEM_BYTES}, ${SANDBOX_MEM_BYTES}))
    # No child processes (prevents fork/exec)
    _resource.setrlimit(_resource.RLIMIT_NPROC, (0, 0))
    # No file writes (SIGXFSZ on any write syscall — kernel-enforced)
    _resource.setrlimit(_resource.RLIMIT_FSIZE, (0, 0))
except Exception:
    pass

# ── 2a. Patch builtins.open globally in this interpreter ──────────────────────
# This removes file-open access for ALL code in the child process, not just
# user exec globals.  Modules imported by user code cannot open files either.
_builtins_mod.open = _sandbox_blocked

for _fn in ${patched}:
    if hasattr(_os, _fn):
        setattr(_os, _fn, _sandbox_blocked)

# ── 2b. Patch io and _io file-I/O classes (preserves StringIO / BytesIO) ──────
for _attr in ${ioAttrs}:
    if hasattr(_io_mod, _attr):
        setattr(_io_mod, _attr, _sandbox_blocked)
    if hasattr(_raw_io, _attr):
        try:
            setattr(_raw_io, _attr, _sandbox_blocked)
        except (AttributeError, TypeError):
            pass

# ── 3. Install __import__ hook — blocks sys, os, builtins, _io, etc. ──────────
_BLOCKED_MODS = set(${blocked})
_real_import = _builtins_mod.__import__

def _safe_import(name, *args, **kwargs):
    top = name.split('.')[0]
    if top in _BLOCKED_MODS:
        raise ImportError(f"Import of {name!r} is not permitted in the sandbox.")
    return _real_import(name, *args, **kwargs)

_builtins_mod.__import__ = _safe_import
if isinstance(__builtins__, dict):
    __builtins__['__import__'] = _safe_import
elif hasattr(__builtins__, '__import__'):
    __builtins__.__import__ = _safe_import

# ── Recursion cap ─────────────────────────────────────────────────────────────
_sys.setrecursionlimit(200)

# ── 4. AST transformer — blocks dangerous attribute accesses at syntax level ───
_BLOCKED_ATTRS = frozenset(${blockedAttrs})

class _AttributeBlocker(_ast.NodeTransformer):
    """Rewrites dangerous attribute accesses to raise a SyntaxError at transform time."""
    def visit_Attribute(self, node):
        self.generic_visit(node)
        if node.attr in _BLOCKED_ATTRS:
            raise SyntaxError(
                f"Access to '.{node.attr}' is not permitted in the sandbox.",
                ('<sandbox>', node.lineno, node.col_offset + 1, None),
            )
        return node

# ── 5. Build restricted builtins dict for exec() ──────────────────────────────
_safe_builtins = vars(_builtins_mod).copy()

# Remove dangerous callables
for _rm in ("eval", "exec", "compile", "open", "__import__",
            "__loader__", "__spec__", "vars"):
    _safe_builtins.pop(_rm, None)

# Replace getattr/hasattr with wrappers that block dunder access
_real_getattr = getattr
_real_hasattr = hasattr

def _safe_getattr(obj, name, *args):
    if name in _BLOCKED_ATTRS:
        raise AttributeError(
            f"Access to attribute '{name}' is not permitted in the sandbox."
        )
    return _real_getattr(obj, name, *args)

def _safe_hasattr(obj, name):
    if name in _BLOCKED_ATTRS:
        return False
    return _real_hasattr(obj, name)

def _safe_dir(obj=None):
    result = dir(obj) if obj is not None else dir()
    return [x for x in result if x not in _BLOCKED_ATTRS]

_safe_builtins['__import__'] = _safe_import
_safe_builtins['getattr'] = _safe_getattr
_safe_builtins['hasattr'] = _safe_hasattr
_safe_builtins['dir'] = _safe_dir

_user_globals = {"__builtins__": _safe_builtins}

# ── Capture output ────────────────────────────────────────────────────────────
_buf = io.StringIO()
_sys.stdout = _buf
_sys.stderr = _buf

# ── 6. Execute user code: AST-transform → compile → exec (REPL-style) ─────────
_USER_CODE = _b64.b64decode('${b64}').decode('utf-8')

try:
    _tree = _ast.parse(_USER_CODE)
    # Layer 4: transform AST to block dangerous attribute accesses
    _AttributeBlocker().visit(_tree)
    _ast.fix_missing_locations(_tree)

    if _tree.body and isinstance(_tree.body[-1], _ast.Expr):
        _head = _tree.body[:-1]
        if _head:
            _head_mod = _ast.Module(body=_head, type_ignores=[])
            _ast.fix_missing_locations(_head_mod)
            exec(compile(_head_mod, '<sandbox>', 'exec'), _user_globals)
        _tail = _ast.Expression(body=_tree.body[-1].value)
        _ast.fix_missing_locations(_tail)
        _result = eval(compile(_tail, '<sandbox>', 'eval'), _user_globals)
        if _result is not None:
            print(repr(_result))
    else:
        exec(compile(_tree, '<sandbox>', 'exec'), _user_globals)
except SystemExit:
    pass
except Exception:
    _buf.write(_traceback.format_exc())
finally:
    _sys.stdout = _sys.__stdout__
    _sys.stderr = _sys.__stderr__

print(_buf.getvalue(), end='')
`;
}

// ── Executor ──────────────────────────────────────────────────────────────────

export interface ExecResult {
  stdout: string;
  timedOut: boolean;
  exitCode: number | null;
}

export function runPythonSandbox(code: string, timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    const script = buildScript(code);
    const chunks: Buffer[] = [];
    let timedOut = false;

    const child = spawn("python3", ["-c", script], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        PYTHONIOENCODING: "utf-8",
        PYTHONUNBUFFERED: "1",
        PYTHONNOUSERSITE: "1",
        PYTHONPATH: "",
      },
    });

    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, Math.min(timeoutMs, MAX_TIMEOUT_MS));

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      const raw = Buffer.concat(chunks).toString("utf8");
      const stdout = raw.length > MAX_OUTPUT_CHARS
        ? raw.slice(0, MAX_OUTPUT_CHARS) + "\n… [output truncated]"
        : raw;
      resolve({ stdout, timedOut, exitCode });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        stdout: `Failed to start Python: ${err.message}`,
        timedOut: false,
        exitCode: -1,
      });
    });
  });
}

// ── Tool definition ───────────────────────────────────────────────────────────

export const codeExecutionTool: AgentTool = {
  name: "run_python",
  description:
    "Execute a Python code snippet in a secure sandbox and return the output. " +
    "Use this for data analysis, calculations, parsing structured data, running formulas, " +
    "or verifying logic. " +
    "Network access and filesystem access are fully blocked. " +
    "Available stdlib: math, cmath, json, re, csv, io (StringIO/BytesIO only), " +
    "collections, itertools, functools, decimal, fractions, statistics, random, " +
    "ast, textwrap, string, pprint, hashlib, base64, struct, copy, time, " +
    "calendar, heapq, bisect, array, datetime, enum, dataclasses. " +
    "The last expression is automatically printed (REPL-style). " +
    "Default timeout is 10 seconds.",
  parameters: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description:
          "Python code to execute. The last expression is auto-printed if not None. " +
          "Blocked: os, sys, builtins, socket, urllib, subprocess, pathlib, shutil, " +
          "pickle, and all other network/filesystem/execution modules. " +
          "Access to dunder attributes like __globals__, __builtins__, __closure__, " +
          "__code__, __mro__, __subclasses__ is also blocked.",
      },
      timeout_ms: {
        type: "number",
        description: `Execution timeout in milliseconds (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS}).`,
      },
    },
    required: ["code"],
  },

  async execute(args, ctx) {
    const a = args as { code?: string; timeout_ms?: number };
    const code = String(a.code || "").trim();
    if (!code) {
      return { ok: false, content: "No code provided.", label: "Empty code" };
    }

    const timeoutMs = Math.min(
      Math.max(1000, Number(a.timeout_ms) || DEFAULT_TIMEOUT_MS),
      MAX_TIMEOUT_MS,
    );

    const channel = ctx.channel || "Agent";
    console.log(
      `[${channel}/CodeExec] run_python userId=${ctx.userId} timeout=${timeoutMs}ms len=${code.length}`,
    );

    const { stdout, timedOut, exitCode } = await runPythonSandbox(code, timeoutMs);

    if (timedOut) {
      return {
        ok: false,
        content:
          `Execution timed out after ${timeoutMs / 1000}s.` +
          (stdout.trim()
            ? `\n\`\`\`\nPartial output:\n${stdout.trimEnd()}\n\`\`\``
            : ""),
        label: "Timed out",
      };
    }

    const trimmed = stdout.trimEnd();
    const succeeded = exitCode === 0;

    if (!trimmed) {
      return {
        ok: succeeded,
        content: succeeded
          ? "Code ran successfully with no output."
          : `Code exited with code ${exitCode} and produced no output.`,
        label: succeeded ? "No output" : `Exit ${exitCode}`,
      };
    }

    return {
      ok: succeeded,
      content: `\`\`\`\n${trimmed}\n\`\`\``,
      label: succeeded ? "Success" : `Exit ${exitCode}`,
    };
  },
};
