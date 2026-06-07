declare module "next" {
  export interface Metadata {
    [key: string]: unknown;
  }
  export interface NextConfig {
    [key: string]: unknown;
  }
}

declare module "next/server" {
  export interface NextRequest extends Request {
    nextUrl: URL;
  }

  export class NextResponse {
    static json(body: unknown, init?: unknown): Response;
  }
}

declare module "next/navigation" {
  export function usePathname(): string;
  export function redirect(path: string): never;
}

declare module "next/link" {
  import type { ComponentType, ReactNode } from "react";

  interface LinkProps {
    href: string;
    className?: string;
    children?: ReactNode;
    [key: string]: unknown;
  }

  const Link: ComponentType<LinkProps>;
  export default Link;
}

declare module "@/components/Sidebar" {
  import type { ComponentType } from "react";

  const Sidebar: ComponentType;
  export default Sidebar;
}

declare module "vite" {
  export function defineConfig(config: unknown): unknown;
}

declare module "@vitejs/plugin-react" {
  const react: () => unknown;
  export default react;
}

declare module "@tauri-apps/api/core" {
  export function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

declare module "react-dom/client" {
  import type { ReactNode } from "react";

  export interface Root {
    render(children: ReactNode): void;
  }

  export function createRoot(container: Element | DocumentFragment): Root;
}
