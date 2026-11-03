// Every probe, as one function that runs in jsdom (run-node.mjs) or Chromium (run-chromium.mjs).
// Each trial gives back { probe, want, got }.
import {defineMachine} from "@demlik/tea";
import {run as effectRun} from "@demlik/tea/effect";
import * as promise22 from "@demlik/tea/promise";
import * as react22 from "@demlik/tea/react";
import {Effect, Fiber} from "effect";
import * as React from "react";
import {createRoot} from "react-dom/client";
import * as compiled from "./out-compiled.mjs";
import * as plain from "./out-plain.mjs";
import {mounted, useEffectMachine} from "./use-effect-machine.mjs";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = React.createElement;
const act = React.act;
const counter = defineMachine({
	types: {model: {}, msg: {}},
	init: (loaded) => (loaded !== null ? [loaded, []] : [{count: 0}, []]),
	update: {inc: (s) => [{count: s.count + 1}, []]},
});
const tick = () => act(async () => new Promise((r) => setTimeout(r, 15)));
let n = 0;
const fresh = () => {
	const el = document.createElement("div");
	el.id = `r${n++}`;
	document.body.append(el);
	const root = createRoot(el);
	return {el, root, read: () => el.textContent};
};
const quiet = async (fn) => {
	let out = "ok";
	await act(async () => {
		try {
			await fn();
		} catch (_error) {
			out = "threw";
		}
	});
	return out;
};
const strictly = (yes, tree) => (yes ? h(React.StrictMode, null, tree) : tree);

/** P1: tea's useMachine on the Promise engine: a click, then a hide and a show. */
async function p1(strict, activity) {
	const {useMachine} = react22;
	const {run} = promise22;
	let send;
	function Counter() {
		const [s, dispatch] = useMachine(counter, {run, ctx: undefined});
		send = dispatch;
		return h("span", null, String(s.count));
	}
	const {root, read} = fresh();
	const at = (mode) =>
		strictly(strict, activity ? h(React.Activity, {mode}, h(Counter)) : h(Counter));
	await act(async () => root.render(at("visible")));
	await tick();
	const r = await quiet(() => send({type: "inc"}));
	await tick();
	let got = `${r} ${read()}`;
	if (activity) {
		await act(async () => root.render(at("hidden")));
		await tick();
		await act(async () => root.render(at("visible")));
		await tick();
		const r2 = await quiet(() => send({type: "inc"}));
		await tick();
		got += ` | show, ${r2} ${read()}`;
	}
	await act(async () => root.unmount());
	const want = activity ? "ok 1 | show, ok 2" : "ok 1";
	return {
		probe: `P1 useMachine${strict ? " strict" : ""}${activity ? " activity" : ""}`,
		want,
		got,
	};
}

/** P2: a run on the Effect engine, booted outside React, read through tea's useRuntime. */
async function p2() {
	let rt;
	let fiber;
	await new Promise((resolve) => {
		fiber = Effect.runFork(
			Effect.scoped(
				Effect.gen(function* () {
					rt = yield* (yield* effectRun(counter, {ctx: undefined})).ready;
					resolve();
					return yield* Effect.never;
				}),
			),
		);
	});
	let send;
	function ViaTea() {
		const [s, dispatch] = react22.useRuntime(rt);
		send = dispatch;
		return h("span", null, String(s.count));
	}
	const {root, read} = fresh();
	await act(async () => root.render(strictly(true, h(ViaTea))));
	await tick();
	const first = read();
	await quiet(() => send({type: "inc"}));
	await tick();
	const afterTeaClick = read();
	await quiet(() => Effect.runPromise(rt.dispatch({type: "inc"})));
	await tick();
	const afterEffect = read();
	await act(async () => root.unmount());
	Effect.runFork(Fiber.interrupt(fiber));
	return [
		{probe: "P2 Effect run → useRuntime: draws", want: "0", got: first},
		{probe: "P2 Effect run → useRuntime: tea's dispatch", want: "1", got: afterTeaClick},
		{probe: "P2 Effect run → useRuntime: redraws on change", want: "1", got: afterEffect},
	];
}

/** P3: the Compiler (PR 320's settings), today's desk shape against tea's value. */
async function p3(kind) {
	const mod = kind === "compiled" ? compiled : plain;
	const rt = await promise22.run(counter, {ctx: undefined}).ready;
	mod.store.count = 0;
	mod.store.version = 0;
	const dropped = fresh();
	const drawn = fresh();
	await act(async () => {
		dropped.root.render(h(mod.Dropped));
		drawn.root.render(h(mod.Drawn, {rt}));
	});
	for (let i = 0; i < 3; i++) {
		await act(async () => {
			mod.bump();
			await rt.dispatch({type: "inc"});
		});
	}
	await tick();
	const got = `dropped ${dropped.read()}, drawn ${drawn.read()}`;
	await act(async () => {
		dropped.root.unmount();
		drawn.root.unmount();
	});
	await rt.stop();
	return {probe: `P3 ${kind}`, want: "dropped 3, drawn 3", got};
}

/** P4: the sketch hook that owns an Effect run: Strict Mode, a hide and a show, an unmount. */
async function p4(strict) {
	let send;
	function Counter() {
		const [s, dispatch] = useEffectMachine(counter, {ctx: undefined});
		send = dispatch;
		return h("span", null, String(s.count));
	}
	const {root, read} = fresh();
	const at = (mode) => strictly(strict, h(React.Activity, {mode}, h(Counter)));
	await act(async () => root.render(at("visible")));
	await tick();
	await quiet(() => send({type: "inc"}));
	await tick();
	const one = read();
	await act(async () => root.render(at("hidden")));
	await tick();
	await act(async () => root.render(at("visible")));
	await tick();
	await quiet(() => send({type: "inc"}));
	await tick();
	const two = read();
	const m = mounted.last;
	const rt = m.rt;
	await act(async () => root.unmount());
	await tick();
	const after = await Effect.runPromise(Effect.result(rt.dispatch({type: "inc"})));
	const stopped = after._tag === "Failure" ? "run stopped" : "run still alive";
	return {
		probe: `P4 useEffectMachine${strict ? " strict" : ""} activity`,
		want: "1, show 2, starts 1, run stopped",
		got: `${one}, show ${two}, starts ${m.starts}, ${stopped}`,
	};
}

export async function runAll(times) {
	const rows = new Map();
	const add = (r) => {
		const row = rows.get(r.probe) ?? {probe: r.probe, want: r.want, got: new Map()};
		row.got.set(r.got, (row.got.get(r.got) ?? 0) + 1);
		rows.set(r.probe, row);
	};
	for (let t = 0; t < times; t++) {
		for (const [strict, activity] of [
			[false, false],
			[true, false],
			[false, true],
			[true, true],
		])
			add(await p1(strict, activity));
		for (const r of await p2()) add(r);
		add(await p3("plain"));
		add(await p3("compiled"));
		add(await p4(false));
		add(await p4(true));
	}
	return [...rows.values()].map((r) => ({
		probe: r.probe,
		want: r.want,
		got: Object.fromEntries(r.got),
	}));
}
