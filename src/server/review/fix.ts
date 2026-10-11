// Fix run validator (plan r3 S-FIX). Pure: the caller reads each edit path at the source head S of the run.
import type { DiffRowDto } from "../../shared/dto";
import { type Coverage, type FixResult, type FixThread, MAX_FIX_BYTES } from "../../shared/review";
import { deniedPath, editRows, type Located, locate, overlaps, prepareFile } from "./edits";
import { MAX_FILE_CHARS, repoPath } from "./validate";

// The tree entry of one edit path at S, keyed by repoPath(). A path without an entry is absent at S.
// blocked: a folder, or a path below a file. size: a blob above MAX_FILE_CHARS bytes.
export type FixFile = { mode: string; bytes: Uint8Array } | "blocked" | "size";

// ord: the index of the edit in the result.
export type ValidEdit = Located & { ord: number; thread: number; path: string; rows: DiffRowDto[] };
export type ValidatedFix = { summary: string; coverage: Coverage; threads: FixThread[]; edits: ValidEdit[] };

const PROBLEMS: Record<string, string> = {
  link: "the path is a link or a submodule",
  binary: "the file is binary",
  encoding: "the file is not UTF-8",
  lfs: "the file is a Git LFS pointer",
  absent: "the file does not exist at the head commit",
  exists: "old is empty, but the file exists",
  match: "old does not match the file",
  matches: "old matches more than one place",
};

const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ");
const utf8 = (s: string) => Buffer.byteLength(s, "utf8");

// Only requested threads pass. Every drop, every thread without a note, and every fixed note without a valid edit go to coverage.skipped.
export function validateFix(result: FixResult, requested: readonly number[], files: ReadonlyMap<string, FixFile>): ValidatedFix {
  const wanted = new Set(requested);
  const skipped = [...result.coverage.skipped];
  const notes = new Map<number, FixThread>();
  for (const t of result.threads) {
    const why = !wanted.has(t.thread) ? "the thread was not requested" : notes.has(t.thread) ? "a second note for the thread" : null;
    if (why) skipped.push(`Note for thread ${t.thread} dropped: ${why}.`);
    else notes.set(t.thread, t);
  }

  const edits: ValidEdit[] = [];
  let bytes = 0;
  const check = (e: FixResult["edits"][number], ord: number): string | null => {
    if (!wanted.has(e.thread)) return "the thread was not requested";
    if (!notes.has(e.thread)) return "the thread has no note";
    const path = repoPath(e.path);
    if (path === null) return "the path is not a repository path";
    if (deniedPath(path)) return "the app never edits this path";
    const f = files.get(path);
    if (f === "blocked") return "the path is a folder or lies below a file";
    if (f === "size") return `the file is larger than ${MAX_FILE_CHARS} bytes`;
    let text: string | null = null;
    if (f) {
      const p = prepareFile(f.bytes, f.mode);
      if ("problem" in p) return PROBLEMS[p.problem] as string;
      text = p.text;
    }
    const at = locate(text, e.old, e.new);
    if ("problem" in at) return PROBLEMS[at.problem] as string;
    if (text !== null && at.old === at.new) return "the edit changes nothing";
    const other = edits.find((x) => x.path === path && overlaps(x, at));
    if (other) return `the edit overlaps edit ${other.ord + 1}`;
    const size = utf8(at.old) + utf8(at.new);
    if (bytes + size > MAX_FIX_BYTES) return `the edits exceed ${MAX_FIX_BYTES} bytes`;
    bytes += size;
    edits.push({ ...at, ord, thread: e.thread, path, rows: editRows(text ?? "", at) });
    return null;
  };
  result.edits.forEach((e, ord) => {
    const why = check(e, ord);
    if (why) skipped.push(`Edit ${ord + 1} (thread ${e.thread}, ${oneLine(e.path)}) dropped: ${why}.`);
  });

  const threads: FixThread[] = [];
  for (const thread of [...wanted].sort((a, b) => a - b)) {
    const note = notes.get(thread);
    if (!note) skipped.push(`Thread ${thread} has no note.`);
    else if (note.fixed && !edits.some((e) => e.thread === thread)) skipped.push(`Thread ${thread} has no valid edit.`);
    else threads.push(note);
  }
  return { summary: result.summary, coverage: { ...result.coverage, skipped }, threads, edits };
}
