import {applyCell} from "@demlik/tea";
import {absurd, Effect} from "effect";
import type {Ghostty} from "ghostty-web";
import {
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useEffectEvent,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {flushSync} from "react-dom";
import {createRoot} from "react-dom/client";
import type {AsksNow} from "../asks.ts";
import {
	activeOf,
	type Desk,
	focusedOf,
	type Open,
	questionOf,
	route,
	tilesOf,
	type Workspace,
} from "../desk/desk.ts";
import {type Hold, type HoldCmd, type HoldMsg, holdMachine, type Key} from "../desk/hold.ts";
import {commandOn, defaults, Key as KeyCase, type Keys, spell} from "../desk/keymap.ts";
import {keyName, keyOwner, matchPress, THE_MACS} from "../desk/keys.ts";
import {
	type ContainerNode,
	findTile,
	fold,
	isFolded,
	type LayoutNode,
	type NodeId,
	openShares,
	type TileId,
	type TileNode,
} from "../desk/layout/index.ts";
import {type Editor, type EditorCmd, type EditorMsg, editorMachine} from "../keys/machine.ts";
import type {Snapshot} from "../keys/program.ts";
import {
	type Attached,
	type FromPage,
	type HostNow,
	type LinkNow,
	readToPage,
	readToWindow,
	type ToApp,
	type ToWindow,
} from "../messages.ts";
import {
	EXPLAIN_ON,
	focusFollows,
	FRAME,
	type Frame,
	type FrameMsg,
	stepFrame,
	keyGoesTo,
	type MidKey,
	type Shapes,
	ticketsShown,
} from "./frame.ts";
import {Band, BottomArea, type FrameProps, Over, TopBar} from "./frame.tsx";
import {type LayerChange} from "./layers.ts";
import {LayerEvents} from "./pop.tsx";
import {loadGhostty, type TileTerminal, terminalFor} from "./terminal.ts";
import {Strip, Tile} from "./tile.tsx";
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
// Each tile's terminal is made once and moved into its body as the layout changes (terminal.ts).
// A tile and a strip are drawn by tile.tsx.
// A program's view is plain React, drawn whole from the newest view its run sent (windows.tsx).
//
// Around the desk is the window's frame (frame.tsx, its words in frame.ts): the top bar is the
// whole desk (workspaces, the line, what asks you, the agents on the host, the ledger's sync and
// the host), and the bottom line is the tile you are in and the key you just pressed. Cmd-K opens
// the palette; C-b a the asks list, C-b ? every key, C-b i the info mode, C-b B hides both bars,
// C-b A, S and H the agents', sync and host lines.
//
// When the link to the host drops, the app reconnects (reconnect.ts) and the top bar says so, in
// a word: the desk stays drawn, dimmed and out of reach. Nothing takes focus, and no dialog opens.
// Once the app says the link is up again, the desk is in reach, and focus goes back to the tile.
//
// What the window shows of the link is one value, `LinkNow` (messages.ts), and `linkView` has
// one branch for each of its kinds, so a kind left out fails the typecheck:
//
//   up            the desk: the top bar shows the host's quiet icon, and no word
//   build         the desk: the top bar says host older, and its lines offer the restart
//   version       no desk: both versions named, and the restart
//   reconnecting  the desk dimmed: the top bar says host down, and its lines say why
//   stopped       the same, and its lines offer Try again
//   restarting    the desk dimmed: the top bar says host restarting

/** The desk, the newest view of each run, the frame's own state, and who to tell of a change. */
const store: {
	/** `null` until the host sends the desk. */
	desk: Desk | null;
	/** A desk came once: a link down after it is the host down. */
	attachedOnce: boolean;
	/** The keys file's table, as the host sent it last (desk/keymap.ts); the defaults until then. */
	keys: Keys;
	keysEditor: Editor | null;
	keySession: string;
	keyChanges: Snapshot["changes"];
	/** What each program takes and sends. */
	shapes: Shapes;
	/** What waits on the person, as the host counts it; `null` until it says. */
	asks: AsksNow | null;
	/** The host's own state: its process, its ledger, the agents on it; `null` until it says. */
	host: HostNow | null;
	/** What the frame shows over the desk, and its modes (frame.ts). */
	frame: Frame;
	/** What the window shows of the link, as the app said last. */
	link: LinkNow;
	readonly views: Map<string, ToWindow>;
	readonly listeners: Set<() => void>;
	version: number;
} = {
	desk: null,
	attachedOnce: false,
	keys: defaults,
	keysEditor: null,
	keySession: "",
	keyChanges: [],
	shapes: new Map(),
	asks: null,
	host: null,
	frame: FRAME,
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

const toHost = (m: FromPage) => {
	const routed =
		m.type === "press" && store.desk?.at === "open" && store.frame.over.kind !== "none"
			? route({...store.desk, keys: store.keys}, m.key, Date.now())
			: null;
	const does = m.type === "run" ? m.does : routed?.kind === "desk" ? routed.ran?.does : undefined;
	if (
		(does === 'tezgah."focus --to next"' || does === 'tezgah."focus --to previous"') &&
		store.frame.over.kind !== "none"
	)
		leftOver = true;
	window.fabrika.send("desk", m);
};
const layerInstances = new Map<string, string>();
const reportLayer = (change: LayerChange) => {
	const key = JSON.stringify(change.layer);
	const instance = change._tag === "open" ? crypto.randomUUID() : layerInstances.get(key);
	if (instance === undefined) return;
	if (change._tag === "open") layerInstances.set(key, instance);
	else layerInstances.delete(key);
	toHost({type: "layer", id: crypto.randomUUID(), instance, change, said: Date.now()});
};
const editKeys = (message: EditorMsg) => {
	if (store.keysEditor === null) return;
	const [next, cmds] = applyCell<Editor, EditorMsg, EditorCmd>(
		editorMachine,
		store.keysEditor,
		message,
	);
	store.keysEditor = next;
	for (const command of cmds)
		toHost({
			type: "keys.edit",
			edit: command.edit,
			request: `${store.keySession}:${command.request}`,
			said: Date.now(),
		});
	changed();
};
/** What the page tells the app itself: on the desk's port, read by main and not passed on. */
const toApp = (m: ToApp) => window.fabrika.send("desk", m);
/** One of a run's own inputs, on its port, as its window sends them (View, below). */
const toRun = (run: string, msg: unknown) => window.fabrika.send(`run:${run}`, {type: "msg", msg});

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

/** With something over the desk, keep focus in it: answers whether focus was already there. */
const focusOver = (target: EventTarget | null): "in" | "moved in" => {
	const box = document.querySelector<HTMLElement>(
		".keys-dialog[role='dialog'], .keys-dialog [role='dialog'], [data-over]",
	);
	if (box === null || (target instanceof Element && box.contains(target))) return "in";
	(box.querySelector<HTMLElement>("input") ?? box).focus();
	return "moved in";
};

/**
 * Is the desk mid-key: Ctrl-B armed, or its own question waiting? A key pressed while one is
 * still out at the host (Ctrl-B, its answer not in yet) queues behind it in the hold, so it counts
 * as armed: `C-b J` typed fast still reaches the desk and closes the list.
 */
const midKey = (): MidKey => {
	const open = store.desk?.at === "open" ? store.desk : null;
	return {
		armed: (open?.prefix.armed ?? false) || hold.waiting !== null,
		asking: open?.ask != null,
	};
};

/**
 * Who a key goes to, with what lies over the desk: the desk; the over, with focus in it; or the
 * over with focus outside it, so the key is dropped, never reaches a tile, and focus has moved in.
 * For a key pressed now and a key held for the host's answer alike: an over opens before that
 * answer is in, so a key can be held while it is already open.
 */
const keyForOver = (name: string, target: EventTarget | null): "desk" | "in" | "moved in" => {
	if (keyGoesTo(store.frame.over, name, store.keys.prefix, midKey()) !== "over") return "desk";
	return focusOver(target);
};

/**
 * Press a held key again, where focus is now: a character into a view's text box, as typing
 * does, or the key itself, which a tile's terminal reads as it reads the keyboard's.
 */
const pressAgain = (key: Key) => {
	const p = key.press;
	const target = document.activeElement ?? document.body;
	if (keyForOver(key.name, target) === "moved in") return;
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
				isComposing: p.composing ?? false,
				modifierAltGraph: p.altGraph ?? false,
				bubbles: true,
				cancelable: true,
			}),
		);
	replaying = false;
};

