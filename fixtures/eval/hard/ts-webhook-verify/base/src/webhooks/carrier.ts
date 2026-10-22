import { timingSafeEqual } from "node:crypto";
import type { EventStore } from "../events/store";
import { readRawBody } from "../http/body";
import { type Handler, json } from "../http/server";

type CarrierEvent = { eventId: string; kind: string; shipmentId: string };

// The shipping carrier sends a shared token in a header. It retries each delivery until it gets a 2xx answer.
export function carrierWebhook(token: Buffer, events: EventStore): Handler {
  return async (req) => {
    const sent = Buffer.from(req.headers["x-carrier-token"] ?? "");
    if (sent.length !== token.length || !timingSafeEqual(sent, token)) return json(401, { error: "bad token" });
    const event = JSON.parse((await readRawBody(req)).toString("utf8")) as CarrierEvent;
    if (typeof event?.eventId !== "string") return json(200, { status: "ignored" });
    const inserted = await events.add("carrier", event.eventId, event.kind, event);
    return json(inserted ? 202 : 200, { status: inserted ? "queued" : "duplicate" });
  };
}
