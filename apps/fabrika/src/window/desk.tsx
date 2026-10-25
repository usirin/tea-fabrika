import {applyCell} from "@demlik/tea";
import {Effect} from "effect";
import type {Ghostty} from "ghostty-web";
import {
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {createRoot} from "react-dom/client";
import {
	activeOf,
	claims,
	type Desk,
	type DeskCmd,
	type DeskMsg,
	deskMachine,
	focusedOf,
	type Open,
	restore,
	type Workspace,
} from "../desk/desk.ts";
import {keyName, PREFIX} from "../desk/keys.ts";
import {
	findTile,
	type LayoutNode,
	type StackNode,
	type TileId,
	type TileNode,
} from "../desk/layout/index.ts";
import {readToDesk, readToWindow, type ToWindow} from "../messages.ts";
import {loadGhostty, type TileTerminal, terminalFor} from "./terminal.ts";
import {WINDOWS} from "./windows.tsx";

// The desk's page: the app's one window, tiled like tmux. The desk machine (desk/desk.ts) runs
// here, stepped by hand with tea's `applyCell`, because a key must be judged the instant it is
// pressed: the page reads every key in the capture phase, before ghostty-web or a program's view
// sees it, and asks the desk whether it takes it (`claims`). A key the desk takes goes no further.
//
//   Ctrl-B |      the desk splits the focused tile: t2 beside t1, and t2's tsh starts
//   Ctrl-B l      focus moves right
//   counter       counter covers its tile; Ctrl-C there goes to that tile's tsh, which stops it
//   Ctrl-B x      the tile closes, after y or n if something runs in it
//
// The desk's Cmds go to the main process on the desk's port (bridge.ts), but `send`, which goes
// on the tile's own port as keys. What main tells the desk comes in on the desk's port.
//
// Each tile's terminal is made once and moved into its slot as the layout changes (terminal.ts).
// A program's view is plain React, drawn whole from the newest view its run sent (windows.tsx).

/** The desk, the newest view of each run, and who to tell of a change. */
const store: {
	/** `null` until main hands the desk kept from before. */
	desk: Desk | null;
	readonly views: Map<string, ToWindow>;
	readonly listeners: Set<() => void>;
	version: number;
} = {desk: null, views: new Map(), listeners: new Set(), version: 0};

const changed = () => {
	store.version += 1;
	for (const listener of store.listeners) listener();
};

const subscribe = (listener: () => void) => {
	store.listeners.add(listener);
	return () => {
		store.listeners.delete(listener);
	};
};

const terminals = new Map<TileId, TileTerminal>();
let ghostty: Ghostty | null = null;

/** Hear a run's view on its port, from now on. */
const follow = (run: string) =>
	window.fabrika.onMessage(`run:${run}`, (raw) => {
		const read = readToWindow(raw);
		if (read.kind === "refused") return console.warn(`fabrika: refused a view: ${read.why}`);
		store.views.set(run, read.msg);
		changed();
	});

/** Carry out what the desk asked for. */
const perform = (cmds: readonly DeskCmd[]) => {
	for (const c of cmds) {
		switch (c.type) {
			case "open":
				if (!terminals.has(c.tile) && ghostty !== null)
					terminals.set(c.tile, terminalFor(ghostty, c.tile));
				window.fabrika.send("desk", {type: "open", tile: c.tile});
				break;
			case "close":
				terminals.get(c.tile)?.dispose();
				terminals.delete(c.tile);
				window.fabrika.send("desk", {type: "close", tile: c.tile});
				break;
			case "stop":
				window.fabrika.send("desk", {type: "stop", run: c.run});
				break;
			case "send":
				window.fabrika.send(`tile:${c.tile}`, {type: "keys", data: c.data});
				break;
			case "save":
				window.fabrika.send("desk", {type: "save", desk: c.desk});
				break;
			case "quit":
				window.fabrika.send("desk", {type: "quit"});
				break;
		}
	}
};

/** Step the desk by one Msg, at once, and carry out what it asks. */
const dispatch = (msg: DeskMsg) => {
	const now = store.desk;
	if (now === null) return;
	const [next, cmds] = applyCell<Desk, DeskMsg, DeskCmd>(deskMachine, now, msg);
	store.desk = next;
	perform(cmds);
	changed();
};

/** What main tells the desk. */
const heard = (raw: unknown) => {
	const read = readToDesk(raw);
	if (read.kind === "refused") return console.warn(`fabrika: refused a message: ${read.why}`);
	const m = read.msg;
	if (m.type === "start") {
		const [desk, cmds] = deskMachine.init(restore(m.saved), undefined);
		store.desk = desk;
		perform(cmds);
		return changed();
	}
	if (m.type === "covered" || m.type === "beside") follow(m.run.id);
	if (m.type === "over") {
		store.views.delete(m.run);
		window.fabrika.forget(`run:${m.run}`);
	}
	dispatch(m);
};

/** Every key, before anything else on the page sees it: the desk's, or the focused tile's. */
const onKey = (e: KeyboardEvent) => {
	const desk = store.desk;
	const key = keyName({key: e.key, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey});
	if (desk === null || key === null || !claims(desk, key, e.timeStamp)) return;
	e.preventDefault();
	e.stopImmediatePropagation();
	dispatch({type: "key", key, at: e.timeStamp});
};

/** The run a tile shows, if any: a run covering its tsh, or the run whose own tile it is. */
const runOf = (tile: TileNode) => tile.shows.run;

function View({tile, run}: {readonly tile: TileId; readonly run: string}): ReactNode {
	const view = store.views.get(run);
	const send = (msg: unknown) => window.fabrika.send(`run:${run}`, {type: "msg", msg});
	const known = view === undefined ? undefined : WINDOWS.get(view.program);
	return (
		// Focus sits here when the tile is focused: the keys a view takes go to it alone.
		<main
			className="program"
			aria-label={`${view?.program ?? "program"} view`}
			data-view={tile}
			tabIndex={-1}
		>
			{view === undefined ? (
				<p className="starting">starting</p>
			) : known === undefined ? (
				<p role="alert">no view for {view.program} in this app</p>
			) : (
				known.draw(view.data, send)
			)}
		</main>
	);
}

function Slot({tile}: {readonly tile: TileId}): ReactNode {
	const ref = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		if (ref.current !== null) terminals.get(tile)?.attach(ref.current);
	});
	return <div className="slot" ref={ref} />;
}