/** Step the hold by one Msg. Answers whether the key pressed this instant goes on as it is. */
const holdStep = (msg: HoldMsg): boolean => {
	const [next, cmds] = applyCell<Hold, HoldMsg, HoldCmd>(holdMachine, hold, msg);
	const wasWaiting = hold.waiting !== null;
	hold = next;
	if (wasWaiting !== (next.waiting !== null)) changed();
	let live = false;
	for (const c of cmds) {
		if (c.type === "press") toHost({type: "press", id: c.id, key: c.key});
		else if (!c.held) live = true;
		else pressAgain(c.key);
	}
	return live;
};

/** How long a note on the bottom line stays, as after the palette ran a command. */
const NOTE_MS = 4000;
let noteTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Step the frame's own state (frame.ts), and draw it. A note goes after a while. Answers whether
 * the frame changed: a key it did not change goes on.
 */
const frameStep = (m: FrameMsg): boolean => {
	const [next, changes] = stepFrame(store.frame, m);
	if (next === store.frame) return false;
	const wasKeys = store.frame.over.kind === "palette" && store.frame.over.title === "keys";
	const isKeys = next.over.kind === "palette" && next.over.title === "keys";
	if (wasKeys && !isKeys) {
		toHost({type: "keys.close"});
		store.keysEditor = null;
	}
	if (!wasKeys && isKeys) {
		store.keySession = crypto.randomUUID();
		store.keysEditor = editorMachine.init(store.keys, undefined)[0];
		toHost({type: "keys.open"});
	}
	if (next.note !== null && next.note !== store.frame.note) {
		clearTimeout(noteTimer);
		noteTimer = setTimeout(() => frameStep({type: "unnote"}), NOTE_MS);
	}
	store.frame = next;
	for (const change of changes) reportLayer(change);
	changed();
	return true;
};

