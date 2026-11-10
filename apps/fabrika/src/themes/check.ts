import {homedir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {NodeRuntime, NodeServices} from "@effect/platform-node";
import {Console, Effect, type FileSystem, Logger, Option, type Path, Stream} from "effect";
import {appliedTheme, type Loaded} from "../host/themes.ts";
import type {ThemePolicy, ThemeReport} from "../messages.ts";

// `theme-check`: the report the window's bottom line sums up, in full, for the theme the person
// selected, with nothing written (themes.md point 4, "any time, through the check command"). The
// host's own loader makes it (host/themes.ts), so the command and the window cannot disagree.
//
//   node apps/fabrika/src/themes/check.ts
//   theme "nord": 4 colors moved, 3 use fabrika's, 7 still failing
//   theme "nord": 4 colors would move, 3 would use fabrika's, 40 failing     (theme-fix = "off")
//     moved closed on surface-selected/surface: #b6bbc4 -> #c6ccd5 (WCAG 4.21, Lc 50.4 -> WCAG 5.02, Lc 60.2)
//     fabrika's stuck: #bf616a -> #ffd1d9, past the cap
//     failing focus on surface-hover/surface: WCAG 2.89, Lc 29.0, under WCAG 3 and Lc 15
//   exit 0 when nothing is left failing, 1 when a pair still fails or the file was not applied
//
// It reads the settings folder the host reads: FABRIKA_SETTINGS when set (a test's or an agent's
// home), else the owner's ~/.fabrika. It prints colors, since they are the person's own; it never
// prints a path or another setting.

/** The theme selected now as the host loads it, or none: fabrika's own, clean. */
const loadedNow = (folder: string) => appliedTheme(folder).pipe(Stream.runHead);
const reportOf = (loaded: Option.Option<Loaded>): ThemeReport =>
	Option.match(loaded, {
		onNone: () => ({name: "fabrika", changes: [], failures: [], diagnostics: []}),
		onSome: (l) => l.report,
	});

/** The report for the theme selected now: what the window would apply, and why. */
export const themeCheck = (
	folder: string,
): Effect.Effect<ThemeReport, never, FileSystem.FileSystem | Path.Path> =>
	loadedNow(folder).pipe(Effect.map(reportOf));

const reading = (r: {readonly wcag: number; readonly apca: number}) =>
	`WCAG ${r.wcag.toFixed(2)}, Lc ${Math.abs(r.apca).toFixed(1)}`;

/**
 * The report as lines: a summary first, then one line for each change, failure and refusal. Under
 * `theme-fix = "off"` nothing moved and the changes are what nudge would do, so they say "would".
 */
export const reportLines = (report: ThemeReport, policy?: ThemePolicy): readonly string[] => {
	const off = policy?.fix === "off";
	const moved = new Set(report.changes.flatMap((c) => (c._tag === "moved" ? [c.token] : []))).size;
	const builtin = report.changes.filter((c) => c._tag === "builtin").length;
	const colors = moved === 1 ? "color" : "colors";
	const parts = [
		...(moved === 0 ? [] : [`${moved} ${colors} ${off ? "would move" : "moved"}`]),
		...(builtin === 0
			? []
			: [`${builtin} ${off ? "would use" : builtin === 1 ? "uses" : "use"} fabrika's`]),
		...(report.failures.length === 0
			? []
			: [`${report.failures.length} ${off ? "failing" : "still failing"}`]),
		...(report.diagnostics.length === 0 ? [] : ["not as written"]),
	];
	return [
		`theme "${report.name}": ${parts.length === 0 ? "reads, nothing moved" : parts.join(", ")}`,
		...report.changes.map((c) =>
			c._tag === "moved"
				? `  ${off ? "would move" : "moved"} ${c.token} on ${c.on}: ${c.was} -> ${c.now} (${reading(c.from)} -> ${reading(c.to)})`
				: `  ${off ? "would use " : ""}fabrika's ${c.token}: ${c.was} -> ${c.now}, past the cap`,
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
			// The policy the report was made under: under theme-fix = "off" its changes did not happen.
			// A second load, so a save between the two can pair them wrong for one run; the next run
			// reads both again.
			const policy = Option.getOrUndefined(
				Option.map(yield* loadedNow(folder), (loaded) => loaded.policy),
			);
			for (const line of reportLines(report, policy)) yield* Console.log(line);
			if (report.failures.length > 0 || report.diagnostics.length > 0) process.exitCode = 1;
		}).pipe(
			// The host's own log line is for the host's log, not this command's output.
			Effect.provide([NodeServices.layer, Logger.layer([])]),
		),
	);
