import type { AuditLog } from "../audit";
import type { Config } from "../config";
import type { Db } from "../db";
import type { Gateway } from "../payments/gateway";
import { renewSubscription } from "../payments/subscriptions";
import type { Handlers } from "./worker";

export type Deps = { db: Db; gateway: Gateway; audit: AuditLog; config: Config };

const text = (payload: Record<string, unknown>, key: string): string => {
  const v = payload[key];
  if (typeof v !== "string" || v === "") throw new Error(`job payload needs ${key}`);
  return v;
};

export function handlers(deps: Deps): Handlers {
  return {
    "renew-subscription": (job) => renewSubscription(deps.db, deps.gateway, deps.audit, text(job.payload, "subscriptionId")),
    refund: (job) =>
      deps.gateway.refund(text(job.payload, "chargeId"), Number(job.payload.amountCents), `refund-${job.id}`),
  };
}
