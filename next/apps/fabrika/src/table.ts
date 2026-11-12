import type { Selection } from "@kampus/libfabrika/build";

// The programs this app runs. Each package's pure `.` entry holds the declaration; a window, when a
// program has one, stays on its package's `./window`. The build embeds both in the brain file. Each
// name is `pack/program` (0083), and the shipped programs are the core pack, `fabrika`.
export const programs: ReadonlyArray<Selection> = [
  { name: "fabrika/counter", package: "@kampus/counter", export: "counter" },
  { name: "fabrika/checklist", package: "@kampus/checklist", export: "checklist" },
];
