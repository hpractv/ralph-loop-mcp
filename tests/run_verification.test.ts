import { describe, expect, it, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

vi.mock("../src/verification.js", () => ({
  runNpmScript: vi.fn(),
}));

import { runNpmScript } from "../src/verification.js";
import { runVerification } from "../src/tools.js";

function makeScriptResult(script: string, returncode: number) {
  return { script, returncode, stdout: "", stderr: "" };
}

async function makeTempRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ralph-verify-"));
  await fs.writeFile(path.join(dir, "package.json"), "{}", "utf8");
  await fs.mkdir(path.join(dir, ".ralph"), { recursive: true });
  return dir;
}

describe("runVerification", () => {
  let tmpDir: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.mocked(runNpmScript).mockReset();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = "";
  });

  it("returns ok:true when both ci and test:e2e pass", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    vi.mocked(runNpmScript)
      .mockResolvedValueOnce(makeScriptResult("ci", 0))
      .mockResolvedValueOnce(makeScriptResult("test:e2e", 0));

    const result = await runVerification(30);

    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(2);
  });

  it("stops after ci fails and does not run test:e2e", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    vi.mocked(runNpmScript).mockResolvedValueOnce(makeScriptResult("ci", 1));

    const result = await runVerification(30);

    expect(result.ok).toBe(false);
    expect(result.results).toHaveLength(1);
    expect(vi.mocked(runNpmScript)).toHaveBeenCalledTimes(1);
  });

  it("returns ok:false when ci passes but test:e2e fails", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    vi.mocked(runNpmScript)
      .mockResolvedValueOnce(makeScriptResult("ci", 0))
      .mockResolvedValueOnce(makeScriptResult("test:e2e", 1));

    const result = await runVerification(30);

    expect(result.ok).toBe(false);
    expect(result.results).toHaveLength(2);
    expect(vi.mocked(runNpmScript)).toHaveBeenCalledTimes(2);
  });

  it("ok is true only when all script results have returncode 0", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    vi.mocked(runNpmScript)
      .mockResolvedValueOnce(makeScriptResult("ci", 0))
      .mockResolvedValueOnce(makeScriptResult("test:e2e", 0));

    const result = await runVerification(30);

    expect(result.ok).toBe(true);
    expect(result.results.every((r) => r.returncode === 0)).toBe(true);
  });

  it("forwards the timeoutSeconds argument to every runNpmScript call", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    vi.mocked(runNpmScript)
      .mockResolvedValueOnce(makeScriptResult("ci", 0))
      .mockResolvedValueOnce(makeScriptResult("test:e2e", 0));

    await runVerification(300);

    const calls = vi.mocked(runNpmScript).mock.calls;
    expect(calls[0][2]).toBe(300);
    expect(calls[1][2]).toBe(300);
  });

  it("calls ci first then test:e2e in that order", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    vi.mocked(runNpmScript)
      .mockResolvedValueOnce(makeScriptResult("ci", 0))
      .mockResolvedValueOnce(makeScriptResult("test:e2e", 0));

    await runVerification(30);

    const calls = vi.mocked(runNpmScript).mock.calls;
    expect(calls[0][1]).toBe("ci");
    expect(calls[1][1]).toBe("test:e2e");
  });

  it("forwards the default 1800 second timeout when called with that value", async () => {
    tmpDir = await makeTempRepo();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    vi.mocked(runNpmScript)
      .mockResolvedValueOnce(makeScriptResult("ci", 0))
      .mockResolvedValueOnce(makeScriptResult("test:e2e", 0));

    await runVerification(1800);

    const calls = vi.mocked(runNpmScript).mock.calls;
    expect(calls[0][2]).toBe(1800);
    expect(calls[1][2]).toBe(1800);
  });
});
