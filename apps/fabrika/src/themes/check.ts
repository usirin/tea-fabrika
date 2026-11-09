import {homedir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {NodeRuntime, NodeServices} from "@effect/platform-node";
import {Console, Effect, type FileSystem, Logger, Option, type Path, Stream} from "effect";
import {appliedTheme} from "../host/themes.ts";
import type {ThemeReport} from "../messages.ts";

// `theme-check`: the report the window's bottom line sums up, in full, for the theme the person
// selected, with nothing written (themes.md point 4, "any time, through the check command"). The
// host's own loader makes it (host/themes.ts), so the command and the window cannot disagree.
//
//   node apps/fabrika/src/themes/check.ts
//   theme "nord": 4 colors moved, 3 use fabrika's, 7 still failing
//     moved closed on surface-selected/surface: #b6bbc4 -> #c6ccd5 (WCAG 4.21, Lc 50.4 -> WCAG 5.02, Lc 60.2)
//     fabrika's stuck: #bf616a -> #ffd1d9, past the cap
//     failing focus on surface-hover/surface: WCAG 2.89, Lc 29.0, under WCAG 3 and Lc 15
//   exit 0 when nothing is left failing, 1 when a pair still fails or the file was not applied
//
// It reads the settings folder the host reads: FABRIKA_SETTINGS when set (a test's or an agent's
// home), else the owner's ~/.fabrika. It prints colors, since they are the person's own; it never
// prints a path or another setting.

/** The report for the theme selected now: what the window would apply, and why. */
export const themeCheck = (
	folder: string,
): Effect.Effect<ThemeReport, never, FileSystem.FileSystem | Path.Path> =>
	appliedTheme(folder).pipe(
		Stream.runHead,
		Effect.map(
			Option.match({
				onNone: () => ({name: "fabrika", changes: [], failures: [], diagnostics: []}),
				onSome: (loaded) => loaded.report,
			}),
		),
	);

const reading = (r: {readonly wcag: number; readonly apca: number}) =>
	`WCAG ${r.wcag.toFixed(2)}, Lc ${Math.abs(r.apca).toFixed(1)}`;

/** The report as lines: a summary first, then one line for each change, failure and refusal. */
export const reportLines = (report: ThemeReport): readonly string[] => {
	const moved = new Set(report.changes.flatMap((c) => (c._tag === "moved" ? [c.token] : []))).size;
	const builtin = report.changes.filter((c) => c._tag === "builtin").length;
	const parts = [
		...(moved === 0 ? [] : [`${moved} ${moved === 1 ? "color" : "colors"} moved`]),
		...(builtin === 0 ? [] : [`${builtin} ${builtin === 1 ? "uses" : "use"} fabrika's`]),
		...(report.failures.length === 0 ? [] : [`${report.failures.length} still failing`]),
		...(report.diagnostics.length === 0 ? [] : ["not as written"]),
	];
	return [
		`theme "${report.name}": ${parts.length === 0 ? "reads, nothing moved" : parts.join(", ")}`,
		...report.changes.map((c) =>
			c._tag === "moved"
				? `  moved ${c.token} on ${c.on}: ${c.was} -> ${c.now} (${reading(c.from)} -> ${reading(c.to)})`
				: `  fabrika's ${c.token}: ${c.was} -> ${c.now}, past the cap`,
		),
		...report.failures.map(
			(f) =>
				`  failing ${f.token} on ${f.on}: ${reading(f.reading)}, under WCAG ${f.floor.wcag} and Lc ${f.floor.apca}`,
		),
		...report.diagnostics.map((d) => `  ${d.file} line ${d.line}, ${d.field}: ${d.message}`),
	];
};

if (process.argv[1] === fileURLToPath(import.meta.url))
	NodeRuntime.runMain(
		Effect.gen(function* () {
			const folder = process.env["FABRIKA_SETTINGS"] ?? join(homedir(), ".fabrika");
			const report = yield* themeCheck(folder);
			for (const line of reportLines(report)) yield* Console.log(line);
			if (report.failures.length > 0 || report.diagnostics.length > 0) process.exitCode = 1;
		}).pipe(
			// The host's own log line is for the host's log, not this command's output.
			Effect.provide([NodeServices.layer, Logger.layer([])]),
		),
	);
