const JARVIS_API = process.env.JARVIS_API || "http://localhost:5000";
const SECRET = process.env.DASHBOARD_SECRET!;

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${JARVIS_API}${path}`, {
    headers: { Authorization: `Bearer ${SECRET}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}
