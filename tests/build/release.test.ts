// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

import { expect, test } from "bun:test";
import { artifactName, sumsLine } from "../../scripts/release";

test("artifact names carry the version and .exe only on Windows", () => {
  expect(artifactName("0.2.0", "windows-x64")).toBe("kierto-0.2.0-windows-x64.exe");
  expect(artifactName("0.2.0", "darwin-arm64")).toBe("kierto-0.2.0-darwin-arm64");
});

test("SHA256SUMS lines use the sha256sum text format", () => {
  const hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  expect(sumsLine(hash, "kierto-0.2.0-linux-x64")).toBe(`${hash}  kierto-0.2.0-linux-x64\n`);
});
