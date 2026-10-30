// tsh's parts that run anywhere, as one module: `Shell` on the top level of
// `@kampus/fabrika`, read as `Shell.programList`, `Shell.tsh`. A module, like
// `Call` and `Monitor`: its names (`check`, `parse`, `EMPTY`, `helpOf`) are
// the shell's, and would say too little on the flat list beside the host's.
//
// It is what an app hands tsh and what it tests its lines with. The launcher
// that holds the terminal, `runTsh`, reads Node's process and is on
// `@kampus/fabrika/shell`.
//
//   import {listed, Shell} from "@kampus/fabrika";
//   const programs = Shell.programList([...Shell.SMALL, listed(hello, Layer.empty)]);

// The host's job table, as tsh shows it. The host's jobs themselves (`HostJobs`, `openJobs`) are
// on the top level, beside the rest of the host.
export {EMPTY, type Job, type Jobs, type JobsMsg} from "../host/jobs.ts";
// A line, read the way tsh reads it before anything starts: for an app's own tests of its lines.
export {type Checked, check} from "./check.ts";
export {complete} from "./complete.ts";
export {shapeLines, typeOf} from "./decode.ts";
export {parse} from "./grammar.ts";
// What `<program> --help` prints: the whole help, or one part of it whole.
export {helpOf, partsHelp} from "./help.ts";
// What tsh starts.
export {type ProgramList, Programs, programList, statusOf} from "./programs.ts";
// Ctrl-R, bash's reverse-i-search: a key in, the search after it out. For a line editor of an
// app's own (apps/fabrika's), so tsh searches its history the same way in both.
export * as Search from "./search.ts";
// tsh itself, as a program: lines in, printed values out. Two of its outputs' schemas too, for an
// app that builds its own schemas on them (apps/fabrika's pane view).
export {Printed, Ready, tsh} from "./shell.ts";
// How a value is shown on a line, and named in a trace's title.
export type {Show} from "./short.ts";
// Its own small programs: say, seq, double, upper, sleep, true, false, tally.
export {SMALL} from "./small.ts";
// A table for a person, as tsh hands it out on `table`: laid out by a terminal at its own width,
// then painted in its own colors (apps/fabrika's line editor does both).
export {type Palette, paint, type Table, tableLines} from "./table.ts";
export {type Short, Shorten} from "./title.ts";
