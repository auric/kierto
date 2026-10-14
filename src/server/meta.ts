// Product names for the UI (plan v3 section 2), and the default model and effort of the runner. Holds no other setting value and no secret.
import { Hono } from "hono";
import type { MetaDto } from "../shared/dto";
import { JIRA } from "./context/jira";
import { RUNNER, TOOL_LABELS } from "./review/catalog";
import { runnerDefaults } from "./review/defaults";
import type { ReviewJobs } from "./review/jobs";
import type { Settings } from "./settings";

export const createMeta = (review: ReviewJobs, settings: Settings) =>
  new Hono().get("/", (c) =>
    c.json({
      forge: { name: "Bitbucket" },
      runner: { ...RUNNER, check: review.runnerCheck(), defaults: runnerDefaults() },
      tools: TOOL_LABELS,
      profiles: settings.profiles().map(({ id, name, note, explain, maxTurns }) => ({ id, name, note, explain, maxTurns })),
      context: [{ ...JIRA, configured: settings.config()?.jira !== undefined }],
    } satisfies MetaDto),
  );
