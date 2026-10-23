// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// docs/plans/thread-outcome.md sections 3 and 4. The rules live in src/shared/outcome.ts, so the PR context file of a run
// (docs/plans/review-v2/spec.md section 2.8) and the UI print the same words.
export {
  asksFix,
  type Conflict,
  type ConflictText,
  conflictText,
  findingConflict,
  findingConflictText,
  MARKER,
  type Marker,
  type Outcome,
  type OutcomeInput,
  type OutcomeKind,
  outcomeText,
  stateText,
  threadOutcome,
} from "../../shared/outcome";
