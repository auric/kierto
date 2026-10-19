// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// The current user check, shared by the server and the web.
// me: the X-AUSERNAME value, the username. It can differ from the slug in case and in form.

// Folds ASCII letters only. SQLite lower() does the same, so the SQL and the JS checks always agree.
export const foldCase = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

export function isMe(u: { slug: string; login?: string | null }, me: string | null): boolean {
  if (me === null) return false;
  const m = foldCase(me);
  return foldCase(u.slug) === m || (u.login != null && foldCase(u.login) === m);
}
