# Step skills

The hand-run pipeline's steps, as [Agent Skills](https://agentskills.io). Codex reads them here.
They are today's hand-run tools, used for work in either version: `next/` or today's.
Each `.claude/skills/<name>` is a link to the same folder, so Claude Code loads them too. One copy,
both tools.

| Skill | For |
|---|---|
| [plan](./plan/SKILL.md) | write one pull request's plan, read-only, with an owner step per file |
| [tests](./tests/SKILL.md) | write the plan's laws and plants, and the exam work, before the build |
| [build](./build/SKILL.md) | make the red laws green in product code, never touching the exam |
| [mutation](./mutation/SKILL.md) | a fixed StrykerJS sample on the build's files, then laws for real survivors |
| [review](./review/SKILL.md) | the one read-only review of the whole diff |
| [lead](./lead/SKILL.md) | start the boxes, approve plans, run e2e, push and land |
| [step-commit](./step-commit/SKILL.md) | commit and sign a step's work in one command |
| [guidelines](./guidelines/SKILL.md) | study one design area, show the choices and plan the build |
| [adr](./adr/SKILL.md) | write one owner decision to `.decisions/`, the turn it is made |
| [write-pattern](./write-pattern/SKILL.md) | write or re-ground one `.patterns/` doc on how the code is shaped now |

## How a brief uses them

A brief names the skill and the ticket's facts, nothing more:

```text
Use the tests skill for ticket 277, door fixes, next/. Plan at ../door-PLAN.md. Box door.
This round: laws d1 to d3, and d4 yourself, since commits.ts is an exam path.
```

The skill holds what every brief used to repeat: what to read, the caps, how to commit and sign,
what never to do, and how to report.

An agent that meets something wrong outside its task writes one finding row, with proof, and
keeps going: never a fix, a ticket or only a mention
([0035](../../.decisions/0035-outside-work-becomes-finding-rows.md), fields in
[field/README.md](../../field/README.md#a-finding)). A read-only step hands the row over in its
report, and the lead saves it as its own file in `field/findings/`
([0090](../../.decisions/0090-each-field-row-is-a-file.md)). A person rates each row, and only a `fix` becomes a ticket.

Plan writers and agents reviewing or revising plans return them unsigned. Only the lead session
fills the blank first line after reading the plan and running `plancheck.sh --draft`.
Approval names the draft's body digest. An edit anywhere after line two, including an amendment,
needs a fresh read and approval. `plancheck.sh --approved` checks that digest at box creation.

`box.sh run --step` checks order and slots, saves run facts, and redacts output. Step-commit checks
owners and staged formatting; its `--commit-only` route leaves missing notes for `fetch --sign`.

Review sweeps every law and decided note, then answers once with all blocking classes and
its finding rows. The lead skill holds the standing review brief.
After a merge, `land.ts merged` starts the box cleanup sweep, which removes safe boxes and linked worktrees.
An exam change needs no owner read when its labels fit and both loosening and mutation find zero hits.

For a stacked child, the brief records the parent ticket, branch and signed build head. The driver
records the child before starting it. The stack lands with `gh stack merge <pr> --squash`, then
`gh stack sync --prune` moves the rest onto main ([0004](../../.decisions/0004-squash-merges-and-native-stacks.md)). The child
keeps its tests and lands after its parent reaches main.

## Changing a skill

A run that teaches something updates its skill in the same pull request as its field note. Scripts
hold no machine paths: they find the repo from where they sit, and read the rest from the
environment.

`pnpm lint` runs `lead/scripts/skillscheck.sh`. Each source folder with `SKILL.md` must have a
`.claude/skills/<name>` link to that folder. Copies, missing links and wrong targets fail. Unrelated
Claude-only skills are allowed. The check also requires the standing review, driver and landing
clauses in their owning sections. Wrapping is free; wording changes need a tests-owned rule update.
