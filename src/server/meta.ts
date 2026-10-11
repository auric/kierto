// Product names for the UI (plan v3 section 2). Holds no setting value and no secret.
import { Hono } from "hono";
import type { MetaDto } from "../shared/dto";
import { PROFILES, RUNNER, TOOL_LABELS } from "./review/catalog";
import type { ReviewJobs } from "./review/jobs";

export const createMeta = (review: ReviewJobs) =>
  new Hono().get("/", (c) =>
    c.json({
      forge: { name: "Bitbucket" },
      runner: { ...RUNNER, check: review.runnerCheck() },
      tools: TOOL_LABELS,
      profiles: PROFILES.map(({ focus, ...p }) => p),
      context: [],
    } satisfies MetaDto),
  );
