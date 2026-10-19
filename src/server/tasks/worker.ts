// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Runs one task-ID pattern per request. The parent terminates this worker when a request passes its budget.
declare const self: Worker;

export type WorkerRequest = { id: number; pattern: string; text: string; keys?: string[]; max: number };
export type WorkerReply = { id: number; keys: string[] } | { id: number; error: string };

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, pattern, text, keys, max } = e.data;
  let re: RegExp;
  try {
    re = new RegExp(pattern, "g");
  } catch (err) {
    self.postMessage({ id, error: (err as Error).message } satisfies WorkerReply);
    return;
  }
  const allow = keys && new Set(keys);
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    // Capture group 1 is the ID when the pattern has one.
    const key = m.length > 1 ? m[1] : m[0];
    if (!key || out.includes(key)) continue;
    const dash = key.indexOf("-");
    if (allow && (dash < 0 || !allow.has(key.slice(0, dash)))) continue;
    out.push(key);
    if (out.length >= max) break;
  }
  self.postMessage({ id, keys: out } satisfies WorkerReply);
};

self.postMessage("ready");
