import { describe, expect, it } from "vitest";
import { normalizeToolName } from "../src/index.js";

describe("normalizeToolName", () => {
  it("normalizes ralph_ prefix to ralph. for generate_phase1", () => {
    expect(normalizeToolName("ralph_generate_phase1")).toBe("ralph.generate_phase1");
  });

  it("normalizes ralph_ prefix to ralph. for run_verification", () => {
    expect(normalizeToolName("ralph_run_verification")).toBe("ralph.run_verification");
  });

  it("passes through dot-form names unchanged", () => {
    expect(normalizeToolName("ralph.generate_phase2")).toBe("ralph.generate_phase2");
  });

  it("does not modify underscores within a dot-form tool name", () => {
    expect(normalizeToolName("ralph.next_task")).toBe("ralph.next_task");
  });

  it("normalizes underscore variant of a tool name that contains underscores", () => {
    expect(normalizeToolName("ralph_next_task")).toBe("ralph.next_task");
  });

  it("does not modify non-ralph-prefixed tool names", () => {
    expect(normalizeToolName("other_tool")).toBe("other_tool");
  });

  it("normalizes bare ralph_ prefix with empty suffix", () => {
    expect(normalizeToolName("ralph_")).toBe("ralph.");
  });

  it("does not normalize uppercase RALPH_ prefix (case-sensitive)", () => {
    expect(normalizeToolName("RALPH_generate_phase1")).toBe("RALPH_generate_phase1");
  });

  it("returns empty string unchanged without throwing", () => {
    expect(normalizeToolName("")).toBe("");
  });
});
