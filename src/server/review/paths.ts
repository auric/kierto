// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

import { isAbsolute, relative, sep } from "node:path";

// Lexical check only: it does not follow links. On Windows, path.relative compares drive letters and names case-insensitively.
// withRoot: true counts the root itself as inside.
export function inside(root: string, p: string, opts: { withRoot: boolean }): boolean {
  const r = relative(root, p);
  if (r === "") return opts.withRoot;
  return r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r);
}
