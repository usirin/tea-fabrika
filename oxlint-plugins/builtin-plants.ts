// oxlint's own rules that went on with 0 hits on the tree (lint audit, 2026-11-09, ticket 438). A rule
// with 0 hits has shown nothing yet, so each one gets a planted line here that it must refuse, and
// most get one it must take. plants.test.ts runs them with the repository's own .oxlintrc.json.

export interface Plant {
	readonly code: string;
	/** The file's name, for a rule that looks at it. */
	readonly file?: string;
	readonly prelude: readonly string[];
	readonly lines: readonly (readonly [string, boolean])[];
}

const NUM = "declare const x: number;";
const NUMS = ["declare const x: number;", "declare const y: number;", "declare const z: number;"];
const STR = "declare const s: string;";
const XS = "declare const xs: number[];";
const FN = "declare const f: () => void;";
const P = "declare const p: Promise<number>;";
const TEST = 'import {describe, expect, it, vi} from "vitest";';
const REACT =
	'import {Component, createContext, forwardRef, useEffect, useMemo, useState} from "react";';

const eslint: readonly Plant[] = [
	{
		code: "eslint(no-unused-expressions)",
		prelude: [NUM],
		lines: [
			["x + 1;", true],
			["export const a = x + 1;", false],
		],
	},
	{
		code: "eslint(no-constant-binary-expression)",
		prelude: ["declare const x: number | undefined;"],
		lines: [
			["export const a = (x === 1) ?? 0;", true],
			["export const b = x ?? 0;", false],
		],
	},
	{
		code: "eslint(no-unassigned-vars)",
		prelude: [],
		lines: [
			["let n: number | undefined; export const a = n;", true],
			["let m = 1; m += 1; export const b = m;", false],
		],
	},
	{
		code: "eslint(no-invalid-regexp)",
		prelude: [],
		lines: [
			['export const a = new RegExp("[");', true],
			['export const b = new RegExp("a");', false],
		],
	},
	{
		code: "eslint(no-unreachable-loop)",
		prelude: [XS],
		lines: [
			["export const f = () => { for (const x of xs) { return x; } return 0; };", true],
			["export const g = () => { for (const x of xs) { if (x) return x; } return 0; };", false],
		],
	},
	{
		code: "eslint(no-throw-literal)",
		prelude: [],
		lines: [
			['export const f = () => { throw "a"; };', true],
			['export const g = () => { throw new Error("a"); };', false],
		],
	},
	{
		code: "eslint(preserve-caught-error)",
		prelude: [FN],
		lines: [
			['export const g = () => { try { f(); } catch (e) { throw new Error("a"); } };', true],
			[
				'export const h = () => { try { f(); } catch (e) { throw new Error("a", {cause: e}); } };',
				false,
			],
		],
	},
	{
		code: "eslint(no-implied-eval)",
		prelude: [],
		lines: [
			['globalThis.setTimeout("a()", 1);', true],
			["globalThis.setTimeout(() => 1, 1);", false],
		],
	},
	{
		code: "eslint(no-new)",
		prelude: [],
		lines: [
			["new Map();", true],
			["export const m = new Map();", false],
		],
	},
	{
		code: "eslint(no-extend-native)",
		prelude: [],
		lines: [
			["Object.prototype.a = 1;", true],
			["export const o = {a: 1};", false],
		],
	},
	{
		code: "eslint(no-extra-bind)",
		prelude: [],
		lines: [
			["export const f = (() => 1).bind(null);", true],
			["export const g = function (this: unknown) { return this; }.bind(null);", false],
		],
	},
	{
		code: "eslint(no-useless-call)",
		prelude: ["declare const f: (x: number) => number;"],
		lines: [
			["export const a = f.call(undefined, 1);", true],
			["export const b = f(1);", false],
		],
	},
	{
		code: "eslint(no-caller)",
		prelude: [],
		lines: [
			["export function f() { return arguments.callee; }", true],
			["export function g() { return 1; }", false],
		],
	},
	{
		code: "eslint(no-iterator)",
		prelude: ["declare const o: {__iterator__: number; b: number};"],
		lines: [
			["export const a = o.__iterator__;", true],
			["export const b = o.b;", false],
		],
	},
	{
		// A module is strict, and strict mode cannot parse `delete v`. A file with no import or export
		// is a script.
		code: "eslint(no-delete-var)",
		file: "script.js",
		prelude: [],
		lines: [
			["var v = 1;", false],
			["delete v;", true],
		],
	},
	{
		code: "eslint(no-empty-static-block)",
		prelude: [FN],
		lines: [
			["export class A { static {} }", true],
			["export class B { static { f(); } }", false],
		],
	},
	{
		code: "eslint(block-scoped-var)",
		prelude: [],
		lines: [
			["export function f(a: boolean) { if (a) { var b = 1; } return b; }", true],
			["export function g(a: boolean) { const b = a ? 1 : 0; return b; }", false],
		],
	},
	{
		code: "eslint(no-unexpected-multiline)",
		prelude: ["declare const g: (x: number) => number;"],
		lines: [
			["export const a = g", false],
			["(1);", true],
		],
	},
	{
		code: "eslint(no-new-wrappers)",
		prelude: [],
		lines: [
			['export const a = new String("a");', true],
			["export const b = String(1);", false],
		],
	},
	{
		code: "eslint(no-object-constructor)",
		prelude: [],
		lines: [
			["export const a = new Object();", true],
			["export const b = Object.create(null);", false],
		],
	},
	{
		code: "eslint(prefer-promise-reject-errors)",
		prelude: [],
		lines: [
			['export const a = Promise.reject("a");', true],
			['export const b = Promise.reject(new Error("a"));', false],
		],
	},
	{
		code: "eslint(symbol-description)",
		prelude: [],
		lines: [
			["export const a = Symbol();", true],
			['export const b = Symbol("b");', false],
		],
	},
	{
		code: "eslint(no-var)",
		prelude: [],
		lines: [
			["var v = 1; export {v};", true],
			["export const w = 1;", false],
		],
	},
	{
		code: "eslint(no-return-assign)",
		prelude: [],
		lines: [
			["export const f = (o: {a: number}) => o.a = 1;", true],
			["export const g = (o: {a: number}) => { o.a = 1; return o.a; };", false],
		],
	},
	{
		code: "eslint(no-useless-computed-key)",
		prelude: [],
		lines: [
			['export const a = {["a"]: 1};', true],
			["export const b = {b: 1};", false],
		],
	},
	{
		code: "eslint(guard-for-in)",
		prelude: ["declare const o: object;", "declare const f: (k: string) => void;"],
		lines: [
			["for (const k in o) { f(k); }", true],
			["for (const k in o) { if (Object.hasOwn(o, k)) f(k); }", false],
		],
	},
	{
		code: "eslint(default-param-last)",
		prelude: [],
		lines: [
			["export const f = (a = 1, b: number) => a + b;", true],
			["export const g = (b: number, a = 1) => a + b;", false],
		],
	},
	{
		code: "eslint(yoda)",
		prelude: [NUM],
		lines: [
			["export const a = 1 === x;", true],
			["export const b = x === 1;", false],
		],
	},
];

