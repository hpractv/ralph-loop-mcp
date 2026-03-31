import { it, expect, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { readState } from "../src/tools.js";

let tmpDir = "";

afterEach(async () => {
  vi.restoreAllMocks();
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  tmpDir = "";
});

it("handles repo-root-not-found when no package.json and no .ralph present", async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ralph-readstate-no-root-"));
  // Intentionally do NOT create package.json or .ralph to simulate running outside a repo
  vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

  const result = await readState();

  expect(result.configValidation.ok).toBe(false);
  expect(result.configValidation.errors).toContain("Missing .ralph/config.json");
  expect(result.repoRoot.replaceAll("\\", "/")).toContain(tmpDir.replaceAll("\\", "/"));
});
