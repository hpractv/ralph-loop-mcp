import { describe, expect, it } from "vitest";
import { replaceFixPlanMd } from "../src/workflow.js";

const SIMPLE_NEW = "# Fix Plan\n\n## Tasks\n- [ ] Brand new task\n";

describe("replaceFixPlanMd", () => {
  it("no-preserve with empty oldMd writes new content verbatim", () => {
    const result = replaceFixPlanMd("", "# New\n- [ ] Task A\n", false);
    expect(result).toBe("# New\n- [ ] Task A\n");
  });

  it("no-preserve with non-empty oldMd still returns new content", () => {
    const old = "# Fix Plan\n- [x] Done thing\n";
    const result = replaceFixPlanMd(old, "# New\n- [ ] Task A\n", false);
    expect(result).toBe("# New\n- [ ] Task A\n");
  });

  it("empty oldMd short-circuits even when preserveCompleted is true", () => {
    const result = replaceFixPlanMd("", "# New\n- [ ] Task A\n", true);
    expect(result).toBe("# New\n- [ ] Task A\n");
  });

  it("in-place merge by taskId: checked state from old survives", () => {
    const old = "# Fix Plan\n\n## Tasks\n- [x] Implement handler task-id: p3-001\n";
    const newMd = "# Fix Plan\n\n## Tasks\n- [ ] Implement handler task-id: p3-001\n";
    const result = replaceFixPlanMd(old, newMd, true);
    expect(result).toContain("- [x] Implement handler task-id: p3-001");
  });

  it("in-place merge by normalized text when no taskId", () => {
    const old = "# Fix Plan\n\n## Tasks\n- [x] Write unit tests\n";
    const newMd = "# Fix Plan\n\n## Tasks\n- [ ] Write unit tests\n";
    const result = replaceFixPlanMd(old, newMd, true);
    expect(result).toContain("- [x] Write unit tests");
  });

  it("unchecked tasks from old active section absent from new are NOT carried forward", () => {
    const old = "# Fix Plan\n\n## Tasks\n- [ ] Stale task\n";
    const result = replaceFixPlanMd(old, SIMPLE_NEW, true);
    expect(result).not.toContain("Stale task");
    expect(result).toContain("Brand new task");
  });

  it("completed tasks absent from new are carried forward under Completed heading", () => {
    const old = "# Fix Plan\n\n## Tasks\n- [x] Done old task task-id: old-1\n";
    const result = replaceFixPlanMd(old, SIMPLE_NEW, true);
    expect(result).toContain("## Completed (carried forward)");
    expect(result).toContain("- [x] Done old task task-id: old-1");
    expect(result).toContain("Brand new task");
  });

  it("blocked tasks absent from new are carried forward under Blocked heading", () => {
    const old = "# Fix Plan\n\n## Tasks\n- [ ] Active thing\n\n## Blocked\n- [ ] Blocked thing task-id: b1 -- BLOCKED: no api\n";
    const result = replaceFixPlanMd(old, SIMPLE_NEW, true);
    expect(result).toContain("## Blocked");
    expect(result).toContain("- [ ] Blocked thing task-id: b1 -- BLOCKED: no api");
  });

  it("blocked task present in both old and new is NOT duplicated", () => {
    const blockedLine = "- [ ] Duplicate blocked task-id: dup-1";
    const old = `# Fix Plan\n\n## Tasks\n\n## Blocked\n${blockedLine}\n`;
    const newMd = `# Fix Plan\n\n## Tasks\n\n## Blocked\n${blockedLine}\n`;
    const result = replaceFixPlanMd(old, newMd, true);
    const occurrences = (result.match(/Duplicate blocked/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it("trailing newline invariant: result always ends with newline", () => {
    const cases: Array<[string, string, boolean]> = [
      ["", "# New\n- [ ] A\n", false],
      ["", "# New\n- [ ] A\n", true],
      ["# Old\n- [x] Done\n", "# New\n- [ ] A\n", true],
      ["# Old\n- [x] Done\n", "# New\n- [ ] A", true],
    ];
    for (const [old, newMd, preserve] of cases) {
      const result = replaceFixPlanMd(old, newMd, preserve);
      expect(result.endsWith("\n"), `result should end with newline for preserve=${preserve}`).toBe(true);
    }
  });
});
