import type { Server } from "http";
import { initChannels } from "../channels";
import { startDaemonBridge } from "../daemon/bridge";
import { registerGatewayControlPlane } from "../gateway/controlPlane";
import { registerVoiceRelay } from "../voiceRelayRoutes";
import type { Express } from "express";

const KNOWN_WS_PATHS = ["/api/daemon/ws", "/api/voice/ws", "/api/gateway/ws"];

export function registerRealtimeBoot(app: Express, server: Server): void {
  initChannels();
  startDaemonBridge(server);
  registerGatewayControlPlane(app, server);
  registerVoiceRelay(server);

  server.on("upgrade", (req, socket) => {
    const pathname = (req.url || "").split("?")[0];
    const isKnown = KNOWN_WS_PATHS.some(p => pathname.startsWith(p));
    if (!isKnown && !socket.destroyed) {
      socket.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
      socket.destroy();
    }
  });
}
