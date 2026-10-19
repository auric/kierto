// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Fake Jira Server for tests and the demo. It listens on 127.0.0.1 only and serves fixtures/jira/ payloads.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { key, startFakeBitbucket } from "./fake-bitbucket";

export const JIRA_TOKEN = "fake-jira-token-fedcba9876543210";
export const ISSUE_KEY = "ABC-42";

// Reads a raw response body from fixtures/jira/.
export function jiraFixture<T = Record<string, unknown>>(name: string): T {
  return JSON.parse(readFileSync(join(import.meta.dir, "../../fixtures/jira", name), "utf8"));
}

// A PNG of exactly size bytes: 8 x 8 pixels of one RGB color, padded with a tEXt chunk (PNG spec, sections 5 and 11.3.4.3).
export function pngOf(size: number, rgb: [number, number, number] = [0xd0, 0x30, 0x30]): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(Bun.hash.crc32(body) >>> 0, body.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(8, 0);
  ihdr.writeUInt32BE(8, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = [0, ...Array.from({ length: 8 }, () => rgb).flat()];
  const head = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from(Array.from({ length: 8 }, () => row).flat()))),
  ];
  const end = chunk("IEND", new Uint8Array());
  const label = Buffer.from("Comment\0", "latin1");
  const pad = size - head.reduce((n, b) => n + b.length, 0) - end.length - 12 - label.length;
  if (pad < 0) throw new Error(`A PNG needs more than ${size} bytes.`);
  return Buffer.concat([...head, chunk("tEXt", Buffer.concat([label, Buffer.alloc(pad, "x")])), end]);
}

// size bytes of an ASCII log.
export function logOf(size: number): Uint8Array {
  const line = "2026-01-06T14:00:00Z INFO sync worker: flushed 12 cache entries\n";
  return Buffer.from(line.repeat(Math.ceil(size / line.length)).slice(0, size), "latin1");
}

// The download path of an attachment (plan r3 S-ATT).
export const attachmentPath = (id: string, filename: string) => `/secure/attachment/${id}/${encodeURIComponent(filename)}`;

type Page = { startAt: number; maxResults: number; total: number; comments: unknown[] };
type Attachment = { id: string; filename: string; mimeType: string | null; size: number };
type Issue = { key: string; fields: { summary: string; attachment: Attachment[] } };

export function startFakeJira(opts: { port?: number; https?: boolean } = {}) {
  const fake = startFakeBitbucket(opts);
  fake.token = JIRA_TOKEN;
  fake.user = null;
  fake.routes[key("GET", "/rest/api/2/myself")] = { status: 200, body: jiraFixture("myself.json") };
  const issues = new Map<string, Issue>();

  // Serves body at the download path, with mimeType as Content-Type.
  function serve(a: { id: string; filename: string; mimeType: string | null }, body: Uint8Array) {
    fake.routes[key("GET", attachmentPath(a.id, a.filename))] = {
      status: 200,
      body,
      headers: a.mimeType ? { "Content-Type": a.mimeType } : {},
    };
  }

  // Serves issue.json and the two comment pages under this key. The fixture attachments get a PNG and a log of their sizes.
  function addIssue(issueKey: string, summary?: string) {
    const issue = jiraFixture<Issue>("issue.json");
    issue.key = issueKey;
    if (summary) issue.fields.summary = summary;
    for (const a of issue.fields.attachment) serve(a, a.mimeType === "image/png" ? pngOf(a.size) : logOf(a.size));
    issues.set(issueKey, issue);
    const pages = [jiraFixture<Page>("comments-p0.json"), jiraFixture<Page>("comments-p1.json")];
    const path = `/rest/api/2/issue/${issueKey}`;
    fake.routes[key("GET", path)] = { status: 200, body: issue };
    fake.routes[key("GET", `${path}/comment`)] = (req) => {
      const at = Number(new URL(req.url).searchParams.get("startAt") ?? 0);
      return { status: 200, body: pages.find((p) => p.startAt === at) ?? { startAt: at, maxResults: 2, total: 3, comments: [] } };
    };
  }
  addIssue(ISSUE_KEY);

  // Lists a new attachment on the issue and serves body for it. size: the listed size, body.length when absent.
  function attach(issueKey: string, a: { id: string; filename: string; mimeType: string | null; body: Uint8Array; size?: number }) {
    const issue = issues.get(issueKey);
    if (!issue) throw new Error(`No issue ${issueKey}.`);
    issue.fields.attachment.push({ id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size ?? a.body.length });
    serve(a, a.body);
  }

  return Object.assign(fake, { addIssue, attach });
}

export type FakeJira = ReturnType<typeof startFakeJira>;
