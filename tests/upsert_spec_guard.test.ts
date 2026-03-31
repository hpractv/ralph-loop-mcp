import { describe, expect, it, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { upsertSpec } from "../src/tools.js";

async function makeTempRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ralph-spec-guard-"));
  await fs.writeFile(path.join(dir, "package.json"), "{}", "utf8");
  await fs.mkdir(path.join(dir, ".ralph", "specs"), { recursive: true });
  return dir;
}

describe("upsertSpec guard", () => {
  let tmpDir = "";

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = "";
  });

  it("rejects reserved log-like filenames under specs", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    await expect(upsertSpec(".ralph/specs/progress.txt", "x")).rejects.toThrow(/reserved filename/i);
    await expect(upsertSpec(".ralph/specs/learnings.md", "x")).rejects.toThrow(/reserved filename/i);
  });

  it("allows normal spec markdown files", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await upsertSpec(".ralph/specs/event-pipeline.md", "# Event Pipeline\n");

    expect(result.ok).toBe(true);
    expect(result.path).toBe(".ralph/specs/event-pipeline.md");
    const content = await fs.readFile(path.join(tmpDir, ".ralph", "specs", "event-pipeline.md"), "utf8");
    expect(content).toContain("# Event Pipeline");
  });
});
