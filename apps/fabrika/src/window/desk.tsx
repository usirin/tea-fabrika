import {applyCell} from "@demlik/tea";
import {absurd, Effect} from "effect";
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
	type ContainerNode,
	findTile,
	fold,
	isFolded,
	type LayoutNode,
	lineOf,
	type NodeId,
	openShares,
	type TileId,
	type TileNode,
	tiles,
} from "../desk/layout/index.ts";
import {
	type Attached,
	type FromPage,
	type LinkNow,
	readToPage,
	readToWindow,
	type ToApp,
	type ToWindow,
} from "../messages.ts";
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
//   title bar     a click focuses its tile; a double-click folds it into a strip, in its place;
//                 a click on the strip opens it
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
//
// When the link to the host drops, the app reconnects (reconnect.ts) and says so here: the desk
// stays drawn, dimmed and out of reach, with a calm note in its corner. Nothing takes focus, and
// no dialog opens. Once the app says the link is up again, the desk is in reach, and focus goes
// back to the tile.
//
// What the window shows of the link is one value, `LinkNow` (messages.ts), and `linkView` has
// one branch for each of its kinds, so a kind left out fails the typecheck:
//
//   up            the desk, nothing more
//   build         the desk, with a banner: "the host runs older code", and the restart
//   version       no desk: both versions named, and the restart
//   reconnecting  the desk dimmed, with a note in its corner
//   stopped       the same, with Try again
//   restarting    the desk dimmed: "Stopping the old host..."

/** The desk, the newest view of each run, and who to tell of a change. */
const store: {
	/** `null` until the host sends the desk. */
	desk: Desk | null;
	/** The desk's Ctrl-B key, as the host's table says. */
	prefix: string;
	/** What the window shows of the link, as the app said last. */
	link: LinkNow;
	readonly views: Map<string, ToWindow>;
	readonly listeners: Set<() => void>;
	version: number;
} = {
	desk: null,
	prefix: "",
	link: {kind: "up"},
	views: new Map(),
	listeners: new Set(),
	version: 0,
};

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
/** What the page tells the app itself: on the desk's port, read by main and not passed on. */
const toApp = (m: ToApp) => window.fabrika.send("desk", m);

/** Hear a run's view on its port, from now on. */
const follow = (run: string) =>
	window.fabrika.onMessage(`run:${run}`, (raw) => {
		const read = readToWindow(raw);
		if (read.kind === "refused") return console.warn(`fabrika: refused a view: ${read.why}`);
		store.views.set(run, read.msg);
		changed();
	});

/**
 * Make what the desk shows, and let go of what it no longer does: a terminal for each tile with a
 * tsh, in any workspace, and the view of each run shown in one. A line's window has no terminal.
 */
