import { useEffect, useState } from "react";
import { ConnectorStatus, getStatus, openJarvis, reconnectDaemon, runVerificationAgain } from "./connectorApi";

const fallbackStatus: ConnectorStatus = {
  daemon: "starting",
  detail: "Starting the desktop daemon in the background.",
  quietStartup: true,
};

function statusLabel(status: ConnectorStatus["daemon"]) {
  if (status === "connected") return "Connected";
  if (status === "reconnecting") return "Reconnecting";
  if (status === "attention") return "Needs attention";
  return "Starting";
}

export default function App() {
  const [status, setStatus] = useState<ConnectorStatus>(fallbackStatus);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function refresh() {
    try {
      setStatus(await getStatus());
      setErrorMessage(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }

  async function runAction(name: string, action: () => Promise<ConnectorStatus | void>) {
    setBusyAction(name);
    setErrorMessage(null);
    try {
      const result = await action();
      if (result) setStatus(result);
      else await refresh();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  }

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <main className="shell">
      <section className="status-panel" aria-label="Jarvis Desktop Connector status">
        <div className="title-row">
          <div>
            <h1>Jarvis Desktop Connector</h1>
            <p>{status.detail}</p>
          </div>
          <span className={`status-dot ${status.daemon}`} aria-label={statusLabel(status.daemon)} />
        </div>

        <div className="status-grid">
          <div>
            <span className="label">Connection</span>
            <strong>{statusLabel(status.daemon)}</strong>
          </div>
          <div>
            <span className="label">Startup</span>
            <strong>{status.quietStartup ? "Quiet startup" : "Manual"}</strong>
          </div>
          <div>
            <span className="label">Verification</span>
            <strong>{status.lastVerification || "Ready"}</strong>
          </div>
        </div>

        <div className="actions">
          <button onClick={() => runAction("reconnect", reconnectDaemon)} disabled={busyAction !== null}>
            {busyAction === "reconnect" ? "Reconnecting" : "Reconnect"}
          </button>
          <button onClick={() => runAction("verify", runVerificationAgain)} disabled={busyAction !== null}>
            {busyAction === "verify" ? "Opening" : "Run verification again"}
          </button>
          <button className="secondary" onClick={() => runAction("open", openJarvis)} disabled={busyAction !== null}>
            Open Jarvis
          </button>
        </div>

        {errorMessage ? (
          <p className="error-message" role="alert">
            {errorMessage}
          </p>
        ) : null}
      </section>
    </main>
  );
}
