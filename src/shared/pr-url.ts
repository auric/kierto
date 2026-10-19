// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

import type { PrRef } from "./types";

// Parses a project or personal PR web URL. The origin must equal the base origin, so the token never goes to another host.
export function parsePrUrl(input: string, baseUrl: string): PrRef {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    throw new Error("Not a pull request URL.");
  }
  if (u.origin !== new URL(baseUrl).origin) throw new Error("The URL origin differs from the Bitbucket URL origin.");
  const m = u.pathname.match(/\/(projects|users)\/([^/]+)\/repos\/([^/]+)\/pull-requests\/(\d+)(?:\/|$)/);
  if (!m?.[2] || !m[3] || !m[4]) throw new Error("Not a pull request URL.");
  const owner = decodeURIComponent(m[2]);
  // A personal repository uses the REST project key ~<USER SLUG> in upper case.
  return { project: m[1] === "users" ? `~${owner.toUpperCase()}` : owner, repo: decodeURIComponent(m[3]), id: Number(m[4]) };
}