const oxc: readonly Plant[] = [
	{
		code: "oxc(missing-throw)",
		prelude: [],
		lines: [
			['export const f = () => { new Error("a"); };', true],
			['export const g = () => { throw new Error("a"); };', false],
		],
	},
	{
		code: "oxc(const-comparisons)",
		prelude: [NUM],
		lines: [
			["export const a = x > 5 && x < 3;", true],
			["export const b = x > 3 && x < 5;", false],
		],
	},
	{
		code: "oxc(double-comparisons)",
		prelude: NUMS,
		lines: [
			["export const a = x === y || x < y;", true],
			["export const b = x <= y;", false],
		],
	},
	{
		code: "oxc(erasing-op)",
		prelude: [NUM],
		lines: [
			["export const a = x * 0;", true],
			["export const b = x * 2;", false],
		],
	},
	{
		code: "oxc(bad-comparison-sequence)",
		prelude: NUMS,
		lines: [
			["export const a = x < y < z;", true],
			["export const b = x < y && y < z;", false],
		],
	},
	{
		code: "oxc(bad-char-at-comparison)",
		prelude: [STR],
		lines: [
			['export const a = s.charAt(0) === "ab";', true],
			['export const b = s.charAt(0) === "a";', false],
		],
	},
	{
		code: "oxc(bad-replace-all-arg)",
		prelude: [STR],
		lines: [
			['export const a = s.replaceAll(/a/, "b");', true],
			['export const b = s.replaceAll(/a/g, "b");', false],
		],
	},
	{
		code: "oxc(bad-match-all-arg)",
		prelude: [STR],
		lines: [
			["export const a = s.matchAll(/a/);", true],
			["export const b = s.matchAll(/a/g);", false],
		],
	},
	{
		code: "oxc(bad-object-literal-comparison)",
		prelude: ["declare const x: unknown;"],
		lines: [
			["export const a = x === {};", true],
			["export const b = x === null;", false],
		],
	},
	{
		code: "oxc(bad-array-method-on-arguments)",
		prelude: [],
		lines: [
			["export function f() { return arguments.map((v: unknown) => v); }", true],
			["export function g(...xs: number[]) { return xs.map((v) => v); }", false],
		],
	},
	{
		code: "oxc(number-arg-out-of-range)",
		prelude: [NUM],
		lines: [
			["export const a = x.toString(1);", true],
			["export const b = x.toString(16);", false],
		],
	},
	{
		code: "oxc(uninvoked-array-callback)",
		prelude: [],
		lines: [
			["export const a = new Array(3).map((v) => v);", true],
			["export const b = Array.from({length: 3}, (_, i) => i);", false],
		],
	},
	{
		code: "oxc(only-used-in-recursion)",
		prelude: [],
		lines: [
			["export function f(a: number, b: number): number { return a > 0 ? f(a - 1, b) : 0; }", true],
			["export function g(a: number): number { return a > 0 ? g(a - 1) : a; }", false],
		],
	},
	{
		code: "oxc(bad-bitwise-operator)",
		prelude: [NUM],
		lines: [
			["export const a = x | {};", true],
			["export const b = x | 1;", false],
		],
	},
];

