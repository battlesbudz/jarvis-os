import { invoke } from "@tauri-apps/api/core";

export type ConnectorStatus = {
  daemon: "starting" | "connected" | "reconnecting" | "attention";
  detail: string;
  quietStartup: boolean;
  lastVerification?: string;
};

export function getStatus() {
  return invoke<ConnectorStatus>("get_status");
}

export function reconnectDaemon() {
  return invoke<ConnectorStatus>("reconnect_daemon");
}

export function runVerificationAgain() {
  return invoke<ConnectorStatus>("run_verification_again");
}

export function openJarvis() {
  return invoke<void>("open_jarvis");
}
