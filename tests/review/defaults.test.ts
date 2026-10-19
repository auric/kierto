// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readUserSettings, runEffort, runnerDefaults } from "../../src/server/review/defaults";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

// A fake config folder with settings.json. A string goes in as the file text.
function config(settings?: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "rl-defaults-"));
  dirs.push(dir);
  if (settings !== undefined) writeFileSync(join(dir, "settings.json"), typeof settings === "string" ? settings : JSON.stringify(settings));
  return dir;
}

const sure = (value: string) => ({ value, sure: true });
const efforts = (dir: string, env = {}) =>
  Object.fromEntries(Object.entries(runnerDefaults(dir, env)?.effort ?? {}).map(([k, v]) => [k, v.sure ? v.value : `${v.value}?`]));

describe("settings file", () => {
  test("an absent file, bad JSON, or a non-object gives null", () => {
    for (const dir of [config(), config("{ not json"), config("[1, 2]"), config('"opus"')]) {
      expect(readUserSettings(dir)).toBeNull();
      expect(runnerDefaults(dir, {})).toBeNull();
      expect(runEffort("opus", dir, {})).toBeNull();
    }
  });

  test("unknown keys and values of a bad type are ignored", () => {
    const dir = config({
      model: 5,
      effortLevel: "turbo",
      apiKeyHelper: "secret",
      modelSettings: { "claude-opus-5-5": "bad" },
      env: { TOKEN: "x" },
    });
    expect(readUserSettings(dir)).toEqual({ modelSettings: { "claude-opus-5-5": {} }, env: { TOKEN: "x" } });
    const d = runnerDefaults(dir, {});
    expect(d).toEqual({ model: null, effort: { opus: sure("medium"), sonnet: sure("medium"), haiku: sure("medium") } });
    expect(JSON.stringify(d)).not.toContain("secret");
  });
});

describe("effort precedence", () => {
  test("a modelSettings level applies to its model and to the alias of that model", () => {
    const dir = config({ model: "opus", effortLevel: "xhigh", modelSettings: { "claude-opus-5-5": { effortLevel: "xhigh" } } });
    expect(runnerDefaults(dir, {})?.model).toEqual(sure("opus"));
    expect(efforts(dir)).toEqual({ "": "xhigh", opus: "xhigh", sonnet: "medium", haiku: "medium" });
  });

  test("Opus 5.5 and later ignore a top-level effortLevel in user settings; older models use it", () => {
    const dir = config({ model: "claude-opus-5", effortLevel: "low" });
    expect(efforts(dir)).toEqual({ "": "low", opus: "medium", sonnet: "medium", haiku: "medium" });
    expect(runEffort("claude-opus-4-8", dir, {})).toBe("low");
    expect(runEffort("claude-sonnet-5-5", dir, {})).toBe("medium");
  });

  test("a modelSettings level wins over the top-level effortLevel of the same file", () => {
    const dir = config({ effortLevel: "low", modelSettings: { "claude-opus-5": { effortLevel: "high" } } });
    expect(runEffort("claude-opus-5", dir, {})).toBe("high");
  });

  test("each model has its own default without settings", () => {
    const dir = config({});
    expect(runEffort("claude-opus-4-7", dir, {})).toBe("xhigh");
    expect(runEffort("claude-fable-5-1", dir, {})).toBe("high");
    expect(runEffort("claude-haiku-5-5", dir, {})).toBe("medium");
  });

  test("[1m] and a date suffix map to the modelSettings entry of the model", () => {
    const dir = config({ modelSettings: { "claude-opus-5-5": { effortLevel: "high" }, "claude-sonnet-5": { effortLevel: "low" } } });
    expect(runEffort("opus[1m]", dir, {})).toBe("high");
    expect(runEffort("claude-opus-5-5[1m]", dir, {})).toBe("high");
    expect(runEffort("claude-sonnet-5-20260101", dir, {})).toBe("low");
  });

  test("an unknown model gets only its own modelSettings level, never the top-level effortLevel", () => {
    const dir = config({ effortLevel: "low", modelSettings: { "claude-next-1": { effortLevel: "high" } } });
    expect(runEffort("claude-other-1", dir, {})).toBeNull();
    expect(runEffort("claude-next-1", dir, {})).toBe("high");
    expect(runEffort("opusplan", dir, {})).toBeNull();
  });

  test("maxEffortLevel caps the level; a modelSettings cap replaces the top-level cap", () => {
    const dir = config({
      maxEffortLevel: "medium",
      modelSettings: { "claude-opus-5-5": { effortLevel: "xhigh" }, "claude-sonnet-5-5": { effortLevel: "xhigh", maxEffortLevel: "max" } },
    });
    expect(efforts(dir)).toEqual({ opus: "medium", sonnet: "xhigh", haiku: "medium" });
  });

  test("a model without xhigh runs a higher level at high", () => {
    const dir = config({ effortLevel: "xhigh" });
    expect(runEffort("claude-opus-4-6", dir, {})).toBe("high");
  });
});

