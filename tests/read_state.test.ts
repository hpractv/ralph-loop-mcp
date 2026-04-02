import { describe, expect, it, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { readState } from "../src/tools.js";

const VALID_CONFIG = {
  version: "1.0",
  phase2: {
    generatorScript: ".ralph/phase2.sh",
    overwriteSpecs: true,
    overwriteFixPlan: true,
  },
  paths: {
    projectPlan: ".ralph/prd.md",
    epicPlan: ".ralph/epic_plan.md",
    fixPlan: ".ralph/fix_plan.md",
    specsDir: ".ralph/specs",
    progressLog: ".ralph/logs/progress.txt",
    learningsLog: ".ralph/logs/learnings.md",
  },
  verification: { timeoutSeconds: 1800, scripts: ["ci", "test:e2e"] },
  allowedNpmScripts: ["build", "ci", "test:ci", "test:e2e", "typecheck"],
  workflow: { blockedHeading: "## Blocked", taskIdTag: "task-id:", timezone: "UTC" },
};

const FIX_PLAN_FIXTURE = `# Fix Plan

## Tasks
- [ ] Alpha task task-id: a1
- [x] Beta task task-id: a2
- [ ] Gamma task task-id: a3

## Blocked
- [ ] Delta task task-id: b1 -- BLOCKED: no api
`;

async function makeTempRepo(config?: unknown): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ralph-readstate-"));
  await fs.writeFile(path.join(dir, "package.json"), "{}", "utf8");
  await fs.mkdir(path.join(dir, ".ralph"), { recursive: true });
  if (config !== undefined) {
    await fs.writeFile(
      path.join(dir, ".ralph", "config.json"),
      JSON.stringify(config, null, 2) + "\n",
      "utf8"
    );
  }
  return dir;
}

