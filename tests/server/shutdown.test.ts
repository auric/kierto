// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRecords } from "../support/fake-claude";

const dirs: string[] = [];
const pids: number[] = [];
afterAll(() => {
  for (const pid of pids)
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(pred: () => boolean, ms: number) {
  const end = Date.now() + ms;
  while (!pred() && Date.now() < end) await Bun.sleep(25);
  return pred();
}

// Windows has no catchable SIGTERM: process.kill ends the process at once.
test.skipIf(process.platform === "win32")(
  "SIGTERM to the app stops the running claude process and its child",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "rl-shutdown-"));
    dirs.push(root);
    const app = Bun.spawn([process.execPath, join(import.meta.dir, "../support/shutdown-app.ts"), root], {
      stdout: "pipe",
      stderr: "inherit",
    });
    pids.push(app.pid);
    const record = join(root, "calls.jsonl");
    const calls = (): { argv: string[]; pid: number; childPid?: number }[] => readRecords(record);
    expect(await waitFor(() => calls().some((c) => c.childPid), 30_000)).toBe(true);
    const run = calls().find((c) => c.argv.includes("-p"));
    const child = calls().find((c) => c.childPid)?.childPid ?? 0;
    const cli = run?.pid ?? 0;
    pids.push(cli, child);
    expect(alive(cli) && alive(child)).toBe(true);

    app.kill("SIGTERM");
    const exited = await Promise.race([app.exited, Bun.sleep(15_000).then(() => null)]);
    expect(exited).toBe(0);
    expect(await waitFor(() => !alive(cli) && !alive(child), 10_000)).toBe(true);
  },
  60_000,
);
