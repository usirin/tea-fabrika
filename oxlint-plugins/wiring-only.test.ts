import {expect, it} from "@effect/vitest";
import {Schema} from "effect";
import {plant} from "../next/apps/fabrika/src/exam/plant.ts";

const app = "next/apps/fabrika/src/runtime.ts";
const data = "next/packages/libfabrika/src/data/planted.ts";
const chaos = "next/packages/libfabrika/src/chaos/planted.ts";
const program = "next/programs/chaos/src/planted.ts";
const linted = plant({
	[app]: [
		'import {Schema as S} from "effect";',
		"export const wire = Layer.mergeAll(a, b);",
		"export const Bad = S.Struct({raw: S.String});",
		"export const guard = (raw) => { if (!raw) return false; return true; };",
		"export const fold = (rows) => rows.reduce((s, r) => s + r.n, 0);",
		"export const refuse = (ok) => ok ? yes : no;",
	].join("\n"),
	[data]: 'import {LiveNemesis} from "../chaos/live.ts";',
	[chaos]: [
		'import {ProgramRunner} from "../app/runner.ts";',
		'import {Ledger} from "../data/ledger.ts";',
		'import {app} from "../../../../../apps/fabrika/src/runtime.ts";',
	].join("\n"),
	[program]: [
		'import {fs} from "node:fs";',
		'import {old} from "@kampus/fabrika-old";',
		'import {report} from "@kampus/libfabrika/chaos";',
	].join("\n"),
});
const code = "fabrika(wiring-only)";
const check = {arbitrary: {seed: 119120, runs: 100, size: 100}};

it.prop(
	"plant: schema, guard, fold or refusal in app wiring fires for its own line",
	[Schema.Literals([3, 4, 5, 6])],
	([line]) => {
		expect(linted(code, app)).toContain(line);
		expect(linted(code, app)).not.toContain(2);
	},
	check,
);
it.prop(
	"plant: upward, old or platform imports fire; chaos may compose the library",
	[Schema.Literals([data, chaos, program])],
	([path]) => {
		expect(linted(code, path)).toContain(path === chaos ? 3 : 1);
		expect(linted(code, chaos)).not.toContain(1);
		expect(linted(code, chaos)).not.toContain(2);
		expect(linted(code, program)).not.toContain(3);
	},
	check,
);
