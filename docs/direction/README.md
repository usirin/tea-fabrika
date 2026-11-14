# Direction

Where this experiment is going, and why. One short note per decision.

`experiments/` records what was tried and what came back. `field/` records what
happened on real tickets. This folder records what was decided about the
direction, so a new reader (or a new agent session) starts from the same place.

Each note says what was decided, why, and what it means for the work. A note
marked **proposed** is a recommendation nobody has settled yet. A note marked
**owner to check** was written later from older records; treat it as proposed
until the owner confirms it.

## Start here

Read these in order. The plan's own way in is [`docs/plan/`](../plan/README.md). `next/` is the
new version, and "today's" is the one in daily use.

1. [Control lives in code](./control-in-code.md): both versions.
2. [Clean slate](./clean-slate.md): why two versions, side by side.
3. [Every pull request goes through the pipeline's steps](./next-is-a-pipeline-pre-run.md): both versions, and the order of work.
4. [The tiers](../plan/tiers.md): `next/`, what comes when.
5. [A local-first sync engine is the base](./a-local-first-sync-engine.md): `next/`, layers 1 to 3.
6. [The cloud is one more host](./the-cloud-is-one-more-host.md): `next/`, layer 4, the app.
7. [The desktop layer](./the-desktop-layer.md): `next/`, layer 5, and the menu bar.
8. [Brain, hands, window, agent](./brain-hands-window-agent.md): `next/`, the words.
9. [Protocols first, and a browser is always a client](./a-browser-is-always-a-client.md): both versions.
10. [Elm first](./elm-first.md): both versions, and the hook differs.

## Every note

This folder keeps no table of its notes
([0522](../../.decisions/0522-no-folder-keeps-an-index-table.md)). Each note says what it is at its
own top, and the lead's command prints one line per note as it is on `origin/main`:

```sh
node .agents/skills/lead/scripts/records.ts list docs/direction
```

[`follows/`](./follows/README.md) holds one table per outside model we follow (0017); its README is
one record of this folder.

## Adding a note

Write it when a direction is set or changed, the same day. Keep it short and in
plain words. Say what would change your mind. Do not record who said what: this
folder holds decisions, not conversations.

Open it with frontmatter above its `# ` heading. `summary` is the note in one line, and
`state` says whether it is decided or proposed. Each value is one line, in double quotes:

```markdown
---
state: "proposed"
summary: "Both versions. What was decided, in one line a reader can stop after."
---

# The note's title
```
