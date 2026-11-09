import {fabrika, fabrikaLight} from "@kampus/fabrika-design";
import {check} from "@kampus/fabrika-design/contrast";
import {decodeTheme, type Diagnostic} from "@kampus/fabrika-design/theme";
import {pairs, repair} from "@kampus/fabrika-design/theme-contract";
import {decodeThemeSettings} from "@kampus/fabrika-design/theme-settings";
import {Effect, type FileSystem, Path, Result, Stream} from "effect";
import type {AppliedTheme, ThemePolicy, ThemeReport} from "../messages.ts";
import {type Setting, settingsFile} from "./settings.ts";

// Today's app, T343 PR 1: the person's selected theme, loaded, checked and heard again on each
// save (themes.md point 4, "A person's file, nudged at load"). Both files are read by the one
// reader of the settings folder (settings.ts), so a rename save, a deletion or a failed watch is
// heard the same way the keys file's are, and a bad theme never touches the keys.
//
//   fabrika.toml          theme = "nord", theme-fix = "nudge", theme-contrast = 4.5
//   themes/nord.toml      a complete theme, decoded (theme.ts), then checked (contrast.ts) at the
//                         measured cap and repair version (tokens/repair.toml)
//
//   appliedTheme(folder)  {name: "nord", source: "file", value, version: "1",
//                          report: {name: "nord", changes, failures, diagnostics}, policy}
//   theme = "fabrika"     fabrika's own values, unchecked: the token build judged them
//   no file, or a file that does not decode
//                         fabrika, and a diagnostic naming the file and why, never its text
//
// Loading never writes a file: `fix = "nudge"` repairs what is shown, and the file stays byte for
// byte as the person wrote it. What is logged names the theme and counts, never a folder's path,
// an unrelated setting or a color.

/** The selected theme as the host loaded it, and what came of the check. */
export interface Loaded {
	/** The theme the person selected, by name. */
	readonly name: string;
	/** fabrika's own values, or the person's file. A file that did not load shows fabrika's. */
	readonly source: "builtin" | "file";
	readonly value: AppliedTheme;
	/** The repair version every check used (tokens/repair.toml). */
	readonly version: string;
	readonly report: ThemeReport;
	readonly policy: ThemePolicy;
}

type Read = ReturnType<typeof decodeThemeSettings>;
type Selected = Extract<Read, {_tag: "Success"}>["success"];

const BUILTINS = {fabrika, "fabrika-light": fabrikaLight} as const;

/** What the window is given of a theme: its decoded values, never its source or repair rows. */
const applied = (theme: {
	readonly name: string;
	readonly look: "dark" | "light";
	readonly colors: AppliedTheme["colors"];
	readonly terminal: AppliedTheme["terminal"];
}): AppliedTheme => ({
	format: 1,
	name: theme.name,
	look: theme.look,
	colors: theme.colors,
	terminal: theme.terminal,
});

/** The selection from fabrika.toml: a file that is missing, unreadable or not TOML is the defaults. */
const selected = (answer: Setting<Read>): Selected => {
	const defaults = Result.getOrThrow(decodeThemeSettings(""));
	if (answer._tag === "none") return defaults;
	if (answer._tag === "refused")
		return {
			...defaults,
			diagnostics: [{file: "fabrika.toml", field: "file", line: answer.line, message: answer.why}],
		};
	return Result.isSuccess(answer.value)
		? answer.value.success
		: {...defaults, diagnostics: [answer.value.failure]};
};

/** fabrika, or fabrika-light, as selected or in place of a file that did not load. */
const builtin = (
	s: Selected,
	name: keyof typeof BUILTINS,
	refused: readonly Diagnostic[] = [],
	pick = s.pick,
): Loaded => ({
	name: pick,
	source: "builtin",
	value: applied(BUILTINS[name]),
	version: repair.version,
	report: {name: pick, changes: [], failures: [], diagnostics: [...s.diagnostics, ...refused]},
	policy: s.policy,
});

/** The person's theme file, as the one reader answered: decoded and checked, or fabrika's and why. */
const fromFile = (s: Selected, answer: Setting<string>): Loaded => {
	const file = `${s.pick}.toml`;
	if (answer._tag === "none")
		return builtin(s, "fabrika", [
			{file, field: "theme", line: 1, message: "no theme file by that name; using fabrika"},
		]);
	if (answer._tag === "refused")
		return builtin(s, "fabrika", [{file, field: "file", line: answer.line, message: answer.why}]);
	const decoded = decodeTheme(answer.value, file);
	if (Result.isFailure(decoded)) return builtin(s, "fabrika", [decoded.failure]);
	const checked = check(decoded.success, pairs, s.policy, repair);
	return {
		name: s.pick,
		source: "file",
		value: applied(checked.shown),
		version: checked.version,
		report: {
			name: s.pick,
			changes: checked.changes,
			failures: checked.failures,
			diagnostics: s.diagnostics,
		},
		policy: s.policy,
	};
};

const isBuiltin = (pick: string): pick is keyof typeof BUILTINS => Object.hasOwn(BUILTINS, pick);

/** One wide line per load: the theme, where it came from and what the check did, by count. */
const logged = (loaded: Loaded) =>
	Effect.logInfo("theme_loaded").pipe(
		Effect.annotateLogs({
			theme: loaded.name,
			source: loaded.source,
			version: loaded.version,
			fix: loaded.policy.fix,
			contrast: loaded.policy.contrast,
			moved: new Set(loaded.report.changes.flatMap((c) => (c._tag === "moved" ? [c.token] : [])))
				.size,
			builtin: loaded.report.changes.filter((c) => c._tag === "builtin").length,
			failures: loaded.report.failures.length,
			diagnostics: loaded.report.diagnostics.map((d) => `${d.file} ${d.field}`).join(", "),
		}),
	);

/**
 * The selected theme now, then again each time fabrika.toml or that theme's file changes. A new
 * selection drops the old file's watch.
 */
export const appliedTheme = (
	folder: string,
): Stream.Stream<Loaded, never, FileSystem.FileSystem | Path.Path> =>
	Stream.unwrap(
		Effect.map(Path.Path, (path) =>
			settingsFile(folder, "fabrika.toml", (text) =>
				Result.succeed(decodeThemeSettings(text)),
			).pipe(
				Stream.map(selected),
				Stream.changesWith((a, b) => JSON.stringify(a) === JSON.stringify(b)),
				Stream.switchMap((s): Stream.Stream<Loaded, never, FileSystem.FileSystem | Path.Path> =>
					isBuiltin(s.pick)
						? Stream.succeed(builtin(s, s.pick))
						: settingsFile(path.join(folder, "themes"), `${s.pick}.toml`, (text) =>
								Result.succeed(text),
							).pipe(Stream.map((answer) => fromFile(s, answer))),
				),
				Stream.tap(logged),
			),
		),
	);
