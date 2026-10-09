# Review Loop

Review Loop is a local-first inbox for Bitbucket Server pull requests (PRs). It runs the user's own Claude Code CLI (`claude -p`) for reviews. The app runs on localhost and keeps all data on the user's machine.

Status: no application code yet. Work starts at Gate 0 (M0). Do not assume that a file in the planned layout exists. Check first.

## Document map

| File | Role |
|---|---|
| `BRIEF.md` | The spec and the source of truth. If another file disagrees, BRIEF.md wins. |
| `prototype/index.html` | Visual spec for the UI: three panes, color tokens, keyboard model. Sample data only. It is also a published artifact. |
| `PROJECT_BRIEF_GPT_ASTRA_6.md` | Reference for edge cases and acceptance scenarios. |
| `IMPLEMENTATION_PROMPTS_GPT_ASTRA_6.md` | Alternative spec-kit prompt set. Prompt 0 drives Gate 0. Its two-pane and general-comments-only rules do not apply. |
| `skills-lock.json` | Pins the installed project skills. Commit it with every skill change. |
| `.claude/skills/` | Installed project skills (see Skills). |

## Stack (BRIEF section 7)

```
Runtime: Bun 1.x, strict TypeScript. Fallback: Node + @hono/node-server if Bun fails a Gate 0 Windows check.
Server:  Hono on 127.0.0.1 only. csrf(), streamSSE, zValidator, typed client hc<AppType>(). One process serves API and built UI.
UI:      Vite, React, Tailwind CSS, shadcn/ui (Vite setup), TanStack Query. No global state library.
Storage: bun:sqlite, prepared SQL, checked-in migrations, no ORM.
Schema:  zod for AI output, used REST responses, and every API input. One shared review-result schema.
Git/AI:  simple-git with argument arrays. The system `claude` CLI.
Secrets: Bun.secrets (experimental, verify in Gate 0). Fallback: memory only.
Tests:   bun test for logic and integration. Playwright for browser acceptance.
Ship:    bun build --compile, one executable per OS with the UI embedded.
```

Planned layout: `src/web/`, `src/server/{bitbucket,sync,inbox,review,publish,storage}/`, `src/shared/`, `fixtures/`, `tests/`. BRIEF section 7 defines each folder. All Bitbucket calls stay in `src/server/bitbucket/`.

Commands:
- `bun install`: install the pinned dependencies.
- `bun run dev`: start Hono with `--watch` on 127.0.0.1:7317 and Vite with HMR on 127.0.0.1:5173. Open the Vite URL.
- `bun run build`: build the UI into `dist/web`.
- `bun run start`: serve the API and the built UI on 127.0.0.1:7317. `REVIEW_LOOP_PORT` overrides the port.
- `bun run typecheck`: run strict `tsc --noEmit`.
- `bun run lint`: run Biome lint and format checks. `bun run format` applies the fixes.
- `bun test`: run the tests under `tests/`. Each group ends green on typecheck, lint, and test.

## Skills

Load the skill before you start the task. Read its SKILL.md for details.

| Task | Skill to load | Rule |
|---|---|---|
| Add, style, or compose UI components. Port the prototype color tokens to the shadcn theme. | `shadcn` | Keep the prototype's three panes and keyboard model. |
| Write or review React components, data fetching, TanStack Query use, bundle size. | `vercel-react-best-practices` | This is a Vite SPA. Ignore the Next.js-only rules (RSC, server actions, next/*). |
| Review UI code for accessibility and UX. | `web-design-guidelines` | Run it before a milestone ends. |
| Server routes, middleware (`csrf`, validator), SSE streaming, typed client. | `hono` | Keep BRIEF 3.6 server safety rules. |
| Browser acceptance tests. | none | Use TypeScript `@playwright/test` with files named `*.e2e.ts`, run by Node. Point tests only at fixture data. |
| Ad-hoc browser checks and screenshots of the running app. | `webapp-testing` | Its helper scripts need Python. Point it only at fixture data. |
| Visual direction for new screens. | `frontend-design:frontend-design` (plugin) | Stay consistent with `prototype/index.html`. |
| Maintain this file. | `claude-md-management:claude-md-improver` | Keep it compact and current. |

Add or update a project skill:
- Read the skill's SKILL.md at its source before you install it.
- Run `npx -y skills@1.7.2 add <owner/repo> -s <skill> -a claude-code --copy -y` at project scope.
- Use `--copy`, because symlinks are unreliable on Windows.
- The skills CLI needs Node 22.20 or later.
- Commit `skills-lock.json` together with the skill files.

## Hard rules

- Never run `claude -p` in a raw PR checkout. Use the sanitized snapshot only (BRIEF 3.5).
- Never use `--bare`. It breaks the subscription login (BRIEF 3.5).
- Before each run, check `claude auth status`. Run only when `authMethod` is `claude.ai`. Remove `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from the child environment.
- Follow the local server safety rules: 127.0.0.1 only, Host and Origin checks, session token, no wildcard CORS, no disabled TLS (BRIEF 3.6).
- Tests never touch the live Bitbucket server. Use sanitized fixtures and a fake `claude` executable. Real-server tests need separate authorization.
- The Bitbucket token never goes into SQLite, localStorage, logs, URLs, or prompts.
- Nothing goes to Bitbucket without an explicit user action. The app posts, not the AI.
- No company names, hosts, or secrets in code, docs, or fixtures. The project may become open source.
- Build a boundary (ForgeProvider, ReviewRunner, ContextSource) only when its milestone needs it.

## Workflow

- Work on one milestone at a time, in the order M0, M1, M2, M3, M4 (BRIEF section 2).
- Run one spec-kit cycle per milestone (BRIEF section 0). Never specify the whole product in one cycle.
- Gate 0 writes `integration-check.md`. Record each Gate 0 fact there before code depends on it.
- Items that BRIEF marks "verify in Gate 0" or "not verified" are assumptions. Do not hard-code them until Gate 0 confirms them.
- End each session with a handoff: completed task IDs, changed files, tests run with results, known limits, next task group.

## Documentation style

- Use ASD-STE100 Simple Technical English: sentences of 20 words or fewer, active voice, no narration.
- No hard line wrapping. One paragraph or one bullet is one physical line.
- Code comments state only constraints that the code cannot show.
- The changelog lists only changes that a user of the tool sees.
