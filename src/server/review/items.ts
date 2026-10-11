// Triage of review items (plan v3 WP12): accept, discard, restore, edit, and move.
import type { Database } from "bun:sqlite";
import type { ItemActionInput, ItemConflict, ReviewItemDto } from "../../shared/dto";
import { type AnchoredFinding, type AnchorState, diffLine, type ExcerptLine, moveChoices } from "../../shared/review";
import { type ItemRow, toItemDto } from "./jobs";

export type TriageResult =
  | { status: 200; item: ReviewItemDto; pr: number }
  | { status: 404 }
  | { status: 400; error: string }
  | { status: 409; conflict: ItemConflict };

const SQL = {
  item: "SELECT i.*, r.pr FROM review_item i JOIN review_run r ON r.id = i.run WHERE i.id = $id",
  // The revision check and the write are one statement, so two pages cannot both win.
  update: `UPDATE review_item SET status = $status, body = $body, edited = $edited, line = $line, line_end = $line_end,
      anchor_state = $anchor_state, revision = revision + 1 WHERE id = $id AND revision = $revision AND status != 'posted'`,
};

type Row = ItemRow & { pr: number };

export function triage(db: Database, id: number, input: ItemActionInput): TriageResult {
  const row = db.query(SQL.item).get({ id }) as Row | null;
  if (!row) return { status: 404 };
  const conflict = (error: string): TriageResult => ({ status: 409, conflict: { error, item: toItemDto(row) } });
  if (row.status === "posted") return conflict("The item is posted.");
  if (row.revision !== input.revision) return conflict("The item changed on another page. Check it again.");

  const next = { ...row };
  switch (input.action) {
    case "accept":
      // A reply draft with action none has no body.
      if (row.kind === "reply" && !row.body.trim()) return { status: 400, error: "Write the reply first." };
      next.status = "accepted";
      break;
    case "discard":
      next.status = "discarded";
      break;
    case "restore":
      next.status = "new";
      break;
    case "edit":
      next.status = "accepted";
      next.body = input.body;
      next.edited = 1;
      break;
    case "move": {
      if (row.kind !== "finding" || row.side === null || row.excerpt_json === null)
        return { status: 400, error: "Only a finding can move." };
      const excerpt = JSON.parse(row.excerpt_json) as ExcerptLine[];
      if (!moveChoices(excerpt, row.side).includes(input.line)) return { status: 400, error: "The line is not in the code excerpt." };
      const found = (JSON.parse(row.payload_json) as AnchoredFinding).anchor;
      // Back on the validator's line, the validator's state applies again.
      const state: AnchorState =
        input.line === found.line && input.line === found.lineEnd
          ? found.state
          : diffLine(excerpt, row.side, input.line)
            ? "exact"
            : "outside";
      next.line = input.line;
      next.line_end = input.line;
      next.anchor_state = state;
      break;
    }
  }
  const done = db.query(SQL.update).run({
    id,
    revision: input.revision,
    status: next.status,
    body: next.body,
    edited: next.edited,
    line: next.line,
    line_end: next.line_end,
    anchor_state: next.anchor_state,
  });
  const now = db.query(SQL.item).get({ id }) as Row;
  if (!done.changes) return { status: 409, conflict: { error: "The item changed on another page. Check it again.", item: toItemDto(now) } };
  return { status: 200, item: toItemDto(now), pr: row.pr };
}
