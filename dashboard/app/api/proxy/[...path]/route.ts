import { NextRequest, NextResponse } from "next/server";

const JARVIS_API = process.env.JARVIS_API || "http://localhost:5000";
const SECRET = process.env.DASHBOARD_SECRET!;

async function proxy(req: NextRequest, path: string[], method: string) {
  const apiPath = path.join("/");
  const url = new URL(req.url);
  const targetUrl = `${JARVIS_API}/api/${apiPath}${url.search}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${SECRET}`,
    "Content-Type": "application/json",
  };

  let body: string | undefined;
  if (method !== "GET" && method !== "HEAD") {
    body = await req.text();
  }

  const res = await fetch(targetUrl, {
    method,
    headers,
    body,
    cache: "no-store",
  });

  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxy(req, path, "GET");
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxy(req, path, "POST");
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxy(req, path, "PATCH");
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxy(req, path, "DELETE");
}
