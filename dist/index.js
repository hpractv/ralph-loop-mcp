import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { appendLearning, appendProgress, blockTask, generatePhase1, generatePhase2, generatePhase3, listFiles, nextTask, readFile, readState, replaceFixPlan, runVerification, setTaskStatus, unblockTask, upsertSpec, writePlan, writePrd, writeEpicPlan, } from "./tools.js";
const tools = [
    {
        name: "ralph.generate_phase1",
        description: "Set up Phase 1: creates .ralph/phase1.sh and .ralph/phase1-prd-prompt.md, seeds a draft " +
            ".github/plans/project-plan.md if missing. " +
            "Run bash .ralph/phase1.sh to normalize the source plan into the canonical PRD at .ralph/prd.md via ralph.write_prd. " +
            "Configure phase1.sourcePlan in .ralph/config.json (default .github/plans/project-plan.md). " +
            "When the PRD is ready, run ralph.generate_phase2.",
        inputSchema: {
            type: "object",
            properties: {
                sourcePlan: {
                    type: "string",
                    description: "Repo-relative path to the source plan markdown Phase 1 reads (seeded into config when config is merged). " +
                        "Defaults to .github/plans/project-plan.md if omitted.",
                },
            },
            additionalProperties: false,
        },
    },
    {
        name: "ralph.write_plan",
        description: "Write or update a planning document under .github/plans/. " +
            "Use for draft plans before Phase 1 PRD normalization, or auxiliary planning docs.",
        inputSchema: {
            type: "object",
            properties: {
                relativePath: {
                    type: "string",
                    description: "Repo-relative path under .github/plans/ (e.g. .github/plans/project-plan.md).",
                },
                content: { type: "string" },
            },
            required: ["relativePath", "content"],
            additionalProperties: false,
        },
    },
    {
        name: "ralph.write_prd",
        description: "Write or replace the canonical product requirements document at .ralph/prd.md. " +
            "Used by the Phase 1 Copilot session only.",
        inputSchema: {
            type: "object",
            properties: { content: { type: "string" } },
            required: ["content"],
            additionalProperties: false,
        },
    },
    {
        name: "ralph.read_state",
        description: "Read .ralph state: config, parsed tasks, spec index, PRD tail, and log tails. " +
            "Call at the start of Phase 2/3 iterations.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
        name: "ralph.list_files",
        description: "List files and directories one level deep under a repo-relative path. " +
            "Use this during Phase 2 exploration to discover source files, then read them with ralph.read_file.",
        inputSchema: {
            type: "object",
            properties: {
                directory: {
                    type: "string",
                    description: "Repo-relative directory path to list. Defaults to repo root if omitted.",
                },
            },
            additionalProperties: false,
        },
    },
    {
        name: "ralph.read_file",
        description: "Read any text file inside the repo by its repo-relative path. " +
            "Use this during Phase 2 to explore source code and inform spec and fix-plan authoring.",
        inputSchema: {
            type: "object",
            properties: {
                relativePath: {
                    type: "string",
                    description: "Repo-relative path of the file to read.",
                },
            },
            required: ["relativePath"],
            additionalProperties: false,
        },
    },
    {
        name: "ralph.write_epic_plan",
        description: "Write/update the canonical .ralph/epic_plan.md file.",
        inputSchema: {
            type: "object",
            properties: { content: { type: "string" } },
            required: ["content"],
            additionalProperties: false,
        },
    },
    {
        name: "ralph.upsert_spec",
        description: "Write/update a spec file under .ralph/specs/**. " +
            "Call this iteratively during Phase 2 as you explore source files and refine your understanding.",
        inputSchema: {
            type: "object",
            properties: {
                relativePath: { type: "string" },
                content: { type: "string" },
            },
            required: ["relativePath", "content"],
            additionalProperties: false,
        },
    },
    {
        name: "ralph.replace_fix_plan",
        description: "Replace .ralph/fix_plan.md, optionally preserving completed items from the previous file. " +
            "Phase 2/3: use preserveCompleted:true when refining. " +
            "You may add \`<!-- ralph-defer: blocked-by: task-id — note -->\` on the line after a checkbox to defer work.",
        inputSchema: {
            type: "object",
            properties: {
                content: { type: "string" },
                preserveCompleted: { type: "boolean", default: true },
            },
            required: ["content"],
            additionalProperties: false,
        },
    },
    {
        name: "ralph.next_task",
        description: "Return the next unchecked active task from .ralph/fix_plan.md (ignores blocked tasks).",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
        name: "ralph.set_task_status",
        description: "Check/uncheck a task in .ralph/fix_plan.md by text or taskId. " +
            "In Phase 3, only the QA-close persona should call this with checked:true after Dev agrees sign-off.",
        inputSchema: {
            type: "object",
            properties: {
                text: { type: "string" },
                checked: { type: "boolean" },
                taskId: { type: ["string", "null"] },
            },
            required: ["text", "checked"],
            additionalProperties: false,
        },
    },
    {
        name: "ralph.block_task",
        description: "Move an active task into the dedicated Blocked section with a short reason.",
        inputSchema: {
            type: "object",
            properties: {
                text: { type: "string" },
                reason: { type: "string" },
                taskId: { type: ["string", "null"] },
            },
            required: ["text", "reason"],
            additionalProperties: false,
        },
    },
    {
        name: "ralph.unblock_task",
        description: "Move a blocked task back into the active task list (unchecked by default).",
        inputSchema: {
            type: "object",
            properties: {
                text: { type: "string" },
                taskId: { type: ["string", "null"] },
            },
            required: ["text"],
            additionalProperties: false,
        },
    },
    {
        name: "ralph.append_progress",
        description: "Append a timestamped entry to .ralph/logs/progress.txt.",
        inputSchema: {
            type: "object",
            properties: { entry: { type: "string" } },
            required: ["entry"],
            additionalProperties: false,
        },
    },
    {
        name: "ralph.append_learning",
        description: "Append a new section to .ralph/logs/learnings.md.",
        inputSchema: {
            type: "object",
            properties: { title: { type: "string" }, body: { type: "string" } },
            required: ["title", "body"],
            additionalProperties: false,
        },
    },
    {
        name: "ralph.generate_phase2",
        description: "Set up Phase 2: .ralph/phase2.sh (planning persona + worker loop), config.json with defaults, " +
            "phase2-planner-prompt.md, phase2-worker-prompt.md, specs/, logs/. " +
            "Phase 2 reads paths.projectPlan (default .ralph/prd.md). Ensure .ralph/prd.md exists first. " +
            "Run bash .ralph/phase2.sh after setup.",
        inputSchema: {
            type: "object",
            properties: {
                planFile: {
                    type: "string",
                    description: "Repo-relative path to the PRD or plan markdown (paths.projectPlan). " +
                        "Defaults to .ralph/prd.md if omitted.",
                },
            },
            additionalProperties: false,
        },
    },
    {
        name: "ralph.generate_phase3",
        description: "Set up Phase 3: .ralph/phase3.sh — Plan, Dev, QA personas, Dev/QA consensus sign-off, then QA close " +
            "marks tasks done. Prompt files: phase3-plan-prompt.md, phase3-dev-prompt.md, phase3-qa-prompt.md, sign-off prompts. " +
            "Requires .ralph/fix_plan.md. Run bash .ralph/phase3.sh.",
        inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
        },
    },
    {
        name: "ralph.run_verification",
        description: "Run strict verification gate: npm run ci, then npm run test:e2e (stop on first failure).",
        inputSchema: {
            type: "object",
            properties: { timeoutSeconds: { type: "number", default: 1800 } },
            additionalProperties: false,
        },
    },
];
export function normalizeToolName(raw) {
    return raw.replace(/^ralph_/, "ralph.");
}
function jsonResult(value) {
    return {
        content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    };
}
function asNullableString(value) {
    return typeof value === "string" ? value : null;
}
async function main() {
    const server = new Server({ name: "ralph-loop", version: "0.1.0" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
    server.setRequestHandler(CallToolRequestSchema, async (req) => {
        const { name: rawName, arguments: args } = req.params;
        // Cursor (and some other clients) serialize dot-namespaced tool names with
        // underscores (ralph_generate_phase2) instead of dots (ralph.generate_phase2).
        // Normalise here so both variants work without duplicating every case.
        const name = normalizeToolName(rawName);
        switch (name) {
            case "ralph.generate_phase1":
                return jsonResult(await generatePhase1(args?.sourcePlan ? String(args.sourcePlan) : undefined));
            case "ralph.write_prd":
                return jsonResult(await writePrd(String(args?.content ?? "")));
            case "ralph.write_plan":
                return jsonResult(await writePlan(String(args?.relativePath ?? ""), String(args?.content ?? "")));
            case "ralph.read_state":
                return jsonResult(await readState());
            case "ralph.list_files":
                return jsonResult(await listFiles(String(args?.directory ?? "")));
            case "ralph.read_file":
                return jsonResult(await readFile(String(args?.relativePath ?? "")));
            case "ralph.write_epic_plan":
                return jsonResult(await writeEpicPlan(String(args?.content ?? "")));
            case "ralph.upsert_spec":
                return jsonResult(await upsertSpec(String(args?.relativePath ?? ""), String(args?.content ?? "")));
            case "ralph.replace_fix_plan":
                return jsonResult(await replaceFixPlan(String(args?.content ?? ""), Boolean(args?.preserveCompleted ?? true)));
            case "ralph.next_task":
                return jsonResult(await nextTask());
            case "ralph.set_task_status":
                return jsonResult(await setTaskStatus(String(args?.text ?? ""), Boolean(args?.checked), asNullableString(args?.taskId)));
            case "ralph.block_task":
                return jsonResult(await blockTask(String(args?.text ?? ""), String(args?.reason ?? ""), asNullableString(args?.taskId)));
            case "ralph.unblock_task":
                return jsonResult(await unblockTask(String(args?.text ?? ""), asNullableString(args?.taskId)));
            case "ralph.append_progress":
                return jsonResult(await appendProgress(String(args?.entry ?? "")));
            case "ralph.append_learning":
                return jsonResult(await appendLearning(String(args?.title ?? ""), String(args?.body ?? "")));
            case "ralph.generate_phase2":
                return jsonResult(await generatePhase2(args?.planFile ? String(args.planFile) : undefined));
            case "ralph.generate_phase3":
                return jsonResult(await generatePhase3());
            case "ralph.run_verification":
                return jsonResult(await runVerification(Number(args?.timeoutSeconds ?? 1800)));
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    });
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((err) => {
    // stderr is safe in stdio mode
    // eslint-disable-next-line no-console
    console.error(String(err?.stack ?? err));
    process.exit(1);
});
