// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

import { afterAll, expect, test } from "bun:test";
import { ForgeError } from "../../src/server/bitbucket/client";
import { createBitbucketProvider } from "../../src/server/bitbucket/provider";
import { FAKE_TOKEN, fixture, key, startFakeBitbucket, TEST_CA_FILE } from "../support/fake-bitbucket";
import { DASHBOARD_PATH } from "../support/scenarios";

process.env.REVIEW_LOOP_SECRETS = "memory";

const fake = startFakeBitbucket({ https: true, routes: { [key("GET", DASHBOARD_PATH)]: fixture("dashboard-pull-requests-page.json") } });
afterAll(() => fake.stop());

test("https fake fails without the CA file", async () => {
  const p = createBitbucketProvider({ baseUrl: fake.url, token: FAKE_TOKEN });
  const err = await p.currentUser().catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ForgeError);
  expect((err as ForgeError).kind).toBe("network");
  expect((err as ForgeError).code).toBe("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
  expect(fake.requests).toHaveLength(0);
});

test("https fake passes with the CA file", async () => {
  const p = createBitbucketProvider({ baseUrl: fake.url, token: FAKE_TOKEN, caFile: TEST_CA_FILE });
  expect(await p.currentUser()).toBe("jdoe");
});
