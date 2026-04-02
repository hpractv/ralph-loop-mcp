import fs from "node:fs/promises";
import path from "node:path";
import { appendText, blockTaskMd, findRepoRoot, findRepoRootForSetup, getAllowedNpmScripts, parseFixPlan, sandboxPath, setTaskChecked, tailTextFile, unblockTaskMd, utcNowIso, replaceFixPlanMd, } from "./workflow.js";
import { runNpmScript } from "./verification.js";
import { PHASE1_PRD_PROMPT, PHASE2_PLANNER_PROMPT, PHASE2_WORKER_PROMPT, PHASE3_DEV_PROMPT, PHASE3_DEV_SIGNOFF_PROMPT, PHASE3_PLAN_PROMPT, PHASE3_QA_CLOSE_PROMPT, PHASE3_QA_PROMPT, } from "./ralph-prompts.js";
export async function listFiles(directory) {
    const root = findRepoRoot(process.cwd());
    const target = sandboxPath(root, directory || ".");
    const entries = await listDir(target.abs, root);
    return { root: root.replaceAll("\\", "/"), directory: directory || ".", entries };
}
async function listDir(dir, root) {
    const out = [];
    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    }
    catch {
        return out;
    }
    for (const e of entries) {
        const rel = path.relative(root, path.join(dir, e.name)).replaceAll("\\", "/");
        out.push({ path: rel, type: e.isDirectory() ? "dir" : "file" });
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
}
export async function readFile(relativePath) {
    const root = findRepoRoot(process.cwd());
    const target = sandboxPath(root, relativePath);
    try {
        const content = await fs.readFile(target.abs, "utf8");
        return { ok: true, path: relativePath, content };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, path: relativePath, error: message };
    }
}
export async function readState() {
    const root = findRepoRoot(process.cwd());
    const ralphDir = path.join(root, ".ralph");
    const configPath = path.join(ralphDir, "config.json");
    const configText = await readTextIfExists(configPath);
    const config = configText ? parseJsonSafe(configText) : {};
    const configValidation = configText
        ? validateRalphConfig(config)
        : { ok: false, errors: ["Missing .ralph/config.json"] };
    const fixPlanPath = path.join(ralphDir, "fix_plan.md");
    const fixPlan = await readTextIfExists(fixPlanPath);
    const tasks = fixPlan ? parseFixPlan(fixPlan) : [];
    // Detect dash-variant fix-plan files (e.g. fix-plan.md, fix-plan-phase3.md) that the
    // model may have created outside of ralph.replace_fix_plan. The canonical name required
    // by the loop exit condition is fix_plan.md (underscore).
    let fixPlanVariants = [];
    try {
        const ralphEntries = await fs.readdir(ralphDir);
        fixPlanVariants = ralphEntries
            .filter((e) => /^fix-plan.*\.md$/.test(e))
            .map((e) => path.relative(root, path.join(ralphDir, e)).replaceAll("\\\\", "/"));
    }
    catch { /* ignore if dir unreadable */ }
    const progressTail = await tailTextFile(path.join(ralphDir, "logs", "progress.txt"), 50);
    const learningsTail = await tailTextFile(path.join(ralphDir, "logs", "learnings.md"), 120);
    const specsRoot = path.join(ralphDir, "specs");
    const specFiles = await listMarkdown(specsRoot, root);
    const phase2ScriptPath = path.join(ralphDir, "phase2.sh");
    const phase2ScriptExists = Boolean(await readTextIfExists(phase2ScriptPath));
    const prdPath = path.join(ralphDir, "prd.md");
    const prdExists = await fileExists(prdPath);
    const prdTail = prdExists ? await tailTextFile(prdPath, 40) : "";
    return {
        repoRoot: root,
        config,
        configValidation,
        tasks,
        fixPlanVariants,
        progressTail,
        learningsTail,
        specFiles,
        prd: {
            exists: prdExists,
            relativePath: ".ralph/prd.md",
            tail: prdTail,
        },
        phase2Script: {
            exists: phase2ScriptExists,
            absolutePath: phase2ScriptPath.replaceAll("\\", "/"),
            relativePath: path.relative(root, phase2ScriptPath).replaceAll("\\", "/"),
        },
        artifacts: {
            config: await fileExists(path.join(ralphDir, "config.json")),
            progressLog: await fileExists(path.join(ralphDir, "logs", "progress.txt")),
            learningsLog: await fileExists(path.join(ralphDir, "logs", "learnings.md")),
            fixPlan: await fileExists(path.join(ralphDir, "fix_plan.md")),
            prd: prdExists,
            specsCount: specFiles.length,
        },
        allowedNpmScripts: Array.from(getAllowedNpmScripts(root)).sort(),
    };
}
export async function writePlan(relativePath, content) {
    const root = findRepoRootForSetup(process.cwd());
    const target = sandboxPath(root, relativePath);
    const normalizedRel = target.relative.replaceAll("\\", "/");
    if (!normalizedRel.startsWith(".github/plans/")) {
        throw new Error("Plans must be written under .github/plans/");
    }
    await fs.mkdir(path.dirname(target.abs), { recursive: true });
    await fs.writeFile(target.abs, content.endsWith("\n") ? content : `${content}\n`, "utf8");
    return { ok: true, path: normalizedRel };
}
/** Canonical PRD for Phase 2+ — only `.ralph/prd.md`. */
export async function writePrd(content) {
    const root = findRepoRootForSetup(process.cwd());
    const p = path.join(root, ".ralph", "prd.md");
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content.endsWith("\n") ? content : `${content}\n`, "utf8");
    return { ok: true, path: ".ralph/prd.md" };
}
async function ensurePromptFile(ralphDir, fileName, body) {
    const p = path.join(ralphDir, fileName);
    if (await fileExists(p))
        return;
    await fs.writeFile(p, body.endsWith("\n") ? body : `${body}\n`, "utf8");
}
async function mergePhase1ConfigDefaults(ralphDir, defaultSource) {
    const configPath = path.join(ralphDir, "config.json");
    if (!(await fileExists(configPath)))
        return;
    let c;
    try {
        c = JSON.parse(await fs.readFile(configPath, "utf8"));
    }
    catch {
        return;
    }
    const cur = asObject(c.phase1) ?? {};
    c.phase1 = {
        sourcePlan: typeof cur.sourcePlan === "string" && cur.sourcePlan.trim()
            ? cur.sourcePlan
            : defaultSource,
        planModel: typeof cur.planModel === "string" && cur.planModel.trim()
            ? cur.planModel
            : "claude-sonnet-4.6",
        planReasoningEffort: typeof cur.planReasoningEffort === "string" && cur.planReasoningEffort.trim()
            ? cur.planReasoningEffort
            : "high",
    };
    await fs.writeFile(configPath, JSON.stringify(c, null, 2) + "\n", "utf8");
}
export async function generatePhase1(sourcePlan) {
    const root = findRepoRootForSetup(process.cwd());
    const plansDir = path.join(root, ".github", "plans");
    const ralphDir = path.join(root, ".ralph");
    const scriptPath = path.join(ralphDir, "phase1.sh");
    const projectPlanPath = path.join(plansDir, "project-plan.md");
    const defaultSourceRel = sourcePlan?.trim() || ".github/plans/project-plan.md";
    await fs.mkdir(plansDir, { recursive: true });
    await fs.mkdir(ralphDir, { recursive: true });
    await mergePhase1ConfigDefaults(ralphDir, defaultSourceRel);
    // Seed project-plan.md only if it does not already exist (draft input for PRD).
    if (!(await fileExists(projectPlanPath))) {
        await fs.writeFile(projectPlanPath, [
            "# Project Plan",
            "",
            "<!-- Draft source plan. Phase 1 normalizes this into .ralph/prd.md via bash .ralph/phase1.sh -->",
            "",
            "## 1) Executive Summary",
            "",
            "## 2) Objectives & Success Criteria",
            "",
            "## 3) Scope",
            "",
            "### In scope",
            "",
            "### Out of scope",
            "",
            "## 4) Architecture",
            "",
            "## 5) Timeline & Milestones",
            "",
            "## 6) Stakeholders & Team",
            "",
            "## 7) Requirements",
            "",
            "### Functional",
            "",
            "### Non-functional",
            "",
            "## 8) Risks, Dependencies, Constraints",
            "",
            "## 9) Communication Plan",
            "",
        ].join("\n"), "utf8");
    }
    await ensurePromptFile(ralphDir, "phase1-prd-prompt.md", PHASE1_PRD_PROMPT);
    const phase1ShContent = [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "",
        "# Phase 1 — source plan → canonical PRD (.ralph/prd.md).",
        "# Re-run to refine the PRD. Next: ralph.generate_phase2",
        "",
        'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
        'REPO_ROOT="$(dirname "${SCRIPT_DIR}")"',
        'cd "${REPO_ROOT}"',
        "",
        'eval "$(node -e "',
        "const fs=require('fs');",
        "const root=process.argv[1];",
        "let c={};",
        "try { c=JSON.parse(fs.readFileSync(root+'/.ralph/config.json','utf8')); } catch (e) {}",
        "const g=(p,d)=>{ let o=c; for (const k of p){ if(!o||typeof o!=='object') return d; o=o[k]; } return (o!=null&&o!=='')?o:d; };",
        "const M=g(['phase1','planModel'],'gpt-5-mini');",
        "const R=g(['phase1','planReasoningEffort'],'high');",
        "const S=g(['phase1','sourcePlan'],'.github/plans/project-plan.md');",
        "console.log('export RALPH_P1_MODEL='+JSON.stringify(M));",
        "console.log('export RALPH_P1_REASONING='+JSON.stringify(R));",
        "console.log('export RALPH_P1_SOURCE='+JSON.stringify(S));",
        "\" \"$REPO_ROOT\")\"",
        "",
        'echo "=== Phase 1 — PRD session (source plan: ${RALPH_P1_SOURCE}) ==="',
        "",
        "REASON_ARGS=()",
        'if [[ -n "${RALPH_P1_REASONING}" ]]; then',
        '  REASON_ARGS+=(--reasoning-effort "${RALPH_P1_REASONING}")',
        "fi",
        "",
        "{",
        '  echo "SOURCE_PLAN_PATH (repo-relative, use with ralph.read_file): ${RALPH_P1_SOURCE}"',
        '  echo "REPO_ROOT: ${REPO_ROOT}"',
        '  cat "${SCRIPT_DIR}/phase1-prd-prompt.md"',
        "} | copilot --yolo --no-ask-user --model \"${RALPH_P1_MODEL}\" \"${REASON_ARGS[@]}\"",
        "",
        'echo "=== Phase 1 complete — review .ralph/prd.md ==="',
        "",
    ].join("\n");
    await fs.writeFile(scriptPath, phase1ShContent, "utf8");
    try {
        await fs.chmod(scriptPath, 0o755);
    }
    catch {
        // chmod not supported on all platforms/filesystems.
    }
    const rel = (p) => path.relative(root, p).replaceAll("\\", "/");
    return {
        ok: true,
        createdFiles: {
            "phase1.sh": rel(scriptPath),
            "project-plan.md": rel(projectPlanPath),
            "phase1-prd-prompt.md": rel(path.join(ralphDir, "phase1-prd-prompt.md")),
        },
        nextSteps: [
            "Phase 1 setup complete. Run: bash .ralph/phase1.sh",
            "That session writes/refines .ralph/prd.md from the configured source plan (phase1.sourcePlan in config.json).",
            "When the PRD is ready, run ralph.generate_phase2.",
        ],
    };
}
const DEFAULT_NEW_CONFIG = {
    version: "1.0",
    phase1: {
        sourcePlan: ".github/plans/project-plan.md",
        planModel: "claude-sonnet-4.6",
        planReasoningEffort: "high",
    },
    phase2: {
        generatorScript: ".ralph/phase2.sh",
        overwriteSpecs: true,
        overwriteFixPlan: true,
        planModel: "claude-sonnet-4.6",
        workerModel: "gpt-5-mini",
        planReasoningEffort: "high",
        workerReasoningEffort: "high",
        planFrequency: 1,
    },
    phase3: {
        planModel: "claude-sonnet-4.6",
        devModel: "gpt-5-mini",
        qaModel: "gpt-5-mini",
        planReasoningEffort: "high",
        devReasoningEffort: "high",
        qaReasoningEffort: "high",
        planFrequency: 1,
        maxDevQaRounds: 5,
        maxSignoffRounds: 3,
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
export async function generatePhase2(planFile) {
    const root = findRepoRootForSetup(process.cwd());
    const ralphDir = path.join(root, ".ralph");
    const configPath = path.join(ralphDir, "config.json");
    const scriptPath = path.join(ralphDir, "phase2.sh");
    const defaultProjectPlanRel = planFile?.trim() || ".ralph/prd.md";
    await fs.mkdir(path.join(ralphDir, "specs"), { recursive: true });
    await fs.mkdir(path.join(ralphDir, "logs"), { recursive: true });
    if (!(await fileExists(configPath))) {
        const cfg = {
            ...DEFAULT_NEW_CONFIG,
            paths: { ...DEFAULT_NEW_CONFIG.paths, projectPlan: defaultProjectPlanRel },
        };
        await fs.writeFile(configPath, JSON.stringify(cfg, null, 2) + "\n", "utf8");
    }
    await ensurePromptFile(ralphDir, "phase2-planner-prompt.md", PHASE2_PLANNER_PROMPT);
    await ensurePromptFile(ralphDir, "phase2-worker-prompt.md", PHASE2_WORKER_PROMPT);
    const configText = await readTextIfExists(configPath);
    const config = parseJsonSafe(configText ?? "");
    const configValidation = validateRalphConfig(config);
    const configuredProjectPlanRel = getConfiguredProjectPlanPath(config) ?? defaultProjectPlanRel;
    const ralphShContent = [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "",
        "# Phase 2 — planning persona + worker loop (reads PRD / project plan path from config).",
        "",
        'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
        'FIX_PLAN="${SCRIPT_DIR}/fix_plan.md"',
        'REPO_ROOT="$(dirname "${SCRIPT_DIR}")"',
        'cd "${REPO_ROOT}"',
        `PRD_REL=\"${configuredProjectPlanRel.replace(/"/g, '\\"')}\"`,
        "",
        "has_unchecked_tasks() {",
        '  [[ -f "${FIX_PLAN}" ]] && grep -qE \'^\\s*- \\[ \\]\' "${FIX_PLAN}"',
        "}",
        "",
        "read_phase2_env() {",
        "  eval \"$(node - \"${REPO_ROOT}\" <<'RALPH_P2_NODE'",
        "const fs=require('fs');",
        "const root=process.argv[1];",
        "let c={};",
        "try { c=JSON.parse(fs.readFileSync(root+'/.ralph/config.json','utf8')); } catch (e) {}",
        "const g=(p,d)=>{ let o=c; for (const k of p){ if(!o||typeof o!=='object') return d; o=o[k]; } return (o!=null&&o!=='')?o:d; };",
        "console.log('export RALPH_P2_PLAN_MODEL='+JSON.stringify(g(['phase2','planModel'],'claude-sonnet-4.6')));",
        "console.log('export RALPH_P2_WORKER_MODEL='+JSON.stringify(g(['phase2','workerModel'],'gpt-5-mini')));",
        "console.log('export RALPH_P2_PLAN_R='+JSON.stringify(g(['phase2','planReasoningEffort'],'high')));",
        "console.log('export RALPH_P2_WORK_R='+JSON.stringify(g(['phase2','workerReasoningEffort'],'high')));",
        "console.log('export RALPH_P2_PLAN_FREQ='+JSON.stringify(g(['phase2','planFrequency'],1)));",
        "RALPH_P2_NODE",
        "  )\"",
        "}",
        "",
        "iteration=1",
        "stagnation_count=0",
        "STAGNATION_LIMIT=3",
        "",
        'while has_unchecked_tasks || [[ ! -f "${FIX_PLAN}" ]]; do',
        '  echo "=== Phase 2 — iteration ${iteration} ==="',
        "  read_phase2_env",
        "",
        '  if [[ -f "${FIX_PLAN}" ]]; then',
        '    pre_hash="$(sha256sum "${FIX_PLAN}" 2>/dev/null | awk \'{print $1}\')"',
        "  else",
        '    pre_hash=""',
        "  fi",
        "",
        "  PLAN_ARGS=()",
        '  if [[ -n "${RALPH_P2_PLAN_R}" ]]; then',
        '    PLAN_ARGS+=(--reasoning-effort "${RALPH_P2_PLAN_R}")',
        "  fi",
        "  WORK_ARGS=()",
        '  if [[ -n "${RALPH_P2_WORK_R}" ]]; then',
        '    WORK_ARGS+=(--reasoning-effort "${RALPH_P2_WORK_R}")',
        "  fi",
        "",
        "  # Planning persona every planFrequency iterations (1 = every time).",
        '  if (( (iteration - 1) % RALPH_P2_PLAN_FREQ == 0 )); then',
        '    echo "--- Phase 2 planning persona ---"',
        "    {",
        '      echo "PRD_PATH (repo-relative, read with ralph.read_file): ${PRD_REL}"',
        '      cat "${SCRIPT_DIR}/phase2-planner-prompt.md"',
        "    } | copilot --yolo --no-ask-user --model \"${RALPH_P2_PLAN_MODEL}\" \"${PLAN_ARGS[@]}\"",
        "  fi",
        "",
        '  echo "--- Phase 2 worker (specs + fix_plan) ---"',
        "  {",
        '    echo "PRD_PATH (repo-relative): ${PRD_REL}"',
        '    cat "${SCRIPT_DIR}/phase2-worker-prompt.md"',
        "  } | copilot --yolo --no-ask-user --model \"${RALPH_P2_WORKER_MODEL}\" \"${WORK_ARGS[@]}\"",
        "",
        '  echo "=== Iteration ${iteration} complete ==="',
        "",
        '  if [[ -f "${FIX_PLAN}" ]]; then',
        '    current_hash="$(sha256sum "${FIX_PLAN}" 2>/dev/null | awk \'{print $1}\')"',
        '    if [[ "${current_hash}" == "${pre_hash}" ]]; then',
        "      (( stagnation_count++ ))",
        '      echo "=== Stagnation: fix_plan.md unchanged (${stagnation_count}/${STAGNATION_LIMIT}) ==="',
        '      if (( stagnation_count >= STAGNATION_LIMIT )); then',
        '        echo "Phase 2 stagnation limit reached — exiting."',
        "        break",
        "      fi",
        "    else",
        "      stagnation_count=0",
        "    fi",
        "  fi",
        "",
        "  (( iteration++ ))",
        "done",
        "",
        'echo "Phase 2 complete — PRD requirements mapped to specs and tasks."',
        'echo "Next: ralph.generate_phase3"',
        "",
    ].join("\n");
    await fs.writeFile(scriptPath, ralphShContent, "utf8");
    try {
        await fs.chmod(scriptPath, 0o755);
    }
    catch {
        // chmod not supported on all platforms/filesystems.
    }
    const progressPath = path.join(ralphDir, "logs", "progress.txt");
    const learningsPath = path.join(ralphDir, "logs", "learnings.md");
    if (!(await fileExists(progressPath))) {
        await fs.writeFile(progressPath, "# Ralph Progress Log\n# Format: [YYYY-MM-DDTHH:MM:SSZ] message\n", "utf8");
    }
    if (!(await fileExists(learningsPath))) {
        await fs.writeFile(learningsPath, "# Ralph Learnings\n\nCapture durable lessons and decisions discovered during implementation.\n", "utf8");
    }
    const rel = (p) => path.relative(root, p).replaceAll("\\", "/");
    return {
        ok: configValidation.ok,
        repoRoot: root,
        createdFiles: {
            "phase2.sh": rel(scriptPath),
            "config.json": rel(configPath),
            "phase2-planner-prompt.md": rel(path.join(ralphDir, "phase2-planner-prompt.md")),
            "phase2-worker-prompt.md": rel(path.join(ralphDir, "phase2-worker-prompt.md")),
            "logs/progress.txt": rel(path.join(ralphDir, "logs", "progress.txt")),
            "logs/learnings.md": rel(path.join(ralphDir, "logs", "learnings.md")),
        },
        configValidation,
        nextSteps: [
            "Ensure .ralph/prd.md exists (run bash .ralph/phase1.sh first).",
            `Run: bash .ralph/phase2.sh — reads ${configuredProjectPlanRel}`,
        ],
    };
}
export async function generatePhase3() {
    const root = findRepoRootForSetup(process.cwd());
    const ralphDir = path.join(root, ".ralph");
    const fixPlanPath = path.join(ralphDir, "fix_plan.md");
    const scriptPath = path.join(ralphDir, "phase3.sh");
    const progressPath = path.join(ralphDir, "logs", "progress.txt");
    const learningsPath = path.join(ralphDir, "logs", "learnings.md");
    const configPath = path.join(ralphDir, "config.json");
    await fs.mkdir(path.join(ralphDir, "logs"), { recursive: true });
    if (!(await fileExists(progressPath))) {
        await fs.writeFile(progressPath, "# Ralph Progress Log\n# Format: [YYYY-MM-DDTHH:MM:SSZ] message\n", "utf8");
    }
    if (!(await fileExists(learningsPath))) {
        await fs.writeFile(learningsPath, "# Ralph Learnings\n\nCapture durable lessons and decisions discovered during implementation.\n", "utf8");
    }
    if (!(await fileExists(fixPlanPath))) {
        return {
            ok: false,
            error: "Missing .ralph/fix_plan.md — run Phase 2 first to generate the fix plan.",
        };
    }
    const configText = await readTextIfExists(configPath);
    const cfgParsed = parseJsonSafe(configText ?? "");
    const prdRel = getConfiguredProjectPlanPath(cfgParsed) ?? ".ralph/prd.md";
    const existingMd = await fs.readFile(fixPlanPath, "utf8");
    const parsedTasks = parseFixPlan(existingMd);
    const uncheckedActive = parsedTasks.filter((t) => !t.checked && t.section === "active");
    let seededCount = 0;
    if (uncheckedActive.length < 5) {
        const seeds = await buildPhase3SeedTasks(ralphDir, existingMd);
        if (seeds.length > 0) {
            const updated = appendPhase3Tasks(existingMd, seeds);
            await fs.writeFile(fixPlanPath, updated, "utf8");
            seededCount = seeds.length;
        }
    }
    await ensurePromptFile(ralphDir, "phase3-plan-prompt.md", PHASE3_PLAN_PROMPT);
    await ensurePromptFile(ralphDir, "phase3-dev-prompt.md", PHASE3_DEV_PROMPT);
    await ensurePromptFile(ralphDir, "phase3-qa-prompt.md", PHASE3_QA_PROMPT);
    await ensurePromptFile(ralphDir, "phase3-dev-signoff-prompt.md", PHASE3_DEV_SIGNOFF_PROMPT);
    await ensurePromptFile(ralphDir, "phase3-qa-close-prompt.md", PHASE3_QA_CLOSE_PROMPT);
    const prdRelEscaped = prdRel.replace(/"/g, '\\"');
    const phase3ShContent = [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "",
        "# Phase 3 — Plan, Dev, QA, then Dev/QA consensus before marking tasks done.",
        "# Logs: .ralph/logs/progress.txt, .ralph/logs/learnings.md",
        "",
        'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
        'FIX_PLAN="${SCRIPT_DIR}/fix_plan.md"',
        'REPO_ROOT="$(dirname "${SCRIPT_DIR}")"',
        'cd "${REPO_ROOT}"',
        `PRD_REL=\"${prdRelEscaped}\"`,
        "",
        "has_unchecked_tasks() {",
        '  [[ -f "${FIX_PLAN}" ]] && grep -qE \'^\\s*- \\[ \\]\' "${FIX_PLAN}"',
        "}",
        "",
        "read_phase3_env() {",
        "  eval \"$(node - \"${REPO_ROOT}\" <<'RALPH_P3_NODE'",
        "const fs=require('fs');",
        "const root=process.argv[1];",
        "let c={};",
        "try { c=JSON.parse(fs.readFileSync(root+'/.ralph/config.json','utf8')); } catch (e) {}",
        "const g=(p,d)=>{ let o=c; for (const k of p){ if(!o||typeof o!=='object') return d; o=o[k]; } return (o!=null&&o!=='')?o:d; };",
        "console.log('export RALPH_P3_PLAN_MODEL='+JSON.stringify(g(['phase3','planModel'],'claude-sonnet-4.6')));",
        "console.log('export RALPH_P3_DEV_MODEL='+JSON.stringify(g(['phase3','devModel'],'gpt-5-mini')));",
        "console.log('export RALPH_P3_QA_MODEL='+JSON.stringify(g(['phase3','qaModel'],'gpt-5-mini')));",
        "console.log('export RALPH_P3_PLAN_R='+JSON.stringify(g(['phase3','planReasoningEffort'],'high')));",
        "console.log('export RALPH_P3_DEV_R='+JSON.stringify(g(['phase3','devReasoningEffort'],'high')));",
        "console.log('export RALPH_P3_QA_R='+JSON.stringify(g(['phase3','qaReasoningEffort'],'high')));",
        "console.log('export RALPH_P3_PLAN_FREQ='+JSON.stringify(g(['phase3','planFrequency'],1)));",
        "console.log('export RALPH_P3_MAX_DEV_QA='+JSON.stringify(g(['phase3','maxDevQaRounds'],5)));",
        "console.log('export RALPH_P3_MAX_SIGNOFF='+JSON.stringify(g(['phase3','maxSignoffRounds'],3)));",
        "RALPH_P3_NODE",
        "  )\"",
        "}",
        "",
        "iteration=1",
        "stagnation_count=0",
        "STAGNATION_LIMIT=3",
        "",
        "while has_unchecked_tasks; do",
        '  echo "=== Phase 3 — outer iteration ${iteration} ==="',
        "  read_phase3_env",
        "",
        '  pre_hash="$(sha256sum "${FIX_PLAN}" 2>/dev/null | awk \'{print $1}\')"',
        "",
        "  P3_PLAN_ARGS=()",
        '  if [[ -n "${RALPH_P3_PLAN_R}" ]]; then P3_PLAN_ARGS+=(--reasoning-effort "${RALPH_P3_PLAN_R}"); fi',
        "  P3_DEV_ARGS=()",
        '  if [[ -n "${RALPH_P3_DEV_R}" ]]; then P3_DEV_ARGS+=(--reasoning-effort "${RALPH_P3_DEV_R}"); fi',
        "  P3_QA_ARGS=()",
        '  if [[ -n "${RALPH_P3_QA_R}" ]]; then P3_QA_ARGS+=(--reasoning-effort "${RALPH_P3_QA_R}"); fi',
        "",
        '  if (( (iteration - 1) % RALPH_P3_PLAN_FREQ == 0 )); then',
        '    echo "--- Phase 3 plan persona ---"',
        "    {",
        '      echo "PRD_PATH (repo-relative): ${PRD_REL}"',
        '      cat "${SCRIPT_DIR}/phase3-plan-prompt.md"',
        "    } | copilot --yolo --no-ask-user --model \"${RALPH_P3_PLAN_MODEL}\" \"${P3_PLAN_ARGS[@]}\"",
        "  fi",
        "",
        '  FB="${SCRIPT_DIR}/logs/phase3-feedback.md"',
        '  : > "${FB}"',
        "  inner=0",
        "  qa_ready=0",
        "",
        '  while (( inner < RALPH_P3_MAX_DEV_QA )); do',
        '    inner_pre="$(sha256sum "${FIX_PLAN}" 2>/dev/null | awk \'{print $1}\')"',
        "",
        "    {",
        '      echo "PRD_PATH: ${PRD_REL}"',
        '      echo "Prior feedback:"',
        '      cat "${FB}"',
        '      echo ""',
        '      cat "${SCRIPT_DIR}/phase3-dev-prompt.md"',
        "    } | copilot --yolo --no-ask-user --model \"${RALPH_P3_DEV_MODEL}\" \"${P3_DEV_ARGS[@]}\" | tee /tmp/ralph-p3-dev.txt",
        "",
        "    {",
        '      cat "${SCRIPT_DIR}/phase3-qa-prompt.md"',
        "      echo \"\"",
        "      echo \"--- Dev output ---\"",
        "      cat /tmp/ralph-p3-dev.txt",
        "    } | copilot --yolo --no-ask-user --model \"${RALPH_P3_QA_MODEL}\" \"${P3_QA_ARGS[@]}\" | tee /tmp/ralph-p3-qa.txt",
        "",
        '    inner_cur="$(sha256sum "${FIX_PLAN}" 2>/dev/null | awk \'{print $1}\')"',
        '    if [[ "${inner_cur}" != "${inner_pre}" ]]; then',
        '      echo "--- fix_plan.md changed during Dev/QA ---"',
        "      qa_ready=0",
        "      break",
        "    fi",
        "",
        "    if grep -qF QA_READY_FOR_SIGNOFF /tmp/ralph-p3-qa.txt 2>/dev/null; then",
        "      qa_ready=1",
        "      break",
        "    fi",
        "",
        '    echo "=== QA feedback (round ${inner}) ===" >> "${FB}"',
        '    cat /tmp/ralph-p3-qa.txt >> "${FB}"',
        "    inner=$((inner + 1))",
        "  done",
        "",
        '  if [[ "${qa_ready}" -eq 1 ]]; then',
        "    s=0",
        '    while (( s < RALPH_P3_MAX_SIGNOFF )); do',
        "      {",
        '        cat "${SCRIPT_DIR}/phase3-dev-signoff-prompt.md"',
        "        echo \"\"",
        "        echo \"--- QA output ---\"",
        "        cat /tmp/ralph-p3-qa.txt",
        "      } | copilot --yolo --no-ask-user --model \"${RALPH_P3_DEV_MODEL}\" \"${P3_DEV_ARGS[@]}\" | tee /tmp/ralph-p3-dsign.txt",
        "",
        "      if grep -qF DEV_AGREES_COMPLETE /tmp/ralph-p3-dsign.txt 2>/dev/null; then",
        "        {",
        '          cat "${SCRIPT_DIR}/phase3-qa-close-prompt.md"',
        "          echo \"\"",
        "          echo \"--- Dev signoff ---\"",
        "          cat /tmp/ralph-p3-dsign.txt",
        "        } | copilot --yolo --no-ask-user --model \"${RALPH_P3_QA_MODEL}\" \"${P3_QA_ARGS[@]}\"",
        "        break",
        "      fi",
        "      s=$((s + 1))",
        "      echo \"Signoff round ${s}: Dev did not agree — extend feedback\" >> \"${FB}\"",
        "    done",
        "  fi",
        "",
        '  echo "=== Outer iteration ${iteration} complete ==="',
        "",
        '  current_hash="$(sha256sum "${FIX_PLAN}" 2>/dev/null | awk \'{print $1}\')"',
        '  if [[ "${current_hash}" == "${pre_hash}" ]]; then',
        "    (( stagnation_count++ ))",
        '    echo "=== Stagnation: fix_plan unchanged (${stagnation_count}/${STAGNATION_LIMIT}) ==="',
        '    if (( stagnation_count >= STAGNATION_LIMIT )); then',
        '      echo "Phase 3 stagnation — exiting."',
        "      break",
        "    fi",
        "  else",
        "    stagnation_count=0",
        "  fi",
        "",
        "  iteration=$((iteration + 1))",
        "done",
        "",
        'echo "Phase 3 complete — no unchecked active tasks remain (or loop exited on stagnation)."',
        "",
    ].join("\n");
    await fs.writeFile(scriptPath, phase3ShContent, "utf8");
    try {
        await fs.chmod(scriptPath, 0o755);
    }
    catch {
        // chmod not supported on all platforms/filesystems.
    }
    const rel = (p) => path.relative(root, p).replaceAll("\\", "/");
    return {
        ok: true,
        seededTaskCount: seededCount,
        createdFiles: { "phase3.sh": rel(scriptPath) },
        sharedLogs: {
            progress: rel(progressPath),
            learnings: rel(learningsPath),
        },
        nextSteps: [
            seededCount > 0
                ? `Seeded ${seededCount} implementation tasks into .ralph/fix_plan.md from Phase 2 planning section.`
                : "Fix plan already has unchecked checkbox tasks — ready to run.",
            "Phase 3 uses phase3-plan-prompt.md, phase3-dev-prompt.md, phase3-qa-prompt.md, and sign-off prompts.",
            "Run: bash .ralph/phase3.sh",
        ],
    };
}
export async function writeEpicPlan(content) {
    const root = findRepoRoot(process.cwd());
    const p = path.join(root, ".ralph", "epic_plan.md");
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content.endsWith("\n") ? content : `${content}\n`, "utf8");
    return { ok: true, path: ".ralph/epic_plan.md" };
}
export async function upsertSpec(relativePath, content) {
    const root = findRepoRoot(process.cwd());
    const target = sandboxPath(root, relativePath);
    const normalizedRel = target.relative.replaceAll("\\", "/");
    if (!normalizedRel.startsWith(".ralph/specs/")) {
        throw new Error("Specs must be written under .ralph/specs/");
    }
    // Keep log-like files out of specs to avoid ambiguous progress locations.
    const baseName = path.basename(normalizedRel).toLowerCase();
    const reservedSpecNames = new Set([
        "progress.txt",
        "progress.md",
        "learnings.txt",
        "learnings.md",
    ]);
    if (reservedSpecNames.has(baseName)) {
        throw new Error("Reserved filename under .ralph/specs/. Use .ralph/logs/progress.txt and .ralph/logs/learnings.md for loop logs.");
    }
    await fs.mkdir(path.dirname(target.abs), { recursive: true });
    await fs.writeFile(target.abs, content.endsWith("\n") ? content : `${content}\n`, "utf8");
    return { ok: true, path: normalizedRel };
}
export async function replaceFixPlan(content, preserveCompleted) {
    const root = findRepoRoot(process.cwd());
    const fixPlanPath = path.join(root, ".ralph", "fix_plan.md");
    const old = await readTextIfExists(fixPlanPath);
    const merged = replaceFixPlanMd(old ?? "", content, preserveCompleted);
    await fs.mkdir(path.dirname(fixPlanPath), { recursive: true });
    await fs.writeFile(fixPlanPath, merged, "utf8");
    return { ok: true, path: ".ralph/fix_plan.md", preserved: Boolean(old && preserveCompleted) };
}
export async function nextTask() {
    const root = findRepoRoot(process.cwd());
    const fixPlanPath = path.join(root, ".ralph", "fix_plan.md");
    const md = await readTextIfExists(fixPlanPath);
    if (!md)
        return { task: null, reason: "Missing .ralph/fix_plan.md" };
    const tasks = parseFixPlan(md);
    const t = tasks.find((x) => x.section === "active" && !x.checked);
    if (!t)
        return { task: null, reason: "No unchecked active tasks" };
    return { task: t };
}
export async function setTaskStatus(text, checked, taskId) {
    const root = findRepoRoot(process.cwd());
    const fixPlanPath = path.join(root, ".ralph", "fix_plan.md");
    const md = await fs.readFile(fixPlanPath, "utf8");
    const ref = { text, taskId };
    const updated = setTaskChecked(md, ref, checked);
    await fs.writeFile(fixPlanPath, updated, "utf8");
    return { ok: true };
}
export async function blockTask(text, reason, taskId) {
    const root = findRepoRoot(process.cwd());
    const fixPlanPath = path.join(root, ".ralph", "fix_plan.md");
    const md = await fs.readFile(fixPlanPath, "utf8");
    const ref = { text, taskId };
    const updated = blockTaskMd(md, ref, reason);
    await fs.writeFile(fixPlanPath, updated, "utf8");
    return { ok: true };
}
export async function unblockTask(text, taskId) {
    const root = findRepoRoot(process.cwd());
    const fixPlanPath = path.join(root, ".ralph", "fix_plan.md");
    const md = await fs.readFile(fixPlanPath, "utf8");
    const ref = { text, taskId };
    const updated = unblockTaskMd(md, ref);
    await fs.writeFile(fixPlanPath, updated, "utf8");
    return { ok: true };
}
export async function appendProgress(entry) {
    const root = findRepoRoot(process.cwd());
    const p = path.join(root, ".ralph", "logs", "progress.txt");
    await appendText(p, `[${utcNowIso()}] ${entry.trim()}\n`);
    return { ok: true };
}
export async function appendLearning(title, body) {
    const root = findRepoRoot(process.cwd());
    const p = path.join(root, ".ralph", "logs", "learnings.md");
    await appendText(p, `\n\n## ${utcNowIso()}: ${title.trim()}\n\n${body.trim()}\n`);
    return { ok: true };
}
export async function runVerification(timeoutSeconds) {
    const root = findRepoRoot(process.cwd());
    const results = [];
    for (const script of ["ci", "test:e2e"]) {
        const cp = await runNpmScript(root, script, timeoutSeconds);
        results.push(cp);
        if (cp.returncode !== 0)
            break;
    }
    return { ok: results.every((r) => r.returncode === 0), results };
}
async function readTextIfExists(p) {
    try {
        return await fs.readFile(p, "utf8");
    }
    catch {
        return null;
    }
}
async function readJsonIfExists(p) {
    const text = await readTextIfExists(p);
    if (!text)
        return {};
    try {
        return JSON.parse(text);
    }
    catch {
        return {};
    }
}
function parseJsonSafe(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
export function validateRalphConfig(cfg) {
    const errors = [];
    if (!cfg || typeof cfg !== "object") {
        return { ok: false, errors: ["Config must be a JSON object"] };
    }
    const o = cfg;
    if (typeof o.version !== "string" || o.version.trim() === "") {
        errors.push("version must be a non-empty string");
    }
    const phase2 = asObject(o.phase2);
    if (!phase2) {
        errors.push("phase2 must be an object");
    }
    else {
        if (typeof phase2.generatorScript !== "string" || phase2.generatorScript.trim() === "") {
            errors.push("phase2.generatorScript must be a non-empty string");
        }
        if (typeof phase2.overwriteSpecs !== "boolean") {
            errors.push("phase2.overwriteSpecs must be a boolean");
        }
        if (typeof phase2.overwriteFixPlan !== "boolean") {
            errors.push("phase2.overwriteFixPlan must be a boolean");
        }
    }
    const paths = asObject(o.paths);
    if (!paths) {
        errors.push("paths must be an object");
    }
    else {
        for (const key of ["epicPlan", "fixPlan", "specsDir", "progressLog", "learningsLog"]) {
            if (typeof paths[key] !== "string" || String(paths[key]).trim() === "") {
                errors.push(`paths.${key} must be a non-empty string`);
            }
        }
        if (paths.projectPlan !== undefined) {
            if (typeof paths.projectPlan !== "string" || String(paths.projectPlan).trim() === "") {
                errors.push("paths.projectPlan must be a non-empty string when provided");
            }
            else {
                const pp = String(paths.projectPlan).replaceAll("\\", "/").trim();
                const planOk = pp === ".ralph/prd.md" || pp.startsWith(".github/plans/");
                if (!planOk) {
                    errors.push("paths.projectPlan must be .ralph/prd.md or under .github/plans/");
                }
            }
        }
    }
    const phase2Extra = asObject(o.phase2);
    if (phase2Extra) {
        if (phase2Extra.workerModel !== undefined && typeof phase2Extra.workerModel !== "string") {
            errors.push("phase2.workerModel must be a string when provided");
        }
        if (phase2Extra.planFrequency !== undefined &&
            (typeof phase2Extra.planFrequency !== "number" || phase2Extra.planFrequency < 1)) {
            errors.push("phase2.planFrequency must be a positive number when provided");
        }
    }
    const phase1c = asObject(o.phase1);
    if (phase1c) {
        if (phase1c.sourcePlan !== undefined &&
            (typeof phase1c.sourcePlan !== "string" || phase1c.sourcePlan.trim() === "")) {
            errors.push("phase1.sourcePlan must be a non-empty string when provided");
        }
    }
    const phase3c = asObject(o.phase3);
    if (phase3c) {
        for (const key of ["planModel", "devModel", "qaModel"]) {
            if (phase3c[key] !== undefined && typeof phase3c[key] !== "string") {
                errors.push(`phase3.${key} must be a string when provided`);
            }
        }
        if (phase3c.planFrequency !== undefined &&
            (typeof phase3c.planFrequency !== "number" || phase3c.planFrequency < 1)) {
            errors.push("phase3.planFrequency must be a positive number when provided");
        }
        if (phase3c.maxDevQaRounds !== undefined &&
            (typeof phase3c.maxDevQaRounds !== "number" || phase3c.maxDevQaRounds < 1)) {
            errors.push("phase3.maxDevQaRounds must be a positive number when provided");
        }
        if (phase3c.maxSignoffRounds !== undefined &&
            (typeof phase3c.maxSignoffRounds !== "number" || phase3c.maxSignoffRounds < 1)) {
            errors.push("phase3.maxSignoffRounds must be a positive number when provided");
        }
    }
    const verification = asObject(o.verification);
    if (!verification) {
        errors.push("verification must be an object");
    }
    else {
        if (typeof verification.timeoutSeconds !== "number" || verification.timeoutSeconds <= 0) {
            errors.push("verification.timeoutSeconds must be a positive number");
        }
        if (!Array.isArray(verification.scripts) || verification.scripts.length === 0) {
            errors.push("verification.scripts must be a non-empty array");
        }
        else if (verification.scripts.some((s) => typeof s !== "string" || s.trim() === "")) {
            errors.push("verification.scripts entries must be non-empty strings");
        }
    }
    if (!Array.isArray(o.allowedNpmScripts) || o.allowedNpmScripts.length === 0) {
        errors.push("allowedNpmScripts must be a non-empty array");
    }
    else if (o.allowedNpmScripts.some((s) => typeof s !== "string" || s.trim() === "")) {
        errors.push("allowedNpmScripts entries must be non-empty strings");
    }
    const workflow = asObject(o.workflow);
    if (!workflow) {
        errors.push("workflow must be an object");
    }
    else {
        if (typeof workflow.blockedHeading !== "string" || workflow.blockedHeading.trim() === "") {
            errors.push("workflow.blockedHeading must be a non-empty string");
        }
        if (typeof workflow.taskIdTag !== "string" || workflow.taskIdTag.trim() === "") {
            errors.push("workflow.taskIdTag must be a non-empty string");
        }
        if (typeof workflow.timezone !== "string" || workflow.timezone.trim() === "") {
            errors.push("workflow.timezone must be a non-empty string");
        }
    }
    return { ok: errors.length === 0, errors };
}
function asObject(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : null;
}
function getConfiguredProjectPlanPath(cfg) {
    const root = asObject(cfg);
    const paths = root ? asObject(root.paths) : null;
    if (!paths || typeof paths.projectPlan !== "string")
        return null;
    return paths.projectPlan.replaceAll("\\", "/").trim() || null;
}
/**
 * Parses the "PLANNING / DOCUMENTATION tasks for Phase 3" section from a
 * Phase 2 fix_plan.md and returns each numbered item as a plain string that
 * can be used as a Phase 3 task. Each item title is concatenated with its
 * "What to produce:" sub-bullet (if present) so the agent has full context.
 */
function extractPhase2PlanningTasks(fixPlanMd) {
    const lines = fixPlanMd.split(/\r?\n/);
    // Find the section header — flexible match so minor wording changes still work.
    const sectionRe = /planning\s*\/\s*documentation\s+tasks\s+for\s+phase\s+3/i;
    let inSection = false;
    const results = [];
    let currentTitle = "";
    let currentProduce = "";
    const flush = () => {
        if (!currentTitle)
            return;
        const detail = currentProduce ? ` — ${currentProduce}` : "";
        results.push(`${currentTitle}${detail}`);
        currentTitle = "";
        currentProduce = "";
    };
    for (const line of lines) {
        const trimmed = line.trim();
        // Detect section start.
        if (!inSection) {
            if (sectionRe.test(trimmed))
                inSection = true;
            continue;
        }
        // Stop at the next markdown heading or a "Notes:" marker.
        if (trimmed.startsWith("#") || /^notes:/i.test(trimmed)) {
            flush();
            break;
        }
        // Numbered item title line: "1. Document system architecture …"
        const numMatch = /^\d+\.\s+(.+)/.exec(trimmed);
        if (numMatch) {
            flush();
            currentTitle = numMatch[1].trim();
            continue;
        }
        // Sub-bullet "- What to produce: …"
        const produceMatch = /^-\s+what to produce:\s*(.+)/i.exec(trimmed);
        if (produceMatch && currentTitle) {
            currentProduce = produceMatch[1].trim();
            continue;
        }
    }
    flush();
    return results;
}
/**
 * Reads the existing fix_plan.md and any Phase 2 spec files to build a
 * de-duplicated list of implementation task strings for Phase 3.
 */
async function buildPhase3SeedTasks(ralphDir, fixPlanMd) {
    const seen = new Set();
    const tasks = [];
    const add = (text) => {
        const key = text.trim().toLowerCase().replace(/\s+/g, " ");
        if (!key || seen.has(key))
            return;
        seen.add(key);
        tasks.push(text.trim());
    };
    // 1. Convert numbered planning items from the Phase 2 fix plan section.
    for (const t of extractPhase2PlanningTasks(fixPlanMd))
        add(t);
    // 2. Pull additional numbered items from phase3-planning.md spec if present.
    const phase3PlanMd = await readTextIfExists(path.join(ralphDir, "specs", "phase3-planning.md"));
    if (phase3PlanMd) {
        for (const t of extractPhase2PlanningTasks(phase3PlanMd))
            add(t);
        // Also grab any plain numbered items in that file.
        for (const line of phase3PlanMd.split(/\r?\n/)) {
            const m = /^\d+\.\s+(.+)/.exec(line.trim());
            if (m?.[1])
                add(m[1].trim());
        }
    }
    return tasks;
}
/**
 * Appends a "## Phase 3 Implementation Tasks" section to the fix plan
 * markdown with one `- [ ] … task-id: p3-NNN` line per task.
 * Returns the updated markdown string (does not write to disk).
 */
function appendPhase3Tasks(existing, taskTexts) {
    const trimmed = existing.trimEnd();
    const lines = trimmed.split(/\r?\n/);
    lines.push("", "## Phase 3 Implementation Tasks", "");
    taskTexts.forEach((text, i) => {
        const id = `p3-${String(i + 1).padStart(3, "0")}`;
        lines.push(`- [ ] ${text} task-id: ${id}`);
    });
    lines.push("");
    return lines.join("\n");
}
async function listMarkdown(dir, root) {
    try {
        const entries = await walk(dir);
        return entries
            .filter((p) => p.toLowerCase().endsWith(".md"))
            .map((p) => path.relative(root, p).replaceAll("\\", "/"))
            .sort();
    }
    catch {
        return [];
    }
}
async function fileExists(p) {
    try {
        await fs.access(p);
        return true;
    }
    catch {
        return false;
    }
}
async function walk(dir) {
    const out = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory())
            out.push(...(await walk(p)));
        else
            out.push(p);
    }
    return out;
}
