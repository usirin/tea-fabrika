// Experiment 87, kamp-us/demlik issue 686: the glue for composition-root.feature.
// Copied to `packages/code-graph/scen87/686-composition-root/` in a scratch
// checkout, so `../../src` is code-graph's source. The gate is driven through
// `boundaryRepo`, the helper the issue names, which calls the CLI's own gate.
import {existsSync, readFileSync} from "node:fs";
import {After} from "quickpickle";
import {
	type BoundaryRepo,
	boundaryRepo,
	type GateRun,
} from "../../src/test-helpers/boundary-repo.ts";
import {expectThat, Given, need, type Problems, Then, When, type World} from "../lib/moves.ts";

const SCOPE = "services/shop";
const KIND = "test-reaches-composition-root";
const at = (rel: string) => `${SCOPE}/${rel}`;
const FEATURES = ["orders", "billing", "catalog"] as const;
const pad = (n: number) => String(n).padStart(3, "0");

function shop(): Record<string, string> {
	const files: Record<string, string> = {
		"tsconfig.json": JSON.stringify({
			compilerOptions: {module: "esnext", moduleResolution: "bundler", strict: true},
		}),
		[at("package.json")]: JSON.stringify({name: "@shop/shop"}),
		[at("tsconfig.json")]: JSON.stringify({
			compilerOptions: {module: "esnext", moduleResolution: "bundler", strict: true},
			include: ["src"],
		}),
		[at("src/index.ts")]:
			'import { schema } from "./schema";\n\nexport default { fetch: () => schema };\n',
		[at("src/schema.ts")]:
			`${FEATURES.map((f) => `import { name as ${f} } from "./${f}/index";`).join("\n")}\n\nexport const schema = [${FEATURES.join(", ")}];\n`,
		[at("src/test-support/harness.ts")]:
			'import { server } from "./server";\n\nexport const harness = () => server();\n',
		[at("src/test-support/server.ts")]:
			'import { schema } from "../schema";\n\nexport const server = () => schema;\n',
		[at("src/index.test.ts")]: 'import worker from "./index";\n\nexport const t = worker;\n',
		[at("src/orders/application/types-a.test.ts")]:
			'import type { schema } from "../../schema";\n\nexport type T = typeof schema;\n',
		[at("src/orders/application/types-b.test.ts")]:
			'import { type schema } from "../../schema";\n\nexport type U = typeof schema;\n',
		[at("src/lib/boot.ts")]:
			'import { schema } from "../schema";\n\nexport const boot = () => schema;\n',
	};
	FEATURES.forEach((f, i) => {
		files[at(`src/${f}/index.ts`)] = `export const name = "${f}";\n`;
		files[at(`src/${f}/application/use.ts`)] = "export const use = (n: number): number => n + 1;\n";
		for (let n = 1; n <= 40; n++) {
			files[at(`src/${f}/application/case-${pad(i * 40 + n)}.test.ts`)] =
				'import { harness } from "../../test-support/harness";\n\nexport const t = harness();\n';
		}
	});
	for (let n = 1; n <= 100; n++) {
		const f = FEATURES[n % 3] ?? "orders";
		files[at(`src/${f}/application/clean-${pad(n)}.test.ts`)] =
			'import { use } from "./use";\n\nexport const t = use(1);\n';
	}
	return files;
}

const baseRules = () => ({
	features: {[SCOPE]: [...FEATURES]},
	testFiles: ["**/*.test.ts", "**/test-support/**"],
	compositionRoots: ["src/index.ts", "src/schema.ts"] as readonly string[] | undefined,
});

/** The repo, made on first use from the files and rules the Givens set. */
function repoOf(world: World): BoundaryRepo {
	if (world.data.repo === undefined) {
		const {compositionRoots, ...rest} = need<ReturnType<typeof baseRules>>(world, "rules");
		const rules = compositionRoots === undefined ? rest : {...rest, compositionRoots};
		world.data.repo = boundaryRepo(".", need<Record<string, string>>(world, "files"), rules);
	}
	return world.data.repo as BoundaryRepo;
}

After((world: World) => {
	(world.data.repo as BoundaryRepo | undefined)?.dispose();
});

// ------------------------------------------------------------ Given

Given("act", "the shop fixture", (world) => {
	world.data.files = shop();
});

Given(
	"act",
	"the rules list the features, testFiles {string} and {string}, and compositionRoots {string} and {string}",
	(world) => {
		world.data.rules = baseRules();
	},
);

