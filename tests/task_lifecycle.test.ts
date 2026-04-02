import { describe, expect, it, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { nextTask, setTaskStatus, blockTask, unblockTask } from "../src/tools.js";

const FIX_PLAN_FIXTURE = `# Fix Plan

## Tasks
- [ ] Alpha task task-id: a1
- [x] Beta task task-id: a2
- [ ] Gamma task task-id: a3

## Blocked
- [ ] Delta task task-id: b1 -- BLOCKED: no api
`;

const FIX_PLAN_ALL_DONE = `# Fix Plan

## Tasks
- [x] Alpha task task-id: a1
- [x] Beta task task-id: a2
`;

const FIX_PLAN_ONLY_BLOCKED = `# Fix Plan

## Tasks

## Blocked
- [ ] Delta task task-id: b1 -- BLOCKED: need spec
`;

async function makeTempRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ralph-lifecycle-"));
  await fs.writeFile(path.join(dir, "package.json"), "{}", "utf8");
  await fs.mkdir(path.join(dir, ".ralph"), { recursive: true });
  return dir;
}

async function writeFixPlan(dir: string, content: string): Promise<void> {
  await fs.writeFile(path.join(dir, ".ralph", "fix_plan.md"), content, "utf8");
}

async function readFixPlan(dir: string): Promise<string> {
  return fs.readFile(path.join(dir, ".ralph", "fix_plan.md"), "utf8");
}

describe("nextTask", () => {
  let tmpDir: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = "";
  });

  it("returns null with reason when fix_plan.md is missing", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await nextTask();

    expect(result.task).toBeNull();
    expect(result.reason).toMatch(/missing/i);
  });

  it("returns null with reason when all active tasks are completed", async () => {
    tmpDir = await makeTempRepo();
    await writeFixPlan(tmpDir, FIX_PLAN_ALL_DONE);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await nextTask();

    expect(result.task).toBeNull();
    expect(result.reason).toMatch(/no unchecked/i);
  });

  it("returns null when only blocked tasks exist (no active unchecked)", async () => {
    tmpDir = await makeTempRepo();
    await writeFixPlan(tmpDir, FIX_PLAN_ONLY_BLOCKED);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await nextTask();

    expect(result.task).toBeNull();
    expect(result.reason).toMatch(/no unchecked/i);
  });

  it("returns the first unchecked active task", async () => {
    tmpDir = await makeTempRepo();
    await writeFixPlan(tmpDir, FIX_PLAN_FIXTURE);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await nextTask();

    expect(result.task).not.toBeNull();
    expect(result.task?.section).toBe("active");
    expect(result.task?.checked).toBe(false);
    expect(result.task?.text).toContain("Alpha task");
  });

  it("skips checked tasks and returns the next unchecked one", async () => {
    const plan = `# Fix Plan\n\n## Tasks\n- [x] Done first task-id: x1\n- [ ] Second task task-id: x2\n`;
    tmpDir = await makeTempRepo();
    await writeFixPlan(tmpDir, plan);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await nextTask();

    expect(result.task?.text).toContain("Second task");
    expect(result.task?.taskId).toBe("x2");
  });
});

describe("setTaskStatus", () => {
  let tmpDir: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = "";
  });

  it("checks an unchecked task by taskId", async () => {
    tmpDir = await makeTempRepo();
    await writeFixPlan(tmpDir, FIX_PLAN_FIXTURE);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await setTaskStatus("Alpha task", true, "a1");

    expect(result.ok).toBe(true);
    const content = await readFixPlan(tmpDir);
    expect(content).toContain("- [x] Alpha task task-id: a1");
  });

  it("unchecks a checked task by taskId", async () => {
    tmpDir = await makeTempRepo();
    await writeFixPlan(tmpDir, FIX_PLAN_FIXTURE);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await setTaskStatus("Beta task", false, "a2");

    expect(result.ok).toBe(true);
    const content = await readFixPlan(tmpDir);
    expect(content).toContain("- [ ] Beta task task-id: a2");
  });

  it("matches by full text when no taskId is provided", async () => {
    tmpDir = await makeTempRepo();
    await writeFixPlan(tmpDir, FIX_PLAN_FIXTURE);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    // Text match requires the full normalized task text (including any inline tags).
    await setTaskStatus("Gamma task task-id: a3", true, null);

    const content = await readFixPlan(tmpDir);
    expect(content).toContain("- [x] Gamma task task-id: a3");
  });

  it("prefers taskId over text when both are provided", async () => {
    const plan = `# Fix Plan\n\n## Tasks\n- [ ] Similar text task-id: id-A\n- [ ] Similar text task-id: id-B\n`;
    tmpDir = await makeTempRepo();
    await writeFixPlan(tmpDir, plan);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await setTaskStatus("Similar text", true, "id-B");

    const content = await readFixPlan(tmpDir);
    const lines = content.split("\n");
    const lineA = lines.find((l) => l.includes("id-A"));
    const lineB = lines.find((l) => l.includes("id-B"));
    expect(lineA).toContain("- [ ]");
    expect(lineB).toContain("- [x]");
  });

  it("persists the change on disk", async () => {
    tmpDir = await makeTempRepo();
    await writeFixPlan(tmpDir, FIX_PLAN_FIXTURE);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await setTaskStatus("Alpha task", true, "a1");

    // Verify the file was actually written (not just returned in memory).
    const raw = await fs.readFile(path.join(tmpDir, ".ralph", "fix_plan.md"), "utf8");
    expect(raw).toContain("- [x] Alpha task task-id: a1");
  });
});