describe("profile model texts", () => {
  test("each profile model text is a key as given: a full ID, an alias with [1m], a date suffix, and any case", () => {
    const dir = config({ modelSettings: { "claude-opus-5-5": { effortLevel: "xhigh" } } });
    const texts = ["claude-opus-5-5", "opus[1m]", "Claude-Opus-5-5-20260101", "claude-opus-4-7", "claude-next-1", "opus"];
    const effort = runnerDefaults(dir, {}, texts)?.effort ?? {};
    expect(effort["claude-opus-5-5"]).toEqual(sure("xhigh"));
    expect(effort["opus[1m]"]).toEqual(sure("xhigh"));
    expect(effort["Claude-Opus-5-5-20260101"]).toEqual(sure("xhigh"));
    expect(effort["claude-opus-4-7"]).toEqual(sure("xhigh"));
    // An unknown model without its own modelSettings entry stays unknown.
    expect(effort).not.toHaveProperty("claude-next-1");
    // An alias text keeps its one key.
    expect(Object.keys(effort).filter((k) => k === "opus")).toHaveLength(1);
  });

  test("a profile model follows an alias env variable and the settings env block", () => {
    const pinned = runnerDefaults(config({}), { ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-4-7" }, ["opus[1m]"]);
    expect(pinned?.effort["opus[1m]"]).toEqual(sure("xhigh"));
    const block = runnerDefaults(config({ env: { CLAUDE_CODE_EFFORT_LEVEL: "low" } }), {}, ["claude-opus-5-5"]);
    expect(block?.effort["claude-opus-5-5"]).toEqual({ value: "low", sure: false });
  });
});

describe("model precedence and env", () => {
  test("ANTHROPIC_MODEL wins over the model key", () => {
    const dir = config({ model: "opus", modelSettings: { "claude-opus-5-5": { effortLevel: "xhigh" } } });
    const d = runnerDefaults(dir, { ANTHROPIC_MODEL: "haiku" });
    expect(d?.model).toEqual(sure("haiku"));
    expect(d?.effort[""]).toEqual(sure("medium"));
  });

  test("an alias env variable changes the model of the alias", () => {
    const dir = config({});
    expect(efforts(dir, { ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-4-7" }).opus).toBe("xhigh");
  });

  test("no model anywhere: the default model is unknown, so its effort is unknown", () => {
    const dir = config({ modelSettings: { "claude-opus-5-5": { effortLevel: "high" } } });
    expect(runnerDefaults(dir, {})?.model).toBeNull();
    expect(efforts(dir)).not.toHaveProperty("");
    expect(runEffort(null, dir, {})).toBeNull();
    // The init event names the model, so the run end knows the effort.
    expect(runEffort("claude-opus-5-5", dir, {})).toBe("high");
  });

  test("ANTHROPIC_DEFAULT_MODEL gives a model that is not sure", () => {
    const dir = config({});
    const d = runnerDefaults(dir, { ANTHROPIC_DEFAULT_MODEL: "opus" });
    expect(d?.model).toEqual({ value: "opus", sure: false });
    expect(d?.effort[""]).toEqual({ value: "medium", sure: false });
    expect(runEffort(null, dir, { ANTHROPIC_DEFAULT_MODEL: "opus" })).toBeNull();
  });

  test("the run gets no CLAUDE_CODE_* variable, so the process value is ignored", () => {
    const dir = config({ model: "opus" });
    expect(efforts(dir, { CLAUDE_CODE_EFFORT_LEVEL: "low" })[""]).toBe("medium");
  });

  test("the settings env block gives values that are not sure, and a run stores no such value", () => {
    const dir = config({ model: "opus", env: { CLAUDE_CODE_EFFORT_LEVEL: "low", OTHER: "x" } });
    expect(efforts(dir)).toEqual({ "": "low?", opus: "low?", sonnet: "low?", haiku: "low?" });
    expect(runnerDefaults(dir, {})?.model).toEqual({ value: "opus", sure: false });
    expect(runEffort("claude-opus-5-5", dir, {})).toBeNull();
  });
});