Given("act", "the rules list compositionRoots {string} only", (world, glob) => {
	world.data.rules = {...baseRules(), compositionRoots: [String(glob)]};
});

Given("act", "the rules list no compositionRoots", (world) => {
	world.data.rules = {...baseRules(), compositionRoots: undefined};
});

Given("act", "the rules list compositionRoots {} and testFiles {}", (world, roots, tests) => {
	const testFiles = JSON.parse(String(tests)) as string[];
	world.data.rules = {
		features: {[SCOPE]: [...FEATURES]},
		...(testFiles.length > 0 ? {testFiles} : {}),
		compositionRoots: JSON.parse(String(roots)) as string[],
	};
});

Given(
	"act",
	"a test {string} that imports the harness and {string}, which imports src\\/schema.ts",
	(world, test, helper) => {
		const files = need<Record<string, string>>(world, "files");
		files[at(String(helper))] =
			'import { schema } from "../schema";\n\nexport const other = () => schema;\n';
		files[at(String(test))] =
			'import { harness } from "../../test-support/harness";\nimport { other } from "../../test-support/other";\n\nexport const t = [harness(), other()];\n';
		world.data.twoRoutes = at(String(test));
	},
);

// ------------------------------------------------------------ When

/** Store a run where the shared "it exits {int}" step reads it, with `out` beside the gate's fields. */
const keep = (world: World, run: GateRun) => {
	world.data.ran = {...run, out: `${run.stdout}\n${run.errors.join("\n")}`};
	return run;
};

When("act", "I run the gate with --json", (world) => {
	keep(world, repoOf(world).run({json: true}));
});

When("act", "I run the gate with --ci", (world) => {
	keep(world, repoOf(world).run({ci: true}));
});

When("act", "I run the gate with no flags", (world) => {
	keep(world, repoOf(world).run());
});

When("act", "I run the gate with --ci twice", (world) => {
	const repo = repoOf(world);
	world.data.ledgerBefore = readFileSync(repo.ledgerFile, "utf8");
	world.data.twice = [repo.run({ci: true}), repo.run({ci: true})];
});

When("act", "I accept the crossings with the reason {string}", (world, reason) => {
	keep(world, repoOf(world).run({acceptCrossings: true, reason: String(reason)}));
});

When("act", "I add a 121st test that imports the harness", (world) => {
	repoOf(world).put(
		"services/shop/src/orders/application/case-121.test.ts",
		'import { harness } from "../../test-support/harness";\n\nexport const t = harness();\n',
	);
});

When("act", "I remove that test", (world) => {
	repoOf(world).remove("services/shop/src/orders/application/case-121.test.ts");
});

When("act", "server.ts stops importing src\\/schema.ts", (world) => {
	repoOf(world).put(at("src/test-support/server.ts"), "export const server = () => [];\n");
});

When("act", "the test {string} imports only the harness", (world) => {
	repoOf(world).put(
		need<string>(world, "twoRoutes"),
		'import { harness } from "../../test-support/harness";\n\nexport const t = harness();\n',
	);
});

When("act", "the test {string} also imports {string}", (world) => {
	repoOf(world).put(
		need<string>(world, "twoRoutes"),
		'import { harness } from "../../test-support/harness";\nimport { boot } from "../../lib/boot";\n\nexport const t = [harness(), boot()];\n',
	);
});

// ------------------------------------------------------------ Then

type Row = {readonly kind: string; readonly from: string; readonly to: string | null};

function rowsOf(world: World): Row[] {
	const run = need<GateRun>(world, "ran");
	try {
		const report = JSON.parse(run.stdout) as {scopes: {violations: Row[]}[]};
		return report.scopes.flatMap((s) => s.violations).filter((v) => v.kind === KIND);
	} catch {
		throw new Error(
			`the gate printed no JSON report (exit ${run.code}): ${run.errors.join(" | ")}`,
		);
	}
}

Then("check", "it lists {int} rows of kind {string}", (world, n) => {
	const rows = rowsOf(world);
	return expectThat(rows.length === n, `it lists ${rows.length} rows of kind ${KIND}, not ${n}`);
});

Then("check", "{int} of them go from a case test to {string}", (world, n, to) => {
	const rows = rowsOf(world).filter((r) => /\/case-\d+\.test\.ts$/.test(r.from) && r.to === to);
	return expectThat(rows.length === n, `${rows.length} case tests go to ${to}, not ${n}`);
});

