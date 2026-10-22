import { randomUUID } from "node:crypto";
import { type HttpClient, type HttpResponse, HttpTimeout } from "../http";

export class GatewayTimeout extends Error {}
export class GatewayUnavailable extends Error {}

// authorize() throws it. charge() reports a decline in its result instead.
export class CardDeclined extends Error {
  constructor(readonly code: string) {
    super(`card declined: ${code}`);
  }
}

export type ChargeRequest = { amountCents: number; currency: string; cardToken: string; reference: string; idempotencyKey: string };
export type ChargeResult = { status: "succeeded" | "declined"; chargeId: string; declineCode: string | null };

const TIMEOUT_MS = 15_000;

export class Gateway {
  constructor(
    private readonly http: HttpClient,
    private readonly apiKey: string,
  ) {}

  // Places a hold on the card and returns the hold ID. Throws CardDeclined on a decline.
  async authorize(amountCents: number, currency: string, cardToken: string): Promise<string> {
    const r = await this.post("/v2/authorizations", { amount: amountCents, currency, source: cardToken }, randomUUID());
    if (r.body.outcome === "declined") throw new CardDeclined(String(r.body.decline_code));
    return String(r.body.id);
  }

  // Creates at most one charge per idempotencyKey: a repeated key returns the result of the first request for 24 hours.
  // A decline resolves with status "declined". It does not throw.
  // Rejects with GatewayTimeout when no answer came within 15 s. The gateway may have created the charge.
  // Rejects with GatewayUnavailable on HTTP 502, 503, or 504. The gateway created no charge.
  async charge(req: ChargeRequest): Promise<ChargeResult> {
    const r = await this.post(
      "/v2/charges",
      { amount: req.amountCents, currency: req.currency, source: req.cardToken, reference: req.reference },
      req.idempotencyKey,
    );
    const declined = r.body.outcome === "declined";
    return { status: declined ? "declined" : "succeeded", chargeId: String(r.body.id), declineCode: declined ? String(r.body.decline_code) : null };
  }

  async refund(chargeId: string, amountCents: number, idempotencyKey: string): Promise<void> {
    await this.post(`/v2/charges/${encodeURIComponent(chargeId)}/refunds`, { amount: amountCents }, idempotencyKey);
  }

  private async post(path: string, body: unknown, idempotencyKey: string): Promise<HttpResponse> {
    let r: HttpResponse;
    try {
      r = await this.http.post(path, body, {
        headers: { authorization: `Bearer ${this.apiKey}`, "idempotency-key": idempotencyKey },
        timeoutMs: TIMEOUT_MS,
      });
    } catch (e) {
      if (e instanceof HttpTimeout) throw new GatewayTimeout(`${path}: no answer in ${TIMEOUT_MS} ms`);
      throw e;
    }
    if (r.status === 502 || r.status === 503 || r.status === 504) throw new GatewayUnavailable(`${path}: HTTP ${r.status}`);
    if (r.status >= 400) throw new Error(`${path}: HTTP ${r.status} ${JSON.stringify(r.body)}`);
    return r;
  }
}
