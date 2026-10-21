// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// context/task.md of a run (plan r2 WP0): the imported task text of the PR. The workspace puts the UNTRUSTED banner before it.
// Plan r3 S-ATT: task.md lists every attachment. The included ones go to context/attachments/.
import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { oneLine } from "../../shared/consult";
import { type AttachmentMeta, type IssueContext, RUN_IMAGE_BYTES, RUN_IMAGES, RUN_TEXT_BYTES, RUN_TEXT_TOTAL } from "../../shared/dto";
import type { AttachmentFile, ContextFile } from "../review/workspace";
import { type Raster, rasterOfFile, resolveFile } from "./attachments";
import { ATTACHMENT_IMAGE } from "./markdown";

export const TASK_FILE = "task.md";

const SOURCES: Record<string, string> = { jira: "Jira" };
const MB = 1024 * 1024;

type TaskRow = { key: string; source: string; json: string; fetched_at: number };
type FileRow = {
  key: string;
  att_id: string;
  filename: string;
  // The media type that Jira lists, for display only. image and text come from the file bytes.
  mime: string | null;
  size: number;
  file: string;
  image: number;
  text: number;
  include: number;
};

// The task files of a run and its attachments for context/attachments/. dataDir: the data folder of the run.
// Without dataDir, no attachment is included.
export function taskContext(db: Database, pr: number, dataDir: string | null): { files: ContextFile[]; attachments: AttachmentFile[] } {
  const rows = db.query("SELECT key, source, json, fetched_at FROM task_context WHERE pr = $pr ORDER BY key").all({ pr }) as TaskRow[];
  if (!rows.length) return { files: [], attachments: [] };
  const downloaded = db
    .query("SELECT key, att_id, filename, mime, size, file, image, text, include FROM task_attachment WHERE pr = $pr ORDER BY key, att_id")
    .all({ pr }) as FileRow[];
  const attachments: AttachmentFile[] = [];
  let images = 0;
  let textBytes = 0;

  // The state line of one attachment. It adds an included file to attachments.
  const include = (id: string, d: FileRow | undefined): string => {
    if (!d) return "Not downloaded.";
    if (!d.include) return "Not included.";
    if (attachments.some((a) => a.name.startsWith(`${id}.`))) return "Not included: another task lists the same file.";
    const src = dataDir === null ? null : resolveFile(dataDir, d.file);
    let raster: Raster | null = null;
    try {
      if (!src || !existsSync(src)) return "Not included: the file is missing.";
      if (d.image) raster = rasterOfFile(src);
    } catch {
      return "Not included: the file is missing.";
    }
    let name: string;
    if (raster) {
      if (d.size > RUN_IMAGE_BYTES) return `Not included: images over ${RUN_IMAGE_BYTES / MB} MB are listed only.`;
      if (images === RUN_IMAGES) return `Not included: a run gets at most ${RUN_IMAGES} images.`;
      images++;
      name = `${id}.${raster}`;
    } else if (d.text) {
      const bytes = Math.min(d.size, RUN_TEXT_BYTES);
      if (textBytes + bytes > RUN_TEXT_TOTAL) return `Not included: a run gets at most ${RUN_TEXT_TOTAL / MB} MB of text files.`;
      textBytes += bytes;
      name = `${id}.txt`;
    } else {
      return "Not included: only images and text files go to runs.";
    }
    attachments.push({ name, src, text: !raster });
    return `Included as ./attachments/${name}${d.size > RUN_TEXT_BYTES && !raster ? `, cut at ${RUN_TEXT_BYTES / 1024} KB` : ""}.`;
  };

  const out: string[] = [];
  for (const r of rows) {
    const i = JSON.parse(r.json) as IssueContext;
    const mine = downloaded.filter((d) => d.key === r.key);
    // A refetch can drop a listed file that the user downloaded before.
    const listed: AttachmentMeta[] = [
      ...(i.attachments ?? []),
      ...mine
        .filter((d) => !i.attachments?.some((a) => a.id === d.att_id))
        .map((d) => ({ id: d.att_id, filename: d.filename, mimeType: d.mime, size: d.size, created: null })),
    ];
    const lines = listed.map((a) => {
      const state = include(
        a.id,
        mine.find((d) => d.att_id === a.id),
      );
      return `- ${oneLine(a.filename)}: ${a.size} bytes, ${oneLine(a.mimeType ?? "unknown type")}. ${state}`;
    });
    const shown = new Map(attachments.filter((a) => !a.text).map((a) => [a.name.split(".")[0], a.name]));
    // Rows without a format hold plain text.
    const body = (s: string) =>
      i.format === "markdown"
        ? s.replace(ATTACHMENT_IMAGE, (_, name: string, id: string) => {
            const file = shown.get(id);
            return file ? `![${name}](./attachments/${file})` : `(image: ${name})`;
          })
        : s;
    out.push(
      `## Task ${r.key}: ${oneLine(i.summary)}`,
      "",
      `- Source: ${SOURCES[r.source] ?? r.source}`,
      `- Status: ${oneLine(i.status ?? "(none)")}`,
      `- Fetched: ${new Date(r.fetched_at).toISOString()}`,
      ...(i.truncated ? ["- The app cut this text at its size limits."] : []),
      "",
      "### Description",
      "",
      body(i.description?.trim() || "(none)"),
      "",
      `### Comments (${i.comments.length} of ${i.commentsTotal})`,
      "",
    );
    for (const c of i.comments) out.push(`#### ${oneLine(c.author)}, ${oneLine(c.created)}`, "", body(c.body), "");
    if (!i.comments.length) out.push("(none)", "");
    if (lines.length) out.push(`### Attachments (${lines.length})`, "", ...lines, "");
  }
  return { files: [{ name: TASK_FILE, text: out.join("\n") }], attachments };
}

// task.md alone. No attachment is included.
export const taskFiles = (db: Database, pr: number): ContextFile[] => taskContext(db, pr, null).files;