const follows = (desk: Desk) => {
	const all = desk.at === "open" ? desk.workspaces.flatMap((ws) => tilesOf(ws)) : [];
	const tiles = new Set(all.flatMap((t) => (t.shows.kind === "window" ? [] : [t.id])));
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

/** The workspace's element, measured for the host, and the size it was last told. */
let measured: HTMLElement | null = null;
let told = "";

/**
 * Tell the host the workspace's size in px, when it changed: the desk opens a line's windows
 * folded where they would be too small (layout/line.ts). `again` tells it even when it did not
 * change, as to a host attached anew.
 */
const tellArea = (again = false) => {
	if (measured === null) return;
	const width = Math.round(measured.clientWidth);
	const height = Math.round(measured.clientHeight);
	const now = `${width}x${height}`;
	if (now === told && !again) return;
	told = now;
	toHost({type: "area", width, height});
};

const sizes = new ResizeObserver(() => tellArea());

/** The workspace's ref: measured while it is drawn. */
const measure = (el: HTMLDivElement | null) => {
	if (measured !== null) sizes.unobserve(measured);
	measured = el;
	if (el !== null) sizes.observe(el);
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
			follows(m.desk);
			// Drawn now, so a key held for this answer lands on the tile the desk just focused.
			flushSync(changed);
			holdStep({type: "takes", takes: m.takes});
			return;
		case "answer":
			holdStep({type: "answer", id: m.id, took: m.took});
			return;
		case "link":
			store.link = m.now;
			// Off a host, a key held for its answer gets none: the hold lets them go.
			if (!attached(m.now)) holdStep({type: "down"});
			// On one, it may be a host that never heard the workspace's size.
			else tellArea(true);
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

/** What a strip or a title bar calls a node: its tile's program, or its tiles' programs in order. */
const nameOf = (node: LayoutNode): string =>
	[...tiles(node)].map((tile) => runOf(tile)?.program ?? "tsh").join(" · ");

/**
 * The tint a node is drawn with: its line's, when every tile under it shows a window of the one
 * line, else none. The desk picks it (layout/line.ts); the page only mixes it in (window.css).
 */
const tintOf = (node: LayoutNode): number | undefined => {
	const lines = [...tiles(node)].map((tile) => lineOf(tile));
	const [first] = lines;
	if (first == null || lines.some((line) => line?.id !== first.id)) return undefined;
	return first.tint;
};

/** A press that takes no focus: the desk gives focus to a tile, and the page follows it. */
const noFocus = (e: ReactPointerEvent) => e.preventDefault();

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
	/** Does the desk let this tile fold: no for the last open tile of the workspace. */
	readonly folds: boolean;
}): ReactNode {
	const {tile, focused, asking, closing, folds} = props;
	const run = runOf(tile);
	const line = lineOf(tile);
	const of = line === null ? "" : `, a window of the line typed in ${line.from}`;
	return (
		<section
			className={`tile${focused ? " focused" : ""}${closing ? " closing" : ""}`}
			data-tile={tile.id}
			data-tint={tintOf(tile)}
			aria-label={`tile ${tile.id}${run === null ? "" : `, ${run.program}`}${of}${closing ? ", closing" : ""}`}
			aria-current={focused}
			onPointerDownCapture={() => toHost({type: "click", tile: tile.id})}
		>
			{/* A press on the title bar focuses the tile, as anywhere on it; a double-click folds it,
			    as on a device's title bar in Ableton Live. Not `disabled` when it cannot fold: a
			    disabled button would swallow the press that focuses. */}
			<button
				type="button"
				className="titlebar"
				aria-label={`tile ${tile.id}: double-click to fold`}
				aria-disabled={!folds}
				onPointerDown={noFocus}
				onDoubleClick={() => {
					if (folds) toHost({type: "fold", tile: tile.id});
				}}
			>
				<span>{nameOf(tile)}</span>
				<span className="tid">{tile.id}</span>
			</button>
			{tile.shows.kind !== "window" && <Slot tile={tile.id} />}
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

/**
 * The sizes after a drag of the border between two open children, `a` and `b`: they split their
 * own two shares at `fraction` of the way across them, and no other child's share changes.
 */
const dragged = (
	sizes: Readonly<Record<NodeId, number>>,
	a: NodeId,
	b: NodeId,
	fraction: number,
): Readonly<Record<NodeId, number>> => {
	const pair = (sizes[a] ?? 0) + (sizes[b] ?? 0);
	const MIN = Math.min(5, pair / 2);
	const left = Math.min(pair - MIN, Math.max(MIN, fraction * pair));
	return {...sizes, [a]: left, [b]: pair - left};
};

/**
 * A row or a column. An open child gets its share of the space the strips leave (`openShares`),
 * with a border to drag between each two open children; a folded one is a strip in its place.
 */
function Container(props: {
	readonly container: ContainerNode;
	readonly ws: Workspace;
	readonly desk: Open;
}): ReactNode {
	const {container, ws, desk} = props;
	const ref = useRef<HTMLDivElement>(null);
	/** While a border is dragged, the sizes drawn: the desk is told once, when it is let go. */
	const [drag, setDrag] = useState<Readonly<Record<string, number>> | null>(null);
	const shares = openShares(drag === null ? container : {...container, sizes: drag});
	const row = container.orientation === "horizontal";
	const open = container.children.filter((child) => !isFolded(child)).map((child) => child.id);
	const cell = (id: NodeId) =>
		[...(ref.current?.children ?? [])].find(
			(el) => el instanceof HTMLElement && el.dataset.cell === id,
		);
	const border = (a: NodeId, b: NodeId) => (e: ReactPointerEvent<HTMLHRElement>) => {
		e.preventDefault();
		e.stopPropagation();
		const [first, second] = [cell(a)?.getBoundingClientRect(), cell(b)?.getBoundingClientRect()];
		if (first === undefined || second === undefined) return;
		const [from, to] = row ? [first.left, second.right] : [first.top, second.bottom];
		const target = e.currentTarget;
		target.setPointerCapture(e.pointerId);
		let last = container.sizes;
		const move = (m: PointerEvent) => {
			const at = row ? m.clientX : m.clientY;
			last = dragged(container.sizes, a, b, (at - from) / Math.max(1, to - from));
			setDrag(last);
		};
		const up = () => {
			target.removeEventListener("pointermove", move);
			target.removeEventListener("pointerup", up);
			setDrag(null);
			toHost({type: "resize", container: container.id, sizes: last});
		};
		target.addEventListener("pointermove", move);
		target.addEventListener("pointerup", up);
	};
	return (
		<div className={`container ${container.orientation}`} data-container={container.id} ref={ref}>
			{container.children.flatMap((child) => {
				if (isFolded(child)) return [<Strip key={child.id} node={child} />];
				const before = open[open.indexOf(child.id) - 1];
				return [
					...(before === undefined
						? []
						: [
								<hr
									key={`border-${child.id}`}
									className="border"
									aria-orientation={row ? "vertical" : "horizontal"}
									onPointerDown={border(before, child.id)}
								/>,
							]),
					<div
						key={child.id}
						className="cell"
						data-cell={child.id}
						style={{flexGrow: shares[child.id] ?? 1}}
					>
						<Node node={child} ws={ws} desk={desk} />
					</div>,
				];
			})}
		</div>
	);
}

/**
 * A folded tile, or a container whose tiles are all folded: a thin strip in its place, along its
 * parent's direction, named by its programs. A click opens every tile it stands for.
 */
function Strip({node}: {readonly node: LayoutNode}): ReactNode {
	const name = nameOf(node);
	return (
		<button
			type="button"
			className="strip"
			data-strip={node.id}
			data-tint={tintOf(node)}
			aria-label={`open ${name}, ${node.id}`}
			onPointerDown={noFocus}
			onClick={() => toHost({type: "unfold", node: node.id})}
		>
			<span className="strip-name">{name}</span>
		</button>
	);
}

function Node(props: {
	readonly node: LayoutNode;
	readonly ws: Workspace;
	readonly desk: Open;
}): ReactNode {
	const {node, ws, desk} = props;
	if (node.tag === "tile") return <DeskTile tile={node} ws={ws} desk={desk} />;
	return <Container container={node} ws={ws} desk={desk} />;
}

/** A tile as the desk has it now: focused or not, asking or not, closing or not, able to fold or not. */
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
			folds={fold(ws.layout, tile.id) !== ws.layout}
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

/**
 * The link is down and the app is on it: said in a corner of the desk, as a status, not an alert.
 * Stopped, it offers Try again, which takes no focus until the person moves to it. Before the
 * first desk came, the app was never attached: it is connecting, not reconnecting.
 */
function LostNote(props: {
	readonly lost: Extract<LinkNow, {readonly kind: "reconnecting" | "stopped"}>;
	readonly first: boolean;
}): ReactNode {
	const {lost, first} = props;
	const stopped = lost.kind === "stopped";
	const verb = first ? "connect" : "reconnect";
	return (
		<section className="lost-note" role="status" aria-label="the link to the host">
			<h1>
				{stopped
					? `Could not ${verb} to the host`
					: `${first ? "Connecting" : "Reconnecting"} to the host…`}
			</h1>
			<p>{lost.why}</p>
			{stopped ? (
				<>
					<p>It stopped trying after five minutes.</p>
					<button type="button" onClick={() => toApp({type: "again"})}>
						Try again
					</button>
				</>
			) : null}
		</section>
	);
}

/** What a restart does to the jobs, said before the person confirms. */
const JOBS_STOP =
	"Its running jobs stop. Their saved lists stay, and each comes back with attach %n.";

/** The one way out of a host that runs older code: the person confirms it, never the app on its own. */
function Restart(): ReactNode {
	return (
		<button type="button" onClick={() => toApp({type: "restart"})}>
			Stop the old host and start this one
		</button>
	);
}

/** Is the app on a host now: the desk is in reach. */
const attached = (now: LinkNow): now is Attached => now.kind === "up" || now.kind === "build";

/** What the window shows for the link: a page in place of the desk, or the desk with a note. */
type Shown =
	| {readonly kind: "instead"; readonly page: ReactNode}
	/** `dim`: the desk is out of reach, as the link is down. */
	| {readonly kind: "over"; readonly dim: boolean; readonly note: ReactNode};

/**
 * One branch for each kind of `LinkNow`: one left out does not compile. `first`: no desk came
 * yet, so the app was never attached.
 */
const linkView = (now: LinkNow, first: boolean): Shown => {
	switch (now.kind) {
		case "up":
			return {kind: "over", dim: false, note: null};
		case "build":
			// Attached, and the desk is in reach: a banner, not an alert.
			return {
				kind: "over",
				dim: false,
				note: (
					<section className="older-note" role="status" aria-label="the host's build">
						<h1>The host runs older code</h1>
						<p>
							{now.theirs === null
								? `It names no build. This app is build ${now.ours}.`
								: `It is build ${now.theirs}. This app is build ${now.ours}.`}{" "}
							{JOBS_STOP}
						</p>
						<Restart />
					</section>
				),
			};
		case "version":
			// Another version of the link: the app does not attach, so there is no desk to keep.
			return {
				kind: "instead",
				page: (
					<div className="down" role="alert">
						<h1>Not attached to the host</h1>
						<p>
							The host speaks link version {now.theirs}. This app speaks {now.ours}.
						</p>
						<p>That host runs on, with its jobs. {JOBS_STOP}</p>
						<Restart />
					</div>
				),
			};
		case "reconnecting":
		case "stopped":
			return {kind: "over", dim: true, note: <LostNote lost={now} first={first} />};
		case "restarting":
			return {
				kind: "over",
				dim: true,
				note: (
					<section className="lost-note" role="status" aria-label="the link to the host">
						<h1>Stopping the old host…</h1>
						<p>Once it has stopped, this app starts its own and attaches.</p>
					</section>
				),
			};
		default:
			return absurd(now);
	}
};

function App(): ReactNode {
	useSyncExternalStore(subscribe, () => store.version);
	const desk = store.desk;
	const view = linkView(store.link, desk === null);
	/** The desk is out of reach: the link is down, or there is no desk to reach. */
	const away = view.kind === "instead" || view.dim;
	const ws = desk?.at === "open" ? activeOf(desk) : null;
	const focused = desk?.at === "open" ? focusedOf(desk) : null;
	const shown = focused === null ? "" : `${ws?.id}/${focused.id}/${runOf(focused)?.id ?? "tsh"}`;
	// Focus follows the desk: to the focused tile's terminal, or to the view that covers it. Only
	// when that changes, so a view's own input keeps focus while its view is drawn again. A layout
	// effect, so focus has moved before a key held for the host's answer is pressed again. The
	// desk is out of reach while the link is down, so focus goes back to it once the link is up.
	useLayoutEffect(() => {
		if (focused === null || away) return;
		const into = document.querySelector(`[data-tile="${focused.id}"]`);
		if (into?.contains(document.activeElement) === true && document.activeElement !== into) return;
		if (focused.shows.kind === "tsh" && focused.shows.run === null)
			terminals.get(focused.id)?.focus();
		else document.querySelector<HTMLElement>(`[data-view="${focused.id}"]`)?.focus();
	}, [shown, away]);
	if (view.kind === "instead") return view.page;
	const note = view.note;
	if (desk === null) return note ?? <p className="starting">starting</p>;
	if (desk.at === "over" || ws === null) return note ?? <p className="starting">closing</p>;
	const zoomed = ws.layout.zoomed;
	return (
		<div className={`desk${view.dim ? " lost" : ""}`}>
			<div
				className="workspace"
				ref={measure}
				data-workspace={ws.id}
				data-zoomed={zoomed ?? undefined}
				inert={view.dim}
			>
				{zoomed !== null ? (
					<ZoomedTile ws={ws} id={zoomed} desk={desk} />
				) : (
					<Node node={ws.layout.root} ws={ws} desk={desk} />
				)}
			</div>
			<Status desk={desk} />
			{note}
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