const unicorn: readonly Plant[] = [
	{
		code: "unicorn(no-unnecessary-await)",
		prelude: [P],
		lines: [
			["export const f = async () => { await 1; };", true],
			["export const g = async () => { await p; };", false],
		],
	},
	{
		code: "unicorn(no-await-in-promise-methods)",
		prelude: [P],
		lines: [
			["export const f = async () => Promise.all([await p, p]);", true],
			["export const g = async () => Promise.all([p, p]);", false],
		],
	},
	{
		code: "unicorn(no-single-promise-in-promise-methods)",
		prelude: [P],
		lines: [
			["export const a = Promise.all([p]);", true],
			["export const b = Promise.all([p, p]);", false],
		],
	},
	{
		code: "unicorn(no-invalid-fetch-options)",
		prelude: [],
		lines: [
			['export const a = fetch("/", {method: "GET", body: "a"});', true],
			['export const b = fetch("/", {method: "POST", body: "a"});', false],
		],
	},
	{
		code: "unicorn(no-invalid-remove-event-listener)",
		prelude: ["declare const el: EventTarget;", "declare const h: () => void;"],
		lines: [
			['el.removeEventListener("click", () => {});', true],
			['el.removeEventListener("click", h);', false],
		],
	},
	{
		code: "unicorn(no-useless-length-check)",
		prelude: [XS],
		lines: [
			["export const a = xs.length === 0 || xs.every((v) => v > 0);", true],
			["export const b = xs.every((v) => v > 0);", false],
		],
	},
	{
		code: "unicorn(prefer-set-size)",
		prelude: [XS],
		lines: [
			["export const a = [...new Set(xs)].length;", true],
			["export const b = new Set(xs).size;", false],
		],
	},
	{
		code: "unicorn(no-accessor-recursion)",
		prelude: [],
		lines: [
			["export class A { get a(): number { return this.a; } }", true],
			["export class B { get b(): number { return 1; } }", false],
		],
	},
	{
		code: "unicorn(no-empty-file)",
		prelude: [],
		lines: [["// only a comment", true]],
	},
	{
		code: "unicorn(no-instanceof-builtins)",
		prelude: ["declare const x: unknown;"],
		lines: [
			["export const a = x instanceof String;", true],
			['export const b = typeof x === "string";', false],
		],
	},
	{
		code: "unicorn(no-negation-in-equality-check)",
		prelude: ["declare const x: boolean;", "declare const y: boolean;"],
		lines: [
			["export const a = !x === y;", true],
			["export const b = x !== y;", false],
		],
	},
	{
		code: "unicorn(no-typeof-undefined)",
		prelude: ["declare const x: number | undefined;"],
		lines: [
			['export const a = typeof x === "undefined";', true],
			["export const b = x === undefined;", false],
		],
	},
	{
		code: "unicorn(prefer-optional-catch-binding)",
		prelude: [FN],
		lines: [
			["try { f(); } catch (_e) { f(); }", true],
			["try { f(); } catch { f(); }", false],
		],
	},
	{
		code: "unicorn(prefer-string-slice)",
		prelude: [STR],
		lines: [
			["export const a = s.substring(1);", true],
			["export const b = s.slice(1);", false],
		],
	},
	{
		code: "unicorn(prefer-includes)",
		prelude: [XS],
		lines: [
			["export const a = xs.indexOf(1) !== -1;", true],
			["export const b = xs.includes(1);", false],
		],
	},
	{
		code: "unicorn(prefer-regexp-test)",
		prelude: [STR, FN],
		lines: [
			["if (s.match(/a/)) f();", true],
			["if (/a/.test(s)) f();", false],
		],
	},
	{
		code: "unicorn(prefer-array-some)",
		prelude: [XS],
		lines: [
			["export const a = xs.filter((v) => v > 0).length > 0;", true],
			["export const b = xs.some((v) => v > 0);", false],
		],
	},
	{
		code: "unicorn(prefer-array-flat)",
		prelude: ["declare const xs: number[][];"],
		lines: [
			["export const a = xs.flatMap((v) => v);", true],
			["export const b = xs.flat();", false],
		],
	},
	{
		code: "unicorn(prefer-math-min-max)",
		prelude: NUMS,
		lines: [
			["export const a = x > 50 ? 50 : x;", true],
			["export const b = Math.min(x, y);", false],
		],
	},
	{
		code: "unicorn(error-message)",
		prelude: [],
		lines: [
			["export const a = new Error();", true],
			['export const b = new Error("b");', false],
		],
	},
	{
		code: "unicorn(prefer-type-error)",
		prelude: ["declare const x: unknown;"],
		lines: [
			['if (typeof x !== "number") { throw new Error("a"); }', true],
			['if (typeof x !== "string") { throw new TypeError("b"); }', false],
		],
	},
];

