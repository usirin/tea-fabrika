// The window's React view, next/ (Tier 1, P14). It reads the live run through tea's own hook and
// sends Msgs; it holds no state of its own and reads no clock. The run is booted outside React, so
// Strict Mode's second mount starts nothing. Each reader picks an existing part of the model.
//
// The screens are the link's states: a waiting screen with the one next action (the grant command),
// the removed and blocked screens, and the desk. The desk folds the fixed layout to this tab's own
// size; the frame says, once, how the link is and how many presses wait.
import type {EffectRun} from "@demlik/tea/effect";
import {useRuntime} from "@demlik/tea/react";
import {Keys, type WindowRegistration} from "@kampus/libfabrika";
import {Button, useClipboard} from "@manti-ui/react";
import {Effect, Option, Schema} from "effect";
import {type ReactNode, StrictMode, useEffect, useRef} from "react";
import {createRoot} from "react-dom/client";
import {keyEvent} from "../desktop/keys.ts";
import {fold, type Layout, tilesIn} from "../desktop/layout.ts";
import type {WindowModel, WindowMsg} from "./machine.ts";

/** The live window run, as `startWindow` booted it. */
export type LiveWindow = EffectRun<WindowModel, WindowMsg>;

/** What draws one tile: its program's registered window. */
export type TileWindow = WindowRegistration<any, ReactNode>;

export type WindowProps = {
	readonly run: LiveWindow;
	/** The brain's origin, which the grant command names. */
	readonly origin: string;
	readonly layout: Layout;
	/** The registered window for a tile's process name, or null when none is registered. */
	readonly windowFor: (pid: string) => TileWindow | null;
};

const pickLink = (m: WindowModel) => m.link;
const pickViews = (m: WindowModel) => m.client.views;
const pickQueue = (m: WindowModel) => m.client.pending.length;
const pickTrouble = (m: WindowModel) => m.trouble;
const pickKeyError = (m: WindowModel) => m.keyError;
const pickKeys = (m: WindowModel) => m.keys;
const pickFocus = (m: WindowModel) => m.focus;
const pickSize = (m: WindowModel) => m.size;
const pickDials = (m: WindowModel) => m.dials;
const pickFingerprint = (m: WindowModel) => m.rejected;

const Waiting = ({
	code,
	fingerprint,
	origin,
}: {
	readonly code: string;
	readonly fingerprint: string;
	readonly origin: string;
}) => {
	const command = `node next/apps/fabrika/grant.ts client ${origin} ${fingerprint} --code=${code} --key=<person-key-file>`;
	const clipboard = useClipboard({value: command});
	return (
		<main className="screen" aria-labelledby="waiting-title">
			<h1 id="waiting-title" className="screen-title">
				Let this window in
			</h1>
			<p className="screen-text">
				Run this on the computer that holds your person key. The window opens by itself once it is
				granted.
			</p>
			<div className="screen-command">
				<code data-testid="grant-command">{command}</code>
				<Button variant="secondary" size="sm" onClick={clipboard.copy}>
					{clipboard.copied ? "Copied" : "Copy command"}
				</Button>
			</div>
			<dl className="screen-facts">
				<dt>Code</dt>
				<dd data-testid="grant-code">{code}</dd>
				<dt>Window key</dt>
				<dd data-testid="fingerprint">{fingerprint}</dd>
			</dl>
			<p className="screen-quiet" role="status">
				Waiting for the grant
			</p>
		</main>
	);
};

const Removed = ({run}: {readonly run: LiveWindow}) => {
	const [dials, send] = useRuntime(run, pickDials);
	const [rejected] = useRuntime(run, pickFingerprint);
	return (
		<main className="screen" aria-labelledby="removed-title">
			<h1 id="removed-title" className="screen-title">
				This window was removed
			</h1>
			<p className="screen-text">
				Its key {rejected === null ? "" : <code>{rejected}</code>} is no longer let in, so it stops
				reconnecting. Ask again to make a new key and wait for a new grant.
			</p>
			<div className="screen-command">
				<Button
					variant="primary"
					size="sm"
					onClick={() => send({type: "ask_again", dial: dials + 1})}
				>
					Ask again
				</Button>
			</div>
		</main>
	);
};

const Blocked = ({reason}: {readonly reason: string}) => (
	<main className="screen" role="alert" aria-labelledby="blocked-title">
		<h1 id="blocked-title" className="screen-title">
			This window is blocked
		</h1>
		<p className="screen-text">
			{reason === "key_store"
				? "The browser refused to keep this window's key, so it cannot sign in. Allow this site's storage, then reload."
				: `It cannot go on: ${reason}.`}
		</p>
	</main>
);

const Connecting = () => (
	<main className="screen" aria-labelledby="connecting-title">
		<h1 id="connecting-title" className="screen-quiet" role="status">
			Connecting to fabrika
		</h1>
	</main>
);

