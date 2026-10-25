import {applyCell} from "@demlik/tea";
import {Effect} from "effect";
import type {Ghostty} from "ghostty-web";
import {
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {flushSync} from "react-dom";
import {createRoot} from "react-dom/client";
import {
	activeOf,
	type Desk,
	focusedOf,
	type Open,
	questionOf,
	tilesOf,
	type Workspace,
} from "../desk/desk.ts";
import {type Hold, type HoldCmd, type HoldMsg, holdMachine, type Key} from "../desk/hold.ts";
import {keyName} from "../desk/keys.ts";
import {
	findTile,
	type LayoutNode,
	type StackNode,
	type TileId,
	type TileNode,
} from "../desk/layout/index.ts";
import {type FromPage, readToPage, readToWindow, type ToWindow} from "../messages.ts";
import {loadGhostty, type TileTerminal, terminalFor} from "./terminal.ts";
import {WINDOWS} from "./windows.tsx";

// The desk's page: the app's one window, tiled like tmux. It draws the desk the host sends
// (desk/desk.ts runs in the host, host/serve.ts), and sends it the keys the desk takes, and its
// clicks. A reload, a new window or a second app draws the same desk, as every tmux client does.
//
//   Ctrl-B |      sent to the host: it splits the focused tile, t2's tsh starts there, and the
//                 page draws the desk it is sent back
//   Ctrl-B l      the same: focus moves right
//   counter       typed into t1's terminal, which sends it to t1's tsh in the host
//   Ctrl-B x      "close t1? (y/n)" on the tile; y closes it, at once or once what runs in it ends
//
// Every key is read in the capture phase, before ghostty-web or a program's view sees it. The
// host says, with each desk, which keys the desk takes now (`takes`): those go to the host and no
// further. While one is out, later keys are held, and go on in order once the host answered
// (desk/hold.ts). No timer: a held key waits for the answer, or for the link to drop. Every other
// key stays in the page: typing in tsh goes to the terminal, and the terminal sends it on its
// tile's port; typing in a view's text box stays in the view, which sends only its program's
// declared inputs.
//
// Each tile's terminal is made once and moved into its slot as the layout changes (terminal.ts).
// A program's view is plain React, drawn whole from the newest view its run sent (windows.tsx).

/** The desk, the newest view of each run, and who to tell of a change. */
const store: {
	/** `null` until the host sends the desk. */
	desk: Desk | null;
	/** The desk's Ctrl-B key, as the host's table says. */
	prefix: string;
	/** Why the app is not attached to the host, said plainly, or `null`. */
	down: string | null;
	readonly views: Map<string, ToWindow>;
	readonly listeners: Set<() => void>;
	version: number;
} = {desk: null, prefix: "", down: null, views: new Map(), listeners: new Set(), version: 0};

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
/** The runs whose view this page hears, on each run's port. */
const followed = new Set<string>();
let ghostty: Ghostty | null = null;

const toHost = (m: FromPage) => window.fabrika.send("desk", m);

/** Hear a run's view on its port, from now on. */
const follow = (run: string) =>
	window.fabrika.onMessage(`run:${run}`, (raw) => {
		const read = readToWindow(raw);
		if (read.kind === "refused") return console.warn(`fabrika: refused a view: ${read.why}`);
		store.views.set(run, read.msg);
		changed();
	});

/**
 * Make what the desk shows, and let go of what it no longer does: a terminal for each tile, in
 * any workspace, and the view of each run covering one.
 */
const follows = (desk: Desk) => {
	const all = desk.at === "open" ? desk.workspaces.flatMap((ws) => tilesOf(ws)) : [];
	const tiles = new Set(all.map((t) => t.id));
	const runs = new Set(all.flatMap((t) => (t.shows.run === null ? [] : [t.shows.run.id])));
	for (const tile of tiles)
		if (!terminals.has(tile) && ghostty !== null) terminals.set(tile, terminalFor(ghostty, tile));
	for (const [tile, term] of terminals) {
		if (tiles.has(tile)) continue;
		term.dispose();
		terminals.delete(tile);
	}
	for (const run of runs) {
		if (followed.has(run)) continue;
		followed.add(run);
		follow(run);
	}
	for (const run of followed) {
		if (runs.has(run)) continue;
		followed.delete(run);
		store.views.delete(run);
		window.fabrika.forget(`run:${run}`);
	}
};

/** The keys while the host decides. */
let hold: Hold = holdMachine.init(null, undefined)[0];
/** A key held back is being pressed again: the page's own listener lets it go by. */
let replaying = false;

/** Is this element one a key types into: a text box, or an editable region of a view? */
const editable = (el: Element | null): el is HTMLElement =>
	el instanceof HTMLInputElement ||
	el instanceof HTMLTextAreaElement ||
	(el instanceof HTMLElement && el.isContentEditable && el.closest("[data-view]") !== null);

/**
 * Press a held key again, where focus is now: a character into a view's text box, as typing
 * does, or the key itself, which a tile's terminal reads as it reads the keyboard's.
 */
const pressAgain = (key: Key) => {
	const p = key.press;
	const target = document.activeElement ?? document.body;
	replaying = true;
	if (editable(target) && p.key.length === 1 && !p.ctrl && !p.alt && !p.meta)
		document.execCommand("insertText", false, p.key);
	else
		target.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: p.key,
				code: p.code,
				ctrlKey: p.ctrl,
				altKey: p.alt,
				metaKey: p.meta,
				shiftKey: p.shift,
				bubbles: true,
				cancelable: true,
			}),
		);
	replaying = false;
};

