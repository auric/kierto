// Product names for the UI (plan v3 section 2). Holds no setting value and no secret.
import { Hono } from "hono";
import type { MetaDto } from "../shared/dto";

export const meta = new Hono().get("/", (c) => c.json({ forge: { name: "Bitbucket" } } satisfies MetaDto));
