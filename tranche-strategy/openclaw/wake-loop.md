# Wake loop (cron-triggered)

> This IS the rebalance engine (architecture O-01). We use OpenClaw's **native
> cron-triggered agentic loop** — we do NOT build a scheduler (CLAUDE.md don't-overbuild).
> Reference pattern: `byreal-scheduled-macro` (wake → poll → act → confirm → exit).

## Schedule

The agent wakes on a fixed interval and runs one cycle. Interval is a tradeoff
(design §5/§9): tighter = closer IL tracking but more gas/funding churn. Start at
**30 min** on testnet; tune toward the T≈5–8% knee.

## Each wake runs one cycle

```
bun ~/.openclaw/workspace/skills/tranche-strategy/scripts/rebalance.ts -o json
```

`scripts/rebalance.ts` performs the full cycle (SKILL.md):
read BOTH venues → (skip-stale on partial read) → compute derived delta → target short
→ drift vs T → decide (hold / rebalance / re-range) → journal the decision → persist
state. Execution of the resize is gated behind `--execute` and routes signing through
the agent-token handoff; a bare wake is read-and-decide only.

## Native loop (preferred)

Register the wake as an OpenClaw scheduled task so the runtime injects workspace
context (AGENTS.md/SOUL.md/TOOLS.md/USER.md) each turn and the agent runs the cycle
within policy. The schedule lives in the OpenClaw task config, not in our code.

## Plain-cron fallback (for a headless testnet demo)

If running the skill outside the OpenClaw scheduler, a crontab entry works:

```cron
# every 30 minutes — tranche rebalance cycle (testnet, decide-only)
*/30 * * * * cd ~/.openclaw/workspace/skills/tranche-strategy && bun scripts/rebalance.ts -o json >> logs/cycles.jsonl 2>&1
```

## Demo runner (visible autonomy, live Byreal data)

`scripts/agent-loop.ts` makes the autonomy visible locally: it runs the wake cycle on a
short interval, reading BOTH Byreal skills LIVE each tick — CLMM pool price (`byreal-cli`)
+ Hyperliquid funding (`byreal-perps-cli signal detail`) — then decides, journals, and
paper-applies the hedge resize.

```bash
pnpm agent-loop --ticks 8 --interval 15
# #1 🔁 REBALANCE SOL $65.38  funding 11.0% carry  delta 70.9 SOL  short 0→42.56  drift 100%
# #2 ✋ HOLD       SOL $65.38  ...  drift 0.0%      ← opens the hedge, then holds delta-neutral
```

Same decision logic as the production cron cycle; only the trigger differs (a local
interval vs OpenClaw's scheduler). Money-moving execution is paper here (resize applied
to local state); live signing is the agent-token handoff. Two-venue safety is real — a
failed/zero live read becomes `skip-stale`.

For a dramatic swing without live venues, `sim/replay.ts` drives the identical decision
logic over a synthetic SOL path (205 rebalances) — feeds the `/manage` dashboard.