/**
 * A cycle request keeps the overlay exit until its reply, even if navigation or the palette
 * closes it first. The exit wraps within open tiles; with one, it enters that tile again.
 */
let leftOver = false;

const closeForFocus = () => {
	if (store.frame.over.kind === "none") return;
	flushSync(() => frameStep({type: "close", reason: "navigation"}));
	leftOver = true;
};

const cycleFocus = (to: "next" | "previous") => {
	closeForFocus();
	const fromOver = leftOver;
	leftOver = false;
	const open = store.desk?.at === "open" ? store.desk : null;
	const ws = open === null ? null : activeOf(open);
	const screens =
		ws === null
			? []
			: tilesOf(ws).flatMap((tile) => {
					const element = document.querySelector<HTMLElement>(
						tile.shows.run === null
							? `[data-tile="${tile.id}"] .screen`
							: `[data-view="${tile.id}"]`,
					);
					return element === null || element.getClientRects().length === 0 ? [] : [{tile, element}];
				});
	const regions = [
		document.querySelector<HTMLElement>(".topbar button"),
		...screens.map(({element}) => element),
		document.querySelector<HTMLElement>(".bottomline button"),
	].filter((el): el is HTMLElement => el !== null && el.getClientRects().length > 0);
	if (regions.length < 2)
		regions.unshift(document.querySelector<HTMLElement>(".desk") ?? document.body);
	const at = regions.findIndex((el) =>
		el.matches(".desk") ? el === document.activeElement : el.contains(document.activeElement),
	);
	const tileAt = screens.findIndex(({tile}) => tile.id === ws?.focused);
	const target =
		fromOver && screens.length > 0
			? screens[(tileAt + (to === "next" ? 1 : screens.length - 1)) % screens.length]?.element
			: regions[(at + (to === "next" ? 1 : regions.length - 1)) % regions.length];
	const screen = screens.find(({element}) => element === target);
	if (screen !== undefined && screen.tile.id !== ws?.focused)
		toHost({type: "go", tile: screen.tile.id});
	if (screen !== undefined && screen.tile.shows.run === null)
		terminals.get(screen.tile.id)?.focus();
	else target?.focus();
};

