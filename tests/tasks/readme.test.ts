// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// docs/plans/review-v2/spec.md section 6.2, Diagram: the state diagram in the README section "Build a Jira task" equals the task machine.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { machineMermaid, taskMachine } from "../../src/server/tasks/machine";

test("the README diagram of the task states equals machineMermaid(taskMachine)", () => {
  const readme = readFileSync(join(import.meta.dir, "../../README.md"), "utf8").replaceAll("\r\n", "\n");
  const section = readme.slice(readme.indexOf("### Build a Jira task"));
  const block = /```mermaid\n([\s\S]*?)\n```/.exec(section)?.[1];
  expect(block).toBe(machineMermaid(taskMachine));
});