const typescript: readonly Plant[] = [
	{
		code: "typescript(prefer-as-const)",
		prelude: [],
		lines: [
			['export const a = "a" as "a";', true],
			['export const b = "b" as const;', false],
		],
	},
	{
		code: "typescript(no-confusing-non-null-assertion)",
		prelude: ["declare const x: number | undefined;", NUMS[1] ?? ""],
		lines: [
			["export const a = x! == y;", true],
			["export const b = x === y;", false],
		],
	},
	{
		code: "typescript(no-non-null-asserted-nullish-coalescing)",
		// It leaves a `declare const` alone, since that one is known to be set.
		prelude: ["let x: number | undefined; x = 1;"],
		lines: [
			["export const a = x! ?? 1;", true],
			["export const b = x ?? 1;", false],
		],
	},
	{
		code: "typescript(no-require-imports)",
		prelude: [],
		lines: [
			['export const a = require("node:fs");', true],
			['export {readFileSync} from "node:fs";', false],
		],
	},
	{
		code: "typescript(no-var-requires)",
		prelude: [],
		lines: [
			['const m = require("node:fs"); export {m};', true],
			['export {writeFileSync} from "node:fs";', false],
		],
	},
	{
		code: "typescript(no-namespace)",
		prelude: [],
		lines: [
			["export namespace N { export const a = 1; }", true],
			["export const n = {a: 1};", false],
		],
	},
	{
		code: "typescript(triple-slash-reference)",
		prelude: [],
		lines: [
			['/// <reference path="a.ts" />', true],
			['/// <reference lib="es2023" />', false],
		],
	},
	{
		code: "typescript(no-unnecessary-parameter-property-assignment)",
		prelude: [],
		lines: [
			["export class A { constructor(public a: number) { this.a = a; } }", true],
			["export class B { constructor(public b: number) { this.b += 1; } }", false],
		],
	},
	{
		code: "typescript(consistent-generic-constructors)",
		prelude: [],
		lines: [
			["export const a: Map<string, number> = new Map();", true],
			["export const b = new Map<string, number>();", false],
		],
	},
	{
		code: "typescript(consistent-type-assertions)",
		prelude: ["declare const x: unknown;"],
		lines: [
			["export const a = <number>x;", true],
			["export const b = x as number;", false],
		],
	},
	{
		code: "typescript(unified-signatures)",
		prelude: [],
		lines: [
			["export function f(a: number): void;", false],
			["export function f(a: string): void;", true],
			["export function f(_a: unknown) {}", false],
		],
	},
	{
		code: "typescript(prefer-ts-expect-error)",
		prelude: [],
		lines: [
			["// @ts-ignore", true],
			["export const a = 1;", false],
		],
	},
];

