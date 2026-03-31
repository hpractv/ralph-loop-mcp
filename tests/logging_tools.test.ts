import { describe, expect, it, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { appendProgress, appendLearning, writeEpicPlan } from "../src/tools.js";

async function makeTempRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ralph-logging-"));
  await fs.writeFile(path.join(dir, "package.json"), "{}", "utf8");
  await fs.mkdir(path.join(dir, ".ralph", "logs"), { recursive: true });
  return dir;
}

const ISO_TS_RE = /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\]/;

describe("appendProgress", () => {
  let tmpDir: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = "";
  });

  it("appends a timestamped entry to an existing log file", async () => {
    tmpDir = await makeTempRepo();
    const logPath = path.join(tmpDir, ".ralph", "logs", "progress.txt");
    await fs.writeFile(logPath, "", "utf8");
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await appendProgress("started work");

    const text = await fs.readFile(logPath, "utf8");
    expect(ISO_TS_RE.test(text)).toBe(true);
    expect(text).toMatch(/\] started work\n$/);
  });

  it("trims whitespace from the entry", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await appendProgress("  padded  ");

    const logPath = path.join(tmpDir, ".ralph", "logs", "progress.txt");
    const text = await fs.readFile(logPath, "utf8");
    expect(text).toMatch(/\] padded\n$/);
    expect(text).not.toMatch(/\]  padded/);
  });

  it("creates the log file if it does not exist", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await appendProgress("new entry");

    const logPath = path.join(tmpDir, ".ralph", "logs", "progress.txt");
    const text = await fs.readFile(logPath, "utf8");
    expect(ISO_TS_RE.test(text)).toBe(true);
    expect(text).toContain("new entry");
  });

  it("accumulates multiple entries", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await appendProgress("first");
    await appendProgress("second");

    const logPath = path.join(tmpDir, ".ralph", "logs", "progress.txt");
    const text = await fs.readFile(logPath, "utf8");
    const lines = text.split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(ISO_TS_RE);
    expect(lines[1]).toMatch(ISO_TS_RE);
    expect(lines[0]).toContain("first");
    expect(lines[1]).toContain("second");
  });

  it("returns { ok: true }", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await appendProgress("done");

    expect(result.ok).toBe(true);
  });
});

describe("appendLearning", () => {
  let tmpDir: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = "";
  });

  it("writes a section heading with a UTC timestamp", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await appendLearning("Key insight", "Details here.");

    const logPath = path.join(tmpDir, ".ralph", "logs", "learnings.md");
    const text = await fs.readFile(logPath, "utf8");
    expect(text).toMatch(/## \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z:/);
  });

  it("includes the title in the heading", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await appendLearning("My Title", "Some body.");

    const logPath = path.join(tmpDir, ".ralph", "logs", "learnings.md");
    const text = await fs.readFile(logPath, "utf8");
    expect(text).toContain("My Title");
  });

  it("includes the body after the heading", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await appendLearning("Title", "Body content here.");

    const logPath = path.join(tmpDir, ".ralph", "logs", "learnings.md");
    const text = await fs.readFile(logPath, "utf8");
    const headingIdx = text.indexOf("## ");
    const bodyIdx = text.indexOf("Body content here.");
    expect(bodyIdx).toBeGreaterThan(headingIdx);
  });

  it("trims whitespace from title and body", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await appendLearning("  Trimmed Title  ", "  Trimmed body.  ");

    const logPath = path.join(tmpDir, ".ralph", "logs", "learnings.md");
    const text = await fs.readFile(logPath, "utf8");
    expect(text).not.toMatch(/##\s+\s/);
    expect(text).toContain("Trimmed Title");
    expect(text).toContain("Trimmed body.");
    expect(text).not.toContain("  Trimmed Title  ");
    expect(text).not.toContain("  Trimmed body.  ");
  });

  it("creates learnings.md if it does not exist", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await appendLearning("First ever", "Content.");

    const logPath = path.join(tmpDir, ".ralph", "logs", "learnings.md");
    const exists = await fs.access(logPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it("accumulates multiple sections with separate headings", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await appendLearning("First", "Body one.");
    await appendLearning("Second", "Body two.");

    const logPath = path.join(tmpDir, ".ralph", "logs", "learnings.md");
    const text = await fs.readFile(logPath, "utf8");
    const headings = text.match(/^## /gm);
    expect(headings).toHaveLength(2);
    expect(text).toContain("First");
    expect(text).toContain("Second");
  });

  it("returns { ok: true }", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await appendLearning("Title", "Body.");

    expect(result.ok).toBe(true);
  });
});

describe("writeEpicPlan", () => {
  let tmpDir: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = "";
  });

  it("writes content to .ralph/epic_plan.md", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await writeEpicPlan("# My Epic\n\nSome content.\n");

    const text = await fs.readFile(path.join(tmpDir, ".ralph", "epic_plan.md"), "utf8");
    expect(text).toBe("# My Epic\n\nSome content.\n");
  });

  it("adds a trailing newline when absent", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await writeEpicPlan("No trailing newline");

    const text = await fs.readFile(path.join(tmpDir, ".ralph", "epic_plan.md"), "utf8");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("preserves existing trailing newline without doubling", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await writeEpicPlan("Already has newline\n");

    const text = await fs.readFile(path.join(tmpDir, ".ralph", "epic_plan.md"), "utf8");
    expect(text).toBe("Already has newline\n");
    expect(text.endsWith("\n\n")).toBe(false);
  });

  it("overwrites existing file on second write", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await writeEpicPlan("First content\n");
    await writeEpicPlan("Second content\n");

    const text = await fs.readFile(path.join(tmpDir, ".ralph", "epic_plan.md"), "utf8");
    expect(text).toBe("Second content\n");
    expect(text).not.toContain("First content");
  });

  it("creates .ralph/ directory if absent", async () => {
    tmpDir = await makeTempRepo();
    await fs.rm(path.join(tmpDir, ".ralph"), { recursive: true, force: true });
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await writeEpicPlan("Content\n");

    const text = await fs.readFile(path.join(tmpDir, ".ralph", "epic_plan.md"), "utf8");
    expect(text).toBe("Content\n");
  });

  it("returns { ok: true, path: '.ralph/epic_plan.md' }", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await writeEpicPlan("Content\n");

    expect(result.ok).toBe(true);
    expect(result.path).toBe(".ralph/epic_plan.md");
  });
});
