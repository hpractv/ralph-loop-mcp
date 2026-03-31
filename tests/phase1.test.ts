import { describe, expect, it, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { generatePhase1, writePlan, writePrd } from "../src/tools.js";

async function makeTempRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ralph-p1-test-"));
  await fs.writeFile(path.join(dir, "package.json"), "{}", "utf8");
  return dir;
}

describe("generatePhase1", () => {
  let tmpDir: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = "";
  });

  it("creates phase1.sh as a single-run script (no while loop)", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await generatePhase1();

    const content = await fs.readFile(path.join(tmpDir, ".ralph", "phase1.sh"), "utf8");
    expect(content).toContain("#!/usr/bin/env bash");
    expect(content).toContain("copilot --yolo --no-ask-user");
    expect(content).toContain("phase1-prd-prompt.md");
    expect(content).not.toContain("while ");
    expect(content).not.toContain("has_unchecked_tasks");
  });

  it("uses stdin pipe for copilot prompt with preamble + prompt file", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await generatePhase1();

    const content = await fs.readFile(path.join(tmpDir, ".ralph", "phase1.sh"), "utf8");
    expect(content).toMatch(/\}\s*\|\s*copilot/);
    expect(content).toContain("SOURCE_PLAN_PATH");
  });

  it("does NOT create planning-tasks.md", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await generatePhase1();

    const exists = await fs.access(path.join(tmpDir, ".github", "plans", "planning-tasks.md"))
      .then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });

  it("seeds .github/plans/project-plan.md if missing", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await generatePhase1();

    const plan = await fs.readFile(path.join(tmpDir, ".github", "plans", "project-plan.md"), "utf8");
    expect(plan).toContain("# Project Plan");
  });

  it("does not overwrite existing project-plan.md", async () => {
    tmpDir = await makeTempRepo();
    await fs.mkdir(path.join(tmpDir, ".github", "plans"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, ".github", "plans", "project-plan.md"),
      "# Existing Plan\n\nKeep this content.\n",
      "utf8",
    );
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await generatePhase1();

    const plan = await fs.readFile(path.join(tmpDir, ".github", "plans", "project-plan.md"), "utf8");
    expect(plan).toContain("Keep this content.");
  });

  it("phase1.sh mentions ralph.write_prd and .ralph/prd.md via nextSteps / prompt file", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await generatePhase1();

    const prompt = await fs.readFile(path.join(tmpDir, ".ralph", "phase1-prd-prompt.md"), "utf8");
    expect(prompt).toContain("ralph.write_prd");
    expect(prompt).toContain(".ralph/prd.md");
    expect(prompt).toContain("Open questions");
  });

  it("returns relative paths including phase1-prd-prompt.md", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await generatePhase1();

    expect(result.ok).toBe(true);
    const files = result.createdFiles as Record<string, string>;
    expect(files["phase1.sh"]).toBe(".ralph/phase1.sh");
    expect(files["project-plan.md"]).toBe(".github/plans/project-plan.md");
    expect(files["phase1-prd-prompt.md"]).toBe(".ralph/phase1-prd-prompt.md");
    expect(Object.keys(files).length).toBeGreaterThanOrEqual(3);
  });

  it("nextSteps mentions prd and ralph.generate_phase2", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await generatePhase1();

    const steps = result.nextSteps.join(" ");
    expect(steps).toContain("ralph.generate_phase2");
    expect(steps.toLowerCase()).toContain("prd");
  });
});

describe("writePlan", () => {
  let tmpDir: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = "";
  });

  it("writes a file under .github/plans/", async () => {
    tmpDir = await makeTempRepo();
    await fs.mkdir(path.join(tmpDir, ".ralph"), { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await writePlan(".github/plans/project-plan.md", "# My Plan\n");

    expect(result.ok).toBe(true);
    expect(result.path).toBe(".github/plans/project-plan.md");
    const content = await fs.readFile(path.join(tmpDir, ".github", "plans", "project-plan.md"), "utf8");
    expect(content).toContain("# My Plan");
  });

  it("rejects paths outside .github/plans/", async () => {
    tmpDir = await makeTempRepo();
    await fs.mkdir(path.join(tmpDir, ".ralph"), { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await expect(writePlan("src/SomeFile.cs", "bad")).rejects.toThrow(".github/plans/");
  });

  it("creates subdirectories as needed", async () => {
    tmpDir = await makeTempRepo();
    await fs.mkdir(path.join(tmpDir, ".ralph"), { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await writePlan(".github/plans/sub/topic.md", "# Topic");

    const content = await fs.readFile(
      path.join(tmpDir, ".github", "plans", "sub", "topic.md"),
      "utf8",
    );
    expect(content).toContain("# Topic");
  });

  it("appends trailing newline if missing", async () => {
    tmpDir = await makeTempRepo();
    await fs.mkdir(path.join(tmpDir, ".ralph"), { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await writePlan(".github/plans/project-plan.md", "no newline");

    const content = await fs.readFile(
      path.join(tmpDir, ".github", "plans", "project-plan.md"),
      "utf8",
    );
    expect(content.endsWith("\n")).toBe(true);
  });
});

describe("writePrd", () => {
  let tmpDir: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = "";
  });

  it("writes .ralph/prd.md", async () => {
    tmpDir = await makeTempRepo();
    await fs.mkdir(path.join(tmpDir, ".ralph"), { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const r = await writePrd("# PRD\n");
    expect(r.ok).toBe(true);
    expect(r.path).toBe(".ralph/prd.md");
    const c = await fs.readFile(path.join(tmpDir, ".ralph", "prd.md"), "utf8");
    expect(c).toContain("# PRD");
  });
});
