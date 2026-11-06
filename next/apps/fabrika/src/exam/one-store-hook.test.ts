// `one-store-hook` (exam item 13, C4): `useSyncExternalStore` lives in one file, and a store hook's
// value is never dropped.
import {describe, expect, it} from "vitest";
import {plant} from "./plant.ts";

const CODE = "fabrika(one-store-hook)";
const HOOK = "next/packages/tuval/src/window/use-model.ts";
const FIRES = "next/programs/counter/src/view.tsx";
const PASSES = "next/programs/counter/src/tile.tsx";

const hook = [
	'import {useSyncExternalStore} from "react";',
	"export const useModel = <A,>(store: {read: () => A; listen: (f: () => void) => () => void}) =>",
	"\tuseSyncExternalStore(store.listen, store.read);",
].join("\n");

const fires = [
	'import * as React from "react";', // 1
	'import {useSyncExternalStore} from "react";', // 2
	'import {useSyncExternalStore as useStore} from "use-sync-external-store/shim";', // 3
	'import {useModel} from "@kampus/tuval";', // 4
	"declare const store: {read: () => number; listen: (f: () => void) => () => void};", // 5
	"declare const shown: {count: number};", // 6
	"export const Frozen = () => {", // 7
	"\tuseModel(store);", // 8: the value dropped
	"\treturn <b>{shown.count}</b>;", // 9
	"};", // 10
	"export const Voided = () => {", // 11
	"\tvoid useModel(store);", // 12
	"\treturn <b>{React.useSyncExternalStore(store.listen, store.read)}</b>;", // 13
	"};", // 14
	"export const kept = [useSyncExternalStore, useStore];", // 15: passes
].join("\n");

const passes = [
	'import {useModel} from "@kampus/tuval";',
	"declare const store: {read: () => number; listen: (f: () => void) => () => void};",
	"export const Counter = () => {",
	"\tconst count = useModel(store);",
	"\treturn <b>{count}</b>;",
	"};",
].join("\n");

describe("one-store-hook", () => {
	const all = plant({
		[HOOK]: hook,
		[FIRES]: fires,
		[PASSES]: passes,
		"next/packages/tuval/src/window/other.ts": hook,
		"next/programs/counter/src/view.test.ts": hook,
	});

	it("fires on a second door to useSyncExternalStore, and on a dropped store value", () => {
		expect(all(CODE, FIRES)).toEqual([2, 3, 8, 12, 13]);
		expect(all(CODE, "next/packages/tuval/src/window/other.ts")).toEqual([1]);
	});

	it("passes the one hook's own file, a view that draws its value, and tests", () => {
		expect(all(CODE, HOOK)).toEqual([]);
		expect(all(CODE, PASSES)).toEqual([]);
		expect(all(CODE, "next/programs/counter/src/view.test.ts")).toEqual([]);
	});
});
