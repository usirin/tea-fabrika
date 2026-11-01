// `@kampus/fabrika-old/shell`: tsh on a Node process. `runTsh` holds the
// terminal, or reads a script, and runs the programs `Programs` holds (on the
// top level, in `Shell`). `homeOf` is where it keeps its home. An app's bin is
// these two lines and its list:
//
//   import {Shell} from "@kampus/fabrika-old";
//   import {runTsh} from "@kampus/fabrika-old/shell";
//   process.exitCode = await Effect.runPromise(
//     runTsh().pipe(Effect.provideService(Shell.Programs, Shell.programList([...Shell.SMALL]))),
//   );
export {homeOf} from "./shell/launch.ts";
export {type Options, runTsh} from "./shell/main.ts";