const Tile = ({
	run,
	tile,
	window,
	at,
	focused,
}: {
	readonly run: LiveWindow;
	readonly tile: {readonly id: string; readonly pid: string};
	readonly window: TileWindow | null;
	readonly at: {readonly x: number; readonly y: number; readonly w: number; readonly h: number};
	readonly focused: boolean;
}) => {
	const [shown, send] = useRuntime(run, (m) => m.client.views[tile.pid]);
	const [keys] = useRuntime(run, pickKeys);
	// The machine installed only a view the registration's schema passed; this decode gives it its type.
	const data =
		window === null || shown === undefined
			? null
			: Option.getOrNull(Schema.decodeUnknownOption(window.data)(shown.view));
	const program = tile.pid.split(":")[0] ?? tile.pid;
	const name = `${tile.pid} · ${tile.id}`;
	return (
		<section
			className={focused ? "tile focused" : "tile"}
			aria-label={name}
			style={{left: at.x, top: at.y, width: at.w, height: at.h}}
			onFocus={() => send({type: "focus", tile: tile.id})}
			onPointerDown={() => send({type: "focus", tile: tile.id})}
		>
			<header className="titlebar">
				<span>{program}</span>
				<span className="tid">{tile.pid}</span>
			</header>
			<div className="slot">
				{window === null || data === null ? (
					<p className="screen-quiet">Opening</p>
				) : (
					<window.View
						data={data}
						press={(m) => send({type: "press", pid: tile.pid, m, via: "button"})}
						hint={(command) => Keys.hintFor(keys, command)}
					/>
				)}
			</div>
		</section>
	);
};

const Desk = ({run, layout, windowFor}: WindowProps) => {
	const [focus, send] = useRuntime(run, pickFocus);
	const [size] = useRuntime(run, pickSize);
	const area = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const element = area.current;
		if (element === null) return;
		const measure = () => send({type: "resized", w: element.clientWidth, h: element.clientHeight});
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		measure();
		return () => observer.disconnect();
	}, [send]);
	const tiles = tilesIn(layout);
	const folded = size === null ? {shown: [], folded: []} : fold(layout, size, focus);
	return (
		<div className="desk" ref={area}>
			{folded.shown.map((rect) => {
				const tile = tiles.find((t) => t.id === rect.id);
				return tile === undefined ? null : (
					<Tile
						key={tile.id}
						run={run}
						tile={tile}
						window={windowFor(tile.pid)}
						at={rect}
						focused={focus === tile.id}
					/>
				);
			})}
			{folded.folded.length === 0 ? null : (
				<nav className="strips" aria-label="Folded tiles">
					{folded.folded.map((id) => {
						const tile = tiles.find((t) => t.id === id);
						return (
							<button
								key={id}
								type="button"
								className="strip"
								onClick={() => send({type: "focus", tile: id})}
							>
								{tile === undefined ? id : `${tile.pid} · ${tile.id}`}
							</button>
						);
					})}
				</nav>
			)}
		</div>
	);
};

/** The frame's one word for the link, beside the presses still waiting. */
const Status = ({run}: {readonly run: LiveWindow}) => {
	const [link] = useRuntime(run, pickLink);
	const [queue] = useRuntime(run, pickQueue);
	const [trouble] = useRuntime(run, pickTrouble);
	const [keyError] = useRuntime(run, pickKeyError);
	const state = link._tag === "online" ? "online" : "reconnecting";
	return (
		<footer className="bottomline" role="status">
			<span data-testid="connection" className={state === "online" ? "" : "broken"}>
				{state}
			</span>
			<span className="sep">·</span>
			<span data-testid="queue">{queue} waiting</span>
			{trouble === null ? null : (
				<>
					<span className="sep">·</span>
					<span className="broken">{trouble.replaceAll("_", " ")}</span>
				</>
			)}
			{keyError === null ? null : (
				<>
					<span className="sep">·</span>
					<span className="broken">
						keybindings.toml{keyError.line > 0 ? ` line ${keyError.line}` : ""}:{" "}
						{keyError.why.replaceAll("_", " ")}
					</span>
				</>
			)}
		</footer>
	);
};

/** The whole window: the screen the link is in, or the desk inside its frame. */
export const Window = (props: WindowProps) => {
	const [link, send] = useRuntime(props.run, pickLink);
	const [views] = useRuntime(props.run, pickViews);
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => send({type: "key", event: keyEvent(event)});
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [send]);
	if (link._tag === "blocked") return <Blocked reason={link.reason} />;
	if (link._tag === "removed") return <Removed run={props.run} />;
	if (link._tag === "waiting_grant")
		return <Waiting code={link.code} fingerprint={link.fingerprint} origin={props.origin} />;
	const pids = [...new Set(tilesIn(props.layout).map((t) => t.pid))];
	const ready = pids.every((pid) => views[pid] !== undefined);
	if (!ready && (link._tag === "online" || Object.keys(views).length === 0)) return <Connecting />;
	return (
		<div className="frame">
			<header className="topbar">
				<span>fabrika</span>
				<span className="sep">·</span>
				<span className="quiet">window</span>
			</header>
			<Desk {...props} />
			<Status run={props.run} />
		</div>
	);
};

/** Renders the window into `element` under Strict Mode, for as long as the scope. */
export const mount = (element: HTMLElement, props: WindowProps) =>
	Effect.acquireRelease(
		Effect.sync(() => {
			const root = createRoot(element);
			root.render(
				<StrictMode>
					<Window {...props} />
				</StrictMode>,
			);
			return root;
		}),
		(root) => Effect.sync(() => root.unmount()),
	);
