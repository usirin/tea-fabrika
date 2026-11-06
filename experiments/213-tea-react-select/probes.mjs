// Every probe, run in Chromium by run-chromium.mjs. Each trial gives back { probe, want, got }.
import {defineMachine} from "@demlik/tea";
import {run as effectRun} from "@demlik/tea/effect";
import {run as promiseRun} from "@demlik/tea/promise";
import {Effect, Fiber} from "effect";
import * as React from "react";
import {createRoot} from "react-dom/client";
import * as compiled from "./out-compiled.mjs";
import * as plain from "./out-plain.mjs";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = React.createElement;
const act = React.act;

const desk = defineMachine({
	types: {model: {}, msg: {}},
	init: () => [{views: {a: {n: 0}, b: {n: 0}, c: {n: 0}}}, []],
	update: {
		inc: (s, m) => [{views: {...s.views, [m.id]: {n: s.views[m.id].n + 1}}}, []],
	},
});

/** A booted run on either engine, with a way to send from outside React and to end it. */
async function boot(engine) {
	if (engine === "promise") {
		const rt = await promiseRun(desk, {ctx: undefined}).ready;
		return {rt, tell: (msg) => rt.dispatch(msg), end: () => rt.stop()};
	}
	let rt;
	let fiber;
	await new Promise((resolve) => {
		fiber = Effect.runFork(
			Effect.scoped(
				Effect.gen(function* () {
					rt = yield* (yield* effectRun(desk, {ctx: undefined})).ready;
					resolve();
					return yield* Effect.never;
				}),
			),
		);
	});
	return {
		rt,
		tell: (msg) => Effect.runPromise(rt.dispatch(msg)),
		end: () => Effect.runPromise(Fiber.interrupt(fiber)),
	};
}

const tick = () => act(async () => new Promise((r) => setTimeout(r, 15)));
let roots = 0;
function fresh() {
	const el = document.createElement("div");
	el.id = `r${roots++}`;
	document.body.append(el);
	return {el, root: createRoot(el)};
}

/** Console errors and render throws while `fn` runs. */
async function watched(fn) {
	const errors = [];
	const was = console.error;
	console.error = (...args) => errors.push(String(args[0]).slice(0, 80));
	try {
		await fn();
	} catch (e) {
		errors.push(`threw: ${String(e?.message ?? e).slice(0, 80)}`);
	} finally {
		console.error = was;
	}
	return errors;
}

const strictly = (yes, tree) => (yes ? h(React.StrictMode, null, tree) : tree);

/**
 * S1 and S2: three tiles; tile b is clicked three times. Counts each tile's commits after mount.
 * `Desk` picks with a selector; `WholeDesk` reads the whole model and passes plain values.
 */
async function clicks(engine, kind, which, strict) {
	const mod = kind === "compiled" ? compiled : plain;
	const {rt, end} = await boot(engine);
	const draws = {a: 0, b: 0, c: 0};
	const onDraw = (id) => {
		draws[id] += 1;
	};
	const {el, root} = fresh();
	const errors = await watched(async () => {
		await act(async () => root.render(strictly(strict, h(mod[which], {run: rt, onDraw}))));
		await tick();
		for (const id of ["a", "b", "c"]) draws[id] = 0;
		const prefix = which === "Desk" ? "tile" : "whole";
		for (let i = 0; i < 3; i++) {
			await act(async () => el.querySelector(`#${prefix}-b`).click());
			await tick();
		}
	});
	const shown = ["a", "b", "c"].map((id) => el.querySelector(`[id$="-${id}"]`).textContent);
	await act(async () => root.unmount());
	await end();
	return {
		probe: `${which === "Desk" ? "S1 selector" : "S2 whole model"} ${engine} ${kind}${strict ? " strict" : ""}`,
		want:
			which === "Desk"
				? "shows 0 3 0, draws a0 b3 c0, errors 0"
				: "shows 0 3 0, draws a3 b3 c3, errors 0",
		got: `shows ${shown.join(" ")}, draws a${draws.a} b${draws.b} c${draws.c}, errors ${errors.length}`,
	};
}

/** S3: a selector that builds a new object on every read, the shape the docs warn against. */
async function built(engine, kind) {
	const mod = kind === "compiled" ? compiled : plain;
	const {rt, end} = await boot(engine);
	const {root} = fresh();
	const errors = await watched(async () => {
		await act(async () => root.render(h(mod.BuiltTile, {run: rt, id: "a"})));
		await tick();
	});
	await act(async () => root.unmount());
	await end();
	const kinds = [...new Set(errors.map((e) => e.replace(/%s.*$/, "").trim()))];
	return {
		probe: `S3 built object ${engine} ${kind}`,
		want: "React refuses it: Maximum update depth exceeded",
		got: kinds.find((k) => k.includes("Maximum update depth"))
			? `React refuses it: Maximum update depth exceeded (${kinds.length} kind(s): ${kinds.join(" | ")})`
			: `${errors.length} error(s): ${kinds.join(" | ")}`,
	};
}

/** S4: a selector over a prop. Tile b moves to 2, then the reader's id changes from a to b. */
async function swap(engine, kind) {
	const mod = kind === "compiled" ? compiled : plain;
	const {rt, tell, end} = await boot(engine);
	const commits = [];
	const onDraw = (text) => {
		commits.push(text);
	};
	const {root} = fresh();
	await act(async () => root.render(h(mod.Swap, {run: rt, id: "a", onDraw})));
	await act(async () => {
		await tell({type: "inc", id: "b"});
		await tell({type: "inc", id: "b"});
	});
	await tick();
	await act(async () => root.render(h(mod.Swap, {run: rt, id: "b", onDraw})));
	await tick();
	await act(async () => root.unmount());
	await end();
	return {probe: `S4 prop swap ${engine} ${kind}`, want: "a:0 > b:2", got: commits.join(" > ")};
}

/** A probe that throws is an answer too: it is recorded, and the run goes on. */
async function trial(probe, fn) {
	try {
		return await fn();
	} catch (e) {
		const inner = e?.errors?.map((x) => x?.message).join(" | ");
		return {
			probe,
			want: "(no throw)",
			got: `threw: ${String(inner || e?.message || e).slice(0, 160)}`,
		};
	}
}

export async function runAll(times) {
	const rows = [];
	for (let t = 0; t < times; t++) {
		for (const engine of ["promise", "effect"]) {
			for (const kind of ["compiled", "plain"]) {
				const at = `${engine} ${kind}`;
				rows.push(await trial(`S1 selector ${at}`, () => clicks(engine, kind, "Desk", false)));
				rows.push(
					await trial(`S1 selector ${at} strict`, () => clicks(engine, kind, "Desk", true)),
				);
				rows.push(
					await trial(`S2 whole model ${at}`, () => clicks(engine, kind, "WholeDesk", false)),
				);
				rows.push(await trial(`S3 built object ${at}`, () => built(engine, kind)));
				rows.push(await trial(`S4 prop swap ${at}`, () => swap(engine, kind)));
			}
		}
	}
	const tally = new Map();
	for (const r of rows) {
		const key = JSON.stringify([r.probe, r.want, r.got]);
		tally.set(key, (tally.get(key) ?? 0) + 1);
	}
	return [...tally].map(([key, count]) => {
		const [probe, want, got] = JSON.parse(key);
		return {probe, want, got, count};
	});
}