const vitest: readonly Plant[] = [
	{
		code: "vitest(valid-describe-callback)",
		file: "planted.test.ts",
		prelude: [TEST],
		lines: [
			['describe("a", () => { return 1; });', true],
			['describe("b", () => { it("c", () => { expect(1).toBe(1); }); });', false],
		],
	},
	{
		code: "vitest(valid-expect-in-promise)",
		file: "planted.test.ts",
		prelude: [TEST, P],
		lines: [
			['it("a", () => { p.then((v) => { expect(v).toBe(1); }); });', true],
			['it("b", async () => { await p.then((v) => { expect(v).toBe(1); }); });', false],
		],
	},
	{
		code: "vitest(hoisted-apis-on-top)",
		file: "planted.test.ts",
		prelude: [TEST],
		lines: [
			['vi.mock("./b.ts");', false],
			['it("a", () => { vi.mock("./a.ts"); });', true],
		],
	},
	{
		code: "vitest(no-conditional-tests)",
		file: "planted.test.ts",
		prelude: [TEST, "declare const x: boolean;"],
		lines: [
			['if (x) { it("a", () => { expect(1).toBe(1); }); }', true],
			['it("b", () => { expect(1).toBe(1); });', false],
		],
	},
	{
		code: "vitest(no-disabled-tests)",
		file: "planted.test.ts",
		prelude: [TEST],
		lines: [
			['it.skip("a", () => { expect(1).toBe(1); });', true],
			['it("b", () => { expect(1).toBe(1); });', false],
		],
	},
	{
		code: "vitest(no-test-return-statement)",
		file: "planted.test.ts",
		prelude: [TEST],
		lines: [
			['it("a", () => { return expect(1).toBe(1); });', true],
			['it("b", () => { expect(1).toBe(1); });', false],
		],
	},
	{
		code: "vitest(no-mocks-import)",
		file: "planted.test.ts",
		prelude: [],
		lines: [
			['import {m} from "./__mocks__/m.ts";', true],
			['import {n} from "./n.ts";', false],
			["export {m, n};", false],
		],
	},
];

