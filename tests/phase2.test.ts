import { describe, expect, it, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { generatePhase2 } from "../src/tools.js";

async function makeTempRepo(config?: object): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ralph-p2-test-"));
  await fs.writeFile(path.join(dir, "package.json"), "{}", "utf8");
  if (config) {
    await fs.mkdir(path.join(dir, ".ralph"), { recursive: true });
    await fs.writeFile(path.join(dir, ".ralph", "config.json"), JSON.stringify(config, null, 2) + "\n", "utf8");
  }
  return dir;
}

describe("generatePhase2", () => {
  let tmpDir = "";

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = "";
  });

  it("writes default config with project plan path", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await generatePhase2();

    expect(result.ok).toBe(true);
    const configText = await fs.readFile(path.join(tmpDir, ".ralph", "config.json"), "utf8");
    expect(configText).toContain('"projectPlan": ".ralph/prd.md"');
  });

  it("uses configured project plan path in phase2.sh prompt and variable", async () => {
    tmpDir = await makeTempRepo({
      version: "1.0",
      phase2: { generatorScript: ".ralph/phase2.sh", overwriteSpecs: true, overwriteFixPlan: true },
      paths: {
        projectPlan: ".github/plans/plan-eventpubsub-enhancments.prompt.md",
        epicPlan: ".ralph/epic_plan.md",
        fixPlan: ".ralph/fix_plan.md",
        specsDir: ".ralph/specs",
        progressLog: ".ralph/logs/progress.txt",
        learningsLog: ".ralph/logs/learnings.md",
      },
      verification: { timeoutSeconds: 1800, scripts: ["ci", "test:e2e"] },
      allowedNpmScripts: ["build", "ci", "test:ci", "test:e2e", "typecheck"],
      workflow: { blockedHeading: "## Blocked", taskIdTag: "task-id:", timezone: "UTC" },
    });
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await generatePhase2();

    expect(result.ok).toBe(true);
    const phase2 = await fs.readFile(path.join(tmpDir, ".ralph", "phase2.sh"), "utf8");
    expect(phase2).toContain('.github/plans/plan-eventpubsub-enhancments.prompt.md');
    expect(phase2).toContain("phase2-planner-prompt.md");
    expect(phase2).toContain("phase2-worker-prompt.md");
    expect(phase2).not.toContain('Your source of truth is .github/plans/project-plan.md');
  });
});