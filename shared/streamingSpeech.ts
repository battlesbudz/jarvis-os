export type SpeakableChunk = {
  id: string;
  index: number;
  spokenText: string;
};

const MIN_PHRASE_CHARACTERS = 12;
const MAX_PHRASE_CHARACTERS = 240;

function normalizeSpeakableText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|mailto:)[^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+|www\.\S+/gi, " ")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^(?: {4}|\t).*$/gm, " ")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gm, "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/~~([^~\n]+)~~/g, "$1")
    .replace(/(^|[\s([{])\*([^*\n]+)\*(?=$|[\s)\]}.!,?:;])/g, "$1$2")
    .replace(/(^|[\s([{])_([^_\n]+)_(?=$|[\s)\]}.!,?:;])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

function isUnsafeStructuralFragment(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (/^[{[]/.test(trimmed) && /[}\]]$/.test(trimmed)) return true;
  return /^(?:tool|arguments?|payload|command|stdout|stderr)\s*:/i.test(trimmed);
}

export class SpeakableResponseSegmenter {
  private readonly responseId: string;
  private buffer = "";
  private codeFence: string | null = null;
  private markdownCarry = "";
  private nextIndex = 0;

  constructor(responseId: string) {
    this.responseId = responseId;
  }

  append(delta: string): SpeakableChunk[] {
    if (!delta) return [];
    this.consumeMarkdown(delta);
    return this.takeCompletePhrases(false);
  }

  finish(): SpeakableChunk[] {
    // Short terminal runs close inline code or strikethrough and must reach the
    // normalizer. Fence-length runs remain structural Markdown and are dropped.
    const terminalCarry = this.markdownCarry;
    this.markdownCarry = "";
    if (terminalCarry.length < 3) {
      this.buffer += terminalCarry;
    } else if (this.codeFence) {
      this.codeFence = null;
      this.buffer += " ";
    }
    return this.takeCompletePhrases(true);
  }

  private consumeMarkdown(delta: string): void {
    const combined = this.markdownCarry + delta;
    const trailingRun = combined.match(/(`+|~+)$/)?.[0] ?? "";
    const trailingFence = trailingRun;
    this.markdownCarry = trailingFence;
    delta = trailingFence ? combined.slice(0, -trailingFence.length) : combined;
    let cursor = 0;
    while (cursor < delta.length) {
      const fence = this.findFence(delta, cursor);
      if (!fence) {
        if (!this.codeFence) this.buffer += delta.slice(cursor);
        return;
      }
      if (!this.codeFence) {
        this.buffer += delta.slice(cursor, fence.index);
        this.codeFence = fence.delimiter;
      } else {
        this.codeFence = null;
        this.buffer += " ";
      }
      cursor = fence.index + fence.delimiter.length;
    }
  }

  private findFence(value: string, cursor: number): { index: number; delimiter: string } | null {
    const expression = this.codeFence
      ? new RegExp(`${this.codeFence[0]}{${this.codeFence.length},}`, "g")
      : /`{3,}|~{3,}/g;
    expression.lastIndex = cursor;
    const match = expression.exec(value);
    return match ? { index: match.index, delimiter: match[0] } : null;
  }

  private takeCompletePhrases(flush: boolean): SpeakableChunk[] {
    const chunks: SpeakableChunk[] = [];
    while (this.buffer.trim()) {
      const unsafeUrl = this.discardUnsafeUrl(flush);
      if (unsafeUrl === "waiting") break;
      if (unsafeUrl === "discarded") continue;
      const indentedCode = this.discardIndentedCodeLine(flush);
      if (indentedCode === "waiting") break;
      if (indentedCode === "discarded") continue;
      const embeddedStructural = this.discardEmbeddedStructuralPayload(flush);
      if (embeddedStructural === "waiting") break;
      if (embeddedStructural === "discarded") continue;
      const structuralPrefix = this.findStructuralPrefixEnd();
      if (structuralPrefix === "incomplete") {
        // SSE boundaries are arbitrary. Hold a structural payload until its
        // closing delimiter arrives so it cannot be split into speakable pieces.
        if (flush) this.buffer = "";
        break;
      }
      if (typeof structuralPrefix === "number") {
        this.buffer = this.buffer.slice(structuralPrefix);
        continue;
      }
      const boundary = this.findBoundary(flush);
      if (boundary === null) break;
      const candidate = normalizeSpeakableText(this.buffer.slice(0, boundary));
      this.buffer = this.buffer.slice(boundary);
      if (!candidate || isUnsafeStructuralFragment(candidate)) continue;
      chunks.push({
        id: `${this.responseId}:${this.nextIndex}`,
        index: this.nextIndex++,
        spokenText: candidate,
      });
    }
    if (flush) this.buffer = "";
    return chunks;
  }

  private discardUnsafeUrl(flush: boolean): "discarded" | "waiting" | null {
    const match = /https?:\/\/|www\./i.exec(this.buffer);
    if (!match) return null;
    const urlStart = match.index;
    const beforeUrl = this.buffer.slice(0, urlStart);

    if (beforeUrl.endsWith("](")) {
      const labelStart = beforeUrl.lastIndexOf("[");
      const destinationEnd = this.buffer.indexOf(")", urlStart);
      if (destinationEnd === -1) {
        if (!flush) return "waiting";
        this.buffer = labelStart >= 0 ? this.buffer.slice(0, labelStart) : beforeUrl;
        return "discarded";
      }
      const label = labelStart >= 0 ? beforeUrl.slice(labelStart + 1, -2) : "";
      const replacementStart = labelStart > 0 && beforeUrl[labelStart - 1] === "!"
        ? labelStart - 1
        : Math.max(0, labelStart);
      this.buffer = `${this.buffer.slice(0, replacementStart)}${label} ${this.buffer.slice(destinationEnd + 1)}`;
      return "discarded";
    }

    const relativeEnd = this.buffer.slice(urlStart).search(/\s/);
    if (relativeEnd === -1) {
      if (!flush) return "waiting";
      this.buffer = beforeUrl;
      return "discarded";
    }
    this.buffer = `${beforeUrl} ${this.buffer.slice(urlStart + relativeEnd)}`;
    return "discarded";
  }

  private discardIndentedCodeLine(flush: boolean): "discarded" | "waiting" | null {
    const marker = /(?:^|\n)(?: {4}|\t)/.exec(this.buffer);
    if (!marker) return null;
    const lineEnd = this.buffer.indexOf("\n", marker.index + 1);
    if (lineEnd === -1) {
      if (!flush) return "waiting";
      this.buffer = this.buffer.slice(0, marker.index);
      return "discarded";
    }
    this.buffer = `${this.buffer.slice(0, marker.index)} ${this.buffer.slice(lineEnd + 1)}`;
    return "discarded";
  }

  private discardEmbeddedStructuralPayload(flush: boolean): "discarded" | "waiting" | null {
    const openings = /[{[]/g;
    let marker: RegExpExecArray | null;
    while ((marker = openings.exec(this.buffer)) !== null) {
      const payloadStart = marker.index;
      if (payloadStart === 0) continue;
      if (marker[0] === "[") {
        const precedingText = this.buffer.slice(0, payloadStart);
        const explicitlyIntroduced = /:\s*$/.test(precedingText) || /\n\s*$/.test(precedingText);
        if (!explicitlyIntroduced) continue;
      }
      const structuralEnd = this.findStructuralPrefixEnd(this.buffer.slice(payloadStart));
      if (structuralEnd === null) continue;
      if (structuralEnd === "incomplete") {
        if (flush) {
          this.buffer = this.buffer.slice(0, payloadStart);
          return this.buffer.trim() ? "discarded" : "waiting";
        }
        return "waiting";
      }
      this.buffer = `${this.buffer.slice(0, payloadStart)} ${this.buffer.slice(payloadStart + structuralEnd)}`;
      return "discarded";
    }
    return null;
  }

  private findStructuralPrefixEnd(value = this.buffer): number | "incomplete" | null {
    const leadingWhitespace = value.match(/^\s*/)?.[0].length ?? 0;
    const opening = value[leadingWhitespace];
    if (opening !== "{" && opening !== "[") return null;
    if (opening === "{") {
      const objectPrefix = value.slice(leadingWhitespace + 1).trimStart();
      const firstValue = objectPrefix[0];
      if (!firstValue) return "incomplete";
      if (firstValue !== '"' && firstValue !== "}") return null;
    } else {
      const valuePrefix = value.slice(leadingWhitespace + 1).trimStart();
      const firstValue = valuePrefix[0];
      // Markdown links and bracketed prose begin with a letter. JSON-like arrays
      // begin with a delimiter, quote, number, or JSON literal.
      if (firstValue && /[a-z]/i.test(firstValue)) {
        const normalizedPrefix = valuePrefix.toLowerCase();
        const literals = ["true", "false", "null"];
        const completeLiteral = literals.some((literal) =>
          normalizedPrefix.startsWith(literal) &&
          /^\s*[,\]}]/.test(normalizedPrefix.slice(literal.length)),
        );
        if (!completeLiteral) {
          if (literals.some((literal) => literal.startsWith(normalizedPrefix))) return "incomplete";
          return null;
        }
      } else if (firstValue && !/[\[\]{"\d\-]/.test(firstValue)) {
        return null;
      }
    }

    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    for (let index = leadingWhitespace; index < value.length; index += 1) {
      const character = value[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
      } else if (character === "{" || character === "[") {
        stack.push(character);
      } else if (character === "}" || character === "]") {
        const expected = character === "}" ? "{" : "[";
        if (stack.pop() !== expected) return null;
        if (stack.length === 0) {
          const structuralEnd = index + 1;
          const candidate = value.slice(leadingWhitespace, structuralEnd);
          if (
            opening === "[" &&
            /^\[\s*-?\d+(?:\.\d+)?(?:\s*,\s*-?\d+(?:\.\d+)?)*\s*\]$/.test(candidate)
          ) return null;
          return structuralEnd;
        }
      }
    }
    return "incomplete";
  }

  private findBoundary(flush: boolean): number | null {
    const source = this.buffer;
    const cappedLength = Math.min(source.length, MAX_PHRASE_CHARACTERS);
    for (let index = MIN_PHRASE_CHARACTERS; index < cappedLength; index += 1) {
      const next = source[index + 1];
      if (/[.!?;\n]/.test(source[index]) && (next === undefined || /\s/.test(next))) {
        return index + 1;
      }
    }
    if (source.length >= MAX_PHRASE_CHARACTERS) {
      const breakAt = source.lastIndexOf(" ", MAX_PHRASE_CHARACTERS);
      return breakAt >= MIN_PHRASE_CHARACTERS ? breakAt + 1 : MAX_PHRASE_CHARACTERS;
    }
    return flush ? source.length : null;
  }
}

type StreamingSpeechQueueOptions = {
  speak: (chunk: SpeakableChunk, signal: AbortSignal, markPlaybackStarted: () => void) => Promise<void>;
  fallback: (chunk: SpeakableChunk, signal: AbortSignal) => Promise<void>;
  onFirstChunkStart?: (chunk: SpeakableChunk) => void;
  onChunkComplete?: (chunk: SpeakableChunk) => void;
};

export class StreamingSpeechQueue {
  private readonly options: StreamingSpeechQueueOptions;
  private readonly queued: SpeakableChunk[] = [];
  private readonly seen = new Set<string>();
  private controller = new AbortController();
  private draining: Promise<void> | null = null;
  private suppressed = false;
  private fallbackUsed = false;
  private firstChunkStarted = false;
  private terminalError: unknown = null;

  constructor(options: StreamingSpeechQueueOptions) {
    this.options = options;
  }

  enqueue(chunks: readonly SpeakableChunk[]): void {
    if (this.suppressed) return;
    for (const chunk of chunks) {
      if (this.seen.has(chunk.id)) continue;
      this.seen.add(chunk.id);
      this.queued.push(chunk);
    }
    void this.drain().catch(() => {});
  }

  suppress(): void {
    this.suppressed = true;
    this.queued.length = 0;
    this.controller.abort();
  }

  async settled(): Promise<void> {
    await this.draining;
    if (this.terminalError) throw this.terminalError;
  }

  private drain(): Promise<void> {
    if (this.draining) return this.draining;
    this.draining = (async () => {
      while (!this.suppressed && this.queued.length > 0) {
        const chunk = this.queued.shift()!;
        if (!this.firstChunkStarted) {
          this.firstChunkStarted = true;
          this.options.onFirstChunkStart?.(chunk);
        }
        if (this.fallbackUsed) {
          await this.runFallback(chunk);
          if (!this.controller.signal.aborted) this.options.onChunkComplete?.(chunk);
          continue;
        }
        let playbackStarted = false;
        try {
          await this.options.speak(chunk, this.controller.signal, () => { playbackStarted = true; });
        } catch (error) {
          if (this.controller.signal.aborted || this.suppressed) break;
          if (playbackStarted) {
            this.terminalError = error;
            this.suppressed = true;
            this.queued.length = 0;
            this.controller.abort();
            throw error;
          }
          this.fallbackUsed = true;
          await this.runFallback(chunk);
        }
        if (!this.controller.signal.aborted) this.options.onChunkComplete?.(chunk);
      }
    })().finally(() => {
      this.draining = null;
      if (!this.suppressed && this.queued.length > 0) void this.drain().catch(() => {});
    });
    return this.draining;
  }

  private async runFallback(chunk: SpeakableChunk): Promise<void> {
    try {
      await this.options.fallback(chunk, this.controller.signal);
    } catch (error) {
      this.terminalError = error;
      this.suppressed = true;
      this.queued.length = 0;
      this.controller.abort();
      throw error;
    }
  }
}
