// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// docs/plans/review-v2/spec.md section 6.16.10 (WP-BR1): defaultBranch and listBranches against the fake Bitbucket, shaped as
// Gates G13 and G14 recorded them (integration-check.md). The live default flag key is isDefault; the 9.6 schema names it default.
import { afterEach, expect, test } from "bun:test";
import { ForgeError } from "../../src/server/bitbucket/client";
import { createBitbucketProvider } from "../../src/server/bitbucket/provider";
import { FAKE_TOKEN, type FakeBitbucket, key, repoWrites, startFakeBitbucket } from "../support/fake-bitbucket";

console.log(`branches.test.ts imported from ${Bun.resolveSync("../../src/server/bitbucket/provider", import.meta.dir)}`);

const PATH = "/rest/api/1.0/projects/PROJ/repos/repo";
let fake: FakeBitbucket;
afterEach(() => fake?.stop());
const provider = () => createBitbucketProvider({ baseUrl: fake.url, token: FAKE_TOKEN });
const page = (values: unknown[], isLastPage = true) => ({
  status: 200,
  body: { size: values.length, limit: 25, start: 0, isLastPage, values },
});

test("defaultBranch strips refs/heads/ from the id (Gate G13 keys: displayId, id, type); a repository without one throws 404", async () => {
  fake = startFakeBitbucket();
  repoWrites(fake, "PROJ", "repo", { defaultBranch: "release/2.1" });
  expect(await provider().defaultBranch("PROJ", "repo")).toBe("release/2.1");
  expect(fake.requests).toEqual([`GET ${PATH}/default-branch`]);
  fake.stop();
  fake = startFakeBitbucket();
  repoWrites(fake, "PROJ", "repo", { defaultBranch: null });
  const e = await provider()
    .defaultBranch("PROJ", "repo")
    .catch((x: unknown) => x);
  expect(e).toBeInstanceOf(ForgeError);
  expect((e as ForgeError).status).toBe(404);
});

test("listBranches sends filterText, boostMatches, orderBy, and the page limit; an empty filter sends only the order and the limit", async () => {
  fake = startFakeBitbucket();
  repoWrites(fake, "PROJ", "repo", { branches: ["release/2.1", "release/2.1-rc", "topic/a b"] });
  expect(await provider().listBranches("PROJ", "repo", "release/2.1")).toEqual({
    branches: [
      { name: "release/2.1", isDefault: false },
      { name: "release/2.1-rc", isDefault: false },
    ],
    more: false,
  });
  expect(await provider().listBranches("PROJ", "repo", "")).toMatchObject({ branches: [{ name: "main", isDefault: true }, {}, {}, {}] });
  expect(fake.requests).toEqual([
    `GET ${PATH}/branches?filterText=release%2F2.1&boostMatches=true&orderBy=MODIFICATION&limit=25`,
    `GET ${PATH}/branches?orderBy=MODIFICATION&limit=25`,
  ]);
});

test("the default flag reads isDefault (live, Gate G14) and default (DC 9.6 schema); a short page reports more", async () => {
  fake = startFakeBitbucket({
    routes: {
      [key("GET", `${PATH}/branches`)]: page(
        [
          { id: "refs/heads/main", displayId: "main", type: "BRANCH", isDefault: true, latestCommit: "a".repeat(40) },
          { id: "refs/heads/old", displayId: "old", type: "BRANCH", default: true },
          { id: "refs/heads/dev", displayId: "dev", type: "BRANCH", isDefault: false, default: true },
          { id: "refs/heads/x", displayId: "x", type: "BRANCH", isDefault: "yes" },
        ],
        false,
      ),
    },
  });
  expect(await provider().listBranches("PROJ", "repo", "")).toEqual({
    branches: [
      { name: "main", isDefault: true },
      { name: "old", isDefault: true },
      // isDefault wins when both keys are present.
      { name: "dev", isDefault: false },
      // A flag of another type reads as absent.
      { name: "x", isDefault: false },
    ],
    more: true,
  });
});
