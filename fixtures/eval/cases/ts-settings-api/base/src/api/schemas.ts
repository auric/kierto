import { z } from "zod";

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): Parsed<T> {
  const r = schema.safeParse(body);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, error: r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") };
}

export const generalSchema = z
  .object({
    siteName: z.string().trim().min(1).max(80).optional(),
    supportEmail: z.string().email().optional(),
  })
  .strict();
