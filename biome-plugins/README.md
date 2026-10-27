These lint rules come from the `biome-plugins/` folder of [kamp-us/phoenix](https://github.com/kamp-us/phoenix), the pipeline this repo rebuilds.
Most are copies, unchanged: change a rule there, then copy the file here again.

Two copies differ: they only advise. `no-effect-promise.grit` and `no-raw-try-catch.grit` give their diagnostics at `"info"`, which `pnpm lint` (`biome check --error-on-warnings`) prints and does not fail on, and their messages start with "Advice, does not block". A `"warn"` or an `"error"` fails it. Experiment 125 found both wrong far too often to block: 8 of 8 and 21 of 21 fires kept their code. When you copy either again, keep these two changes.

Phoenix's `no-node-sqlite-test-backing.grit` is not here. It bans a fake of Cloudflare D1; this repo has no D1, and `node:sqlite` is the ledger's real driver. Experiment 125 found it wrong 8 of 8 times.

Two rules are this repo's own, not copies. Change them here.

`no-project-settings.grit` keeps a Claude run from loading a repository's own settings. Its hooks ran outside the sandbox in experiment 155, and the owner kept them out even where only trusted people work (`docs/direction/agents-read-rules-the-normal-way.md`). It refuses `settingSources` with a source in it, any `projectConfigRoot`, and the same CLI flags, anywhere but `packages/fabrika/src/agents/claude/rules.ts`, whose `ownRules` is the one place that says where a run's settings come from. `biome.jsonc` turns it on through an override that leaves that file and tests out. It blocks: of its 17 fires on the tree when it was added, 12 were on purpose and now say why in a `// biome-ignore lint/plugin/no-project-settings: <why>`, 4 were tests (so tests are left out), and 1 was a real slip, in experiment 127. `rules.test.ts` plants each form it refuses and checks it fires.

The other is `no-bare-tell.grit`. A `tell` or `offer` to a program's input is an Effect, and written as a bare statement, or answered from a callback whose caller wants nothing back (`xs.forEach((x) => run.tell("n", x))`), it is made and dropped, so nothing is told.

`pnpm typecheck` catches every other dropped Effect statement through Effect's own `floatingEffect` check (`@effect/tsgo`, set up in `tsconfig.base.json`). That check does not look inside callbacks, so the callback shape stays this rule's job.
