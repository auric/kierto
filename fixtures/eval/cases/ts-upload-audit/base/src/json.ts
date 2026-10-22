import type { Readable } from "node:stream";

// Reads a JSON object body of at most maxBytes. null: the body is too large or is not a JSON object.
export async function readJson(body: Readable, maxBytes: number): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > maxBytes) {
      body.destroy();
      return null;
    }
    chunks.push(buf);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
