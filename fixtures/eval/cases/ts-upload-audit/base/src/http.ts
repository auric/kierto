import type { Readable } from "node:stream";

export type User = { id: string; name: string };

export type Request = {
  user: User | null;
  headers: Record<string, string | undefined>;
  params: Record<string, string>;
  body: Readable;
};

export type Response = { status: number; body?: unknown; headers?: Record<string, string> };