function Tile(props: {
	readonly tile: TileNode;
	readonly focused: boolean;
	readonly asking: boolean;
}): ReactNode {
	const {tile, focused, asking} = props;
	const run = runOf(tile);
	return (
		<section
			className={`tile${focused ? " focused" : ""}`}
			data-tile={tile.id}
			aria-label={`tile ${tile.id}${run === null ? "" : `, ${run.program}`}`}
			aria-current={focused}
			onPointerDownCapture={() => dispatch({type: "click", tile: tile.id})}
		>
			{tile.shows.kind === "tsh" && <Slot tile={tile.id} />}
			{run !== null && <View tile={tile.id} run={run.id} />}
			{asking && (
				<div className="ask" role="alertdialog" aria-label="close the tile">
					<p>
						Close {tile.id} and stop what runs in it? <kbd>y</kbd> or <kbd>n</kbd>
					</p>
				</div>
			)}
		</section>
	);
}

/** The share of each child, after a drag of the border between `at` and the next child. */
const dragged = (stack: StackNode, at: number, fraction: number) => {
	const ids = stack.children.map((c) => c.id);
	const a = ids[at];
	const b = ids[at + 1];
	if (a === undefined || b === undefined) return stack.sizes;
	const before = ids.slice(0, at).reduce((sum, id) => sum + (stack.sizes[id] ?? 0), 0);
	const pair = (stack.sizes[a] ?? 0) + (stack.sizes[b] ?? 0);
	const MIN = Math.min(5, pair / 2);
	const left = Math.min(pair - MIN, Math.max(MIN, fraction * 100 - before));
	return {...stack.sizes, [a]: left, [b]: pair - left};
};

function Stack(props: {
	readonly stack: StackNode;
	readonly ws: Workspace;
	readonly ask: TileId | null;
}): ReactNode {
	const {stack, ws, ask} = props;
	const ref = useRef<HTMLDivElement>(null);
	/** While a border is dragged, the sizes drawn: the desk is told once, when it is let go. */
	const [drag, setDrag] = useState<Readonly<Record<string, number>> | null>(null);
	const sizes = drag ?? stack.sizes;
	const across = stack.orientation === "horizontal";
	const border = (at: number) => (e: ReactPointerEvent<HTMLHRElement>) => {
		e.preventDefault();
		e.stopPropagation();
		const box = ref.current?.getBoundingClientRect();
		if (box === undefined) return;
		const target = e.currentTarget;
		target.setPointerCapture(e.pointerId);
		let last = stack.sizes;
		const move = (m: PointerEvent) => {
			const fraction = across
				? (m.clientX - box.left) / box.width
				: (m.clientY - box.top) / box.height;
			last = dragged(stack, at, fraction);
			setDrag(last);
		};
		const up = () => {
			target.removeEventListener("pointermove", move);
			target.removeEventListener("pointerup", up);
			setDrag(null);
			dispatch({type: "resize", stack: stack.id, sizes: last});
		};
		target.addEventListener("pointermove", move);
		target.addEventListener("pointerup", up);
	};
	return (
		<div className={`stack ${stack.orientation}`} data-stack={stack.id} ref={ref}>
			{stack.children.flatMap((child, i) => [
				...(i === 0
					? []
					: [
							<hr
								key={`border-${child.id}`}
								className="border"
								aria-orientation={across ? "vertical" : "horizontal"}
								onPointerDown={border(i - 1)}
							/>,
						]),
				<div key={child.id} className="cell" style={{flexGrow: sizes[child.id] ?? 1}}>
					<Node node={child} ws={ws} ask={ask} />
				</div>,
			])}
		</div>
	);
}

