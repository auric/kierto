// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Playwright kills the web server without a signal on Windows, so serve.ts gets the shutdown route first.
import { control } from "./control";

export default async function teardown() {
  await control("shutdown").catch(() => {});
}
