import { HttpError } from "./errors";
import type { Request } from "./server";

export const MAX_BODY_BYTES = 1024 * 1024;

// The whole body as bytes. Throws HttpError 413 beyond MAX_BODY_BYTES.
export async function readRawBody(req: Request, limit = MAX_BODY_BYTES): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req.body) {
    size += chunk.byteLength;
    if (size > limit) throw new HttpError(413, `The body is larger than ${limit} bytes.`);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