function Node(props: {
	readonly node: LayoutNode;
	readonly ws: Workspace;
	readonly ask: TileId | null;
}): ReactNode {
	const {node, ws, ask} = props;
	if (node.tag === "stack") return <Stack stack={node} ws={ws} ask={ask} />;
	return <Tile tile={node} focused={node.id === ws.focused} asking={ask === node.id} />;
}

function Status({desk}: {readonly desk: Open}): ReactNode {
	const tile = focusedOf(desk);
	const running = tile === null ? 0 : (desk.running[tile.id] ?? 0);
	return (
		<footer className="status">
			<ol className="workspaces" aria-label="workspaces">
				{desk.workspaces.map((ws, i) => (
					<li key={ws.id} aria-current={ws.id === desk.active}>
						{i + 1}
					</li>
				))}
			</ol>
			<span className="focus">
				{tile?.id ?? ""}
				{running > 0 ? ` · ${running} running` : ""}
			</span>
			<span className={`prefix${desk.prefix.armed ? " armed" : ""}`}>
				{desk.prefix.armed ? PREFIX : ""}
			</span>
		</footer>
	);
}

function App(): ReactNode {
	useSyncExternalStore(subscribe, () => store.version);
	const desk = store.desk;
	const ws = desk?.at === "open" ? activeOf(desk) : null;
	const focused = desk?.at === "open" ? focusedOf(desk) : null;
	const shown = focused === null ? "" : `${ws?.id}/${focused.id}/${runOf(focused)?.id ?? "tsh"}`;
	// Focus follows the desk: to the focused tile's terminal, or to the view that covers it. Only
	// when that changes, so a view's own input keeps focus while its view is drawn again.
	useEffect(() => {
		if (focused === null) return;
		const into = document.querySelector(`[data-tile="${focused.id}"]`);
		if (into?.contains(document.activeElement) === true && document.activeElement !== into) return;
		if (focused.shows.kind === "tsh" && focused.shows.run === null)
			terminals.get(focused.id)?.focus();
		else document.querySelector<HTMLElement>(`[data-view="${focused.id}"]`)?.focus();
	}, [shown]);
	if (desk === null) return <p className="starting">starting</p>;
	if (desk.at === "over" || ws === null) return <p className="starting">closing</p>;
	const zoomed = ws.layout.zoomed;
	return (
		<div className="desk">
			<div className="workspace" data-workspace={ws.id} data-zoomed={zoomed ?? undefined}>
				{zoomed !== null ? (
					<ZoomedTile ws={ws} id={zoomed} ask={desk.ask} />
				) : (
					<Node node={ws.layout.root} ws={ws} ask={desk.ask} />
				)}
			</div>
			<Status desk={desk} />
		</div>
	);
}

function ZoomedTile(props: {
	readonly ws: Workspace;
	readonly id: TileId;
	readonly ask: TileId | null;
}): ReactNode {
	const {ws, id, ask} = props;
	const tile = findTile(ws.layout, id);
	if (tile === null) return null;
	return <Tile tile={tile} focused={ws.focused === id} asking={ask === id} />;
}

const boot = Effect.gen(function* () {
	ghostty = yield* loadGhostty;
	window.addEventListener("keydown", onKey, {capture: true});
	window.fabrika.onMessage("desk", heard);
	const root = document.getElementById("root");
	if (root !== null) createRoot(root).render(<App />);
});

Effect.runFork(
	boot.pipe(
		Effect.catchCause((cause) =>
			Effect.sync(() => {
				const root = document.getElementById("root");
				if (root === null) return;
				root.setAttribute("role", "alert");
				root.textContent = `the desk could not start: ${String(cause)}`;
			}),
		),
	),
);
