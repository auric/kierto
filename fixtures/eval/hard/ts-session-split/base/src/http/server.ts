import type { Session } from "../auth/sessions";

export type Request = {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  ip: string;
  body: unknown;
  session?: Session;
};

export type Response = { status: number; headers?: Record<string, string>; body?: unknown };

export type Handler = (req: Request) => Promise<Response>;

export const json = (status: number, body: unknown, headers?: Record<string, string>): Response => ({ status, body, headers });