/** What info mode says of a part of the page: the words of the nearest `data-info`, or `null`. */
const wordsAt = (at: EventTarget | null): string | null =>
	at instanceof Element ? (at.closest<HTMLElement>("[data-info]")?.dataset.info ?? null) : null;

/** A bottom-line item keyboard focus was on: its name (`data-item`) and its words in info mode. */
interface KeyedFrom {
	readonly item: string;
	readonly words: string | null;
}

/**
 * The bottom line's item keyboard focus was on when Ctrl-B was pressed, or `null`. While the desk
 * is mid-key, the line's right side says `esc cancels` in place of its items, so focus on one falls
 * to the page. It goes back to that item once the key is done (`focusBack`), and info mode, turned
 * on in between, explains that item.
 */
let keyedFrom: KeyedFrom | null = null;

/** What keyboard focus is on, in info mode's words: through the desk's key, the item it was on. */
const focusWords = (): string | null =>
	document.activeElement === document.body
		? (keyedFrom?.words ?? null)
		: wordsAt(document.activeElement);

/** Ctrl-B pressed: note the bottom line's item focus is on, if any, before the key takes it away. */
const noteKeyedFrom = (at: EventTarget | null) => {
	if (at === document.body) return;
	const item =
		at instanceof Element
			? at.closest<HTMLElement>(".bottomline [data-item]")?.dataset.item
			: undefined;
	keyedFrom = item === undefined ? null : {item, words: wordsAt(at)};
};

/** Focus goes back to the bottom line's item it fell from while the desk was mid-key. */
const focusBack = () => {
	const from = keyedFrom;
	keyedFrom = null;
	if (from === null || document.activeElement !== document.body) return;
	const items = document.querySelectorAll<HTMLElement>(".bottomline [data-item]");
	[...items].find((el) => el.dataset.item === from.item)?.focus();
};

/** What the host, or the app when the host is not there, tells the page on the desk's port. */
const heard = (raw: unknown) => {
	const read = readToPage(raw);
	if (read.kind === "refused") return console.warn(`fabrika: refused a message: ${read.why}`);
	const m = read.msg;
	switch (m.type) {
		case "keys":
			store.keys = {prefix: m.prefix, rows: m.rows, ignore: m.ignore, file: m.file};
			store.keyChanges = m.changes ?? [];
			editKeys({
				type: "keys",
				keys: store.keys,
				...(m.version === undefined ? {} : {version: m.version}),
			});
			return changed();
		case "keys.saved":
			if (!m.request.startsWith(`${store.keySession}:`)) return;
			return editKeys({
				type: "saved",
				request: m.request.slice(store.keySession.length + 1),
				version: m.version,
			});
		case "keys.failed":
			if (m.request !== "open" && !m.request.startsWith(`${store.keySession}:`)) return;
			return editKeys({
				type: "failed",
				request: m.request === "open" ? "open" : m.request.slice(store.keySession.length + 1),
				why: m.why,
			});
		case "keys.opened":
			return;
		case "keys.closed":
			return;
		case "programs":
			store.shapes = new Map(m.programs.map((p) => [p.name, {takes: p.takes, sends: p.sends}]));
			return changed();
		case "asks":
			store.asks = m.now;
			return changed();
		case "host":
			store.host = m.now;
			return changed();
		case "show":
			if (m.what === "focus-next" || m.what === "focus-previous")
				return cycleFocus(m.what === "focus-next" ? "next" : "previous");
			return m.what === "info"
				? frameStep({
						type: "info",
						focus: focusWords(),
						...(m.via === undefined ? {} : {via: m.via}),
					})
				: frameStep({type: "show", what: m.what, ...(m.via === undefined ? {} : {via: m.via})});
		case "navigation":
			flushSync(() => frameStep({type: "close", reason: "navigation"}));
			return;
		case "desk":
			store.desk = m.desk;
			store.attachedOnce = true;
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
			if (!attached(m.now)) {
				leftOver = false;
				holdStep({type: "down"});
				if (store.keysEditor !== null) frameStep({type: "close", reason: "owner_gone"});
			}
			// On one, it may be a host that never heard the workspace's size.
			else tellArea(true);
			return changed();
	}
};

/**
 * On macOS, the window has no title bar of its own, so the top bar keeps room for its three
 * buttons, and Command keys are the system's and the menu's.
 */
