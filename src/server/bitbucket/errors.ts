// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// One sentence and one button for a failed task write (spec.md sections 6.9 and 6.14, AC-B23).
import { ForgeError } from "./client";

// spec.md section 6.14: the repository has no http clone link with the configured origin.
export class NoCloneLink extends Error {
  override name = "NoCloneLink";
  constructor(project: string, repo: string) {
    super(`Bitbucket gives no https clone link for ${project}/${repo}.`);
  }
}

export type WriteAction = "create" | "update";
export type WriteProblem = { sentence: string; button: "Try again" | "Open settings" };

// id: the PR number of an update.
export function writeProblem(e: unknown, action: WriteAction, at: { project: string; repo: string; id?: number }): WriteProblem {
  const repo = `${at.project}/${at.repo}`;
  const pr = at.id === undefined ? "the pull request" : `pull request #${at.id}`;
  const create = action === "create";
  const again = (sentence: string): WriteProblem => ({ sentence, button: "Try again" });
  if (e instanceof NoCloneLink) return { sentence: e.message, button: "Open settings" };
  if (!(e instanceof ForgeError)) return again("No clear answer from Bitbucket. Try again.");
  // HTTP 401: the token itself fails, so more permissions do not help. The sync uses the same words.
  if (e.kind === "auth") return { sentence: "Bitbucket rejected the token. Enter a new token in Settings.", button: "Open settings" };
  if (e.kind === "forbidden")
    return again(
      create
        ? `The token cannot create pull requests in ${repo}. Give it Repository write in Bitbucket, then try again.`
        : `The token cannot change ${pr} in ${repo}. Give it Repository write in Bitbucket, then try again.`,
    );
  if (e.kind === "not_found")
    return again(
      create
        ? `Bitbucket cannot find ${repo}, or the token cannot read it. Check the repository, then try again.`
        : `Bitbucket cannot find ${pr} in ${repo}. Sync the inbox, then try again.`,
    );
  if (e.status === 409)
    return again(
      create
        ? `Bitbucket refused the new pull request in ${repo} because of a conflict. Check the branches, then try again.`
        : `Someone changed ${pr} in Bitbucket after the app read it. Try again.`,
    );
  if (e.kind === "rate") return again("Bitbucket is busy. Wait a minute, then try again.");
  if (e.status !== undefined && e.status < 500) return again(`Bitbucket refused the change (HTTP ${e.status}). Check ${pr} in Bitbucket.`);
  return again(`No clear answer from Bitbucket (${e.kind}). Try again.`);
}
