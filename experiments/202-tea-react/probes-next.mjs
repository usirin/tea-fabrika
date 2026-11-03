// P6: the patched tea/react (send on post), bundled from the demlik clone's source.
// Each trial gives back { probe, want, got }.
import {defineMachine} from "@demlik/tea";
import {run as effectRun} from "@demlik/tea/effect";
import {run as promiseRun} from "@demlik/tea/promise";
import {useMachine, useRuntime} from "@demlik/tea/react";
import {Effect, Fiber} from "effect";
import * as React from "react";
import {createRoot} from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = React.createElement;
const act = React.act;
const counter = defineMachine({
	types: {model: {}, msg: {}},
	init: (loaded) => (loaded !== null ? [loaded, []] : [{count: 0}, []]),
	update: {
		inc: (s) => [{count: s.count + 1}, []],
		boom: () => {
			throw new Error("reducer threw");
		},
	},
});
const tick = () => act(async () => new Promise((r) => setTimeout(r, 15)));
const fresh = () => {
	const el = document.createElement("div");
	document.body.append(el);
	return {root: createRoot(el), read: () => el.textContent};
};
const strictly = (yes, tree) => (yes ? h(React.StrictMode, null, tree) : tree);

/** useMachine on the Promise engine: send, a hide and show, a reducer throw, a send after unmount. */
async function machine(strict) {
	const errors = [];
	const onError = (e, ctx) => errors.push(`${ctx.phase}:${e?.name ?? e}`);
	let send;
	function Counter() {
		const [s, sendMsg] = useMachine(counter, {run: promiseRun, ctx: undefined, onError});
		send = sendMsg;
		return h("span", null, String(s.count));
	}
	const {root, read} = fresh();
	const at = (mode) => strictly(strict, h(React.Activity, {mode}, h(Counter)));
	await act(async () => root.render(at("visible")));
	await tick();
	let returned = "unset";
	await act(async () => {
		returned = send({type: "inc"});
	});
	await tick();
	const one = read();
	await act(async () => root.render(at("hidden")));
	await tick();
	await act(async () => root.render(at("visible")));
	await tick();
	await act(async () => send({type: "inc"}));
	await tick();
	const two = read();
	await act(async () => send({type: "boom"}));
	await tick();
	await act(async () => root.unmount());
	await tick();
	send({type: "inc"});
	await tick();
	return {
		probe: `P6 useMachine${strict ? " strict" : ""} activity`,
		want: "returns undefined; 1, show 2; errors reduce+discard",
		got: `returns ${returned}; ${one}, show ${two}; errors ${[...new Set(errors)].join(",")}`,
	};
}

/** useRuntime on an Effect-engine run: the click that did nothing before. */
async function effectRuntime() {
	let rt;
	let fiber;
	await new Promise((resolve) => {
		fiber = Effect.runFork(
			Effect.scoped(
				Effect.gen(function* () {
					rt = yield* (yield* effectRun(counter, {ctx: undefined, onError: () => {}})).ready;
					resolve();
					return yield* Effect.never;
				}),
			),
		);
	});
	let send;
	function ViaTea() {
		const [s, sendMsg] = useRuntime(rt);
		send = sendMsg;
		return h("span", null, String(s.count));
	}
	const {root, read} = fresh();
	await act(async () => root.render(strictly(true, h(ViaTea))));
	await tick();
	await act(async () => send({type: "inc"}));
	await tick();
	await act(async () => send({type: "inc"}));
	await tick();
	const got = read();
	await act(async () => root.unmount());
	await Effect.runPromise(Fiber.interrupt(fiber));
	return {probe: "P6 Effect run → useRuntime: send", want: "2", got};
}

/** useRuntime on a hand-built handle: no line to post to, so its own dispatch. */
async function handBuilt() {
	let state = {count: 0};
	const listeners = new Set();
	const handle = {
		getState: () => state,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		dispatch: async (msg) => {
			if (msg.type === "inc") state = {count: state.count + 1};
			for (const l of listeners) l();
		},
	};
	let send;
	function ViaFake() {
		const [s, sendMsg] = useRuntime(handle);
		send = sendMsg;
		return h("span", null, String(s.count));
	}
	const {root, read} = fresh();
	await act(async () => root.render(h(ViaFake)));
	await act(async () => send({type: "inc"}));
	await tick();
	const got = read();
	await act(async () => root.unmount());
	return {probe: "P6 hand-built handle → useRuntime: send", want: "1", got};
}

export async function runAll(times) {
	const rows = new Map();
	const add = (r) => {
		const row = rows.get(r.probe) ?? {probe: r.probe, want: r.want, got: new Map()};
		row.got.set(r.got, (row.got.get(r.got) ?? 0) + 1);
		rows.set(r.probe, row);
	};
	for (let t = 0; t < times; t++) {
		add(await machine(false));
		add(await machine(true));
		add(await effectRuntime());
		add(await handBuilt());
	}
	return [...rows.values()].map((r) => ({
		probe: r.probe,
		want: r.want,
		got: Object.fromEntries(r.got),
	}));
}
