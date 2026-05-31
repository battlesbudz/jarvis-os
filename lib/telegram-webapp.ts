const TELEGRAM_WEBAPP_SCRIPT_SRC = "https://telegram.org/js/telegram-web-app.js";
const TELEGRAM_INIT_DATA_STORAGE_KEY = "@gameplan_telegram_init_data";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        ready?: () => void;
        expand?: () => void;
        openLink?: (url: string, options?: Record<string, unknown>) => void;
      };
    };
  }
}

function canUseTelegramWebApp(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export function getCachedTelegramInitData(): string | null {
  if (!canUseTelegramWebApp()) return null;

  const liveInitData = window.Telegram?.WebApp?.initData;
  if (liveInitData) return liveInitData;

  try {
    return window.sessionStorage.getItem(TELEGRAM_INIT_DATA_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function loadTelegramWebAppScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!canUseTelegramWebApp()) return reject(new Error("Not in browser"));
    if (window.Telegram?.WebApp) return resolve();

    const existing = document.querySelector(`script[src="${TELEGRAM_WEBAPP_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load Telegram Web App")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = TELEGRAM_WEBAPP_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Telegram Web App"));
    document.head.appendChild(script);
  });
}

export async function captureTelegramInitData(): Promise<string | null> {
  await loadTelegramWebAppScript();

  const webApp = window.Telegram?.WebApp;
  webApp?.ready?.();
  webApp?.expand?.();

  const initData = webApp?.initData || null;
  if (initData) {
    try {
      window.sessionStorage.setItem(TELEGRAM_INIT_DATA_STORAGE_KEY, initData);
    } catch {
      // Session storage can be unavailable in locked-down webviews.
    }
  }

  return initData || getCachedTelegramInitData();
}
