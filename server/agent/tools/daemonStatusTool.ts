import type { AgentTool } from "../types";
import {
  getAndroidDaemonPermissions,
  getDaemonDeviceMeta,
  getDaemonLastSeen,
  getDaemonPermissions,
  isAndroidDaemonActive,
  isDesktopDaemonActive,
} from "../../daemon/bridge";

export const daemonStatusTool: AgentTool = {
  name: "daemon_status",
  description:
    "Check the current connection status of the desktop daemon and Android daemon for this user. Returns connected state, last-seen time, hostname, and which capabilities are enabled. Use before running daemon_shell or daemon_action to verify the daemon is online and permissions are correct.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  async execute(_args, ctx) {
    const desktopActive = isDesktopDaemonActive(ctx.userId);
    const androidActive = isAndroidDaemonActive(ctx.userId);

    const [desktopMeta, androidMeta, desktopPerms, androidPerms, desktopLastSeen, androidLastSeen] = await Promise.all([
      getDaemonDeviceMeta(ctx.userId, "desktop").catch(() => ({ hostname: null, platform: null })),
      getDaemonDeviceMeta(ctx.userId, "android").catch(() => ({ hostname: null, platform: null })),
      getDaemonPermissions(ctx.userId).catch(() => null),
      getAndroidDaemonPermissions(ctx.userId).catch(() => null),
      getDaemonLastSeen(ctx.userId, "desktop").catch(() => null),
      getDaemonLastSeen(ctx.userId, "android").catch(() => null),
    ]);

    const desktopCapabilities: string[] = [];
    if (desktopPerms) {
      if (desktopPerms.shell) desktopCapabilities.push("shell");
      if (desktopPerms.file_read) desktopCapabilities.push("file_read");
      if (desktopPerms.file_write) desktopCapabilities.push("file_write");
      if (desktopPerms.file_list) desktopCapabilities.push("file_list");
      if (desktopPerms.notify) desktopCapabilities.push("notify");
      if (desktopPerms.desktop_screenshot) desktopCapabilities.push("desktop_screenshot");
      if (desktopPerms.desktop_read_screen) desktopCapabilities.push("desktop_read_screen");
      if (desktopPerms.browser_local) desktopCapabilities.push("browser_local");
      if (desktopPerms.allow_outside_root) desktopCapabilities.push("allow_outside_root");
    }

    const androidCapabilities: string[] = [];
    if (androidPerms) {
      if (androidPerms.android_screenshot) androidCapabilities.push("android_screenshot");
      if (androidPerms.android_read_screen) androidCapabilities.push("android_read_screen");
      if (androidPerms.android_open_app) androidCapabilities.push("android_open_app");
      if (androidPerms.android_browse) androidCapabilities.push("android_browse");
      if (androidPerms.android_file_list) androidCapabilities.push("android_file_list");
      if (androidPerms.android_file_read) androidCapabilities.push("android_file_read");
      if (androidPerms.android_tap_type) androidCapabilities.push("android_tap_type");
      if (androidPerms.android_camera) androidCapabilities.push("android_camera");
      if (androidPerms.android_location) androidCapabilities.push("android_location");
      if (androidPerms.android_sms) androidCapabilities.push("android_sms");
      if (androidPerms.android_screen_record) androidCapabilities.push("android_screen_record");
    }

    const status = {
      desktop: {
        connected: desktopActive,
        lastSeen: desktopLastSeen,
        hostname: desktopMeta.hostname,
        capabilities: desktopCapabilities,
      },
      android: {
        connected: androidActive,
        lastSeen: androidLastSeen,
        hostname: androidMeta.hostname,
        capabilities: androidCapabilities,
      },
    };

    const lines: string[] = [];

    if (desktopActive) {
      lines.push(`Desktop daemon: CONNECTED${desktopMeta.hostname ? ` (${desktopMeta.hostname})` : ""}${desktopLastSeen ? `     last seen ${desktopLastSeen}` : ""}`);
      lines.push(`  Enabled capabilities: ${desktopCapabilities.length > 0 ? desktopCapabilities.join(", ") : "none"}`);
      if (!desktopPerms?.shell) {
        lines.push(`  Note: 'shell' is disabled. Enable it in Profile     Connected Channels     Desktop Daemon     Permissions to use daemon_shell.`);
      }
    } else {
      lines.push(`Desktop daemon: OFFLINE${desktopLastSeen ? `     last seen ${desktopLastSeen}` : ""}`);
      lines.push("  To connect: run jarvis-daemon.js with your pair code from Profile     Connected Channels     Desktop Daemon.");
    }

    lines.push("");

    if (androidActive) {
      lines.push(`Android daemon: CONNECTED${androidMeta.hostname ? ` (${androidMeta.hostname})` : ""}${androidLastSeen ? `     last seen ${androidLastSeen}` : ""}`);
      lines.push(`  Enabled capabilities: ${androidCapabilities.length > 0 ? androidCapabilities.join(", ") : "none"}`);
    } else {
      lines.push(`Android daemon: OFFLINE${androidLastSeen ? `     last seen ${androidLastSeen}` : ""}`);
      lines.push("  To connect: install the Jarvis Android APK and pair it from Profile     Connected Channels     Android Device.");
    }

    console.log(`[daemon_status] userId=${ctx.userId} desktop=${desktopActive} android=${androidActive}`);

    return {
      ok: true,
      content: lines.join("\n"),
      label: `Daemon status: desktop=${desktopActive ? "online" : "offline"} android=${androidActive ? "online" : "offline"}`,
      detail: JSON.stringify(status),
    };
  },
};