const MAC = /Mac/.test(navigator.userAgent);

/** Take a key from the page: nothing else hears it. */
const swallow = (e: KeyboardEvent) => {
	e.preventDefault();
	e.stopImmediatePropagation();
};

/**
 * Every key, before anything else on the page sees it: the frame's own, the desk's, or the
 * focused tile's. The palette's key opens it: Cmd-K, as in Linear and VS Code, unless the keys file
 * moved it (`palette.open`). Escape closes what lies over
 * the desk; with nothing over it, it leaves info mode, unless the desk is mid-key, where it cancels
 * the prefix or the question first; with neither, it goes on to the tile (frame.ts, `escaped`).
 * While something lies over it, the keys it takes (frame.ts, `keyGoesTo`) go to it and
 * never to a tile: if focus is not in it, the key is dropped and focus moves in.
 *
 * A key the system or the menu owns goes by all of that. Electron offers a key to the menu only if
 * the page did not call `preventDefault` on it, and ghostty-web calls it on every Command key but
 * Cmd-C and Cmd-V, and types the letter. Its custom key handler cannot help: answering true calls
 * `preventDefault` too. So the key stops here, on its way down, before the terminal hears it. A
 * program's view still hears it: a text box there may read Cmd-Enter.
 *
 * The menu's Paste and Cut act on whatever has focus. With something over the desk, focus goes back
 * into it first, armed prefix or not, so such a key never reaches a tile nobody can see. Focus
 * moving does not cancel the key, so Cmd-Q still quits.
 *
 * A key nobody owns is swallowed: nothing on the page hears it, and cancelling it is what keeps it
 * from the menu, so Cmd-W does not reach Close Window.
 */
const onKey = (e: KeyboardEvent) => {
	if (replaying) return;
	const pressed = {
		key: e.key,
		code: e.code,
		ctrl: e.ctrlKey,
		alt: e.altKey,
		meta: e.metaKey,
		shift: e.shiftKey,
		composing: e.isComposing,
		altGraph: e.getModifierState("AltGraph"),
	};
	const rawName = keyName(pressed);
	if (MAC && rawName !== null && THE_MACS.has(rawName)) {
		e.stopPropagation();
		return;
	}
	const recording = store.keysEditor?.recording;
	if (recording !== undefined && recording._tag !== "idle" && rawName === "<c-c>") {
		swallow(e);
		const tile = store.desk?.at === "open" ? focusedOf(store.desk) : null;
		if (tile !== null) window.fabrika.send(`tile:${tile.id}`, {type: "keys", data: "\u0003"});
		return;
	}
	if (recording?._tag === "waiting") {
		if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey) return;
		if (
			(e.key === "Enter" || e.key === " ") &&
			e.target instanceof Element &&
			e.target.closest("button") !== null
		)
			return;
		swallow(e);
		return editKeys({type: "press", press: pressed});
	}
	if (recording?._tag === "candidate" || recording?._tag === "saving") {
		if (e.key === "Escape") {
			swallow(e);
			if (recording._tag === "candidate") editKeys({type: "cancel"});
			return;
		}
		// Keep candidates away from app shortcuts while the native controls still receive their keys.
		if (pressed.meta || pressed.ctrl || pressed.alt) {
			if (keyOwner(pressed, MAC, store.keys) === "system") return;
			return swallow(e);
		}
		return;
	}
	const afterPrefix = midKey().armed
		? matchPress(
				pressed,
				store.keys.rows.flatMap((row) => row.keys.filter((key) => key._tag === "after_prefix")),
				MAC,
			)
		: null;
	const owner = afterPrefix === null ? keyOwner(pressed, MAC, store.keys) : "app";
	if (owner === "nobody") return swallow(e);
	if (owner === "system") {
		if (e.target instanceof Element && e.target.closest(".term") !== null) e.stopPropagation();
		if (store.frame.over.kind !== "none") focusOver(e.target);
		return;
	}
	const applicable = [
		KeyCase.cases.alone.make({key: store.keys.prefix}),
		...store.keys.rows.flatMap((row) =>
			row.keys.filter((key) => key._tag === (midKey().armed ? "after_prefix" : "alone")),
		),
	];
	const name = matchPress(pressed, applicable, MAC)?.key ?? rawName;
	const alone =
		name === null ? undefined : commandOn(store.keys, KeyCase.cases.alone.make({key: name}));
	if (alone === "palette.open") {
		swallow(e);
		toHost({type: "run", does: "palette.open", via: {keys: spell(name ?? "")}});
		return;
	}
	if (alone === 'tezgah."focus --to next"' || alone === 'tezgah."focus --to previous"') {
		swallow(e);
		closeForFocus();
		toHost({type: "run", does: alone, via: {keys: spell(name ?? "")}});
		return;
	}
	if (e.key === "Escape" && frameStep({type: "escape", desk: midKey()})) return swallow(e);
	if (name === null) return;
	const forOver = keyForOver(name, e.target);
	if (forOver === "in") return;
	if (forOver === "moved in") return swallow(e);
	const press = pressed;
	if (name === store.keys.prefix) noteKeyedFrom(e.target);
	if (holdStep({type: "key", key: {name, press}})) return;
	swallow(e);
};

