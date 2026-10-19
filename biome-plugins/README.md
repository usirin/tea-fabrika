These lint rules come from the `biome-plugins/` folder of [kamp-us/phoenix](https://github.com/kamp-us/phoenix), the pipeline this repo rebuilds.
They are copies, unchanged: change a rule there, then copy the file here again.

One rule is this repo's own, not a copy: `no-bare-tell.grit`. A `tell` or `offer` to a program's input is an Effect, and written as a bare statement, or answered from a callback whose caller wants nothing back (`xs.forEach((x) => run.tell("n", x))`), it is made and dropped, so nothing is told. Change it here.

`pnpm typecheck` catches every other dropped Effect statement through Effect's own `floatingEffect` check (`@effect/tsgo`, set up in `tsconfig.base.json`). That check does not look inside callbacks, so the callback shape stays this rule's job.
