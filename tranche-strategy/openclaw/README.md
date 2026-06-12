# OpenClaw workspace config

These are the workspace-level config files the `tranche-strategy` skill conforms to
(the RealClaw §-contract, architecture §12). They are kept in the repo for version
control; at runtime they live at the OpenClaw **workspace root**, with the skill under
`skills/`:

```
~/.openclaw/workspace/
  AGENTS.md      ← openclaw/AGENTS.md   (operator policy: permissions, risk, watchdog…)
  SOUL.md        ← openclaw/SOUL.md     (risk tier + persona)
  TOOLS.md       ← openclaw/TOOLS.md    (composed skills/CLIs + parsing contract)
  USER.md        ← openclaw/USER.md     (operator profile + allocation)
  IDENTITY.md    ← openclaw/IDENTITY.md (ERC-8004 agent identity)
  skills/
    tranche-strategy/   ← this whole package
```

Install the composed skills + this skill, copy the workspace files to the root, then
register the wake loop (see `wake-loop.md`):

```bash
npm i -g @byreal-io/byreal-cli @byreal-io/byreal-perps-cli
cp openclaw/{AGENTS,SOUL,TOOLS,USER,IDENTITY}.md ~/.openclaw/workspace/
# place this package at ~/.openclaw/workspace/skills/tranche-strategy/
```

`agent-registration.json` is the ERC-8004 `tokenURI` target (hosted on IPFS/HTTPS at
mint time). `wake-loop.md` documents the cron-triggered rebalance cycle.
