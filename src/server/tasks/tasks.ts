// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// The state writes of a task (docs/plans/review-v2/spec.md section 6.2). No other code writes task.state or task_part.state.
// Each write runs in a transaction, and a caller transaction makes it a savepoint: the caller writes its step row in the same commit.
// The caller runs every effect (a run start, a push, a notification) after the commit, from the new state.
import type { Database } from "bun:sqlite";
import { transition } from "xstate";
import { PART_STATE_TEXT, type PartState, TASK_STATE_TEXT, type TaskSize, type TaskState } from "../../shared/task";
import { type PartEvent, partMachine, type TaskEvent, taskMachine } from "./machine";

export type Advanced<S> =
  | { status: 200; state: S; version: number }
  | { status: 404; error: string }
  | { status: 409; error: string; state: S; version: number };

// version: task.version as the caller saw it. A part change raises the version of its task too.
export type TaskRef = { task: number; version: number };
// gate: the PR of the event passed its review rules (spec.md section 6.10). The machine reads it only for the gate events.
export type Facts = { gate?: boolean };

export const TASK_CHANGED = "The task changed on another page. Check it again.";

const SQL = {
  task: "SELECT state, stopped_from, size, version FROM task WHERE id = $id",
  part: "SELECT p.state, t.version FROM task_part p JOIN task t ON t.id = p.task WHERE p.id = $part AND p.task = $task",
  setTask: `UPDATE task SET state = $state, stopped_from = $stopped, version = version + 1, updated_at = $now
    WHERE id = $id AND version = $version`,
  setPart: "UPDATE task_part SET state = $state, updated_at = $now WHERE id = $id",
  bump: "UPDATE task SET version = version + 1, updated_at = $now WHERE id = $id AND version = $version",
  // The tasks whose Claude step was running at the last stop.
  running: `SELECT DISTINCT t.id, t.version FROM task t JOIN review_run r ON r.task = t.id WHERE r.status = 'running' ORDER BY t.id`,
  failSteps: `UPDATE task_step SET state = 'failed', ended_at = $now
    WHERE state = 'running' AND run IN (SELECT id FROM review_run WHERE status = 'running' AND task IS NOT NULL)`,
};

type TaskRow = { state: TaskState; stopped_from: TaskState | null; size: TaskSize | null; version: number };

function write(db: Database, sql: string, params: Record<string, string | number | null>) {
  // The version check of the same statement. The read in the same transaction already saw this version.
  if (db.query(sql).run(params).changes !== 1) throw new Error(TASK_CHANGED);
}

export function advance(db: Database, ref: TaskRef, event: TaskEvent, facts: Facts = {}, now = Date.now()): Advanced<TaskState> {
  return db.transaction((): Advanced<TaskState> => {
    const row = db.query(SQL.task).get({ id: ref.task }) as TaskRow | null;
    if (!row) return { status: 404, error: "Task not found." };
    if (row.version !== ref.version) return { status: 409, error: TASK_CHANGED, state: row.state, version: row.version };
    const snapshot = taskMachine.resolveState({
      value: row.state,
      context: { size: row.size, gate: facts.gate === true, stoppedFrom: row.stopped_from },
    });
    if (!snapshot.can(event)) return { status: 409, error: TASK_STATE_TEXT[row.state], state: row.state, version: row.version };
    const [next] = transition(taskMachine, snapshot, event);
    const state = next.value as TaskState;
    write(db, SQL.setTask, { id: ref.task, version: ref.version, state, stopped: state === "stopped" ? row.state : null, now });
    return { status: 200, state, version: ref.version + 1 };
  })();
}

export function advancePart(
  db: Database,
  ref: TaskRef & { part: number },
  event: PartEvent,
  facts: Facts = {},
  now = Date.now(),
): Advanced<PartState> {
  return db.transaction((): Advanced<PartState> => {
    const row = db.query(SQL.part).get({ part: ref.part, task: ref.task }) as { state: PartState; version: number } | null;
    if (!row) return { status: 404, error: "Part not found." };
    if (row.version !== ref.version) return { status: 409, error: TASK_CHANGED, state: row.state, version: row.version };
    const snapshot = partMachine.resolveState({ value: row.state, context: { gate: facts.gate === true } });
    if (!snapshot.can(event))
      return { status: 409, error: `This part is ${PART_STATE_TEXT[row.state].toLowerCase()}.`, state: row.state, version: row.version };
    const [next] = transition(partMachine, snapshot, event);
    const state = next.value as PartState;
    write(db, SQL.bump, { id: ref.task, version: ref.version, now });
    db.query(SQL.setPart).run({ id: ref.part, state, now });
    return { status: 200, state, version: ref.version + 1 };
  })();
}

// spec.md section 6.14: a Claude step that ran at the last stop has no process now. Its step ends failed, and its task stops, so
// Resume continues. Call it before the run recovery (run-rows.ts SQL.recover), which ends the runs themselves with kind restart.
export function recoverTasks(db: Database, now = Date.now()) {
  db.transaction(() => {
    const tasks = db.query(SQL.running).all() as { id: number; version: number }[];
    db.query(SQL.failSteps).run({ now });
    // A done or failed task refuses STOP and keeps its state.
    for (const t of tasks) advance(db, { task: t.id, version: t.version }, { type: "STOP" }, {}, now);
  })();
}
