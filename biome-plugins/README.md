These lint rules come from the `biome-plugins/` folder of [kamp-us/phoenix](https://github.com/kamp-us/phoenix), the pipeline this repo rebuilds.
Most are copies, unchanged: change a rule there, then copy the file here again.

Two copies differ: they only advise. `no-effect-promise.grit` and `no-raw-try-catch.grit` give their diagnostics at `"info"`, which `pnpm lint` (`biome check --error-on-warnings`) prints and does not fail on, and their messages start with "Advice, does not block". A `"warn"` or an `"error"` fails it. Experiment 125 found both wrong far too often to block: 8 of 8 and 21 of 21 fires kept their code. When you copy either again, keep these two changes.

Phoenix's `no-node-sqlite-test-backing.grit` is not here. It bans a fake of Cloudflare D1; this repo has no D1, and `node:sqlite` is the ledger's real driver. Experiment 125 found it wrong 8 of 8 times.

One rule is this repo's own, not a copy: `no-bare-tell.grit`. A `tell` or `offer` to a program's input is an Effect, and written as a bare statement, or answered from a callback whose caller wants nothing back (`xs.forEach((x) => run.tell("n", x))`), it is made and dropped, so nothing is told. Change it here.

`pnpm typecheck` catches every other dropped Effect statement through Effect's own `floatingEffect` check (`@effect/tsgo`, set up in `tsconfig.base.json`). That check does not look inside callbacks, so the callback shape stays this rule's job.