/** Step the hold by one Msg. Answers whether the key pressed this instant goes on as it is. */
const holdStep = (msg: HoldMsg): boolean => {
	const [next, cmds] = applyCell<Hold, HoldMsg, HoldCmd>(holdMachine, hold, msg);
	hold = next;
	let live = false;
	for (const c of cmds) {
		if (c.type === "press") toHost({type: "press", id: c.id, key: c.key});
		else if (!c.held) live = true;
		else pressAgain(c.key);
	}
	return live;
};

/** What the host, or the app when the host is not there, tells the page on the desk's port. */
const heard = (raw: unknown) => {
	const read = readToPage(raw);
	if (read.kind === "refused") return console.warn(`fabrika: refused a message: ${read.why}`);
	const m = read.msg;
	switch (m.type) {
		case "keys":
			store.prefix = m.prefix;
			return changed();
		case "desk":
			store.desk = m.desk;
			store.down = null;
			follows(m.desk);
			// Drawn now, so a key held for this answer lands on the tile the desk just focused.
			flushSync(changed);
			holdStep({type: "takes", takes: m.takes});
			return;
		case "answer":
			holdStep({type: "answer", id: m.id, took: m.took});
			return;
		case "down":
			store.down = m.why;
			holdStep({type: "down"});
			return changed();
	}
};

/** Every key, before anything else on the page sees it: the desk's, or the focused tile's. */
const onKey = (e: KeyboardEvent) => {
	if (replaying) return;
	const name = keyName({key: e.key, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey});
	if (name === null) return;
	const press = {
		key: e.key,
		code: e.code,
		ctrl: e.ctrlKey,
		alt: e.altKey,
		meta: e.metaKey,
		shift: e.shiftKey,
	};
	if (holdStep({type: "key", key: {name, press}})) return;
	e.preventDefault();
	e.stopImmediatePropagation();
};

/** The run a tile shows, if any: a run covering its tsh. */
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
	/** The tile's question, as tmux's confirm-before asks it, or none. */
	readonly asking: string | null;
	readonly closing: boolean;
}): ReactNode {
	const {tile, focused, asking, closing} = props;
	const run = runOf(tile);
	return (
		<section
			className={`tile${focused ? " focused" : ""}${closing ? " closing" : ""}`}
			data-tile={tile.id}
			aria-label={`tile ${tile.id}${run === null ? "" : `, ${run.program}`}${closing ? ", closing" : ""}`}
			aria-current={focused}
			onPointerDownCapture={() => toHost({type: "click", tile: tile.id})}
		>
			<Slot tile={tile.id} />
			{run !== null && <View tile={tile.id} run={run.id} />}
			{closing && (
				<p className="closing-note" role="status">
					closing
				</p>
			)}
			{asking !== null && (
				<div className="ask" role="alertdialog" aria-label={asking}>
					<p>{asking}</p>
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
	readonly desk: Open;
}): ReactNode {
	const {stack, ws, desk} = props;
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
			toHost({type: "resize", stack: stack.id, sizes: last});
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
					<Node node={child} ws={ws} desk={desk} />
				</div>,
			])}
		</div>
	);
}

function Node(props: {
	readonly node: LayoutNode;
	readonly ws: Workspace;
	readonly desk: Open;
}): ReactNode {
	const {node, ws, desk} = props;
	if (node.tag === "stack") return <Stack stack={node} ws={ws} desk={desk} />;
	return <DeskTile tile={node} ws={ws} desk={desk} />;
}

/** A tile as the desk has it now: focused or not, asking or not, closing or not. */
function DeskTile(props: {
	readonly tile: TileNode;
	readonly ws: Workspace;
	readonly desk: Open;
}): ReactNode {
	const {tile, ws, desk} = props;
	return (
		<Tile
			tile={tile}
			focused={tile.id === ws.focused}
			asking={desk.ask === tile.id ? questionOf(desk, tile.id) : null}
			closing={desk.closing.includes(tile.id)}
		/>
	);
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
				{desk.prefix.armed ? store.prefix : ""}
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
	// when that changes, so a view's own input keeps focus while its view is drawn again. A layout
	// effect, so focus has moved before a key held for the host's answer is pressed again.
	useLayoutEffect(() => {
		if (focused === null) return;
		const into = document.querySelector(`[data-tile="${focused.id}"]`);
		if (into?.contains(document.activeElement) === true && document.activeElement !== into) return;
		if (focused.shows.kind === "tsh" && focused.shows.run === null)
			terminals.get(focused.id)?.focus();
		else document.querySelector<HTMLElement>(`[data-view="${focused.id}"]`)?.focus();
	}, [shown]);
	if (store.down !== null)
		return (
			<div className="down" role="alert">
				<h1>Not attached to the host</h1>
				<p>{store.down}</p>
			</div>
		);
	if (desk === null) return <p className="starting">starting</p>;
	if (desk.at === "over" || ws === null) return <p className="starting">closing</p>;
	const zoomed = ws.layout.zoomed;
	return (
		<div className="desk">
			<div className="workspace" data-workspace={ws.id} data-zoomed={zoomed ?? undefined}>
				{zoomed !== null ? (
					<ZoomedTile ws={ws} id={zoomed} desk={desk} />
				) : (
					<Node node={ws.layout.root} ws={ws} desk={desk} />
				)}
			</div>
			<Status desk={desk} />
		</div>
	);
}

function ZoomedTile(props: {
	readonly ws: Workspace;
	readonly id: TileId;
	readonly desk: Open;
}): ReactNode {
	const {ws, id, desk} = props;
	const tile = findTile(ws.layout, id);
	if (tile === null) return null;
	return <DeskTile tile={tile} ws={ws} desk={desk} />;
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
