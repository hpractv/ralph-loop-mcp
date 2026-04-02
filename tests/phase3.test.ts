import { describe, expect, it, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { generatePhase3 } from "../src/tools.js";

const PHASE2_FIX_PLAN_WITH_PLANNING_SECTION = `# Fix plan (Phase 3 planning tasks)

Explored (checked during Phase 2 exploration):
- [x] README.md (root) — minimal

PLANNING / DOCUMENTATION tasks for Phase 3 (each item is a planning or documentation deliverable — no implementation here):

1. Document system architecture and component responsibilities
   - What to produce: diagram and narrative describing EventProcessing, Database, and external dependencies.

2. Define event/message contracts and versioning strategy
   - What to produce: catalog of event types consumed/produced, JSON schema/examples, versioning rules.

3. Document database schema & migration strategy
   - What to produce: canonical DB schema, migration execution plan, rollback guidance.

Notes:
- Each task should include expected owners and acceptance criteria.
`;

const FIX_PLAN_WITH_CHECKBOXES = `# Fix Plan\n\n## Tasks\n- [ ] Implement handler task-id: p3-001\n- [ ] Add tests task-id: p3-002\n\n## Blocked\n`;

async function makeTempRepo(fixPlanContent: string | false): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ralph-p3-test-"));
  await fs.writeFile(path.join(dir, "package.json"), "{}", "utf8");
  if (fixPlanContent !== false) {
    await fs.mkdir(path.join(dir, ".ralph"), { recursive: true });
    await fs.writeFile(path.join(dir, ".ralph", "fix_plan.md"), fixPlanContent, "utf8");
  }
  return dir;
}

