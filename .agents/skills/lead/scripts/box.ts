// box.ts: the TypeScript half of box.sh, a Codex agent's own copy of tea-fabrika. Today's lead
// tooling, run on our own laptop; it is not product. box.sh hands it these subcommands:
//
//   box.ts rm <name>   remove a clean pair whose commits MAIN retains (box/Remove.ts says how)
//
// `new`, `run` and `fetch` still run in box.sh, and `gc` in gc.ts. Paths come from env.sh, which
// box.sh sources first: MAIN, BOXES. One result line on stdout; exit 0, 1 (kept) or 2 (bad name or
// usage), as box.sh's Python gave.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Layer } from "effect";
import * as BoxGitProcess from "./box/BoxGitProcess.ts";
import * as Remove from "./box/Remove.ts";
import * as RunsProcess from "./box/RunsProcess.ts";

const setExit = (code: number) =>
  Effect.sync(() => {
    process.exitCode = code;
  });

const rm = Effect.fn("box.rm")(function* (name: string) {
  const main = process.env.MAIN;
  const boxes = process.env.BOXES;

  if (main === undefined || boxes === undefined) {
    yield* Console.log(`kept box ${name}: inspection or removal failed`);
    return yield* setExit(1);
  }

  const services = Layer.mergeAll(
    BoxGitProcess.layer(main, process.env),
    RunsProcess.layer(`${import.meta.dirname}/keepruns.sh`, process.env),
  ).pipe(Layer.provide(NodeServices.layer));
  const removal = yield* Remove.remove(name, { boxes, main }).pipe(Effect.provide(services));

  if (removal.runs !== "") {
    yield* Console.log(removal.runs);
  }

  yield* Console.log(Remove.line(removal));
  yield* setExit(Remove.exitCode(removal.verdict));
});

// A box name is read as the exact argument, never through a flag parser: a name such as "", "-h"
// or "--x" must reach the name check, which answers it with exit 2.
const [command, ...rest] = process.argv.slice(2);

const program =
  command === "rm" && rest.length === 1
    ? rm(rest[0] ?? "")
    : Effect.andThen(Console.error("usage: box.sh rm <name>"), setExit(2));

NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)), { disableErrorReporting: true });