Then("check", "one goes from {string} to {string}", (world, from, to) => {
	const rows = rowsOf(world).filter((r) => r.from === from && r.to === to);
	return expectThat(rows.length === 1, `${rows.length} rows go from ${from} to ${to}, not 1`);
});

Then(
	"check",
	"the test {string} has {int} rows, one to {string} and one to {string}",
	(world, test, n, a, b) => {
		const rows = rowsOf(world).filter((r) => r.from.endsWith(`/${test}`));
		const tos = rows.map((r) => r.to ?? "").sort();
		return expectThat(
			rows.length === n &&
				tos.some((t) => t.endsWith(`/${a}`)) &&
				tos.some((t) => t.endsWith(`/${b}`)),
			`${test} has rows to ${JSON.stringify(tos)}`,
		);
	},
);

// "it exits {int}" is the shared step in lib/common.ts: `keep` stores `out` for it.

const b20Lines = (stdout: string) =>
	stdout.split("\n").filter((l) => /\bB20 /.test(l) && l.includes(KIND));

Then("check", "it lists {int} entries for rule B20", (world, n) => {
	const lines = b20Lines(need<GateRun>(world, "ran").stdout);
	return expectThat(lines.length === n, `it lists ${lines.length} B20 entries, not ${n}`);
});

Then("check", "it lists {int} entry for rule B20, for {string}", (world, n, name) => {
	const lines = b20Lines(need<GateRun>(world, "ran").stdout);
	return expectThat(
		lines.length === n && lines.every((l) => l.includes(`/${name}`)),
		`it lists ${JSON.stringify(lines)}`,
	);
});

Then("check", "both runs exit 0 and the ledger did not change", (world) => {
	const runs = need<GateRun[]>(world, "twice");
	const after = readFileSync(repoOf(world).ledgerFile, "utf8");
	return [
		...runs.flatMap((r, i) => expectThat(r.code === 0, `run ${i + 1} exited ${r.code}`)),
		...expectThat(after === need<string>(world, "ledgerBefore"), "the ledger bytes changed"),
	];
});

type Entry = {readonly kind: string; readonly from: string; readonly to: string | null};
const ledger = (world: World): Entry[] =>
	(JSON.parse(readFileSync(repoOf(world).ledgerFile, "utf8")) as {entries: Entry[]}).entries;

Then("check", "the ledger keeps {int} entry for rule B20, from {string}", (world, n, from) => {
	const entries = ledger(world).filter((e) => e.kind === KIND);
	return expectThat(
		entries.length === n && entries.every((e) => e.from === from),
		`the ledger keeps ${JSON.stringify(entries.map((e) => `${e.from} -> ${e.to}`))}`,
	);
});

Then("check", "the ledger has no entry from {string} to {string}", (world, from, to) => {
	const found = ledger(world).filter(
		(e) => e.from.endsWith(`/${from}`) && (e.to ?? "").endsWith(`/${to}`),
	);
	return expectThat(found.length === 0, `the ledger still has ${JSON.stringify(found)}`);
});

Then("check", "its output has the line {string}", (world, line) => {
	const out = need<GateRun>(world, "ran").stdout;
	return expectThat(
		out.split("\n").some((l) => l.includes(String(line))),
		`no line holds ${line}; B20 lines: ${JSON.stringify(b20Lines(out).slice(0, 3))}`,
	);
});

Then("check", "its output never says {string}", (world, text) => {
	const run = need<GateRun>(world, "ran");
	return expectThat(
		!`${run.stdout}${run.errors.join("\n")}`.includes(String(text)),
		`the output says ${text}`,
	);
});

Then("check", "no ledger was written", (world) =>
	expectThat(!existsSync(repoOf(world).ledgerFile), "a ledger file was written"),
);

const errorLines = (world: World) =>
	need<GateRun>(world, "ran")
		.errors.flatMap((e) => e.split("\n"))
		.filter((l) => l.trim() !== "");

Then("check", "one error line names {string}", (world, key): Problems => {
	const errors = errorLines(world);
	const naming = errors.filter((l) => l.includes(String(key)));
	return expectThat(
		errors.length === 1 && naming.length === 1,
		`the error lines are ${JSON.stringify(errors)}`,
	);
});

Then(
	"check",
	"that line also names {string}, the reason it cannot work",
	(world, reason): Problems => {
		const errors = errorLines(world);
		return expectThat(
			errors.some((l) => l.includes("compositionRoots") && l.includes(String(reason))),
			`no error line names both compositionRoots and ${reason}: ${JSON.stringify(errors)}`,
		);
	},
);
