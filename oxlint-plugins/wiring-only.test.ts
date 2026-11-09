// Tests the real configured AST rule. No source-text assertion substitutes for the linter.
import {describe, expect, it} from "vitest";
import {plant} from "../next/apps/fabrika/src/exam/plant.ts";

const path = "next/apps/fabrika/mcp.ts",
	rule = "fabrika(wiring-only)";
const clean = [
	"import {serveMcp} from '@kampus/libfabrika/mcp'; serveMcp();",
	"import {serveMcp} from '@kampus/libfabrika/mcp'; import {notes} from '@kampus/notes'; serveMcp({programs:[notes]});",
	"import {serveMcp} from '@kampus/libfabrika/mcp'; serveMcp({argv:process.argv.slice(2)});",
	"import {serveMcp} from '@kampus/libfabrika/mcp'; import {nodeLayers} from '@kampus/libfabrika/node'; serveMcp({layers:nodeLayers});",
	"import {serveMcp} from '@kampus/libfabrika/mcp'; export {serveMcp};",
	"import * as Mcp from '@kampus/libfabrika/mcp'; Mcp.serveMcp({programs:[]});",
];
const bad = [
	"function readStage(argv) { return argv[0]; }",
	"const refuse = (why) => ({isError:true,content:[{type:'text',text:why}]});",
	"import {Schema} from 'effect'; const Name=Schema.String.check(isName);",
	"if (process.argv[2] === '--as') start();",
	"const url = supplied ? supplied : local;",
	"import {readMcpOptions} from '@kampus/libfabrika/node'; readMcpOptions(process.argv);",
	"import {Schema as S} from 'effect'; const Name=S.String.check(isName);",
	"import {readMcpOptions as read} from '@kampus/libfabrika/node'; read(process.argv);",
	"export const refusal={why:'bad_args',isError:true};",
];
describe("L28 app wiring, measured 6 clean and 9 planted examples", () => {
	for (const [i, source] of clean.entries())
		it(`clean ${i}`, () => expect(plant({[path]: source})(rule, path)).toEqual([]));
	for (const [i, source] of bad.entries())
		it(`plant L28: app owns parsing or refusal ${i}`, () =>
			expect(plant({[path]: source})(rule, path).length).toBeGreaterThan(0));
});
it("plant L30: Effect, tag and name rules still hold in adapters", () => {
	const path = "next/packages/libfabrika/src/node/planted.ts";
	const result = plant({
		[path]:
			"import {Effect} from 'effect'; import {Legacy} from '@kampus/fabrika-old'; export const badOf=async()=>({ _tag:'bad' }); export const dropped=Effect.runPromise(Effect.void);",
	});
	for (const rule of [
		"fabrika(no-promises)",
		"fabrika(no-hand-tag)",
		"fabrika(no-of)",
		"fabrika(no-effect-run-outside-edge)",
		"eslint(no-restricted-imports)",
	])
		expect(result(rule, path).length).toBeGreaterThan(0);
});
