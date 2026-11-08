// `next/`, exam item 13, C4: React's store hook has no allowed file; tea's value is kept.
import {describe, expect, it} from "vitest";
import {plant} from "./plant.ts";

const CODE = "fabrika(one-store-hook)";
const HOOK = "next/packages/tuval/src/window/use-model.ts";
const FIRES = "next/programs/counter/src/view.tsx";
const PASSES = "next/programs/counter/src/tile.tsx";
const RUNTIME = "next/programs/counter/src/dropped-runtime.ts";
const MODEL = "next/programs/counter/src/dropped-model.ts";
const TEST = "next/programs/counter/src/view.test.ts";
const TSX_TEST = "next/programs/counter/src/view.test.tsx";
const OUTSIDE = "programs/counter/src/view.tsx";

const forbidden = [
	'import * as React from "react";', // 1
	'import {useSyncExternalStore} from "react";', // 2
	'import {useSyncExternalStore as useStore} from "react";', // 3
	'import {useSyncExternalStore as useShim} from "use-sync-external-store/shim";', // 4
	"declare const store: {read: () => number; listen: (f: () => void) => () => void};", // 5
	"export const read = () => React.useSyncExternalStore(store.listen, store.read);", // 6
	"export const kept = [useSyncExternalStore, useStore, useShim];", // 7
].join("\n");

const passes = [
	'import {type ViewHandle, useRuntime} from "@demlik/tea/react";',
	'declare const run: ViewHandle<{views: {counter: {count: number}}}, {type: "inc"}>;',
	"export const Counter = () => {",
	"\tconst [view, send] = useRuntime(run, (model) => model.views.counter);",
	'\treturn <button onClick={() => send({type: "inc"})}>{view.count}</button>;',
	"};",
].join("\n");

const runtime = [
	'import {type ViewHandle, useRuntime} from "@demlik/tea/react";', // 1
	'import * as tea from "@demlik/tea/react";', // 2
	'declare const run: ViewHandle<{count: number}, {type: "inc"}>;', // 3
	"export const Bare = () => { useRuntime(run); return null; };", // 4
	"export const Voided = () => { void useRuntime(run); return null; };", // 5
	"export const Member = () => { tea.useRuntime(run); return null; };", // 6
	"export const VoidMember = () => { void tea.useRuntime(run); return null; };", // 7
].join("\n");

const model = [
	'import {useModel} from "@kampus/tuval";', // 1
	"declare const store: {read: () => number; listen: (f: () => void) => () => void};", // 2
	"export const Bare = () => { useModel(store); return null; };", // 3
	"export const Voided = () => { void useModel(store); return null; };", // 4
].join("\n");

describe("one-store-hook", () => {
	const all = plant({
		[HOOK]: forbidden,
		[FIRES]: forbidden,
		[PASSES]: passes,
		[RUNTIME]: runtime,
		[MODEL]: model,
		[TEST]: `${forbidden}\n${runtime}`,
		[TSX_TEST]: `${forbidden}\n${runtime}`,
		[OUTSIDE]: `${forbidden}\n${runtime}`,
	});

	// Plants: restore the retired path allowance, or delete an import branch or member visitor.
	it.each([HOOK, FIRES])("rejects React imports, aliases, the shim and members in %s", (file) => {
		expect(all(CODE, file)).toEqual([2, 3, 4, 6]);
	});

	// Plant: forbid tea's hook or report calls whose returned value is kept.
	it("passes tea's selector when the view draws its value", () => {
		expect(all(CODE, PASSES)).toEqual([]);
	});

	// Plants: drop useRuntime from the hook set, or remove bare, void or member-call handling.
	it("rejects dropped useRuntime values in bare, void and plain member calls", () => {
		expect(all(CODE, RUNTIME)).toEqual([4, 5, 6, 7]);
	});

	// Plant: replace the old hook set with only useRuntime.
	it("still rejects bare and void useModel calls", () => {
		expect(all(CODE, MODEL)).toEqual([3, 4]);
	});

	// Plant: remove the test override from the real config copied by plant.
	it.each([TEST, TSX_TEST])("leaves %s out of the rule", (file) => {
		expect(all(CODE, file)).toEqual([]);
	});

	// Plant: enable the rule globally instead of only under next/.
	it("adds no restriction outside next/", () => {
		expect(all(CODE, OUTSIDE)).toEqual([]);
	});
});