const imports: readonly Plant[] = [
	{
		code: "import(no-absolute-path)",
		prelude: [],
		lines: [
			['import {a} from "/a.ts";', true],
			['import {b} from "./b.laws.ts";', false],
			["export {a, b};", false],
		],
	},
	{
		code: "import(first)",
		prelude: [],
		lines: [
			['import {b} from "./b.laws.ts";', false],
			["export const a = b;", false],
			['import {b as c} from "./b.laws.ts";', true],
			["export {c};", false],
		],
	},
	{
		code: "import(no-mutable-exports)",
		prelude: [],
		lines: [
			["export let a = 1;", true],
			["export const b = 1;", false],
		],
	},
	{
		code: "import(no-empty-named-blocks)",
		prelude: [],
		lines: [
			['import {} from "./b.laws.ts";', true],
			['import "./b.laws.ts";', false],
		],
	},
	{
		code: "import(no-named-default)",
		prelude: [],
		lines: [
			['import {default as d} from "./b.laws.ts";', true],
			['import e from "./b.laws.ts";', false],
			["export {d, e};", false],
		],
	},
	{
		code: "import(no-amd)",
		prelude: ["declare const define: (deps: string[], f: () => number) => void;"],
		lines: [
			['define(["a"], () => 1);', true],
			["export const c = 1;", false],
		],
	},
	{
		code: "import(no-commonjs)",
		prelude: [],
		lines: [
			["exports.a = 1;", true],
			["export default 1;", false],
		],
	},
	{
		code: "import(no-webpack-loader-syntax)",
		prelude: [],
		lines: [
			['import "style!css!./a.css";', true],
			['import "./a.css";', false],
		],
	},
];

const promise: readonly Plant[] = [
	{
		code: "promise(no-multiple-resolved)",
		prelude: ["declare const x: boolean;"],
		lines: [
			// No second Promise in the file: in oxlint 1.90.0 one below it hides this fire.
			[
				"export const a = new Promise<number>((resolve) => { if (x) { resolve(1); } resolve(2); });",
				true,
			],
		],
	},
	{
		code: "promise(no-new-statics)",
		prelude: [],
		lines: [
			["export const a = new Promise.resolve(1);", true],
			["export const b = Promise.resolve(1);", false],
		],
	},
	{
		code: "promise(valid-params)",
		prelude: [],
		lines: [
			["export const a = Promise.resolve(1, 2);", true],
			["export const b = Promise.resolve(1);", false],
		],
	},
	{
		code: "promise(no-return-in-finally)",
		prelude: [P, FN],
		lines: [
			["export const a = p.finally(() => { return 1; });", true],
			["export const b = p.finally(() => { f(); });", false],
		],
	},
	{
		code: "promise(no-callback-in-promise)",
		prelude: [P, FN, "declare const cb: () => void;"],
		lines: [
			["export const a = p.then(() => cb());", true],
			["export const b = p.then(() => f());", false],
		],
	},
	{
		code: "promise(no-promise-in-callback)",
		prelude: [P, "declare const g: (done: (err: unknown) => unknown) => void;"],
		lines: [
			["g((err) => p.then(() => err));", true],
			["g((err) => err);", false],
		],
	},
];

