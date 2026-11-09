// Today's version, T245 PR 3. Read CSS in place; retain every fire, including known debt.
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync, readdirSync, writeFileSync} from "node:fs";
import {devNull} from "node:os";
import {join} from "node:path";
import stylelint from "stylelint";
import base from "../stylelint.config.ts";

const config = {
	...base,
	rules: Object.fromEntries(
		Object.entries(base.rules).map(([rule, [on, options]]) => [
			rule,
			[on, {...options, known: []}],
		]),
	),
};
const MAIN = "e95bfd79";
const tracked = spawnSync("git", ["ls-files", "-z", "--", "apps", "packages", "programs"], {
	encoding: "utf8",
});
if (tracked.status !== 0) throw new Error(tracked.stderr);
const tree = tracked.stdout.split("\0").filter((file) => file.endsWith(".css"));
const manti = "apps/fabrika/node_modules/@manti-ui/styles/dist";
const outside = [
	...readdirSync(manti)
		.filter((file) => file.endsWith(".css"))
		.sort()
		.map((file) => `${manti}/${file}`),
	"apps/fabrika/node_modules/@xyflow/react/dist/style.css",
	"experiments/142-web-terminals/page.css",
];
const result = [];
for (const [set, files] of [
	["main", tree],
	["tree", tree],
	["outside", outside],
] as const) {
	for (const file of files) {
		const main =
			set === "main"
				? spawnSync("git", ["show", `${MAIN}:${file}`], {encoding: "utf8"})
				: undefined;
		if (main !== undefined && main.status !== 0) throw new Error(main.stderr);
		const code = main?.stdout ?? readFileSync(file, "utf8");
		const report = await stylelint.lint({
			code,
			codeFilename: join(process.cwd(), file),
			config,
			ignorePath: devNull,
			ignoreDisables: true,
			disableDefaultIgnores: true,
		});
		const [linted] = report.results;
		if (linted === undefined || linted.parseErrors.length || linted.invalidOptionWarnings.length) {
			throw new Error(`Cannot count ${file}`);
		}
		const declarations: {
			line: number;
			column: number;
			selector: string;
			property: string;
			value: string;
		}[] = [];
		linted._postcssResult?.root.walkDecls((decl) => {
			declarations.push({
				line: decl.source?.start?.line ?? 1,
				column: decl.source?.start?.column ?? 1,
				selector: decl.parent?.type === "rule" ? decl.parent.selector : "",
				property: decl.prop,
				value: decl.value,
			});
		});
		const fires = linted.warnings.map((warning) => {
			const decl = declarations.find(
				({line, column}) => line === warning.line && column === warning.column,
			);
			if (decl === undefined)
				throw new Error(`Missing declaration at ${file}:${warning.line}:${warning.column}`);
			return {...decl, rule: warning.rule, detail: warning.text};
		});
		result.push({
			set,
			file,
			hash: createHash("sha256").update(code).digest("hex"),
			declarations: declarations.length,
			fires,
		});
	}
}
// Keep locations and counts, not copies of the outside stylesheets.
const saved = result.map(({fires, ...row}) => ({
	...row,
	rules: Object.keys(config.rules).map((rule) => ({
		rule,
		fires: fires
			.filter((fire) => fire.rule === rule)
			.map(({line, column, detail}) => [line, column, detail]),
	})),
}));
writeFileSync(
	"experiments/results/232-stylelint-fire-counts.json",
	`${JSON.stringify(saved, null, 2)}\n`,
);
if (process.argv.includes("--audit")) {
	for (const {set, file, fires} of result) {
		for (const fire of fires) console.log(JSON.stringify({set, file, ...fire}));
	}
}
for (const set of ["main", "tree", "outside"]) {
	const rows = result.filter((row) => row.set === set);
	console.log(
		set,
		rows.map(({declarations}) => declarations).reduce((a, b) => a + b, 0),
		"declarations",
	);
	for (const rule of Object.keys(config.rules)) {
		console.log(rule, rows.flatMap(({fires}) => fires).filter((fire) => fire.rule === rule).length);
	}
	for (const row of rows) console.log(row.file, row.declarations, row.fires.length);
}
