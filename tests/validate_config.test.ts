import { describe, expect, it } from "vitest";

import { validateRalphConfig } from "../src/tools.js";

const VALID_CONFIG = {
  version: "1.0",
  phase2: {
    generatorScript: ".ralph/phase2.sh",
    overwriteSpecs: true,
    overwriteFixPlan: true,
  },
  paths: {
    projectPlan: ".ralph/prd.md",
    epicPlan: ".ralph/epic_plan.md",
    fixPlan: ".ralph/fix_plan.md",
    specsDir: ".ralph/specs",
    progressLog: ".ralph/logs/progress.txt",
    learningsLog: ".ralph/logs/learnings.md",
  },
  verification: { timeoutSeconds: 1800, scripts: ["ci", "test:e2e"] },
  allowedNpmScripts: ["build", "ci", "test:ci", "test:e2e", "typecheck"],
  workflow: { blockedHeading: "## Blocked", taskIdTag: "task-id:", timezone: "UTC" },
};

describe("validateRalphConfig", () => {
  it("accepts a valid minimal config", () => {
    const result = validateRalphConfig(VALID_CONFIG);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects null", () => {
    const result = validateRalphConfig(null);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Config must be a JSON object");
  });

  it("rejects a non-object (string)", () => {
    const result = validateRalphConfig("bad");
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Config must be a JSON object");
  });

  it("rejects a non-object (array)", () => {
    const result = validateRalphConfig([]);
    expect(result.ok).toBe(false);
  });

  it("rejects missing version", () => {
    const cfg = { ...VALID_CONFIG, version: undefined };
    const result = validateRalphConfig(cfg);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("version"))).toBe(true);
  });

  it("rejects empty string version", () => {
    const cfg = { ...VALID_CONFIG, version: "" };
    const result = validateRalphConfig(cfg);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("version"))).toBe(true);
  });

  it("rejects whitespace-only version", () => {
    const cfg = { ...VALID_CONFIG, version: "   " };
    const result = validateRalphConfig(cfg);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("version"))).toBe(true);
  });

  it("rejects missing phase2", () => {
    const cfg = { ...VALID_CONFIG, phase2: undefined };
    const result = validateRalphConfig(cfg);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("phase2"))).toBe(true);
  });

  it("rejects phase2.overwriteSpecs not boolean", () => {
    const cfg = { ...VALID_CONFIG, phase2: { ...VALID_CONFIG.phase2, overwriteSpecs: "yes" } };
    const result = validateRalphConfig(cfg);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("phase2.overwriteSpecs"))).toBe(true);
  });

  it("rejects phase2.overwriteFixPlan not boolean", () => {
    const cfg = { ...VALID_CONFIG, phase2: { ...VALID_CONFIG.phase2, overwriteFixPlan: 1 } };
    const result = validateRalphConfig(cfg);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("phase2.overwriteFixPlan"))).toBe(true);
  });

  it("rejects phase2.generatorScript empty string", () => {
    const cfg = { ...VALID_CONFIG, phase2: { ...VALID_CONFIG.phase2, generatorScript: "  " } };
    const result = validateRalphConfig(cfg);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("phase2.generatorScript"))).toBe(true);
  });

  it("rejects missing paths", () => {
    const cfg = { ...VALID_CONFIG, paths: undefined };
    const result = validateRalphConfig(cfg);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("paths"))).toBe(true);
  });

  it("rejects missing paths.epicPlan", () => {
    const cfg = { ...VALID_CONFIG, paths: { ...VALID_CONFIG.paths, epicPlan: undefined } };
    const result = validateRalphConfig(cfg);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("paths.epicPlan"))).toBe(true);
  });

  it("rejects missing paths.fixPlan", () => {
    const cfg = { ...VALID_CONFIG, paths: { ...VALID_CONFIG.paths, fixPlan: undefined } };
    const result = validateRalphConfig(cfg);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("paths.fixPlan"))).toBe(true);
  });

  it("rejects missing paths.specsDir", () => {
    const cfg = { ...VALID_CONFIG, paths: { ...VALID_CONFIG.paths, specsDir: undefined } };
    const result = validateRalphConfig(cfg);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("paths.specsDir"))).toBe(true);
  });

  it("rejects missing paths.progressLog", () => {
    const cfg = { ...VALID_CONFIG, paths: { ...VALID_CONFIG.paths, progressLog: undefined } };
    const result = validateRalphConfig(cfg);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("paths.progressLog"))).toBe(true);
  });

  it("rejects missing paths.learningsLog", () => {
    const cfg = { ...VALID_CONFIG, paths: { ...VALID_CONFIG.paths, learningsLog: undefined } };
    const result = validateRalphConfig(cfg);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("paths.learningsLog"))).toBe(true);
  });

  it("rejects invalid paths.projectPlan (arbitrary path)", () => {
    const cfg = { ...VALID_CONFIG, paths: { ...VALID_CONFIG.paths, projectPlan: "src/somewhere.md" } };
    const result = validateRalphConfig(cfg);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("paths.projectPlan"))).toBe(true);
  });

  it("rejects empty string paths.projectPlan", () => {
    const cfg = { ...VALID_CONFIG, paths: { ...VALID_CONFIG.paths, projectPlan: "" } };
    const result = validateRalphConfig(cfg);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("paths.projectPlan"))).toBe(true);
  });

  it("accepts paths.projectPlan = .ralph/prd.md", () => {
    const cfg = { ...VALID_CONFIG, paths: { ...VALID_CONFIG.paths, projectPlan: ".ralph/prd.md" } };
    const result = validateRalphConfig(cfg);
    expect(result.ok).toBe(true);
  });

  it("accepts paths.projectPlan under .github/plans/", () => {
    const cfg = { ...VALID_CONFIG, paths: { ...VALID_CONFIG.paths, projectPlan: ".github/plans/foo.md" } };
    const result = validateRalphConfig(cfg);
    expect(result.ok).toBe(true);
  });

  it("rejects phase2.planFrequency as a string", () => {
    const cfg = { ...VALID_CONFIG, phase2: { ...VALID_CONFIG.phase2, planFrequency: "weekly" } };
    const result = validateRalphConfig(cfg);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("phase2.planFrequency"))).toBe(true);
  });

  it("rejects phase2.planFrequency = 0", () => {
    const cfg = { ...VALID_CONFIG, phase2: { ...VALID_CONFIG.phase2, planFrequency: 0 } };
    const result = validateRalphConfig(cfg);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("phase2.planFrequency"))).toBe(true);
  });

  it("accepts phase2.planFrequency as a positive number", () => {
    const cfg = { ...VALID_CONFIG, phase2: { ...VALID_CONFIG.phase2, planFrequency: 3 } };
    const result = validateRalphConfig(cfg);
    expect(result.ok).toBe(true);
  });

  it("rejects phase2.workerModel as a number", () => {
    const cfg = { ...VALID_CONFIG, phase2: { ...VALID_CONFIG.phase2, workerModel: 42 } };
    const result = validateRalphConfig(cfg);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("phase2.workerModel"))).toBe(true);
  });

  it("accepts phase2.workerModel as a string", () => {
    const cfg = { ...VALID_CONFIG, phase2: { ...VALID_CONFIG.phase2, workerModel: "gpt-4o" } };
    const result = validateRalphConfig(cfg);
    expect(result.ok).toBe(true);
  });

  it("rejects phase1.sourcePlan as empty string", () => {
    const cfg = { ...VALID_CONFIG, phase1: { sourcePlan: "" } };
    const result = validateRalphConfig(cfg);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("phase1.sourcePlan"))).toBe(true);
  });

  it("accepts phase1.sourcePlan as a non-empty string", () => {
    const cfg = { ...VALID_CONFIG, phase1: { sourcePlan: ".github/plans/project-plan.md" } };
    const result = validateRalphConfig(cfg);
    expect(result.ok).toBe(true);
  });

  it("rejects phase3.maxDevQaRounds = 0", () => {
    const cfg = { ...VALID_CONFIG, phase3: { maxDevQaRounds: 0 } };
    const result = validateRalphConfig(cfg);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("phase3.maxDevQaRounds"))).toBe(true);
  });

  it("rejects phase3.maxSignoffRounds = 0", () => {
    const cfg = { ...VALID_CONFIG, phase3: { maxSignoffRounds: 0 } };
    const result = validateRalphConfig(cfg);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("phase3.maxSignoffRounds"))).toBe(true);
  });

  it("rejects phase3.planFrequency as non-number", () => {
    const cfg = { ...VALID_CONFIG, phase3: { planFrequency: "daily" } };
    const result = validateRalphConfig(cfg);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("phase3.planFrequency"))).toBe(true);
  });

  it("accepts phase3 with valid optional fields", () => {
    const cfg = { ...VALID_CONFIG, phase3: { devModel: "gpt-4o", maxDevQaRounds: 2, planFrequency: 1 } };
    const result = validateRalphConfig(cfg);
    expect(result.ok).toBe(true);
  });

  it("rejects phase3 model field as non-string", () => {
    const cfg = { ...VALID_CONFIG, phase3: { devModel: 123 } };
    const result = validateRalphConfig(cfg);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("phase3.devModel"))).toBe(true);
  });
});