/**
 * In info mode, what the pointer is over or keyboard focus moved to, said on the bottom line
 * (WCAG 2.1.1: what a pointer can learn, a keyboard can too).
 */
const explainAt = (e: Event) => {
	if (store.frame.info.kind !== "on") return;
	frameStep({type: "explain", text: wordsAt(e.target)});
};

/** The run a tile shows, if any: a run covering its tsh. */
const runOf = (tile: TileNode) => tile.shows.run;

function View({tile, run}: {readonly tile: TileId; readonly run: string}): ReactNode {
	const view = store.views.get(run);
	const send = (msg: unknown) => toRun(run, msg);
	const known = view === undefined ? undefined : WINDOWS.get(view.program);
	return (
		// Focus sits here when the tile is focused: the keys a view takes go to it alone.
		<main
			className="program"
			aria-label={`${view?.program ?? "program"} view`}
			data-view={tile}
			tabIndex={-1}
		>
			{view?.program === "keys" ? null : view === undefined ? (
				<p className="starting">starting</p>
			) : known === undefined ? (
				<p role="alert">no view for {view.program} in this app</p>
			) : (
				known.draw(view.data, send)
			)}
		</main>
	);
}

/** A tile's terminal, moved into its body under the title bar (terminal.ts, `attach`). */
function Body({tile}: {readonly tile: TileId}): ReactNode {
	const ref = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		if (ref.current !== null) terminals.get(tile)?.attach(ref.current);
	});
	return <div className="tile-body" ref={ref} />;
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
				if (isFolded(child))
					return [<Strip key={child.id} node={child} toHost={toHost} agents={desk.agents} />];
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

function Node(props: {
	readonly node: LayoutNode;
	readonly ws: Workspace;
	readonly desk: Open;
}): ReactNode {
	const {node, ws, desk} = props;
	if (node.tag === "tile") return <DeskTile tile={node} ws={ws} desk={desk} />;
	return <Container container={node} ws={ws} desk={desk} />;
}

/**
 * A tile as the desk has it now: focused or not, asking or not, closing or not, zoomed or not,
 * able to fold or not, with its terminal and the view over it as its body.
 */
