# Ralph Loop MCP — Product Requirements

## 1. Executive Summary

**ralph-loop-mcp** is a **Model Context Protocol (MCP) server** implemented in Node.js + TypeScript. It provides deterministic tool handles for Ralph-style delivery loops that follow a Plan -> Specs -> Dev/QA discipline.

The server operates on canonical artifacts stored under `.ralph/` in a target repository. The **LLM loop** (bash + `copilot`, or a human driving an IDE) lives **outside** the MCP. ralph-loop-mcp is the filesystem-and-verification sidecar: it exposes tools that materialize Huntley's plan/spec/task stack and ralph-gui's Plan/Dev/QA discipline, while the bash/Copilot (or IDE) loop remains the deliberately replaceable engine.

---

## 2. Scope

### In scope

- MCP tool implementations for all three delivery phases (Phase 1: PRD, Phase 2: Specs + backlog, Phase 3: Dev/QA iteration).
- Path sandbox: all file writes constrained to within the repo root; paths traversing above the root are rejected.
- Allowlisted npm script runner for the verification gate.
- Phase script generation (phase1.sh, phase2.sh, phase3.sh) and prompt file scaffolding written to `.ralph/`.
- Config schema validation for `.ralph/config.json`.
- Stdio MCP transport only.

### Out of scope

- Embedding or running an LLM in-process.
- Replacing copilot / Cursor with an in-process agent.
- A long-running HTTP server or ralph-gui-style UI inside this package.
- Multi-repo orchestration.

---

## 3. Users and Stakeholders

- **Primary users**: Developers using Cursor, Copilot CLI, or any MCP-capable host to run Ralph-style delivery loops on a target repository.
- **Secondary users**: Teams who want a headless, portable implementation of the plan/spec/task stack analogous to ralph-gui's task-status.json and scripts but expressed as MCP tools and markdown on disk.

---

## 4. Functional Requirements

### Phase 1 — Plan to PRD

- **FR-01**: `ralph.generate_phase1` must scaffold `.ralph/phase1.sh` and write `.ralph/phase1-prd-prompt.md`. It must seed `.github/plans/project-plan.md` only when the file does not already exist. The generated session is constrained to PRD output only: it must not create `.ralph/specs/**`, `.ralph/fix_plan.md`, or any task items.
- **FR-02**: `ralph.write_prd` must write or replace the canonical product requirements document exclusively at `.ralph/prd.md`. It must reject writes to any other path.
- **FR-03**: `ralph.write_plan` must write planning documents under `.github/plans/` only. It must reject paths outside that directory tree.

### Phase 2 — Specs and Backlog

- **FR-04**: `ralph.generate_phase2` must scaffold `.ralph/phase2.sh` (planner + worker loop), write a default `config.json` if one does not already exist, create prompt files (`phase2-planner-prompt.md`, `phase2-worker-prompt.md`), and create log stubs (`logs/progress.txt`, `logs/learnings.md`) when absent. It must validate `.ralph/config.json` schema before generating the script and report validation errors in the response without throwing an unhandled exception.
- **FR-05**: `ralph.upsert_spec` must write spec files under `.ralph/specs/**` only. It must reject paths outside that directory. It must also reject reserved filenames within that directory: `progress.txt`, `progress.md`, `learnings.txt`, `learnings.md`.
- **FR-06**: `ralph.replace_fix_plan` must merge or replace `.ralph/fix_plan.md`. When `preserveCompleted: true`, it must carry forward completed tasks (checked) and blocked tasks from the previous file that are absent from the new content. When `preserveCompleted: false` or no previous file exists, it writes the new content directly.

### Phase 3 — Dev/QA Iteration

- **FR-07**: `ralph.generate_phase3` must scaffold `.ralph/phase3.sh` implementing the Plan, Dev, QA, Dev-signoff, and QA-close persona loop. It must fail with a clear error if `.ralph/fix_plan.md` does not exist. When the existing fix plan has fewer than five unchecked active tasks, it must seed Phase 3 checkbox tasks extracted from the Phase 2 planning section of `fix_plan.md`.
- **FR-08**: `ralph.run_verification` must run `npm run ci` and then `npm run test:e2e` sequentially, stopping on the first non-zero exit code. Script names must be validated against the allowlist before execution. Timeout must default to 1800 seconds and be configurable per call.

### Task Lifecycle

- **FR-09**: `ralph.read_state` must return a single snapshot containing: parsed config object, config validation result, parsed task list from `fix_plan.md`, list of fix-plan variant filenames (dash-variant filenames that may indicate wrong naming), spec file index, PRD existence and tail, log tails (last 50 lines of `progress.txt`, last 120 lines of `learnings.md`), and the current allowlist.
- **FR-10**: `ralph.next_task` must return the first unchecked task in the active section of `fix_plan.md`. It must ignore tasks in the `## Blocked` section. It must return a null task with a reason string when no unchecked active task exists.
- **FR-11**: `ralph.set_task_status` must check or uncheck a task in `fix_plan.md` identified by text match or optional taskId. In Phase 3 semantics, only the QA-close persona should call this with `checked: true`.
- **FR-12**: `ralph.block_task` must move a task from the active section into the `## Blocked` section, appending the reason to the task line.
- **FR-13**: `ralph.unblock_task` must move a task from the `## Blocked` section back into the active section as unchecked.

### Logging and Artifacts

