# Ralph Loop MCP (Node + TypeScript)

This MCP server turns the repo's `.ralph/` folder into a 3-phase workflow:

- **Phase 1**: Create or refine plan documents under `.github/plans/`. Phase 1 produces plan files only.
- **Phase 2**: Generate/refine specs under `.ralph/specs/**` and tasks in `.ralph/fix_plan.md`.
- **Phase 3**: Iterate one task at a time with strict verification (npm run ci + npm run test:e2e).

## Phase 1 generator script

`ralph.generate_phase1` bootstraps `.ralph/phase1.sh` and seeds `.github/plans/project-plan.md` when missing.
The generated Phase 1 session is intentionally constrained to planning output only:

- It writes plan documents only under `.github/plans/`
- It does not create `.ralph/specs/**`
- It does not create `.ralph/fix_plan.md` task items

- Run directly: `bash ./.ralph/phase1.sh`
- Run via MCP tool: `ralph.generate_phase1`

## Phase 2 generator script

`ralph.generate_phase2` scaffolds `.ralph/phase2.sh` and creates the baseline Phase 2 artifacts:

- `.ralph/specs/*.md`
- `.ralph/fix_plan.md`
- `.ralph/config.json`
- `.ralph/logs/progress.txt`
- `.ralph/logs/learnings.md`

- Run directly: `bash ./.ralph/phase2.sh`
- Run via MCP tool: `ralph.generate_phase2`

`ralph.generate_phase2` performs a lightweight schema validation of `.ralph/config.json`.
If the file exists and is invalid, the tool reports validation errors without executing the script.

## Phase 3 generator script

`ralph.generate_phase3` scaffolds `.ralph/phase3.sh` and creates the Phase 3 prompt files.
It fails with a clear error if `.ralph/fix_plan.md` does not yet exist.
When the fix plan has fewer than five unchecked active tasks, it seeds Phase 2 planning items as checkboxes automatically.

Artifacts created:

- `.ralph/phase3.sh`
- `.ralph/phase3-plan-prompt.md`
- `.ralph/phase3-dev-prompt.md`
- `.ralph/phase3-dev-signoff-prompt.md`
- `.ralph/phase3-qa-prompt.md`
- `.ralph/phase3-qa-close-prompt.md`
- `.ralph/phase3-feedback.md`

- Run directly: `bash ./.ralph/phase3.sh`
- Run via MCP tool: `ralph.generate_phase3`

## Install

From repo root:

```bash
npm install --prefix ./mcp/ralph_loop_mcp
```

## Build

```bash
npm run --prefix ./mcp/ralph_loop_mcp build
```

## Run (stdio)

```bash
node ./mcp/ralph_loop_mcp/dist/index.js
```

## VS Code MCP registration

Example configuration (you must have the repo folder opened in VS Code for `${workspaceFolder}` to resolve):

```json
{
  "mcpServers": {
    "ralph-loop": {
      "command": "node",
      "args": ["./mcp/ralph_loop_mcp/dist/index.js"],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

If VS Code reports `${workspaceFolder}` cannot be resolved, open the repository with File -> Open Folder..., or set `cwd` to an absolute path.

## Conventions

- `.ralph/fix_plan.md` is the task source of truth.
- Blocked tasks live under a dedicated heading: `## Blocked` (or `## Blocked Tasks`).
- Phase 1 planning documents live under `.github/plans/`.
- Phase 2 generator script lives at `.ralph/phase2.sh` and is auto-created by `ralph.generate_phase2` when absent.
- Phase 3 generator script lives at `.ralph/phase3.sh` and is auto-created by `ralph.generate_phase3` when absent.

## Dev tests

```bash
npm run --prefix ./mcp/ralph_loop_mcp test
```
