import {describe, expect, it} from "vitest";
import {plant} from "../next/apps/fabrika/src/exam/plant.ts";

const code = "fabrika(outside-input-constructor)";
const file = "next/packages/libfabrika/src/data/id.ts";
describe("P17a, outside input has typed failures", () => {
	it("plants throwing calls, saved aliases, decoder aliases and a wire prefix", () => {
		const lines = [
			'import {Schema} from "effect";',
			'import {Id as Identity} from "./ids.ts";',
			"declare const raw: unknown, saved: unknown, wire: string, Row: any;",
			"Row.make(raw);",
			"const alias = saved;",
			"Row.make(alias);",
			"Schema.decodeUnknownSync(Row)(raw);",
			"const decode = Schema.decodeSync(Row);",
			"decode(saved);",
			"Identity.make(wire);",
			"const prefix = wire; Identity.make(prefix);",
			"function decodeRow(value: unknown) { return Row.make(value); }",
			"function readRow(value: unknown) { return Schema.decodeSync(Row)(value); }",
			"const decodeAlias = (value: unknown) => { const alias = value; return Row.make(alias); };",
		].join("\n");
		expect(plant({[file]: lines})(code, file)).toEqual([4, 6, 7, 9, 10, 11, 12, 13, 14]);
	});
	it("permits code constants and Effect or Result decoders", () => {
		const lines = [
			'import {Schema} from "effect";',
			'import {Id} from "./ids.ts";',
			"declare const raw: unknown, Row: any, Program: any, Machine: any, Cmd: any;",
			'Id.make("input"); const PREFIX = "chaos" as const; Id.make(PREFIX);',
			"Schema.decodeUnknownEffect(Row)(raw); Schema.decodeUnknownResult(Row)(raw);",
			'Row.makeEffect(raw); Id.makeEffect("outside_prefix");',
			'const decodeRow = () => Row.make({n: 0, nested: [true, "idle"]});',
			'Program.make({name: "counter"}); Machine.make({name: "counter"}); Cmd.make("read", {});',
			"Schema.decodeSync(Row)({n: 0});",
		].join("\n");
		expect(plant({[file]: lines})(code, file)).toEqual([]);
	});
	it("covers each named production path and leaves other files alone", () => {
		const paths = [
			"data/id",
			"data/log",
			"coordination/authorization",
			"door/door",
			"door/store",
			"door/nonce",
			"app/nemesis",
			"app/chaos-state",
			"app/runner",
			"app/entry",
		];
		const files = Object.fromEntries(
			paths.map((path) => [
				`next/packages/libfabrika/src/${path}.ts`,
				"declare const raw: unknown, Row: any; Row.make(raw);",
			]),
		);
		const other = "next/packages/libfabrika/src/coordination/members.ts";
		const linted = plant({
			...files,
			[other]: "declare const raw: unknown, Row: any; Row.make(raw);",
		});
		for (const path of Object.keys(files)) expect(linted(code, path)).toEqual([1]);
		expect(linted(code, other)).toEqual([]);
	});
});
