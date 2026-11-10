// The clock in a view (C1, owner 2026-11-05): React's `react/purity` refuses a clock or random read
// in render and allows one in a handler; our `no-clock-in-view` refuses both.
import {describe, expect, it} from "vitest";
import {plant} from "./plant.ts";

const PURITY = "react(purity)";
const CLOCK = "fabrika(no-clock-in-view)";
const VIEW = "next/packages/tuval/src/window/view.tsx";
const CLEAN = "next/packages/tuval/src/window/clean.tsx";
const PLAIN = "next/packages/tuval/src/window/model.ts";

const view = [
	"declare const send: (m: {type: string; at?: number}) => void;", // 1
	"export const When = () => <time>{Date.now()}</time>;", // 2: render
	"export const Roll = () => <b>{Math.random()}</b>;", // 3: render
	"export const Press = () => (", // 4
	'\t<button type="button" onClick={() => send({type: "press", at: performance.now()})} />', // 5: handler
	");", // 6
	// Experiment 195's plant: 0.156.0's Compiler refused it, 0.157.0's compiles it.
	"const Tile = (props: {readonly focus: () => void}) => (", // 7
	'\t<button type="button" onClick={props.focus} />', // 8
	");", // 9
	"export const Desk = (props: {readonly tiles: readonly string[]; readonly go: (s: string) => void}) => {", // 10
	"\tconst said = () => new Date().toISOString();", // 11: a handler's helper
	"\tconst focus = (tile: string) => props.go(tile + said());", // 12
	"\treturn <main>{props.tiles.map((t) => <Tile key={t} focus={() => focus(t)} />)}</main>;", // 13
	"};", // 14
	"export const Id = () => <b onClick={() => send({type: crypto.randomUUID()})} />;", // 15
	"export const Old = () => <b onClick={() => send({type: String(Date())})} />;", // 16
].join("\n");

const clean = [
	"declare const send: (m: {type: string}) => void;",
	"export const Shown = (props: {readonly at: number}) => <time>{new Date(props.at).toISOString()}</time>;",
	'export const Press = () => <button type="button" onClick={() => send({type: "press"})} />;',
].join("\n");

describe("the clock in a view", async () => {
	const all = await plant({
		[VIEW]: view,
		[CLEAN]: clean,
		[PLAIN]: "export const now = () => Date.now();",
		"next/packages/tuval/src/window/view.test.tsx": view,
	});

	// It also fires on line 11, a helper made in render that only a handler calls: the false alarm
	// experiment 194 saw at the slice's `main.tsx:146`. Under no-clock-in-view that line is refused anyway.
	it("react/purity fires in render and lets an inline handler pass, as React's rule does", () => {
		expect(all(PURITY, VIEW)).toEqual([2, 3, 11]);
	});

	it("no-clock-in-view fires in render and in every handler, the passed-down one too", () => {
		expect(all(CLOCK, VIEW)).toEqual([2, 3, 5, 11, 15, 16]);
	});

	it("passes a time the view was given, a plain .ts file and tests", () => {
		for (const code of [PURITY, CLOCK]) {
			expect(all(code, CLEAN)).toEqual([]);
			expect(all(code, PLAIN)).toEqual([]);
			expect(all(code, "next/packages/tuval/src/window/view.test.tsx")).toEqual([]);
		}
	});
});
