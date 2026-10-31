import type {BootedRunHandle} from "@demlik/tea";
import {run} from "@demlik/tea/effect";
import {useRuntime} from "@demlik/tea/react";
import {Effect, Option, Queue, Stream} from "effect";
import {createRoot} from "react-dom/client";
import {DESK, type Workspace} from "../desktop/desk.ts";
import {fold, type Placed, type Size} from "../desktop/fold.ts";
import {CounterView, countIn} from "../programs/counter/view.tsx";
import {deskIn, type Model, type Msg, startWindow, windowMachine} from "./machine.ts";

// The browser backend (W1): a tab that dials the brain, draws what it hears, and folds by its own
// size. All it keeps is in one tea machine, which runs on the Effect engine; `useRuntime` is how
// React reads it.

const WORKSPACE = 1;
const STATUS_H = 28;

const query = new URLSearchParams(location.search);
const peer = `w-${crypto.randomUUID().slice(0, 8)}`;

const sizeNow = (): Size => ({w: window.innerWidth, h: window.innerHeight - STATUS_H});

const dialUrl = (): string =>
	`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/peer/${peer}`;

/** The one socket this tab holds: the Elm way, a Sub listens and a Cmd sends. */
let socket: WebSocket | null = null;

const socketStream = (dial: number) =>
	Stream.callback<Msg>((queue) =>
		Effect.acquireRelease(
			Effect.sync(() => {
				const ws = new WebSocket(dialUrl());
				ws.onopen = () => Queue.offerUnsafe(queue, {type: "opened", dial});
				ws.onclose = () => Queue.offerUnsafe(queue, {type: "closed", dial});
				ws.onmessage = (event) => {
					if (typeof event.data === "string") {
						Queue.offerUnsafe(queue, {type: "frame", text: event.data});
					}
				};
				socket = ws;
				return ws;
			}),
			(ws) =>
				Effect.sync(() => {
					ws.onopen = null;
					ws.onclose = null;
					ws.onmessage = null;
					ws.close();
				}),
		),
	);

const sizeStream = Stream.callback<Msg>((queue) =>
	Effect.acquireRelease(
		Effect.sync(() => {
			const resized = () => Queue.offerUnsafe(queue, {type: "resized", size: sizeNow()});
			window.addEventListener("resize", resized);
			return resized;
		}),
		(resized) => Effect.sync(() => window.removeEventListener("resize", resized)),
	),
);

function Tile(props: {
	readonly tile: Placed;
	readonly focused: boolean;
	readonly data: unknown;
	readonly focus: () => void;
	readonly press: (m: {readonly type: "plus"}) => void;
}) {
	const {tile, focused, data} = props;
	const box = {left: tile.x, top: tile.y, width: tile.w, height: tile.h};
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: a click anywhere in a tile focuses it, as in tmux with the mouse on; keys come with W5.
		// biome-ignore lint/a11y/useKeyWithClickEvents: as above, keys come with W5.
		<div
			className={`tile${focused ? " focused" : ""}${tile.folded ? " folded" : ""}`}
			data-tile={tile.id}
			data-folded={tile.folded}
			data-focused={focused}
			style={box}
			onClick={props.focus}
		>
			{tile.folded ? (
				<>
					<span className="strip-name">{tile.id}</span>
					<span className="strip-count" data-count="">
						{countIn(data)}
					</span>
				</>
			) : (
				<>
					<header className="tile-head">
						<span>{tile.id}</span>
						<span className="tile-shows">{tile.shows}</span>
					</header>
					<CounterView data={data} press={props.press} />
				</>
			)}
		</div>
	);
}

const statusWords = (model: Model): string => {
	switch (model.link.is) {
		case "online":
			return "connected";
		case "waiting":
			return `link lost, reconnecting (try ${model.link.tries})`;
		case "dialing":
		case "hello":
			return model.link.tries === 0
				? "connecting"
				: `link lost, reconnecting (try ${model.link.tries})`;
	}
};

function Status({model}: {readonly model: Model}) {
	const newest = Math.max(0, ...Object.values(model.views).map((shown) => shown.ledger));
	const waiting = model.outbox.length;
	return (
		<footer className="status" data-link={model.link.is}>
			<span className="dot" />
			<span data-status="">{statusWords(model)}</span>
			<span className="faint" data-ledger={newest}>
				ledger rev {newest}
			</span>
			{waiting > 0 ? (
				<span className="faint" data-waiting={waiting}>
					{waiting} waiting to send
				</span>
			) : null}
			{model.refused === null ? null : <span className="faint">refused: {model.refused}</span>}
			<span className="faint right">{model.peer}</span>
		</footer>
	);
}

function Desk(props: {
	readonly model: Model;
	readonly workspace: Workspace;
	readonly dispatch: (msg: Msg) => void;
}) {
	const {model, workspace, dispatch} = props;
	const said = () => new Date().toISOString();
	const focus = (tile: string) => {
		if (workspace.focus === tile) return;
		dispatch({type: "press", pid: DESK, m: {type: "focus", n: workspace.n, tile}, said: said()});
	};
	return (
		<main className="desk" data-layout={JSON.stringify(workspace.layout)}>
			{fold(workspace.layout, model.size, workspace.focus).map((tile) => (
				<Tile
					key={tile.id}
					tile={tile}
					focused={workspace.focus === tile.id}
					data={model.views[tile.shows]?.data}
					focus={() => focus(tile.id)}
					press={(m) => dispatch({type: "press", pid: tile.shows, m, said: said()})}
				/>
			))}
		</main>
	);
}

function App({handle}: {readonly handle: BootedRunHandle<Model, Msg>}) {
	const [model, dispatch] = useRuntime(handle);
	const desk = deskIn(model);
	const workspace = Option.isSome(desk)
		? desk.value.workspaces.find((w) => w.n === WORKSPACE)
		: undefined;
	return (
		<>
			{workspace !== undefined ? (
				<Desk model={model} workspace={workspace} dispatch={dispatch} />
			) : (
				<main className="desk empty">waiting for the desk</main>
			)}
			<Status model={model} />
		</>
	);
}

const machine = windowMachine(
	startWindow({
		peer,
		ping: query.get("ping") ?? "30s",
		seed: crypto.getRandomValues(new Uint32Array(1))[0] ?? 1,
		size: sizeNow(),
	}),
);

const program = Effect.gen(function* () {
	const booting = yield* run(machine, {
		ctx: undefined,
		interpret: {
			send_text: (cmd) =>
				Effect.sync(() => {
					if (socket?.readyState === WebSocket.OPEN) socket.send(cmd.text);
				}),
		},
		subscribe: {
			socket: (sub) => socketStream(sub.deps.dial),
			size: () => sizeStream,
		},
	});
	const runtime = yield* booting.ready;
	// The Effect engine's handle speaks Effect; `useRuntime` speaks Promise. Only the verbs differ.
	const handle: BootedRunHandle<Model, Msg> = {
		...runtime,
		dispatch: (msg) => Effect.runPromise(runtime.dispatch(msg).pipe(Effect.ignore)),
		stop: () => Effect.runPromise(runtime.stop()),
		get ready() {
			return Promise.resolve(handle);
		},
	};
	const root = document.getElementById("root");
	if (root !== null) createRoot(root).render(<App handle={handle} />);
	return yield* Effect.never;
});

Effect.runFork(program.pipe(Effect.scoped));
