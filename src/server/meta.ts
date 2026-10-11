// Product names for the UI (plan v3 section 2). Holds no setting value and no secret.
import { Hono } from "hono";
import type { MetaDto } from "../shared/dto";
import { RUNNER, TOOL_LABELS } from "./review/catalog";
import type { ReviewJobs } from "./review/jobs";
import type { Settings } from "./settings";

export const createMeta = (review: ReviewJobs, settings: Settings) =>
  new Hono().get("/", (c) =>
    c.json({
      forge: { name: "Bitbucket" },
      runner: { ...RUNNER, check: review.runnerCheck() },
      tools: TOOL_LABELS,
      profiles: settings.profiles().map(({ id, name, note, explain, maxTurns }) => ({ id, name, note, explain, maxTurns })),
      context: [],
    } satisfies MetaDto),
  );