function DeskTile(props: {
	readonly tile: TileNode;
	readonly ws: Workspace;
	readonly desk: Open;
}): ReactNode {
	const {tile, ws, desk} = props;
	const run = runOf(tile);
	return (
		<Tile
			tile={tile}
			focused={tile.id === ws.focused}
			asking={desk.ask === tile.id ? questionOf(desk, tile.id) : null}
			closing={desk.closing.includes(tile.id)}
			zoomed={ws.layout.zoomed === tile.id}
			folds={fold(ws.layout, tile.id) !== ws.layout}
			tickets={ticketsShown(store.views)}
			keys={store.keys}
			agents={desk.agents}
			toHost={toHost}
		>
			{tile.shows.kind !== "window" && <Body tile={tile.id} />}
			{run !== null && <View tile={tile.id} run={run.id} />}
		</Tile>
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

/**
 * What the window shows for the link: a page in place of the desk, or the desk, dimmed and out
 * of reach while the link is down. How the host is, and what to do about it, is the top bar's
 * host item (frame.tsx): said in words, quietly, never as an alert.
 */
type Shown =
	| {readonly kind: "instead"; readonly page: ReactNode}
	/** `dim`: the desk is out of reach, as the link is down. */
	| {readonly kind: "over"; readonly dim: boolean};

/** One branch for each kind of `LinkNow`: one left out does not compile. */
const linkView = (now: LinkNow): Shown => {
	switch (now.kind) {
		case "up":
		case "build":
			return {kind: "over", dim: false};
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
		case "restarting":
			return {kind: "over", dim: true};
		default:
			return absurd(now);
	}
};

function App(): ReactNode {
	useSyncExternalStore(subscribe, () => store.version);
	const desk = store.desk;
	const view = linkView(store.link);
	/** The desk is out of reach: the link is down, or there is no desk to reach. */
	const away = view.kind === "instead" || view.dim;
	const open = desk?.at === "open" ? desk : null;
	const ws = open === null ? null : activeOf(open);
	const focused = open === null ? null : focusedOf(open);
	const over = store.frame.over.kind;
	const shown = focusFollows(open);
	// Focus follows the desk: to the focused tile's terminal, or to the view that covers it. Only
	// when that changes, so a view's own input keeps focus while its view is drawn again. A layout
	// effect, so focus has moved before a key held for the host's answer is pressed again. The
	// desk is out of reach while the link is down, so focus goes back to it once the link is up,
	// and while something lies over it, which takes focus (pop.tsx); it goes back once that closes.
	const focusTile = useEffectEvent(() => {
		if (focused === null) return;
		const into = document.querySelector(`[data-tile="${focused.id}"]`);
		if (into?.contains(document.activeElement) === true && document.activeElement !== into) return;
		if (focused.shows.kind === "tsh" && focused.shows.run === null)
			terminals.get(focused.id)?.focus();
		else document.querySelector<HTMLElement>(`[data-view="${focused.id}"]`)?.focus();
	});
	useLayoutEffect(() => {
		if (!away && over === "none") focusTile();
	}, [shown, away, over]);
	// The desk's key done, focus goes back to the bottom line's item it was on, if it fell.
	const pending = midKey();
	const mid = pending.armed || pending.asking;
	useLayoutEffect(() => {
		if (!mid) focusBack();
	}, [mid]);
	const props: FrameProps = {
		desk: open,
		frame: store.frame,
		asks: store.asks,
		host: store.host,
		link: store.link,
		attachedOnce: store.attachedOnce,
		keys: store.keys,
		keysEditor: store.keysEditor,
		keyChanges: store.keyChanges,
		editKeys,
		shapes: store.shapes,
		tickets: ticketsShown(store.views),
		armed:
			pending.armed && (store.keysEditor === null || store.keysEditor.recording._tag === "idle"),
		toHost,
		toApp,
		toRun,
		step: frameStep,
	};
	const bare = store.frame.bare;
	const zoomed = ws?.layout.zoomed ?? null;
	return (
		<div
			className={`desk${view.kind === "over" && view.dim ? " lost" : ""}${MAC ? " mac" : ""}${bare ? " bare" : ""}`}
			tabIndex={-1}
			role="group"
			aria-label="the desk"
		>
			{bare || view.kind === "instead" ? <Band /> : <TopBar {...props} />}
			{view.kind === "instead" ? (
				view.page
			) : open === null || ws === null ? (
				<p className="starting">{desk === null ? "starting" : "closing"}</p>
			) : (
				<div
					className="workspace"
					ref={measure}
					data-workspace={ws.id}
					data-zoomed={zoomed ?? undefined}
					inert={view.dim}
				>
					{zoomed !== null ? (
						<ZoomedTile ws={ws} id={zoomed} desk={open} />
					) : (
						<Node node={ws.layout.root} ws={ws} desk={open} />
					)}
				</div>
			)}
			<BottomArea {...props} instead={view.kind === "instead"} />
			<Over {...props} />
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
	for (const on of EXPLAIN_ON) window.addEventListener(on, explainAt);
	window.fabrika.onMessage("desk", heard);
	const root = document.getElementById("root");
	if (root !== null)
		createRoot(root).render(
			<LayerEvents value={reportLayer}>
				<App />
			</LayerEvents>,
		);
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
