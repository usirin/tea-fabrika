// Experiment 87, kamp-us/demlik issue 709: the glue for move-extensions.feature.
// Copied to `packages/structure-sweep/scen87/709-move-extensions/` in a
// scratch checkout, so `../../src` is structure-sweep's source.
import {existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, relative} from "node:path";
import {vi} from "vitest";
import {moveCommand} from "../../src/move/cli.ts";
import {git, scratchRepo, typecheck} from "../lib/common.ts";
import {expectThat, Given, need, Then, When, type World} from "../lib/moves.ts";

const MOVES = [
	{from: "app/src/lib/check.ts", to: "app/src/core/check.ts"},
	{from: "app/src/lib/format.ts", to: "app/src/core/format.ts"},
	{from: "app/src/app/runner.ts", to: "app/src/jobs/runner.ts"},
];

/** The package: three files that move, four importers, two files that stay. */
function fixture(ext: string, nodeNext: boolean): Record<string, string> {
	const compilerOptions = nodeNext
		? {module: "NodeNext", moduleResolution: "NodeNext", allowImportingTsExtensions: ext === ".ts"}
		: {module: "ESNext", moduleResolution: "Bundler"};
	return {
		"app/package.json": JSON.stringify({name: "app", type: "module"}),
		"app/tsconfig.json": JSON.stringify({
			compilerOptions: {
				...compilerOptions,
				strict: true,
				noEmit: true,
				skipLibCheck: true,
				types: [],
			},
			include: ["src"],
		}),
		"app/src/lib/check.ts": "export const check = (n: number): boolean => n > 0;\n",
		"app/src/lib/format.ts": `import { size } from "../x/index${ext}";\n\nexport const format = (n: number): string => \`\${n}/\${size}\`;\n`,
		"app/src/x/index.ts": "export const size = 3;\n",
		"app/src/reviewer.ts": "export interface Reviewer {\n  readonly name: string;\n}\n",
		"app/src/app/runner.ts": `import { check } from "../lib/check${ext}";\n\nexport const run = (r: import("../reviewer${ext}").Reviewer): boolean => check(r.name.length);\n`,
		"app/src/main.ts": `import { check } from "./lib/check${ext}";\nimport { format } from "./barrel${ext}";\n\nexport const main = (): string => (check(1) ? format(1) : "");\n`,
		"app/src/barrel.ts": `export { format } from "./lib/format${ext}";\n`,
		"app/src/lazy.ts": `export const load = () => import("./app/runner${ext}");\n`,
		"app/src/types.ts": `export type Check = typeof import("./lib/check${ext}").check;\n`,
	};
}

Given("act", "a NodeNext repository whose relative imports end in {string}", (world, ext) => {
	world.data.repo = scratchRepo(fixture(String(ext), true));
});

Given("act", "a Bundler repository whose relative imports have no extension", (world) => {
	world.data.repo = scratchRepo(fixture("", false));
});

Given("act", "a plan that moves three files named by four importers", (world) => {
	const path = join(mkdtempSync(join(tmpdir(), "scen87-plan-")), "plan.json");
	writeFileSync(path, JSON.stringify({scope: "app", moves: MOVES}));
	world.data.plan = path;
});

const commits = (repo: string): number => Number(git(repo, "rev-list", "--count", "HEAD"));

function apply(world: World) {
	const repo = need<string>(world, "repo");
	world.data.before = commits(repo);
	const log = vi.spyOn(console, "log").mockImplementation(() => {});
	try {
		moveCommand(["apply", "--plan", need<string>(world, "plan")], repo);
	} finally {
		log.mockRestore();
	}
}

When("act", "I apply the plan", apply);
When("act", "I apply the plan again", apply);

Then("check", "the repository gained one rename commit and then one rewrite commit", (world) => {
	const repo = need<string>(world, "repo");
	const gained = commits(repo) - need<number>(world, "before");
	if (gained !== 2) return [`the apply made ${gained} commits, not 2`];
	const renames = git(repo, "diff", "--name-status", "-M100%", "HEAD~2", "HEAD~1").split("\n");
	const rewrites = git(repo, "diff", "--name-status", "HEAD~1", "HEAD").split("\n");
	return [
		...renames
			.filter((l) => !l.startsWith("R100"))
			.map((l) => `the first commit is not only renames: ${l}`),
		...rewrites
			.filter((l) => !l.startsWith("M\t"))
			.map((l) => `the second commit is not only edits: ${l}`),
	];
});

Then("check", "the repository gained no commit", (world) => {
	const gained = commits(need<string>(world, "repo")) - need<number>(world, "before");
	return expectThat(gained === 0, `the second apply made ${gained} commits`);
});

const SPECIFIER = /(?:from\s*|import\s*\(\s*)"(\.{1,2}\/[^"]+)"/g;

function sources(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? sources(path) : path.endsWith(".ts") ? [path] : [];
	});
}

/** Every relative specifier in the package, with the file it sits in. */
function specifiers(world: World) {
	const repo = need<string>(world, "repo");
	return sources(join(repo, "app", "src")).flatMap((file) =>
		[...readFileSync(file, "utf8").matchAll(SPECIFIER)].map((m) => ({
			file: relative(repo, file),
			at: file,
			spec: m[1] ?? "",
		})),
	);
}

Then("check", "every relative specifier in the package ends in {string}", (world, ext) => {
	const all = specifiers(world);
	return [
		...expectThat(all.length === 8, `${all.length} specifiers found, not the fixture's 8`),
		...all
			.filter((s) => !s.spec.endsWith(String(ext)))
			.map((s) => `${s.file} names "${s.spec}", without ${ext}`),
	];
});

Then("check", "every relative specifier in the package has no extension", (world) =>
	specifiers(world)
		.filter((s) => /\.(ts|js)$/.test(s.spec))
		.map((s) => `${s.file} names "${s.spec}", with an extension`),
);

Then("check", "every relative specifier in the package names a file that exists", (world) =>
	specifiers(world)
		.filter((s) => {
			const base = join(dirname(s.at), s.spec);
			const tries = /\.(ts|js)$/.test(s.spec)
				? [base.replace(/\.js$/, ".ts")]
				: [`${base}.ts`, join(base, "index.ts")];
			return !tries.some(existsSync);
		})
		.map((s) => `${s.file} names "${s.spec}", which is no file`),
);

Then("check", "tsc --noEmit passes over the package", (world) =>
	typecheck(join(need<string>(world, "repo"), "app", "tsconfig.json")).map(
		(d) => `${d.file}:${d.line} ${d.code} ${d.text}`,
	),
);

Then("check", "the moved file {string} names {string} in a type position", (world, path, spec) => {
	const body = readFileSync(join(need<string>(world, "repo"), String(path)), "utf8");
	return expectThat(
		body.includes(`import("${spec}").`),
		`${path} has no import("${spec}") type:\n${body}`,
	);
});

Then("check", "the moved file {string} names {string}", (world, path, spec) => {
	const body = readFileSync(join(need<string>(world, "repo"), String(path)), "utf8");
	return expectThat(body.includes(`"${spec}"`), `${path} does not name "${spec}":\n${body}`);
});
