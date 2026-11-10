import {describe, expect, it} from "vitest";
import {plant} from "../next/apps/fabrika/src/exam/plant.ts";

const code = "fabrika(outside-input-constructor)";
const file = "next/packages/libfabrika/src/data/id.ts";

describe("P17a, outside input has typed failures", () => {
	it("plants schema aliases and destructured decoder aliases in the door", async () => {
		const door = "next/packages/libfabrika/src/door/door.ts";
		const lines = [
			'import {Schema} from "effect";',
			"declare const raw: unknown, Binding: any;",
			"const Alias = Binding; Alias.make(raw);",
			"const Other = Alias; Other.make(raw);",
			"const {decodeUnknownSync} = Schema; decodeUnknownSync(Binding)(raw);",
			"const {decodeSync: decode} = Schema; decode(Binding)(raw);",
			"const read = decodeUnknownSync(Binding); read(raw);",
			"const parser = decode; parser(Binding)(raw);",
			"const Local = Schema.Struct({value: Schema.String});",
			"function decodeLocal(value: unknown) { const Alias = Local; return Alias.make(value); }",
		].join("\n");
		expect((await plant({[door]: lines}))(code, door)).toEqual([3, 4, 5, 6, 7, 8, 10]);
	});
	it("follows destructured aliases and keeps same-named bindings in their own scope", async () => {
		const lines = [
			'import {Id} from "./ids.ts";',
			"declare const wire: string, saved: {body: unknown}, Row: any;",
			'const prefix = "input";',
			"function receive(prefix: string) { return Id.make(prefix); }",
			"function local() { const prefix = wire; return Id.make(prefix); }",
			"Id.make(prefix);",
			"const {body: alias} = saved; Row.make(alias);",
			"const mint = Id.make; mint(wire);",
			"Id.make(`input`);",
		].join("\n");
		expect((await plant({[file]: lines}))(code, file)).toEqual([4, 5, 7, 8]);
	});
	it("plants throwing calls, saved aliases, decoder aliases and a wire prefix", async () => {
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
		expect((await plant({[file]: lines}))(code, file)).toEqual([4, 6, 7, 9, 10, 11, 12, 13, 14]);
	});
	it("permits code constants and Effect or Result decoders", async () => {
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
			"const Alias = Row; Alias.make({n: 0});",
			"const {decodeUnknownEffect: decode} = Schema; decode(Row)(raw);",
			"const {decodeUnknownResult: result} = Schema; Alias.make(result(Row)(raw));",
			"const Declaration = Program; Declaration.make({name: raw});",
			"function scope() { const Alias = Schema.decodeSync(Row); Alias({n: 0}); }",
		].join("\n");
		expect((await plant({[file]: lines}))(code, file)).toEqual([]);
	});
	it("covers each named production path and leaves other files alone", async () => {
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
		const linted = await plant({
			...files,
			[other]: "declare const raw: unknown, Row: any; Row.make(raw);",
		});

		for (const path of Object.keys(files)) {
			expect(linted(code, path)).toEqual([1]);
		}

		expect(linted(code, other)).toEqual([]);
	});
});