describe("blockTask", () => {
  let tmpDir: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = "";
  });

  it("moves an active task to the Blocked section with the reason", async () => {
    tmpDir = await makeTempRepo();
    await writeFixPlan(tmpDir, FIX_PLAN_FIXTURE);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await blockTask("Alpha task", "waiting for API", "a1");

    expect(result.ok).toBe(true);
    const content = await readFixPlan(tmpDir);
    expect(content).toContain("## Blocked");
    expect(content).toContain("BLOCKED: waiting for API");
    // The task line should appear somewhere after the Blocked heading.
    const blockedIdx = content.indexOf("## Blocked");
    const taskIdx = content.indexOf("Alpha task", blockedIdx);
    expect(taskIdx).toBeGreaterThan(blockedIdx);
  });

  it("removes the task from the active section after blocking", async () => {
    tmpDir = await makeTempRepo();
    await writeFixPlan(tmpDir, FIX_PLAN_FIXTURE);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await blockTask("Alpha task", "need spec", "a1");

    const content = await readFixPlan(tmpDir);
    const tasksIdx = content.indexOf("## Tasks");
    const blockedIdx = content.indexOf("## Blocked");
    // Alpha task must NOT appear in the active section (between Tasks and Blocked headings).
    const activeSection = content.slice(tasksIdx, blockedIdx);
    expect(activeSection).not.toContain("Alpha task");
  });

  it("works by taskId match", async () => {
    tmpDir = await makeTempRepo();
    await writeFixPlan(tmpDir, FIX_PLAN_FIXTURE);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await blockTask("Gamma task", "dependency unresolved", "a3");

    const content = await readFixPlan(tmpDir);
    expect(content).toContain("BLOCKED: dependency unresolved");
  });
});

describe("unblockTask", () => {
  let tmpDir: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = "";
  });

  it("moves a blocked task back to the active section as unchecked", async () => {
    tmpDir = await makeTempRepo();
    await writeFixPlan(tmpDir, FIX_PLAN_FIXTURE);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await unblockTask("Delta task", "b1");

    expect(result.ok).toBe(true);
    const content = await readFixPlan(tmpDir);
    expect(content).toContain("- [ ] Delta task");
    // Must appear before any Blocked heading (or the task must be in the active section).
    const blockedIdx = content.indexOf("## Blocked");
    const taskIdx = content.indexOf("Delta task");
    // Task should appear before the Blocked section (moved to active).
    expect(taskIdx).toBeLessThan(blockedIdx === -1 ? Infinity : blockedIdx);
  });

  it("removes the task from the Blocked section", async () => {
    tmpDir = await makeTempRepo();
    await writeFixPlan(tmpDir, FIX_PLAN_FIXTURE);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await unblockTask("Delta task", "b1");

    const content = await readFixPlan(tmpDir);
    const blockedIdx = content.indexOf("## Blocked");
    if (blockedIdx !== -1) {
      const blockedSection = content.slice(blockedIdx);
      expect(blockedSection).not.toContain("Delta task");
    }
  });

  it("works with null taskId (full text match)", async () => {
    const plan = `# Fix Plan\n\n## Tasks\n\n## Blocked\n- [ ] My blocked task -- BLOCKED: reason\n`;
    tmpDir = await makeTempRepo();
    await writeFixPlan(tmpDir, plan);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    // Text match uses the full parsed task text including the BLOCKED suffix.
    await unblockTask("My blocked task -- BLOCKED: reason", null);

    const content = await readFixPlan(tmpDir);
    expect(content).toContain("- [ ] My blocked task");
  });
});

describe("task lifecycle round-trip", () => {
  let tmpDir: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = "";
  });

  it("block then unblock then check — full round-trip", async () => {
    tmpDir = await makeTempRepo();
    await writeFixPlan(tmpDir, FIX_PLAN_FIXTURE);
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    // Step 1: nextTask returns Alpha task.
    const first = await nextTask();
    expect(first.task?.text).toContain("Alpha task");

    // Step 2: block Alpha task.
    await blockTask("Alpha task", "blocked for now", "a1");
    const afterBlock = await readFixPlan(tmpDir);
    expect(afterBlock).toContain("BLOCKED: blocked for now");

    // Step 3: nextTask now skips Alpha (blocked) and returns Gamma task.
    const second = await nextTask();
    expect(second.task?.text).toContain("Gamma task");

    // Step 4: unblock Alpha.
    await unblockTask("Alpha task", "a1");
    const afterUnblock = await readFixPlan(tmpDir);
    expect(afterUnblock).toContain("- [ ] Alpha task");

    // Step 5: check Alpha as done.
    await setTaskStatus("Alpha task", true, "a1");
    const afterCheck = await readFixPlan(tmpDir);
    expect(afterCheck).toContain("- [x] Alpha task");
  });
});
