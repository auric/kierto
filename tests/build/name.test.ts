// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

import { expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => Bun.file(join(ROOT, path)).text();

test("shipped files do not show an old product name", async () => {
  const paths = ["index.html", "package.json", "NOTICE.md", "THIRD_PARTY_NOTICES.md"];
  for (const dir of ["src", "scripts"]) for (const p of new Bun.Glob(`${dir}/**`).scanSync(ROOT)) paths.push(p);
  const hits: string[] = [];
  for (const p of paths) if (/\b(kierto|revido)\b/i.test(await read(p))) hits.push(p);
  expect(hits).toEqual([]);
});

test("the About footer shows the attribution that NOTICE.md requires", async () => {
  const shown = /Notices show "([^"]+ by Ihor Lifanov)"/.exec(await read("NOTICE.md"))?.[1];
  expect(shown).toBe("PR Review Inbox by Ihor Lifanov");
  expect(await read("src/web/settings/About.tsx")).toContain(`>${shown}<`);
});
