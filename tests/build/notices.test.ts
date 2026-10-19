// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

import { expect, test } from "bun:test";
import { compatible, packageDir } from "../../scripts/notices";

test("a license expression is compatible only when its SPDX IDs are on the list", () => {
  expect(compatible("MIT")).toBe(true);
  expect(compatible("(MIT OR GPL-2.0-only)")).toBe(true);
  expect(compatible("MIT AND Apache-2.0")).toBe(true);
  expect(compatible("MIT AND SSPL-1.0")).toBe(false);
  expect(compatible("BUSL-1.1")).toBe(false);
  expect(compatible("UNKNOWN")).toBe(false);
  // Mixed or nested expressions need a manual review.
  expect(compatible("MIT OR (Apache-2.0 AND BSD-3-Clause)")).toBe(false);
  expect(compatible("MIT OR Apache-2.0 AND ISC")).toBe(false);
});

test("the package folder is the name after the last node_modules segment", () => {
  expect(packageDir("D:\\r\\node_modules\\react\\cjs\\react.js")).toBe("D:/r/node_modules/react");
  expect(packageDir("/r/node_modules/@base-ui/react/esm/index.js")).toBe("/r/node_modules/@base-ui/react");
  expect(packageDir("/r/node_modules/a/node_modules/b/x.js?commonjs-proxy")).toBe("/r/node_modules/a/node_modules/b");
  expect(packageDir("/r/src/web/main.tsx")).toBeNull();
});
