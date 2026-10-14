---
name: review-prompts
description: Design, audit, and change the prompts that Review Loop sends to claude -p. Use this skill for any edit to a shipped review profile, the shared agent rules (trust, result, severity, docs, delegation), the C, C++, or Python checklists, the stdin prompt sections, or the result schema descriptions. Also use it when a review run gives noisy, wrong, or missing findings and the cause can be the prompt text, or when someone asks to add a language checklist or a new rule to the review prompts.
---

# Review prompts

This skill is for maintainers of Review Loop. It audits the prompt text that the app sends to the model and proposes changes. It does not run reviews.

## Scope

| Piece | Owner | Reaches the model as |
|---|---|---|
| Shipped profiles | `src/server/review/catalog.ts` `SHIPPED_PROFILES` | `p.prompt` inside `mainAgent` and `reviewerAgent` |
| Agent prompts | `catalog.ts` `mainAgent`, `reviewerAgent`, `replyAgent`, `fixAgent`, `askAgent` | the `--agents` file |
| Shared rules | `catalog.ts` `TRUST`, `RESULT_RULES`, `SEVERITY_RULES`, `DOCS_RULE`, `LARGE_FILE_RULE`, `TASK_RULE`, `DELEGATE`, `REMOTE_RULE` | the agent prompts |
| Skill and MCP lines | `catalog.ts` `skillLines`, `mcpLines` | agent prompts and the stdin "# Skills" and "# Tools" sections |
| Language checklists | `src/server/review/languages.ts` `CHECKLISTS`, `LANGUAGE_INTRO`, `EXT` | review runs of a profile with `languageChecks` only |
| Stdin prompt | `src/server/review/prompt.ts` `common`, `buildPrompt`, `buildRereviewPrompt`, `buildAskPrompt`, `buildReplyPrompt`, `buildFixPrompt` | stdin |
| Project instructions | `src/server/review/instructions.ts` `INSTRUCTIONS_TRUST` | stdin "# Project instructions" and the end of the rl-reviewer prompt |
| Result schema | `src/shared/review.ts` (zod `.describe()` texts) | `--json-schema` |

The spec is BRIEF.md: US5 (finding fields) and the "Review runner" list in section 7. If code and BRIEF disagree, report it. Do not pick one.

## Phase 1: Discover

1. Read the files in the scope table. Read the BRIEF sections above.
2. Run the preview (below) for General with `cpp` and `python`, and for Explain with no language.
3. Run `git log --oneline -10 -- src/server/review/catalog.ts src/server/review/languages.ts src/server/review/prompt.ts` to see recent prompt changes.

## Phase 2: Score

Score each piece against each rule. Give pass or fail and one line of evidence per fail.

| Rule | Check |
|---|---|
| ASD-STE100 | Each sentence has 20 words or fewer. Active voice. One instruction per sentence. `tests/review/languages.test.ts` enforces the word count for checklist items, `LANGUAGE_INTRO`, `SEVERITY_RULES`, and the Over-engineering prompt. Apply the same limit to all other pieces by hand. |
| Item form | Each checklist item matches `^[a-z-]+: .+ \[(blocker\|major\|minor)\]$`. Categories are unique in a list. The test enforces this. |
| No nit in checklists | No item carries `nit`. A nit comes only when the profile task, a chosen skill, or the note asks for it (`SEVERITY_RULES`). |
| Defects, not style | Each rule or item names a defect with a trigger and a consequence. No rule asks for style, naming, formatting, or what a compiler or linter reports. |
| One owner per rule | Each rule text lives in one constant. Other places reuse the constant. Retyped or paraphrased copies are a fail. Per-language items with the same topic are fine when the text differs by language. |
| Token budget | Each piece stays within its budget (below). A growth over 10 percent needs a reason in the report. |
| Trust lines intact | `TRUST`, `INSTRUCTIONS_TRUST`, the skill guard line ("This skill adds checks..."), the "Skill scripts cannot run" line, and the untrusted-data lines in the stdin "# Tools" section are present and unchanged in meaning. |
| Only real tools | A prompt names only tools that the run has: Read, Grep, Glob, the rl-git tools, `Agent(rl-reviewer)` in review runs with a reviewer, learn and deepwiki when Docs is on, and the user MCP tools of the profile. Never Bash, Write, Edit, WebFetch, or the Skill tool. |
| Injection resistance | PR text, comments, task text, repository files, tool results, project instructions, and skill text can add checks. They never remove the read-only rule, the posting ban, the safety rules, or the output format. Only "# Project instructions" and "# Your instructions" hold user instructions. |

