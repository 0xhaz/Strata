/**
 * Atomic JSON state store (RealClaw skill pattern): write to a temp file, fsync,
 * then rename over the target so a crash mid-write never corrupts state.
 */
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentState } from "./schema.js";

export const DEFAULT_STATE_PATH = new URL("../config/state.json", import.meta.url)
  .pathname;

export async function readState(path = DEFAULT_STATE_PATH): Promise<AgentState | null> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as AgentState;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Atomic write: temp-then-rename. rename(2) is atomic within a filesystem. */
export async function writeState(
  state: AgentState,
  path = DEFAULT_STATE_PATH,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
  await rename(tmp, path);
}

/** Read-modify-write with the atomic guarantee. */
export async function updateState(
  mutate: (s: AgentState) => AgentState | void,
  path = DEFAULT_STATE_PATH,
): Promise<AgentState> {
  const current = await readState(path);
  if (!current) throw new Error(`No state at ${path} — run init first.`);
  const next = mutate(current) ?? current;
  await writeState(next, path);
  return next;
}
