// Today's app, T204 PR 1. Root config, no known debt, ignores or disable comments.
// Raw reports stay private. The lead owns the public summary and written judgments.
import {spawnSync} from "node:child_process";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {devNull} from "node:os";
import {dirname, join} from "node:path";
import stylelint from "stylelint";
import base from "../stylelint.config.ts";

const arg = (name: string, fallback: string) => {
	const at = process.argv.indexOf(name);
	return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
};
const pinned = arg("--base", "9f126695");
const output = arg("--out", "runs/240-layer-fire-counts.json");
const config = {
	...base,
	rules: Object.fromEntries(
		Object.entries(base.rules).map(([name, [on, options]]) => [
			name,
			[on, {...options, known: []}],
		]),
	),
};
const git = (...args: string[]) => {
	const result = spawnSync("git", args, {encoding: "utf8"});
	if (result.status !== 0) throw new Error(result.stderr);
	return result.stdout;
};
const paths = git("ls-files", "-z", "--", "apps", "packages", "programs")
	.split("\0")
	.filter((path) => path.endsWith(".css"));
const rows = [];
for (const set of ["base", "tree", "good", "bad"] as const) {
	const files =
		set === "base" || set === "tree"
			? paths
			: [`oxlint-plugins/css/fixtures/${set}/frame-layers.css`];
	for (const path of files) {
		const code = set === "base" ? git("show", `${pinned}:${path}`) : readFileSync(path, "utf8");
		const filename =
			set === "good"
				? "apps/fabrika/src/window/window.css"
				: set === "bad"
					? "programs/layer-plant/window.css"
					: path;
		const report = await stylelint.lint({
			code,
			codeFilename: join(process.cwd(), filename),
			config,
			ignorePath: devNull,
			ignoreDisables: true,
			disableDefaultIgnores: true,
		});
		const result = report.results[0];
		if (result === undefined || result.parseErrors.length || result.invalidOptionWarnings.length)
			throw new Error(`Cannot count ${path}`);
		let declarations = 0;
		result._postcssResult?.root.walkDecls(() => {
			declarations++;
		});
		rows.push({
			set,
			path,
			declarations,
			fires: result.warnings.filter((warning) => warning.rule === "fabrika/frame-layers"),
		});
	}
}
mkdirSync(dirname(output), {recursive: true});
writeFileSync(output, `${JSON.stringify({base: pinned, rows}, null, 2)}\n`);
const summary = Object.fromEntries(
	["base", "tree", "good", "bad"].map((set) => {
		const matching = rows.filter((row) => row.set === set);
		return [
			set,
			{
				files: matching.length,
				declarations: matching.reduce((n, row) => n + row.declarations, 0),
				fires: matching.reduce((n, row) => n + row.fires.length, 0),
			},
		];
	}),
);
console.log(JSON.stringify({base: pinned, summary}, null, 2));
if (process.argv.includes("--audit"))
	for (const row of rows)
		for (const fire of row.fires)
			console.log(JSON.stringify({set: row.set, path: row.path, ...fire}));
// The base has three raw ranks and no required frame table, so all four fires are real.
if (summary.base?.fires !== 4 || summary.good?.fires !== 0 || summary.bad?.fires !== 6)
	process.exitCode = 1;
if (process.argv.includes("--assert-clean") && summary.tree?.fires !== 0) process.exitCode = 1;