- **FR-14**: `ralph.append_progress` must append a timestamped entry to `.ralph/logs/progress.txt`. The timestamp must be in ISO-8601 UTC format (e.g., `[2026-03-31T00:00:00Z]`).
- **FR-15**: `ralph.append_learning` must append a new titled section to `.ralph/logs/learnings.md` with a UTC timestamp heading.
- **FR-16**: `ralph.write_epic_plan` must write or replace `.ralph/epic_plan.md`.

### File Exploration

- **FR-17**: `ralph.list_files` must list entries (files and directories) one level deep under a given repo-relative path, defaulting to the repo root. All paths must be resolved within the repo sandbox.
- **FR-18**: `ralph.read_file` must read any text file inside the repo sandbox by its repo-relative path and return its content. It must return a structured error (not throw) when the file does not exist.

### Path Safety and Transport

- **FR-19**: All file write operations must validate that the resolved absolute path does not escape the repo root. Any path that traverses above the root (e.g., via `../`) must be rejected with an error.
- **FR-20**: The MCP server must accept both dot-namespaced tool names (`ralph.tool_name`) and underscore-namespaced variants (`ralph_tool_name`), normalizing to the dot form before dispatch.

---

## 5. Non-Functional Requirements

- **NFR-01**: Transport is stdio MCP only. The server must not open any HTTP listener or network socket.
- **NFR-02**: No embedded LLM runtime and no outbound network calls from the MCP process itself. The server interacts only with the local filesystem and spawns npm child processes for verification.
- **NFR-03**: The npm script allowlist must be configurable via `.ralph/config.json` (`allowedNpmScripts` array). The default allowlist is `["ci", "test:e2e", "typecheck", "build", "test:ci"]`. Scripts not in the allowlist must be rejected before any child process is spawned.
- **NFR-04**: `config.json` schema validation must surface structured errors (a list of error strings) in the tool response without throwing unhandled exceptions. Invalid config must not prevent `generate_phase2` from completing setup but must be reflected in the `configValidation` field of the response.
- **NFR-05**: All file output from tool calls must end with a trailing newline character.
- **NFR-06**: Log entries written by `ralph.append_progress` must use ISO-8601 UTC timestamps in the format `[YYYY-MM-DDTHH:MM:SSZ]` (milliseconds omitted).
- **NFR-07**: The server is implemented as a single npm package (`ralph-loop-mcp`) using ESM modules, TypeScript, and the `@modelcontextprotocol/sdk` library. The build produces `dist/index.js` as the entry point.
- **NFR-08**: The test suite uses Vitest and must pass with exit code 0 before any change is considered complete.

---

## 6. Architecture and Constraints

### Source layout

| File | Responsibility |
| --- | --- |
| `src/index.ts` | MCP server setup, tool registration, request dispatch, name normalization |
| `src/tools.ts` | All tool function implementations |
| `src/workflow.ts` | Pure parse/mutation helpers (parseFixPlan, setTaskChecked, blockTaskMd, unblockTaskMd, replaceFixPlanMd, sandboxPath, etc.) |
| `src/verification.ts` | npm child-process runner with allowlist enforcement |
| `src/ralph-prompts.ts` | Versioned prompt template strings written to `.ralph/*.md` by generate_* tools |

### Repo root detection

- For runtime tools (read/write during a session): detect by presence of both `package.json` and `.ralph/` within 10 ancestor directories.
- For setup tools (generate_phase1, generate_phase2, generate_phase3, write_plan, write_prd): detect by presence of `package.json` only, so setup can run before `.ralph/` exists.

### Task ID convention

Tasks in `fix_plan.md` may carry an inline task ID using the tag `task-id: <id>`. The `nextTask`, `setTaskStatus`, `blockTask`, and `unblockTask` tools accept an optional `taskId` field and prefer ID match over text match when both are provided.

### Blocked section convention

A heading of `## Blocked` or `## Blocked Tasks` (case-insensitive) marks the start of the blocked section in `fix_plan.md`. All checkbox lines after this heading (until EOF or the next heading) belong to the blocked section.

---

## 7. Phase Model Contract

1. **Phase 1 — Plan to PRD**: Draft under `.github/plans/`; canonical output `.ralph/prd.md`. MCP tools: `generate_phase1`, `write_plan`, `write_prd`. The generated session writes plan documents only; no specs or tasks.

2. **Phase 2 — Specs and Backlog (no product code)**: Planner and worker loops refine `.ralph/specs/**` and `.ralph/fix_plan.md`. MCP tools: `generate_phase2`, `upsert_spec`, `replace_fix_plan`, `read_state`, `list_files`, `read_file`.

3. **Phase 3 — Implement with Dev/QA**: One task per outer iteration. Verification gate (`run_verification`) before sign-off. Only the QA-close persona may call `set_task_status` with `checked: true`. MCP tools: `generate_phase3`, `run_verification`, `set_task_status`, `block_task`, `unblock_task`, `append_progress`, `append_learning`.

New tools or features must declare which phase they belong to so the loop remains coherent.

---

## 8. Risks, Dependencies, and Open Decisions

- **README drift**: Generated script names in `README.md` must stay aligned with the actual file paths written by the tools (currently `phase1.sh`, `phase2.sh`, `phase3.sh`). Any change to generated filenames must update the README.
- **Prompt quality**: `src/ralph-prompts.ts` is treated as versioned tuning. Prompts are iterated when the loop misbehaves; changes must not break existing phase generation tests.
- **Config schema evolution**: Adding new required fields to `config.json` is a breaking change for existing `.ralph/` trees. Prefer optional fields with defaults.
- **Context budget**: `read_state` returns tails rather than full file contents to avoid flooding the LLM context window. Tail line counts (50 for progress, 120 for learnings) are set by convention and may need tuning.
