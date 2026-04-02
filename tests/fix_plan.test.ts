import { describe, expect, it } from "vitest";

import {
  blockTaskMd,
  parseFixPlan,
  sandboxPath,
  setTaskChecked,
  unblockTaskMd,
  type TaskRef,
} from "../src/workflow.js";

const SAMPLE = `# Fix Plan

## Tasks
- [ ] First thing task-id: a1
- [x] Done thing

## Blocked
- [ ] Blocked thing task-id: b1 — BLOCKED: no api
`;

const WITH_DEFER_NOTE = `# Fix Plan

## Tasks
- [ ] First thing task-id: a1
  <!-- ralph-defer: blocked-by: p2-002 — need API first -->
- [x] Done thing
`;

describe("fix_plan parsing", () => {
  it("parses active and blocked sections", () => {
    const tasks = parseFixPlan(SAMPLE);
    const active = tasks.filter((t) => t.section === "active");
    const blocked = tasks.filter((t) => t.section === "blocked");
    expect(active).toHaveLength(2);
    expect(blocked).toHaveLength(1);
  });

  it("ignores non-checkbox defer note lines (does not create extra tasks)", () => {
    const tasks = parseFixPlan(WITH_DEFER_NOTE);
    const titles = tasks.map((t) => t.text);
    expect(titles.some((t) => t.includes("ralph-defer"))).toBe(false);
    expect(titles).toContain("First thing task-id: a1");
  });

  it("checks off by task-id", () => {
    const ref: TaskRef = { text: "First thing", taskId: "a1" };
    const updated = setTaskChecked(SAMPLE, ref, true);
    expect(updated).toContain("- [x] First thing");
  });

  it("blocks and unblocks", () => {
    const ref: TaskRef = { text: "First thing", taskId: "a1" };
    const md2 = blockTaskMd(SAMPLE, ref, "need dependency");
    expect(md2).toContain("## Blocked");
    expect(md2).toContain("BLOCKED: need dependency");

    const md3 = unblockTaskMd(md2, ref);
    expect(md3).toContain("- [ ] First thing");
  });
});

describe("path sandbox", () => {
  it("allows inside root", () => {
    const root = "C:/tmp/root";
    const p = sandboxPath(root, "a/b/c.txt");
    expect(p.abs.replaceAll("\\", "/")).toContain("/tmp/root/");
  });

  it("rejects escape", () => {
    const root = "C:/tmp/root";
    expect(() => sandboxPath(root, "../evil.txt")).toThrow();
  });
});
