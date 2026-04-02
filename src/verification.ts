import { spawn } from "node:child_process";
import path from "node:path";

import { getAllowedNpmScripts } from "./workflow.js";

export async function runNpmScript(
  root: string,
  script: string,
  timeoutSeconds: number,
): Promise<{ script: string; returncode: number; stdout: string; stderr: string }> {
  const allowed = getAllowedNpmScripts(root);
  if (!allowed.has(script)) {
    throw new Error(`npm script not allowlisted: ${script}`);
  }

  const cmd = "npm";
  const args = ["run", script];

  const child = spawn(cmd, args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    env: { ...process.env },
  });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  child.stdout?.on("data", (b) => stdoutChunks.push(Buffer.from(b)));
  child.stderr?.on("data", (b) => stderrChunks.push(Buffer.from(b)));

  const timeout = setTimeout(() => {
    child.kill("SIGKILL");
  }, Math.max(1, timeoutSeconds) * 1000);

  const returncode = await new Promise<number>((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });

  clearTimeout(timeout);

  const stdout = Buffer.concat(stdoutChunks).toString("utf8");
  const stderr = Buffer.concat(stderrChunks).toString("utf8");

  const tail = (s: string) => (s.length > 8000 ? s.slice(-8000) : s);

  return {
    script,
    returncode,
    stdout: tail(stdout),
    stderr: tail(stderr),
  };
}