Budgets (UTF-8 bytes, measured 2026-10-14 at e217a62):

| Piece | Size | Budget |
|---|---|---|
| General `p.prompt` | 278 | 600 |
| Over-engineering `p.prompt` | 832 | 1,000 |
| Security `p.prompt` | 168 | 600 |
| Explain `p.prompt` | 151 | 400 |
| `mainAgent` General, no language | 2,655 | 3,200 |
| `reviewerAgent` General, no language | 2,670 | 3,200 |
| `SEVERITY_RULES` | 904 | 1,000 |
| `LANGUAGE_INTRO` | 273 | 300 |
| C++ list (18 items) | 2,437 | 2,700 |
| C list (9 items) | 1,404 | 1,700 |
| Python list (17 items) | 2,245 | 2,500 |
| `mainAgent` General with C++, C, and Python | 9,015 | 10,000 |

## Phase 3: Report

Give the report before any edit. List each fail with the piece, the rule, the evidence, and a proposed fix. Give the size change of each fix. Stop and wait for the user.

## Phase 4: Propose diffs

Show each change as a diff. Keep each change small. Do not rewrite a piece that passes.

Migration rule:
- A change to a field of a shipped profile (`prompt`, `maxTurns`, `docs`, `languageChecks`, `explain`, `name`, `note`, and the other `profileRevision` fields) needs two steps. Bump `PROFILES_VERSION` in `src/server/config.ts`. Add a `FORMER` entry for the old version in `catalog.ts` with the old field values. Without it, `upgradeProfile` treats unedited saved profiles as edited, and they keep the old text.
- Each `FORMER` entry is a change against the current shipped profile. So also add the old value to each older entry that does not set that field.
- A change to a shared rule, a checklist, `LANGUAGE_INTRO`, `EXT`, or the stdin sections needs no bump. Every profile gets it at the next run.
- Add a test in `tests/settings.test.ts` that upgrades a config of the old version.

## Phase 5: Apply

Apply only the diffs that the user approves. Keep comments to constraints that the code cannot show.

## Phase 6: Test

Run these in order:

1. `bun test tests/review/languages.test.ts tests/review/prompt.test.ts tests/review/skills.test.ts tests/settings.test.ts`
2. `bun test tests/review/jobs.test.ts` when the change touches what a run kind gets.
3. `bun run check`

The fake CLI proves only that the app assembles the prompt. It does not prove review quality. A real-model check runs only through the gate harness (`scripts/gate/claude-checks.ts`) or a smoke document in `docs/`, and only with the user's authorization.

## Preview

Run from the repository root. Change the profile ID and the language set as needed.

```sh
bun -e 'import { SHIPPED_PROFILES, mainAgent, reviewerAgent } from "./src/server/review/catalog"; import { withLanguages } from "./src/server/review/languages"; const p = SHIPPED_PROFILES.find((x) => x.id === "general")!; for (const a of [mainAgent(p), reviewerAgent(p)]) { const t = withLanguages(a, ["cpp", "python"]).prompt; console.log(t, "\n---", Buffer.byteLength(t), "bytes\n"); }'
```

The stdin prompt comes from `buildPrompt` in `prompt.ts`. To each agent prompt, `src/server/review/jobs.ts` appends the language lines, then the skill lines, then the MCP lines (`withLanguages`, `withSkills`, `withMcp`). The rl-reviewer prompt then gets the project instructions (`withInstructions`). The main agent gets them in stdin.

## References

- `references/sources.md`: sources for the checklist items.