describe("generatePhase3", () => {
  let tmpDir: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = "";
  });

  it("fails when fix_plan.md is missing", async () => {
    tmpDir = await makeTempRepo(false);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await generatePhase3();

    expect(result.ok).toBe(false);
    expect((result as any).error).toMatch(/fix_plan\.md/);
  });

  it("creates phase3.sh when fix_plan.md exists", async () => {
    tmpDir = await makeTempRepo(FIX_PLAN_WITH_CHECKBOXES);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await generatePhase3();

    expect(result.ok).toBe(true);
    const content = await fs.readFile(path.join(tmpDir, ".ralph", "phase3.sh"), "utf8");
    expect(content).toContain("#!/usr/bin/env bash");
    expect(content).toContain("copilot --yolo --no-ask-user");
    expect(content).toContain("has_unchecked_tasks");
    expect(content).toContain("phase3-plan-prompt.md");
    expect(content).toContain("phase3-dev-prompt.md");
    expect(content).toContain("phase3-qa-prompt.md");
    expect(content).toContain("QA_READY_FOR_SIGNOFF");
    expect(content).toContain("DEV_AGREES_COMPLETE");
  });

  it("phase3 prompt files mandate implementation and verification flow", async () => {
    tmpDir = await makeTempRepo(FIX_PLAN_WITH_CHECKBOXES);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await generatePhase3();

    const dev = await fs.readFile(path.join(tmpDir, ".ralph", "phase3-dev-prompt.md"), "utf8");
    expect(dev).toMatch(/CODE|code/);
    expect(dev).toMatch(/test/i);

    const qa = await fs.readFile(path.join(tmpDir, ".ralph", "phase3-qa-prompt.md"), "utf8");
    expect(qa).toContain("run_verification");
    expect(qa).toContain("set_task_status");

    const close = await fs.readFile(path.join(tmpDir, ".ralph", "phase3-qa-close-prompt.md"), "utf8");
    expect(close).toContain("DEV_AGREES_COMPLETE");
  });

  it("returns relative createdFiles paths and sharedLogs", async () => {
    tmpDir = await makeTempRepo(FIX_PLAN_WITH_CHECKBOXES);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await generatePhase3();

    expect(result.ok).toBe(true);
    const files = (result as any).createdFiles as Record<string, string>;
    expect(files["phase3.sh"]).toBe(".ralph/phase3.sh");
    const logs = (result as any).sharedLogs as { progress: string; learnings: string };
    expect(logs.progress).toBe(".ralph/logs/progress.txt");
    expect(logs.learnings).toBe(".ralph/logs/learnings.md");
  });

  it("seeds Phase 2 planning tasks as checkboxes when fix plan has no unchecked tasks", async () => {
    tmpDir = await makeTempRepo(PHASE2_FIX_PLAN_WITH_PLANNING_SECTION);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await generatePhase3();

    expect(result.ok).toBe(true);
    expect((result as any).seededTaskCount).toBeGreaterThan(0);

    const updated = await fs.readFile(path.join(tmpDir, ".ralph", "fix_plan.md"), "utf8");
    expect(updated).toContain("## Phase 3 Implementation Tasks");
    expect(updated).toContain("- [ ] Document system architecture");
    expect(updated).toContain("- [ ] Define event/message contracts");
    expect(updated).toContain("task-id: p3-001");
    expect(updated).toContain("task-id: p3-002");
  });

  it("includes What-to-produce detail in seeded task text", async () => {
    tmpDir = await makeTempRepo(PHASE2_FIX_PLAN_WITH_PLANNING_SECTION);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await generatePhase3();

    const updated = await fs.readFile(path.join(tmpDir, ".ralph", "fix_plan.md"), "utf8");
    expect(updated).toContain("diagram and narrative describing EventProcessing");
  });

  it("does not overwrite existing Phase 2 log files", async () => {
    tmpDir = await makeTempRepo(FIX_PLAN_WITH_CHECKBOXES);
    await fs.mkdir(path.join(tmpDir, ".ralph", "logs"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, ".ralph", "logs", "progress.txt"), "# existing phase 2 entry\n", "utf8");
    await fs.writeFile(path.join(tmpDir, ".ralph", "logs", "learnings.md"), "# existing learnings\n", "utf8");
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await generatePhase3();

    const progress = await fs.readFile(path.join(tmpDir, ".ralph", "logs", "progress.txt"), "utf8");
    const learnings = await fs.readFile(path.join(tmpDir, ".ralph", "logs", "learnings.md"), "utf8");
    expect(progress).toContain("existing phase 2 entry");
    expect(learnings).toContain("existing learnings");
  });

  it("phase3.sh references shared log paths", async () => {
    tmpDir = await makeTempRepo(FIX_PLAN_WITH_CHECKBOXES);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await generatePhase3();

    const content = await fs.readFile(path.join(tmpDir, ".ralph", "phase3.sh"), "utf8");
    expect(content).toContain(".ralph/logs/progress.txt");
    expect(content).toContain(".ralph/logs/learnings.md");
    expect(content).toContain("phase3-feedback.md");
  });

  it("skips seeding when fix plan already has enough unchecked tasks", async () => {
    tmpDir = await makeTempRepo(FIX_PLAN_WITH_CHECKBOXES);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await generatePhase3();

    expect(result.ok).toBe(true);
    expect((result as any).seededTaskCount).toBe(0);
    const content = await fs.readFile(path.join(tmpDir, ".ralph", "fix_plan.md"), "utf8");
    expect(content).not.toContain("## Phase 3 Implementation Tasks");
  });

  it("embeds PRD path from config when present", async () => {
    tmpDir = await makeTempRepo(FIX_PLAN_WITH_CHECKBOXES);
    await fs.writeFile(
      path.join(tmpDir, ".ralph", "config.json"),
      JSON.stringify({
        version: "1.0",
        phase2: { generatorScript: ".ralph/phase2.sh", overwriteSpecs: true, overwriteFixPlan: true },
        paths: {
          projectPlan: ".github/plans/custom.md",
          epicPlan: ".ralph/epic_plan.md",
          fixPlan: ".ralph/fix_plan.md",
          specsDir: ".ralph/specs",
          progressLog: ".ralph/logs/progress.txt",
          learningsLog: ".ralph/logs/learnings.md",
        },
        verification: { timeoutSeconds: 1800, scripts: ["ci", "test:e2e"] },
        allowedNpmScripts: ["ci", "test:e2e"],
        workflow: { blockedHeading: "## Blocked", taskIdTag: "task-id:", timezone: "UTC" },
      }) + "\n",
      "utf8",
    );
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await generatePhase3();

    const content = await fs.readFile(path.join(tmpDir, ".ralph", "phase3.sh"), "utf8");
    expect(content).toContain(".github/plans/custom.md");
  });
});
