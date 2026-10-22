// The signature header of the payments provider: "t=<unix seconds>,v1=<hex>[,v1=<hex>...]". The provider sends two v1
// values while it rotates its signing secret.
// t: the signing time in milliseconds. timestamp: the t value as sent, for the signed payload "<timestamp>.<body>".
// v1: the signatures, each 64 lowercase hex characters (an HMAC-SHA256).
export type SignatureHeader = { t: number; timestamp: string; v1: string[] };

// Returns null when the header is missing or malformed, or has no valid v1 value. Unknown keys are ignored.
export function parseSignatureHeader(value: string | undefined): SignatureHeader | null {
  if (!value) return null;
  let timestamp: string | null = null;
  const v1: string[] = [];
  for (const part of value.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === "t" && /^\d{1,12}$/.test(v)) timestamp = v;
    else if (k === "v1" && /^[0-9a-f]{64}$/.test(v)) v1.push(v);
  }
  if (timestamp === null || v1.length === 0) return null;
  return { t: Number(timestamp) * 1000, timestamp, v1 };
}
