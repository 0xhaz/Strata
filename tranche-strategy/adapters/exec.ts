/**
 * Thin shell-out helper. Every Byreal command supports `-o json` (techstacks §4) —
 * we always request it and parse structured output. We NEVER reimplement the CLIs'
 * logic (CLAUDE.md rule 3: compose, don't rebuild).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

export class CliUnavailableError extends Error {
  constructor(public readonly bin: string) {
    super(
      `\`${bin}\` is not installed. It is a hackathon-onboarding dependency ` +
        `(install: npm i -g @byreal-io/${bin}). The agent cannot run the live ` +
        `leg until it is present — see workplan.md Phase 0.`,
    );
    this.name = "CliUnavailableError";
  }
}

export async function hasBinary(bin: string): Promise<boolean> {
  try {
    await pexec("which", [bin]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run `<bin> <args...> -o json` and parse the result.
 * @throws CliUnavailableError if the binary is missing (degrade loudly, never guess).
 */
export async function runJson<T = unknown>(
  bin: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  if (!(await hasBinary(bin))) throw new CliUnavailableError(bin);
  const full = [...args, "-o", "json"];
  const { stdout } = await pexec(bin, full, {
    timeout: opts.timeoutMs ?? 30_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new Error(`Non-JSON output from \`${bin} ${full.join(" ")}\`:\n${stdout.slice(0, 500)}`);
  }
}