const react: readonly Plant[] = [
	{
		code: "react(forward-ref-uses-ref)",
		file: "planted.tsx",
		prelude: [REACT],
		lines: [
			["export const A = forwardRef((props: object) => <div {...props} />);", true],
			["export const B = forwardRef<HTMLDivElement>((_props, ref) => <div ref={ref} />);", false],
		],
	},
	{
		code: "react(iframe-missing-sandbox)",
		file: "planted.tsx",
		prelude: [],
		lines: [
			['export const A = () => <iframe title="a" />;', true],
			['export const B = () => <iframe title="b" sandbox="" />;', false],
		],
	},
	{
		code: "react(jsx-no-constructed-context-values)",
		file: "planted.tsx",
		prelude: [REACT, "const Ctx = createContext({a: 1});", "const v = {a: 1};"],
		lines: [
			["export const A = () => <Ctx.Provider value={{a: 1}} />;", true],
			["export const B = () => <Ctx.Provider value={v} />;", false],
		],
	},
	{
		code: "react(jsx-no-undef)",
		file: "planted.tsx",
		prelude: [],
		lines: [
			["export const A = () => <Missing />;", true],
			["export const B = () => <div />;", false],
		],
	},
	{
		code: "react(jsx-props-no-spread-multi)",
		file: "planted.tsx",
		prelude: ["declare const p: object;"],
		lines: [
			["export const A = () => <div {...p} {...p} />;", true],
			["export const B = () => <div {...p} />;", false],
		],
	},
	{
		code: "react(no-did-mount-set-state)",
		file: "planted.tsx",
		prelude: [REACT],
		lines: [
			[
				"export class A extends Component { componentDidMount() { this.setState({a: 1}); } render() { return null; } }",
				true,
			],
			["export class B extends Component { render() { return null; } }", false],
		],
	},
	{
		code: "react(no-did-update-set-state)",
		file: "planted.tsx",
		prelude: [REACT],
		lines: [
			[
				"export class A extends Component { componentDidUpdate() { this.setState({a: 1}); } render() { return null; } }",
				true,
			],
			["export class B extends Component { render() { return null; } }", false],
		],
	},
	{
		code: "react(no-will-update-set-state)",
		file: "planted.tsx",
		prelude: [REACT],
		lines: [
			[
				"export class A extends Component { componentWillUpdate() { this.setState({a: 1}); } render() { return null; } }",
				true,
			],
			["export class B extends Component { render() { return null; } }", false],
		],
	},
	{
		code: "react(no-direct-mutation-state)",
		file: "planted.tsx",
		prelude: [REACT],
		lines: [
			[
				"export class A extends Component<object, {a: number}> { m() { this.state.a = 1; } render() { return null; } }",
				true,
			],
			[
				"export class B extends Component<object, {a: number}> { m() { this.setState({a: 1}); } render() { return null; } }",
				false,
			],
		],
	},
	{
		code: "react(no-find-dom-node)",
		file: "planted.tsx",
		prelude: ["declare const findDOMNode: (x: unknown) => unknown;"],
		lines: [
			["export const a = (x: unknown) => findDOMNode(x);", true],
			["export const b = (x: unknown) => x;", false],
		],
	},
	{
		code: "react(no-is-mounted)",
		file: "planted.tsx",
		prelude: [REACT],
		lines: [
			[
				"export class A extends Component { m() { return this.isMounted(); } render() { return null; } }",
				true,
			],
			["export class B extends Component { render() { return null; } }", false],
		],
	},
	{
		code: "react(no-this-in-sfc)",
		file: "planted.tsx",
		prelude: [],
		lines: [
			["export function A(this: {a: string}) { return <div>{this.a}</div>; }", true],
			["export function B(p: {a: string}) { return <div>{p.a}</div>; }", false],
		],
	},
	{
		code: "react(no-unknown-property)",
		file: "planted.tsx",
		prelude: [],
		lines: [
			['export const A = () => <div class="a" />;', true],
			['export const B = () => <div className="b" />;', false],
		],
	},
	{
		code: "react(no-unsafe)",
		file: "planted.tsx",
		prelude: [REACT],
		lines: [
			[
				"export class A extends Component { UNSAFE_componentWillMount() {} render() { return null; } }",
				true,
			],
			["export class B extends Component { render() { return null; } }", false],
		],
	},
	{
		code: "react(no-unstable-nested-components)",
		file: "planted.tsx",
		prelude: [],
		lines: [
			["export function A() { function Inner() { return <div />; } return <Inner />; }", true],
			["export function B() { return <div />; }", false],
		],
	},
	{
		code: "react(style-prop-object)",
		file: "planted.tsx",
		prelude: [],
		lines: [
			['export const A = () => <div style="a" />;', true],
			["export const B = () => <div style={{color: 'red'}} />;", false],
		],
	},
	{
		code: "react(require-render-return)",
		file: "planted.tsx",
		prelude: [REACT, FN],
		lines: [
			["export class A extends Component { render() { f(); } }", true],
			["export class B extends Component { render() { return null; } }", false],
		],
	},
	{
		code: "react(set-state-in-render)",
		file: "planted.tsx",
		prelude: [REACT],
		lines: [
			[
				"export function A() { const [a, setA] = useState(0); setA(1); return <div>{a}</div>; }",
				true,
			],
			["export function B() { const [b] = useState(0); return <div>{b}</div>; }", false],
		],
	},
	{
		code: "react(static-components)",
		file: "planted.tsx",
		prelude: [],
		lines: [
			["export function A() { const Inner = () => <div />; return <Inner />; }", true],
			["export function B() { return <div />; }", false],
		],
	},
	{
		code: "react(globals)",
		file: "planted.tsx",
		prelude: ["declare let count: number;"],
		lines: [
			["export function A() { count = 1; return <div />; }", true],
			["export function B() { return <div>{count}</div>; }", false],
		],
	},
	{
		code: "react(hooks)",
		file: "planted.tsx",
		prelude: [REACT],
		lines: [
			["export function A(p: {a: boolean}) { if (p.a) { useState(0); } return <div />; }", true],
			["export function B() { const [b] = useState(0); return <div>{b}</div>; }", false],
		],
	},
	{
		code: "react(void-use-memo)",
		file: "planted.tsx",
		prelude: [REACT, FN],
		lines: [
			["export function A() { useMemo(() => { f(); }, []); return <div />; }", true],
			["export function B() { const b = useMemo(() => 1, []); return <div>{b}</div>; }", false],
		],
	},
	{
		code: "react(use-memo)",
		file: "planted.tsx",
		prelude: [REACT],
		lines: [
			[
				"export function A() { const a = useMemo((x: number) => x, []); return <div>{a}</div>; }",
				true,
			],
			["export function B() { const b = useMemo(() => 1, []); return <div>{b}</div>; }", false],
		],
	},
	{
		code: "react(error-boundaries)",
		file: "planted.tsx",
		prelude: [],
		lines: [
			["export function A() { try { return <div />; } catch { return null; } }", true],
			["export function B() { return <div />; }", false],
		],
	},
	{
		code: "react(no-deriving-state-in-effects)",
		file: "planted.tsx",
		prelude: [REACT],
		lines: [
			[
				"export function A({a}: {a: number}) { const [b, setB] = useState(0); useEffect(() => { setB(a * 2); }, [a]); return <div>{b}</div>; }",
				true,
			],
			["export function B(p: {a: number}) { const b = p.a * 2; return <div>{b}</div>; }", false],
		],
	},
	{
		code: "react(capitalized-calls)",
		file: "planted.tsx",
		prelude: ["declare const Foo: () => number;"],
		lines: [
			["export function A() { const a = Foo(); return <div>{a}</div>; }", true],
			["export function B() { return <div><Foo /></div>; }", false],
		],
	},
	{
		code: "react(memo-dependencies)",
		file: "planted.tsx",
		prelude: [REACT],
		lines: [
			[
				"export function A(p: {a: number}) { const a = useMemo(() => p.a, []); return <div>{a}</div>; }",
				true,
			],
			[
				"export function B(p: {a: number}) { const b = useMemo(() => p.a, [p.a]); return <div>{b}</div>; }",
				false,
			],
		],
	},
	{
		code: "react(incompatible-library)",
		file: "planted.tsx",
		prelude: ['import {useForm} from "react-hook-form";'],
		lines: [
			['export function A() { const {watch} = useForm(); return <div>{watch("a")}</div>; }', true],
			["export function B() { return <div />; }", false],
		],
	},
];

export const BUILTIN_PLANTS: readonly Plant[] = [
	...eslint,
	...oxc,
	...unicorn,
	...typescript,
	...vitest,
	...imports,
	...promise,
	...react,
];
