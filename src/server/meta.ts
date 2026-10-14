// Product names for the UI (plan v3 section 2), and the default model and effort of the runner. Holds no other setting value and no secret.
import { Hono } from "hono";
import type { MetaDto } from "../shared/dto";
import { JIRA } from "./context/jira";
import { RUNNER, TOOL_LABELS } from "./review/catalog";
import { runnerDefaults } from "./review/defaults";
import type { ReviewJobs } from "./review/jobs";
import type { Settings } from "./settings";

export const createMeta = (review: ReviewJobs, settings: Settings) =>
  new Hono().get("/", (c) => {
    const profiles = settings.profiles();
    const models = profiles.flatMap((p) => (p.model ? [p.model] : []));
    return c.json({
      forge: { name: "Bitbucket" },
      runner: { ...RUNNER, check: review.runnerCheck(), defaults: runnerDefaults(undefined, undefined, models) },
      tools: TOOL_LABELS,
      profiles: profiles.map((p) => ({
        id: p.id,
        name: p.name,
        note: p.note,
        explain: p.explain,
        maxTurns: p.maxTurns,
        model: p.model,
        effort: p.effort,
        reviewerMode: p.reviewer.mode,
        skillCount: p.skills.length,
        mcpCount: p.mcp.length,
      })),
      context: [{ ...JIRA, configured: settings.config()?.jira !== undefined }],
    } satisfies MetaDto);
  });
