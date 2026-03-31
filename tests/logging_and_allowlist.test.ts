import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { appendText, getAllowedNpmScripts } from "../src/workflow.js";
import { runNpmScript } from "../src/verification.js";

describe("logging", () => {
  it("appendText always ends with newline", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ralph-"));
    const p = path.join(dir, "log.txt");
    await appendText(p, "hello");
    await appendText(p, "world\n");
    const text = await fs.readFile(p, "utf8");
    expect(text).toBe("hello\nworld\n");
  });
});

describe("allowlist", () => {
  it("includes defaults", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ralph-"));
    await fs.mkdir(path.join(dir, ".ralph"), { recursive: true });
    await fs.writeFile(path.join(dir, "package.json"), "{}", "utf8");

    const allowed = getAllowedNpmScripts(dir);
    expect(allowed.has("ci")).toBe(true);
    expect(allowed.has("test:e2e")).toBe(true);
  });

  it("rejects non-allowlisted scripts before running npm", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ralph-"));
    await fs.mkdir(path.join(dir, ".ralph"), { recursive: true });
    await fs.writeFile(path.join(dir, "package.json"), "{}", "utf8");

    await expect(runNpmScript(dir, "definitely-not-allowed", 1)).rejects.toThrow(
      /not allowlisted/i,
    );
  });
});
