/**
 * Shared script I/O: every script supports `-o json` (agent consumption) and a
 * human-readable default (debugging) — CLAUDE.md coding convention.
 */
export interface Argv {
  flags: Record<string, string | boolean>;
  json: boolean;
}

export function parseArgs(argv = process.argv.slice(2)): Argv {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-o") {
      flags.o = argv[++i] ?? "";
    } else if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    }
  }
  return { flags, json: flags.o === "json" };
}

export function num(flags: Argv["flags"], key: string, fallback?: number): number {
  const v = flags[key];
  if (v === undefined || v === true) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required numeric flag --${key}`);
  }
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`--${key} must be a number, got "${v}"`);
  return n;
}

export function emit(argv: Argv, json: unknown, human: () => void): void {
  if (argv.json) {
    process.stdout.write(JSON.stringify(json, null, 2) + "\n");
  } else {
    human();
  }
}
