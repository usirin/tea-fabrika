// Actual oxlint, disposable app entries, generated names and positive plants.
import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {Arbitrary, Effect, Schema} from "effect";
import {describe, expect, it} from "vitest";

const root = resolve(import.meta.dirname, "..");
const paths = [
	"build.ts",
	"alchemy.run.ts",
	"src/build.ts",
	"src/runtime.ts",
	"src/table.ts",
	"src/entry/electron-main.ts",
];
const run = (text: string, entry = "alchemy.run.ts") => {
	const home = realpathSync(mkdtempSync("/tmp/p24-lint-"));
	try {
		mkdirSync(join(home, "next/apps/fabrika/src/entry"), {recursive: true});
		symlinkSync(join(root, "oxlint-plugins"), join(home, "oxlint-plugins"));
		writeFileSync(
			join(home, ".oxlintrc.json"),
			JSON.stringify({
				categories: {correctness: "off"},
				jsPlugins: ["./oxlint-plugins/wiring-only.ts"],
				rules: {"fabrika-wiring/wiring-only": "error"},
			}),
		);
		const path = `next/apps/fabrika/${entry}`;
		writeFileSync(join(home, path), text);
		const result = spawnSync(
			join(root, "node_modules/.bin/oxlint"),
			["--config", join(home, ".oxlintrc.json"), "--no-ignore", "--format=json", path],
			{cwd: home, encoding: "utf8"},
		);
		const report: {number_of_files: number; diagnostics: {code?: string; message: string}[]} =
			JSON.parse(result.stdout);
		expect(report.number_of_files).toBe(1);
		return report.diagnostics.filter((d) => d.code === "fabrika-wiring(wiring-only)");
	} finally {
		rmSync(home, {recursive: true, force: true});
	}
};
const runs = {arbitrary: {seed: 119120, runs: 100, size: 100}};
// This package does not depend on @effect/vitest. Use the Schema's own Arbitrary instead.
const property = (
	name: string,
	inputs: {n: typeof Schema.Int},
	check: (value: {n: number}) => void,
	options = runs,
) => {
	it(name, () =>
		Effect.runPromise(
			Arbitrary.checkEffect(
				Arbitrary.schema(Schema.Struct(inputs)),
				(value) =>
					Effect.sync(() => {
						check(value);
						return true;
					}),
				options.arbitrary,
			),
		),
	);
};
describe("P24 wiring-only", () => {
	property(
		"accepts program tables, thin build commands and the shared stack",
		{n: Schema.Int},
		({n}) => {
			const sources = [
				`import {build} from "@kampus/libfabrika/build"; export const main = build({out: "out${n}"});`,
				'import * as Alchemy from "alchemy"; import * as Cloudflare from "@alchemy.run/cloudflare"; import {Effect, Layer} from "effect"; export const stack = (built, settings) => Alchemy.Stack("fabrika", {providers: Cloudflare.providers(), state: Alchemy.localState()}, Effect.gen(function* () {return yield* Cloudflare.Workers.Worker("Brain", {main: built.brain, bundle: false, ...settings});}));',
				'export const programs = [{name: "counter", package: "@kampus/counter", export: "counter"}];',
			];
			for (const path of paths) for (const source of sources) expect(run(source, path)).toEqual([]);
		},
		{...runs, arbitrary: {...runs.arbitrary, runs: 8}},
	);
	property(
		"plants: schemas, aliased schemas, reducers, checks, folds and refusals fail in every changed entry",
		{n: Schema.Int},
		({n}) => {
			for (const source of [
				'import {Schema as S} from "effect"; export const Bad = S.Struct({n: S.Number});',
				'import * as E from "effect"; export const Bad = E.Schema.Struct({n: E.Schema.Number});',
				'import * as S from "effect/Schema"; const T = S; export const Bad = T.Struct({n: T.Number});',
				`export const step${Math.abs(n)} = (m) => [m, []];`,
				"export const run = (items) => items.reduce((a, b) => a + b, 0);",
				"export const run = (s) => s ? 1 : 0;",
				'export function start(s) {if (!s) throw new Error("refused"); return s;}',
			])
				for (const path of paths) expect(run(source, path).length).toBeGreaterThan(0);
		},
		{...runs, arbitrary: {...runs.arbitrary, runs: 8}},
	);
	property(
		"plants: remote-only resources and Alchemy.remote have no local-provider escape",
		{n: Schema.Int},
		({n}) => {
			for (const source of [
				`import * as A from "alchemy"; export const stack = A.remote(${n});`,
				'import {remote as r} from "alchemy"; export const stack = r();',
				'import * as C from "@alchemy.run/cloudflare"; export const stack = C.D1.Database("Remote");',
			])
				expect(run(source).length).toBeGreaterThan(0);
		},
		runs,
	);
	it("scenario: read every real finding before enabling the restriction", () => {
		const result = spawnSync(
			join(root, "node_modules/.bin/oxlint"),
			[
				"--config",
				join(root, ".oxlintrc.json"),
				"--format=json",
				...paths.map((path) => `next/apps/fabrika/${path}`),
			],
			{cwd: root, encoding: "utf8"},
		);
		const report: {diagnostics: {code?: string; filename: string; message: string}[]} = JSON.parse(
			result.stdout,
		);
		const findings = report.diagnostics.filter((d) => d.code === "fabrika-wiring(wiring-only)");
		console.log(JSON.stringify({rule: "wiring-only", findings}));
		// P16's app build and P12's stack still decide here. These are true findings for the build step.
		expect(findings).toEqual([]);
	});
});
