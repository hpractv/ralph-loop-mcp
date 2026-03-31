import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

export type TaskSection = "active" | "blocked";

export type ParsedTask = {
  section: TaskSection;
  checked: boolean;
  text: string;
  rawLine: string;
  lineIndex: number;
  taskId: string | null;
};

export type TaskRef = { text: string; taskId: string | null };

const REPO_ROOT_MARKERS = ["package.json", ".ralph"] as const;
const DEFAULT_ALLOWED_NPM_SCRIPTS = ["ci", "test:e2e", "typecheck", "build", "test:ci"] as const;

export function utcNowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function findRepoRoot(start: string) {
  let cur = path.resolve(start);

  for (let i = 0; i < 10; i += 1) {
    if (REPO_ROOT_MARKERS.every((m) => existsSync(path.join(cur, m)))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  return path.resolve(process.cwd());
}

/** Like findRepoRoot but only requires package.json — safe to use before .ralph exists. */
export function findRepoRootForSetup(start: string) {
  let cur = path.resolve(start);

  for (let i = 0; i < 10; i += 1) {
    if (existsSync(path.join(cur, "package.json"))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  return path.resolve(process.cwd());
}

function existsSync(p: string) {
  try {
    fsSync.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

export function sandboxPath(root: string, rel: string) {
  const abs = path.resolve(root, rel);
  const relative = path.relative(root, abs);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return { abs, relative };
  }
  throw new Error(`Path escapes repo root: ${rel}`);
}

export async function appendText(p: string, content: string) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const final = content.endsWith("\n") ? content : `${content}\n`;
  await fs.appendFile(p, final, "utf8");
}

export async function tailTextFile(p: string, n: number) {
  try {
    const text = await fs.readFile(p, "utf8");
    const lines = text.split(/\r?\n/);
    return lines.slice(Math.max(0, lines.length - n)).join("\n");
  } catch {
    return "";
  }
}

export function parseFixPlan(markdown: string): ParsedTask[] {
  const lines = markdown.split(/\r?\n/);
  const tasks: ParsedTask[] = [];

  const checkboxRe = /^\s*- \[(?<mark>[ xX])\]\s+(?<text>.+?)\s*$/;

  let section: TaskSection = "active";
  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx] ?? "";
    const stripped = line.trim();

    if (stripped.startsWith("#")) {
      const header = stripped.replace(/^#+\s*/, "").toLowerCase();
      if (header === "blocked" || header === "blocked tasks") section = "blocked";
      continue;
    }

    const m = checkboxRe.exec(line);
    if (!m || !m.groups) continue;

    const checked = m.groups.mark.toLowerCase() === "x";
    const text = m.groups.text.trim();
    tasks.push({
      section,
      checked,
      text,
      rawLine: line,
      lineIndex: idx,
      taskId: extractTaskId(text),
    });
  }

  return tasks;
}

export function setTaskChecked(markdown: string, ref: TaskRef, checked: boolean) {
  const lines = markdown.split(/\r?\n/);
  const tasks = parseFixPlan(markdown);
  const task = findTask(tasks, ref);

  const prefix = checked ? "- [x] " : "- [ ] ";
  const oldLine = lines[task.lineIndex] ?? "";
  const indentMatch = /^\s*/.exec(oldLine);
  const indent = indentMatch ? indentMatch[0] : "";

  lines[task.lineIndex] = `${indent}${prefix}${task.text}`;
  return lines.join("\n") + (markdown.endsWith("\n") ? "" : "");
}

export function blockTaskMd(markdown: string, ref: TaskRef, reason: string) {
  const lines = markdown.split(/\r?\n/);
  const tasks = parseFixPlan(markdown);
  const task = findTask(tasks.filter((t) => t.section === "active"), ref);

  lines.splice(task.lineIndex, 1);

  const base = `- [ ] ${task.text}`;
  const lineToAdd = reason.trim() ? `${base} — BLOCKED: ${reason.trim()}` : base;

  const { updated } = ensureBlockedSection(lines);
  if (updated.length > 0 && updated[updated.length - 1]?.trim() !== "") updated.push("");
  updated.push(lineToAdd);

  return updated.join("\n") + (markdown.endsWith("\n") ? "\n" : "");
}

export function unblockTaskMd(markdown: string, ref: TaskRef) {
  const lines = markdown.split(/\r?\n/);
  const tasks = parseFixPlan(markdown);
  const task = findTask(tasks.filter((t) => t.section === "blocked"), ref);

  lines.splice(task.lineIndex, 1);

  const taskLine = `- [ ] ${task.text}`;
  const out = insertIntoActive(lines, taskLine);
  return out.join("\n") + (markdown.endsWith("\n") ? "\n" : "");
}

export function replaceFixPlanMd(oldMd: string, newMd: string, preserveCompleted: boolean) {
  if (!preserveCompleted || !oldMd) return newMd.endsWith("\n") ? newMd : `${newMd}\n`;

  const oldTasks = parseFixPlan(oldMd);
  const newTasks = parseFixPlan(newMd);

  const oldById = new Map(oldTasks.filter((t) => t.taskId).map((t) => [t.taskId as string, t]));
  const oldByNorm = new Map(oldTasks.map((t) => [norm(t.text), t]));

  const newLines = newMd.split(/\r?\n/);

  for (const t of newTasks) {
    const match = t.taskId ? oldById.get(t.taskId) : oldByNorm.get(norm(t.text));
    if (!match) continue;

    const prefix = match.checked ? "- [x] " : "- [ ] ";
    const oldLine = newLines[t.lineIndex] ?? "";
    const indentMatch = /^\s*/.exec(oldLine);
    const indent = indentMatch ? indentMatch[0] : "";
    newLines[t.lineIndex] = `${indent}${prefix}${t.text}`;
  }

  const newNorms = new Set(newTasks.map((t) => norm(t.text)));

  const carriedCompleted = oldTasks.filter((t) => t.checked && !newNorms.has(norm(t.text)));
  const carriedBlocked = oldTasks.filter((t) => t.section === "blocked" && !newNorms.has(norm(t.text)));

  if (carriedCompleted.length || carriedBlocked.length) {
    if (newLines.length && newLines[newLines.length - 1]?.trim() !== "") newLines.push("");

    if (carriedCompleted.length) {
      newLines.push("## Completed (carried forward)", "");
      for (const t of carriedCompleted) newLines.push(`- [x] ${t.text}`);
    }

    if (carriedBlocked.length) {
      newLines.push("", "## Blocked", "");
      for (const t of carriedBlocked) newLines.push(`- [ ] ${t.text}`);
    }
  }

  const merged = newLines.join("\n");
  return merged.endsWith("\n") ? merged : `${merged}\n`;
}

export function getAllowedNpmScripts(root: string) {
  const allowed = new Set<string>(DEFAULT_ALLOWED_NPM_SCRIPTS);

  const configPath = path.join(root, ".ralph", "config.json");
  try {
    const raw = fsSync.readFileSync(configPath, "utf8");
    const cfg = JSON.parse(raw) as unknown;
    if (
      cfg &&
      typeof cfg === "object" &&
      "allowedNpmScripts" in cfg &&
      Array.isArray((cfg as any).allowedNpmScripts)
    ) {
      for (const x of (cfg as any).allowedNpmScripts) allowed.add(String(x));
    }
  } catch {
    // ignore missing/invalid config
  }

  return allowed;
}

function ensureBlockedSection(lines: string[]) {
  for (let i = 0; i < lines.length; i += 1) {
    const s = (lines[i] ?? "").trim().toLowerCase();
    if (s === "## blocked" || s === "## blocked tasks") return { updated: lines, blockedIndex: i };
  }

  if (lines.length && lines[lines.length - 1]?.trim() !== "") lines.push("");
  lines.push("## Blocked", "");
  return { updated: lines, blockedIndex: lines.length - 2 };
}

function insertIntoActive(lines: string[], taskLine: string) {
  const blockedIdx = lines.findIndex((l) => {
    const s = (l ?? "").trim().toLowerCase();
    return s === "## blocked" || s === "## blocked tasks";
  });

  if (blockedIdx === -1) {
    if (lines.length && lines[lines.length - 1]?.trim() !== "") lines.push("");
    lines.push(taskLine);
    return lines;
  }

  let insertAt = blockedIdx;
  if (insertAt > 0 && (lines[insertAt - 1] ?? "").trim() !== "") {
    lines.splice(insertAt, 0, "");
    insertAt += 1;
  }

  lines.splice(insertAt, 0, taskLine);
  return lines;
}

function findTask(tasks: ParsedTask[], ref: TaskRef) {
  if (ref.taskId) {
    const found = tasks.find((t) => t.taskId === ref.taskId);
    if (found) return found;
  }

  const needle = norm(ref.text);
  const found = tasks.find((t) => norm(t.text) === needle);
  if (found) return found;

  throw new Error(`Task not found: ${ref.taskId ?? ref.text}`);
}

function norm(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function extractTaskId(text: string) {
  const idx = text.toLowerCase().indexOf("task-id:");
  if (idx === -1) return null;
  const after = text.slice(idx + "task-id:".length).trim();
  if (!after) return null;
  const token = after.split(/\s+/)[0]?.replace(/[\]\)]$/, "") ?? "";
  return token || null;
}
