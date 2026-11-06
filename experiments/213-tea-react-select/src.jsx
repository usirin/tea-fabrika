// The components under test. compile.mjs compiles this file twice: with the React Compiler, and without.
// Each component reports its own commits through `onDraw` in a no-deps effect, so nothing is
// written during render and the Compiler has no reason to skip a component.
import {useRuntime} from "@demlik/tea/react";
import {useEffect} from "react";

const IDS = ["a", "b", "c"];

/** Way 3b: each tile picks its own part of the model. */
export function Tile({run, id, onDraw}) {
	const [view, send] = useRuntime(run, (m) => m.views[id]);
	useEffect(() => onDraw(id));
	return (
		<button type="button" id={`tile-${id}`} onClick={() => send({type: "inc", id})}>
			{view.n}
		</button>
	);
}

export function Desk({run, onDraw}) {
	return (
		<div>
			{IDS.map((id) => (
				<Tile key={id} run={run} id={id} onDraw={onDraw} />
			))}
		</div>
	);
}

/** The baseline: the parent reads the whole model and hands each tile plain values. */
function PlainTile({id, n, send, onDraw}) {
	useEffect(() => onDraw(id));
	return (
		<button type="button" id={`whole-${id}`} onClick={() => send({type: "inc", id})}>
			{n}
		</button>
	);
}

export function WholeDesk({run, onDraw}) {
	const [m, send] = useRuntime(run);
	return (
		<div>
			{IDS.map((id) => (
				<PlainTile key={id} id={id} n={m.views[id].n} send={send} onDraw={onDraw} />
			))}
		</div>
	);
}

/** The trap the docs warn about: a selector that builds a new object on every read. */
export function BuiltTile({run, id}) {
	const [view] = useRuntime(run, (m) => ({n: m.views[id].n}));
	return <span id="built">{view.n}</span>;
}

/** A selector over a prop: the id changes between renders. */
export function Swap({run, id, onDraw}) {
	const [view] = useRuntime(run, (m) => m.views[id]);
	useEffect(() => onDraw(`${id}:${view.n}`));
	return (
		<span id="swap">
			{id}:{view.n}
		</span>
	);
}
