import type {Selection} from "@kampus/libfabrika/build";

// The programs this app runs. Each package's pure `.` entry holds the declaration; a window, when a
// program has one, stays on its package's `./window`. The build embeds both in the brain file.
export const programs: ReadonlyArray<Selection> = [
	{name: "counter", package: "@kampus/counter", export: "counter"},
];
