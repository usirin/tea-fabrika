// A browser-like page for React, and a tiny counter machine every probe shares.
import {JSDOM} from "jsdom";

const dom = new JSDOM("<!doctype html><div id=root></div>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const {defineMachine} = await import("@demlik/tea");

export const counter = defineMachine({
	types: {model: {}, msg: {}},
	init: (loaded) => (loaded !== null ? [loaded, []] : [{count: 0}, []]),
	update: {inc: (s) => [{count: s.count + 1}, []]},
});

export const React = await import("react");
export const {createRoot} = await import("react-dom/client");
export const h = React.createElement;
export const act = React.act;
export const tick = () => act(async () => new Promise((r) => setTimeout(r, 30)));
export const text = (id) => document.getElementById(id)?.textContent ?? "(gone)";

export const freshRoot = () => {
	const el = document.createElement("div");
	document.body.append(el);
	return createRoot(el);
};

/** Run `fn` inside act and give back what it threw, or "ok". */
export const tryAct = async (fn) => {
	let out = "ok";
	await act(async () => {
		try {
			await fn();
		} catch (e) {
			out = `threw: ${e?.message ?? e}`;
		}
	});
	return out;
};
