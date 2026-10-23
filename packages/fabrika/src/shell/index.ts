// tsh's parts that run anywhere, as one module: `Shell` on the top level of
// `@kampus/fabrika`, read as `Shell.programList`, `Shell.tsh`. A module, like
// `Call` and `Monitor`: its names (`check`, `parse`, `EMPTY`, `describe`) are
// the shell's, and would say too little on the flat list beside the host's.
//
// It is what an app hands tsh and what it tests its lines with. The launcher
// that holds the terminal, `runTsh`, reads Node's process and is on
// `@kampus/fabrika/shell`.
//
//   import {listed, Shell} from "@kampus/fabrika";
//   const programs = Shell.programList([...Shell.SMALL, listed(hello, Layer.empty)]);

// A line, read the way tsh reads it before anything starts: for an app's own tests of its lines.
export {describe} from "./builtins.ts";
export {type Checked, check} from "./check.ts";
export {complete} from "./complete.ts";
export {shapeLines, typeOf} from "./decode.ts";
export {parse} from "./grammar.ts";
export {EMPTY, type Jobs} from "./jobs.ts";
// What tsh starts, and from where.
export {JobStorage, type ProgramList, Programs, programList, statusOf} from "./programs.ts";
// tsh itself, as a program: lines in, printed values out.
export {type Printed, type Ready, tsh} from "./shell.ts";
// How a value is shown on a line, and named in a trace's title.
export type {Show} from "./short.ts";
// Its own small programs: say, seq, double, upper, sleep, true, false, tally.
export {SMALL} from "./small.ts";
export {type Short, Shorten} from "./title.ts";