describe("readState", () => {
  let tmpDir: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = "";
  });

  it("returns missing config error when config.json is absent", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await readState();

    expect(result.configValidation.ok).toBe(false);
    expect(result.configValidation.errors).toContain("Missing .ralph/config.json");
  });

  it("returns empty tasks array when fix_plan.md is absent", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await readState();

    expect(result.tasks).toEqual([]);
    expect(result.artifacts.fixPlan).toBe(false);
  });

  it("returns ok config validation for a valid config.json", async () => {
    tmpDir = await makeTempRepo(VALID_CONFIG);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await readState();

    expect(result.configValidation.ok).toBe(true);
    expect(result.configValidation.errors).toHaveLength(0);
  });

  it("returns config validation errors for invalid config (missing version)", async () => {
    const badConfig = { ...VALID_CONFIG, version: undefined as unknown as string };
    tmpDir = await makeTempRepo(badConfig);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await readState();

    expect(result.configValidation.ok).toBe(false);
    expect(result.configValidation.errors.some((e) => e.includes("version"))).toBe(true);
  });

  it("returns config validation errors when paths object is missing", async () => {
    const badConfig = { ...VALID_CONFIG, paths: undefined as unknown };
    tmpDir = await makeTempRepo(badConfig);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await readState();

    expect(result.configValidation.ok).toBe(false);
    expect(result.configValidation.errors.some((e) => e.includes("paths"))).toBe(true);
  });

  it("returns config validation error for invalid paths.projectPlan value", async () => {
    const badConfig = {
      ...VALID_CONFIG,
      paths: { ...VALID_CONFIG.paths, projectPlan: "some/random/path.md" },
    };
    tmpDir = await makeTempRepo(badConfig);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await readState();

    expect(result.configValidation.ok).toBe(false);
    expect(
      result.configValidation.errors.some((e) => e.includes("paths.projectPlan"))
    ).toBe(true);
  });

  it("parses tasks from fix_plan.md correctly", async () => {
    tmpDir = await makeTempRepo(VALID_CONFIG);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    await fs.writeFile(path.join(tmpDir, ".ralph", "fix_plan.md"), FIX_PLAN_FIXTURE, "utf8");

    const result = await readState();

    expect(result.tasks.length).toBeGreaterThan(0);
    const alpha = result.tasks.find((t) => t.text.includes("Alpha task"));
    expect(alpha).toBeDefined();
    expect(alpha?.checked).toBe(false);
    expect(alpha?.section).toBe("active");

    const beta = result.tasks.find((t) => t.text.includes("Beta task"));
    expect(beta).toBeDefined();
    expect(beta?.checked).toBe(true);

    const delta = result.tasks.find((t) => t.text.includes("Delta task"));
    expect(delta).toBeDefined();
    expect(delta?.section).toBe("blocked");

    expect(result.artifacts.fixPlan).toBe(true);
  });

  it("reports prd.exists false when prd.md is absent", async () => {
    tmpDir = await makeTempRepo(VALID_CONFIG);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await readState();

    expect(result.prd.exists).toBe(false);
    expect(result.artifacts.prd).toBe(false);
  });

  it("reports prd.exists true and returns tail when prd.md is present", async () => {
    tmpDir = await makeTempRepo(VALID_CONFIG);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    await fs.writeFile(
      path.join(tmpDir, ".ralph", "prd.md"),
      "# PRD\n\nLast line content here.\n",
      "utf8"
    );

    const result = await readState();

    expect(result.prd.exists).toBe(true);
    expect(result.prd.tail).toContain("Last line content here.");
    expect(result.artifacts.prd).toBe(true);
  });

  it("returns progress tail capped at 50 lines", async () => {
    tmpDir = await makeTempRepo(VALID_CONFIG);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    await fs.mkdir(path.join(tmpDir, ".ralph", "logs"), { recursive: true });

    const lines = Array.from({ length: 80 }, (_, i) => `[2026-03-31T00:00:00Z] Line ${i + 1}`);
    // Write without trailing newline so split() gives exactly 80 elements with no empty tail
    await fs.writeFile(
      path.join(tmpDir, ".ralph", "logs", "progress.txt"),
      lines.join("\n"),
      "utf8"
    );

    const result = await readState();

    const tailLines = result.progressTail.trim().split("\n");
    expect(tailLines.length).toBe(50);
    expect(tailLines[0]).toContain("Line 31");
    expect(tailLines[tailLines.length - 1]).toContain("Line 80");
    expect(result.artifacts.progressLog).toBe(true);
  });

  it("returns learnings tail capped at 120 lines", async () => {
    tmpDir = await makeTempRepo(VALID_CONFIG);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    await fs.mkdir(path.join(tmpDir, ".ralph", "logs"), { recursive: true });

    const lines = Array.from({ length: 160 }, (_, i) => `## Learning ${i + 1}`);
    // Write without trailing newline so split() gives exactly 160 elements with no empty tail
    await fs.writeFile(
      path.join(tmpDir, ".ralph", "logs", "learnings.md"),
      lines.join("\n"),
      "utf8"
    );

    const result = await readState();

    const tailLines = result.learningsTail.trim().split("\n");
    expect(tailLines.length).toBe(120);
    expect(tailLines[0]).toContain("Learning 41");
    expect(tailLines[tailLines.length - 1]).toContain("Learning 160");
    expect(result.artifacts.learningsLog).toBe(true);
  });

  it("lists spec files under .ralph/specs/", async () => {
    tmpDir = await makeTempRepo(VALID_CONFIG);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    await fs.mkdir(path.join(tmpDir, ".ralph", "specs"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, ".ralph", "specs", "auth.md"), "# Auth spec\n", "utf8");
    await fs.writeFile(path.join(tmpDir, ".ralph", "specs", "api.md"), "# API spec\n", "utf8");

    const result = await readState();

    expect(result.specFiles.length).toBe(2);
    expect(result.specFiles.some((f) => f.includes("auth.md"))).toBe(true);
    expect(result.specFiles.some((f) => f.includes("api.md"))).toBe(true);
    expect(result.artifacts.specsCount).toBe(2);
  });

  it("detects dash-variant fix-plan files in fixPlanVariants", async () => {
    tmpDir = await makeTempRepo(VALID_CONFIG);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    await fs.writeFile(
      path.join(tmpDir, ".ralph", "fix-plan.md"),
      "# Fix Plan (wrong name)\n",
      "utf8"
    );

    const result = await readState();

    expect(result.fixPlanVariants.length).toBeGreaterThan(0);
    expect(result.fixPlanVariants.some((v) => v.includes("fix-plan.md"))).toBe(true);
  });

  it("includes allowed npm scripts from default list", async () => {
    tmpDir = await makeTempRepo(VALID_CONFIG);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await readState();

    expect(Array.isArray(result.allowedNpmScripts)).toBe(true);
    expect(result.allowedNpmScripts.includes("ci")).toBe(true);
    expect(result.allowedNpmScripts.includes("test:e2e")).toBe(true);
  });

  it("returns repoRoot pointing to the temp directory", async () => {
    tmpDir = await makeTempRepo(VALID_CONFIG);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await readState();

    expect(result.repoRoot.replaceAll("\\", "/")).toContain(
      tmpDir.replaceAll("\\", "/")
    );
  });
});
