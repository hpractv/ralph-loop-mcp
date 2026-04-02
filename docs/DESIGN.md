# Ralph Loop MCP — Guiding project design

This document captures how **ralph-loop-mcp** is intended to work: alignment with ideas from Geoffrey Huntley’s writing on the Ralph technique (see [Attribution](#8-attribution-and-external-references)), conceptual parity with the Plan → Dev → QA flow described in **[izep/ralph-gui](https://github.com/izep/ralph-gui)** (same attribution section), and a clear boundary that the product **remains an MCP** (tools + repo state), not a separate orchestration server or embedded LLM runtime.

**ralph-loop-mcp** is an independent project; it does not bundle or redistribute those works. Citations are for credit and for readers who want the original context.

---

## 1. Product thesis

**Ralph Loop MCP** is a **Model Context Protocol server** that gives a host (Cursor, Copilot CLI, etc.) **deterministic handles** on Ralph-style delivery: canonical artifacts under `.ralph/`, safe file access, task lifecycle on `fix_plan.md`, and a **verification gate** (allowlisted `npm` scripts).

The **LLM loop** (bash + `copilot`, or a human driving the IDE) stays **outside** the MCP. That matches Huntley’s “Ralph is a Bash loop” idea and ralph-gui’s split: **orchestration state + tools** vs **the agent that runs prompts**. This MCP is the **headless, portable** version of the “task state + tools” half—analogous to ralph-gui’s `ralph/task-status.json` and scripts, but expressed as **MCP tools** and **markdown + JSON on disk**.

---

## 2. Design principles (mapped to Huntley)

| Idea ([Ralph](https://ghuntley.com/ralph/) / [loop](https://ghuntley.com/loop/)) | How this MCP embodies it |
| --- | --- |
| **Monolithic, one repo, one process style** | Single `.ralph/` tree; no multi-repo orchestration in-process. |
| **Deterministic stack each “iteration”** | PRD (`.ralph/prd.md`), specs (`.ralph/specs/**`), tasks (`.ralph/fix_plan.md`), config (`.ralph/config.json`). Prompts tell the agent to open with `ralph.read_state`. |
| **One important thing per loop** (relax later) | Phase 3 prompts: `ralph.next_task`, Dev implements **one** task; QA verifies; only QA-close checks the box. |
| **Backpressure** | `ralph.run_verification` → allowlisted `ci` + `test:e2e` (configurable via `.ralph/config.json`). |
| **Don’t assume missing implementation** | Phase 2 worker prompt stresses search + specs; MCP provides `list_files` / `read_file`. |
| **Memory outside the window** | `append_progress`, `append_learning`, plus specs/fix_plan as durable state. |
| **Watch the loop** | Human or script watches stagnation (generated `phase2.sh` / `phase3.sh` track fix_plan churn). |

---

## 3. Alignment with ralph-gui flows

[ralph-gui](https://github.com/izep/ralph-gui) documents: **requirements** → **epic** → **planning** → **Dev** → **QA**, with persisted state.

> **Note on "requirements"**: The repository root `requirements.md` documents this MCP package's own product requirements; consumer repos use `.ralph/prd.md` (written via `ralph.write_prd`) as their plan source of truth.

| ralph-gui | ralph-loop-mcp |
| --- | --- |
| `requirements.md` (SoT) | `.ralph/prd.md` (+ optional `.github/plans/*` as draft input) |
| `ralph/epic.md` | `.ralph/epic_plan.md` (`ralph.write_epic_plan`) |
| `ralph/task-status.json` | `.ralph/fix_plan.md` + parsed tasks from `ralph.read_state` / `ralph.next_task` |
| Planning / Dev / QA prompts + loop | `.ralph/phase3-*.md` + `phase3.sh` (Plan → Dev → QA → sign-off → QA close) |
| Dev/QA models in config | `.ralph/config.json` `phase2.*` / `phase3.*` models (used by generated bash) |

**Personas** (see `src/ralph-prompts.ts`): Phase 1 = PRD-only; Phase 2 = planner (no code) + worker (specs/tasks only); Phase 3 = plan (sequence only) → dev → qa → dev sign-off → qa close (only QA-close may `set_task_status` with checked). That matches ralph-gui’s Dev vs QA separation, with Phase 2 planning and a **gate** on marking work done.

---

## 4. Architectural boundaries (stay MCP)

**In scope for the MCP package**

- **Tools**: read/write allowed paths, task mutations, verification runner, phase script + prompt **generation** (scaffolding).
- **Policy**: path sandbox (`sandboxPath`), reserved spec names, allowlisted npm scripts.
- **Transport**: stdio MCP (`src/index.ts`).

**Out of scope (by design)**

- Running or embedding the LLM.
- Replacing `copilot` / Cursor with an in-process agent (that would be a different product).
- A long-running HTTP server or ralph-gui-style UI **inside** this package—unless a **separate** optional package is added later.

**Optional future (still MCP-friendly)**

- **Resources** for `config.json` or `fix_plan` previews (read-only) to reduce tool round-trips.
- **Prompts** capability for bundled “how to use Ralph Loop” templates.

---

## 5. Phase model (contract)

1. **Phase 1 — Plan → PRD**  
   Draft under `.github/plans/`; canonical output `.ralph/prd.md`. MCP: `generate_phase1`, `write_plan`, `write_prd`.

2. **Phase 2 — Specs + backlog (no product code)**  
   Planner + worker loops refine `.ralph/specs/**` and `.ralph/fix_plan.md`. MCP: `upsert_spec`, `replace_fix_plan`, `read_state`, exploration tools.

3. **Phase 3 — Implement with Dev/QA**  
   One task per outer iteration; verification before sign-off; only QA-close marks complete. MCP: implementation via normal editing + `run_verification` + `set_task_status` / `block_task` / `unblock_task`.

New features, tools, or documentation should declare which phase they belong to so the loop stays coherent.

---

## 6. Threats and mitigations

- **README drift** — Keep root `README.md` aligned with generated script names (`phase1.sh`, `phase2.sh`, `phase3.sh`) and Phase 1 output (`.ralph/prd.md`).
- **“Perfect prompt” trap** — Treat `src/ralph-prompts.ts` as **versioned tuning**; iterate when the loop misbehaves.
- **Context burn** — Prefer `read_state` tails + targeted `read_file` over dumping whole trees; prompts reinforce “one task” in Phase 3.

---

## 7. One-sentence positioning

**Ralph Loop MCP is the filesystem-and-verification sidecar for Ralph-style loops: it stays a small MCP that materializes Huntley’s plan/spec/task stack and ralph-gui’s Plan/Dev/QA discipline, while the bash/Copilot (or IDE) loop remains the deliberately replaceable “engine.”**

---

## 8. Attribution and external references

### Geoffrey Huntley — the “Ralph” technique and loop mindset

The naming and several design principles in this document (monolithic loop, one task per iteration, deterministic plan/spec/task stack, backpressure via tests, memory in files, “watch the loop”) are discussed in publicly shared articles by **Geoffrey Huntley** on [ghuntley.com](https://ghuntley.com):

| Work | URL |
| --- | --- |
| *Ralph Wiggum as a “software engineer”* (Jul 2025) | [https://ghuntley.com/ralph/](https://ghuntley.com/ralph/) |
| *everything is a ralph loop* (Jan 2026) | [https://ghuntley.com/loop/](https://ghuntley.com/loop/) |

Those articles are **not** authored by this repository’s maintainers; we reference them to give credit for the technique and vocabulary readers may already know. Any misstatement of Huntley’s ideas here is ours, not his.

### izep — ralph-gui (reference architecture)

The **Plan → Dev → QA** phases, persisted task state, and separation between “orchestration / backlog” and “implementation” in this design are **conceptually aligned** with the README and structure of the open-source project **[ralph-gui](https://github.com/izep/ralph-gui)** by GitHub user **[izep](https://github.com/izep)**.

| Resource | URL |
| --- | --- |
| Repository | [https://github.com/izep/ralph-gui](https://github.com/izep/ralph-gui) |

**ralph-loop-mcp** is **not** a fork of ralph-gui: it is a separate MCP-first implementation (different stack, transport, and file layout). We cite ralph-gui so users can compare flows and so credit goes to the project that documented that epic/planning/dev/qa shape publicly.

### This project

**ralph-loop-mcp** code and docs in this repository are provided under the terms declared in this repository (for example `package.json` and any `LICENSE` file if present). Third-party trademarks and project names belong to their respective owners.
