import { describe, expect, it, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { listFiles, readFile } from "../src/tools.js";

async function makeTempRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ralph-explore-"));
  await fs.writeFile(path.join(dir, "package.json"), "{}", "utf8");
  await fs.mkdir(path.join(dir, ".ralph"), { recursive: true });
  return dir;
}

describe("listFiles", () => {
  let tmpDir: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = "";
  });

  it("returns entries for the repo root including files and dirs", async () => {
    tmpDir = await makeTempRepo();
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "src", "index.ts"), "// index\n", "utf8");
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await listFiles("");

    const types = Object.fromEntries(result.entries.map((e) => [e.path, e.type]));
    expect(types["src"]).toBe("dir");
    expect(types["package.json"]).toBe("file");
  });

  it("returns entries for a subdirectory", async () => {
    tmpDir = await makeTempRepo();
    await fs.mkdir(path.join(tmpDir, ".ralph", "specs"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, ".ralph", "specs", "spec-a.md"), "# A\n", "utf8");
    await fs.writeFile(path.join(tmpDir, ".ralph", "specs", "spec-b.md"), "# B\n", "utf8");
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await listFiles(".ralph/specs");

    const paths = result.entries.map((e) => e.path);
    expect(paths.some((p) => p.includes("spec-a.md"))).toBe(true);
    expect(paths.some((p) => p.includes("spec-b.md"))).toBe(true);
    expect(result.entries.every((e) => e.type === "file")).toBe(true);
  });

  it("defaults to repo root when directory is empty string", async () => {
    tmpDir = await makeTempRepo();
    await fs.writeFile(path.join(tmpDir, "README.md"), "# Readme\n", "utf8");
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await listFiles("");

    const paths = result.entries.map((e) => e.path);
    expect(paths.some((p) => p.includes("README.md"))).toBe(true);
  });

  it("returns empty array for a non-existent directory without throwing", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await listFiles("missing-dir");

    expect(Array.isArray(result.entries)).toBe(true);
    expect(result.entries).toHaveLength(0);
  });

  it("rejects paths that escape the sandbox", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await expect(listFiles("../../etc")).rejects.toThrow();
  });

  it("returns entries sorted alphabetically by path", async () => {
    tmpDir = await makeTempRepo();
    await fs.mkdir(path.join(tmpDir, ".ralph", "specs"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, ".ralph", "specs", "zzz.md"), "z\n", "utf8");
    await fs.writeFile(path.join(tmpDir, ".ralph", "specs", "aaa.md"), "a\n", "utf8");
    await fs.writeFile(path.join(tmpDir, ".ralph", "specs", "mmm.md"), "m\n", "utf8");
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await listFiles(".ralph/specs");

    const paths = result.entries.map((e) => e.path);
    const sorted = [...paths].sort();
    expect(paths).toEqual(sorted);
  });

  it("returns root field using forward slashes only", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await listFiles("");

    expect(result.root).not.toContain("\\");
  });
});

describe("readFile", () => {
  let tmpDir: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = "";
  });

  it("returns { ok: true, path, content } for an existing file", async () => {
    tmpDir = await makeTempRepo();
    await fs.writeFile(path.join(tmpDir, ".ralph", "prd.md"), "# PRD\n\nContent here.\n", "utf8");
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await readFile(".ralph/prd.md");

    expect(result.ok).toBe(true);
    expect(result.path).toBe(".ralph/prd.md");
    expect(result.content).toContain("# PRD");
    expect(result.content).toContain("Content here.");
  });

  it("returns { ok: false, path, error } when file does not exist", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await readFile("nonexistent.md");

    expect(result.ok).toBe(false);
    expect(result.path).toBe("nonexistent.md");
    expect(typeof (result as { error: string }).error).toBe("string");
    expect((result as { error: string }).error.length).toBeGreaterThan(0);
  });

  it("does not throw for a missing file", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await expect(readFile("does-not-exist.md")).resolves.toBeDefined();
  });

  it("reads a nested file correctly", async () => {
    tmpDir = await makeTempRepo();
    await fs.mkdir(path.join(tmpDir, ".ralph", "specs", "sub"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, ".ralph", "specs", "sub", "spec.md"),
      "# Nested Spec\n",
      "utf8",
    );
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await readFile(".ralph/specs/sub/spec.md");

    expect(result.ok).toBe(true);
    expect(result.content).toContain("# Nested Spec");
  });

  it("rejects paths that escape the sandbox", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await expect(readFile("../../etc/passwd")).rejects.toThrow();
  });

  it("reads a file at the repo root", async () => {
    tmpDir = await makeTempRepo();
    await fs.writeFile(path.join(tmpDir, "README.md"), "# Hello World\n", "utf8");
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await readFile("README.md");

    expect(result.ok).toBe(true);
    expect(result.content).toContain("# Hello World");
  });
});
