// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

import { expect, test } from "bun:test";
import { parsePrUrl } from "../../src/shared/pr-url";

process.env.REVIEW_LOOP_SECRETS = "memory";

const BASE = "https://bitbucket.example.test";

test("project URL parses", () => {
  expect(parsePrUrl(`${BASE}/projects/PROJ1/repos/sample-repo-2/pull-requests/1001`, BASE)).toEqual({
    project: "PROJ1",
    repo: "sample-repo-2",
    id: 1001,
  });
});

test("personal URL with /overview parses to the ~USER key", () => {
  expect(parsePrUrl(`${BASE}/users/jdoe/repos/sample-repo-1/pull-requests/2/overview`, `${BASE}/`)).toEqual({
    project: "~JDOE",
    repo: "sample-repo-1",
    id: 2,
  });
});

test("a context path in the base URL works", () => {
  const base = `${BASE}/bitbucket`;
  expect(parsePrUrl(`${base}/projects/PROJ1/repos/r/pull-requests/7`, base)).toEqual({ project: "PROJ1", repo: "r", id: 7 });
});

test("a foreign origin is refused", () => {
  expect(() => parsePrUrl("https://evil.example.test/projects/PROJ1/repos/r/pull-requests/1", BASE)).toThrow("origin");
  expect(() => parsePrUrl("http://bitbucket.example.test/projects/PROJ1/repos/r/pull-requests/1", BASE)).toThrow("origin");
});

test("a non-PR URL is refused", () => {
  expect(() => parsePrUrl(`${BASE}/projects/PROJ1/repos/r/browse`, BASE)).toThrow();
  expect(() => parsePrUrl("PROJ1/r/1", BASE)).toThrow();
  expect(() => parsePrUrl(`${BASE}/projects/PROJ1/repos/r/pull-requests/1x`, BASE)).toThrow();
});
