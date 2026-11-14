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
| [mutation](./mutation/SKILL.md) | the hourly StrykerJS run on what merged to main, a ticket per real gap; no step of a pull request |
| [review](./review/SKILL.md) | the one read-only review of the whole diff |
| [lead](./lead/SKILL.md) | start the boxes, approve plans, run e2e, push and land |
| [step-commit](./step-commit/SKILL.md) | commit and sign a step's work in one command |
| [guidelines](./guidelines/SKILL.md) | study one design area, show the choices and plan the build |
| [adr](./adr/SKILL.md) | write one owner decision to `.decisions/`, the turn it is made |
| [write-pattern](./write-pattern/SKILL.md) | write or re-ground one `.patterns/` doc on how the code is shaped now |
| [pr](./pr/SKILL.md) | write a pull request's title and description, what it does first and the steps last |

## How a brief uses them

A brief names the skill and the ticket's facts, nothing more:

```text
Use the tests skill for ticket 277, door fixes, next/. Plan at ../door-PLAN.md. Box door.
This round: laws d1 to d3, and d4 yourself, since commits.ts is an exam path.
```

The skill holds what every brief used to repeat: what to read, the caps, how to commit and sign,
what never to do, and how to report. What every step shares is in
[`AGENTS.md`, "Finish your task"](../../AGENTS.md#finish-your-task): finish the whole task, the routine steps
that need no approval, and a report a reader with no context can follow.

An agent that meets something wrong outside its task writes one finding row, with proof, and
keeps going: never a fix, a ticket or only a mention
([0035](../../.decisions/0035-outside-work-becomes-finding-rows.md), fields in
[field/README.md](../../field/README.md#a-finding)). A read-only step hands the row over in its
report, and the lead saves it as its own file in `field/findings/`
([0090](../../.decisions/0090-each-field-row-is-a-file.md)). A person rates each row, and only a `fix` becomes a ticket.

## Changing a skill

A run that teaches something updates its skill in the same pull request as its field note. Scripts
hold no machine paths: they find the repo from where they sit, and read the rest from the
environment.

`pnpm lint` runs `lead/scripts/skillscheck.sh`. Each source folder with `SKILL.md` must have a
`.claude/skills/<name>` link to that folder. Copies, missing links and wrong targets fail. Unrelated
Claude-only skills are allowed. The check also requires the standing review, exam, driver and landing
clauses, each in its one home. Wrapping is free; wording changes need a tests-owned rule update.
