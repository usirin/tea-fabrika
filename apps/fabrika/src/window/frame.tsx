import {type ReactNode, useLayoutEffect, useRef} from "react";
import type {AsksNow} from "../asks.ts";
import {activeOf, type Open} from "../desk/desk.ts";
import type {FromPage, LinkNow, ToApp} from "../messages.ts";
import {
	askRow,
	asksWord,
	type Bound,
	bindingWord,
	commandsOf,
	type Frame,
	type FrameMsg,
	hereWord,
	hostWord,
	INFO,
	ledgerWord,
	lineIn,
	matching,
	type Part,
	prefixLine,
	questionWord,
	type Shapes,
	type TicketsShown,
	tileOfTicket,
	tipOf,
	workspaceName,
} from "./frame.ts";

// The window's frame, drawn: the top bar, the bottom line, and what opens over the desk (the
// asks list, the palette, an item's few lines). Its words are frame.ts's; this file only lays
// them out. Every item is a button with a tooltip (`name · key`) and, in info mode, a line of
// plain words (`data-info`). No item has a background: plain words, ` · ` between them.

/** What the frame is drawn from, and how it sends. */
export interface FrameProps {
	readonly desk: Open | null;
	readonly frame: Frame;
	readonly asks: AsksNow | null;
	readonly link: LinkNow;
	/** A desk came once: a link down after it is the host down, not a first connect. */
	readonly attachedOnce: boolean;
	readonly prefix: string;
	readonly table: readonly Bound[];
	readonly shapes: Shapes;
	readonly tickets: TicketsShown;
	readonly armed: boolean;
	readonly toHost: (m: FromPage) => void;
	readonly toApp: (m: ToApp) => void;
	readonly step: (m: FrameMsg) => void;
}

/** ` · `, between two words of the frame. */
const Sep = () => <span className="sep">·</span>;

/** The key bound to a name, as the frame writes it, or `null`. */
const keyFor = (props: FrameProps, name: string): string | null => {
	const bound = props.table.find((b) => b.name === name);
	return bound === undefined ? null : bindingWord(props.prefix, bound.key);
};

/** A frame item: a button of plain words, with its tooltip and its info line. */
function Item(props: {
	readonly name: string;
	readonly keyed: string | null;
	readonly info: string;
	readonly className?: string | undefined;
	readonly current?: boolean;
	readonly onClick: () => void;
	readonly children: ReactNode;
}): ReactNode {
	return (
		<button
			type="button"
			className={`fb${props.className === undefined ? "" : ` ${props.className}`}`}
			title={tipOf(props.name, props.keyed)}
			data-info={props.info}
			aria-current={props.current}
			onPointerDown={(e) => e.preventDefault()}
			onClick={props.onClick}
		>
			{props.children}
		</button>
	);
}

/**
 * The top bar: the whole desk. Workspaces, the line, then what needs you, and a part of the app
 * only when it is broken or old.
 */
export function TopBar(props: FrameProps): ReactNode {
	const {desk, asks, step} = props;
	const ws = desk === null ? null : activeOf(desk);
	const line = ws === null ? [] : lineIn(ws);
	const ledger = asks === null ? null : ledgerWord(asks);
	const host = hostWord(props.link, props.attachedOnce);
	const count = asks?.asks.length ?? 0;
	const unseen = asks?.asks.filter((a) => !a.seen).length ?? 0;
	return (
		<header className="topbar">
			<div className="lights-room" aria-hidden="true" />
			{desk !== null && (
				<nav className="workspaces" aria-label="workspaces">
					{desk.workspaces.map((w, i) => (
						<Item
							key={w.id}
							name={`workspace ${i + 1}`}
							keyed={i < 9 ? bindingWord(props.prefix, String(i + 1)) : null}
							info={INFO.workspace}
							current={w.id === desk.active}
							onClick={() => props.toHost({type: "pick", workspace: w.id})}
						>
							<span className="num">{i + 1}</span> {workspaceName(w, props.tickets)}
						</Item>
					))}
				</nav>
			)}
			<nav className="line" aria-label="the line">
				{line.length === 0 && ws !== null && <span className="seg plain">tsh</span>}
				{line.map((s, i) => (
					<span key={s.tile} className="seg-pair">
						{i > 0 && (
							<span className="pipe" data-info={INFO.pipe} title="pipe">
								|
							</span>
						)}
						<Item
							name={s.program}
							keyed={null}
							info={INFO.segment}
							className={`seg${s.focused ? " on" : ""}`}
							onClick={() => props.toHost({type: "go", tile: s.tile})}
						>
							{s.program}
						</Item>
					</span>
				))}
			</nav>
			<div className="drag" data-info={INFO.drag} title="drag to move the window" />
			<div className="right">
				{asks === null ? (
					<span className="quiet">reading the ledger</span>
				) : (
					<Item
						name="asks"
						keyed={keyFor(props, "asks")}
						info={INFO.asks}
						className={count > 0 ? "accent" : undefined}
						onClick={() => step({type: "show", what: "asks"})}
					>
						{asksWord(count)}
						{unseen > 0 && <span className="udot" role="img" aria-label={`${unseen} not seen`} />}
					</Item>
				)}
				{ledger !== null && (
					<>
						<Sep />
						<Item
							name="ledger"
							keyed={null}
							info={INFO.ledger}
							className="broken"
							onClick={() => step({type: "item", what: "ledger"})}
						>
							{ledger.word}
						</Item>
					</>
				)}
				{host !== null && <Sep />}
				{/* Said as a status, never an alert: a screen reader hears the host go and come back. */}
				<span role="status" aria-label="the link to the host">
					{host !== null && (
						<Item
							name="host"
							keyed={null}
							info={INFO.host}
							className={host.broken ? "broken" : undefined}
							onClick={() => step({type: "item", what: "host"})}
						>
							{host.word}
						</Item>
					)}
					{props.link.kind === "stopped" && (
						<>
							<Sep />
							<Item
								name="try again"
								keyed={null}
								info={INFO.again}
								onClick={() => props.toApp({type: "again"})}
							>
								try again
							</Item>
						</>
					)}
				</span>
			</div>
		</header>
	);
}

/** What lies over the desk now: the asks list, an item's lines, or the palette. Shown with the bars hidden too. */
export function Over(props: FrameProps): ReactNode {
	const {over} = props.frame;
	switch (over.kind) {
		case "none":
			return null;
		case "asks":
			return props.asks === null ? null : <AsksList {...props} asks={props.asks} />;
		case "item":
			return <ItemLines {...props} what={over.what} />;
		case "palette":
			return <Palette {...props} />;
	}
}

/** The band left when both bars are hidden, or before there is a desk: room for the window's buttons. */
export function Band(): ReactNode {
	return <div className="band" data-info={INFO.drag} />;
}

/**
 * The asks list: each ask named by its tile and ticket; a pick focuses that tile. An ask whose
 * ticket no tile shows is words, not a button: there is nothing to focus.
 */
function AsksList(props: FrameProps & {readonly asks: AsksNow}): ReactNode {
	const {asks, desk, frame, step} = props;
	const later = frame.over.kind === "asks" && frame.over.later;
	const tileOf = (ticket: number) =>
		desk === null ? undefined : tileOfTicket(desk, ticket, props.tickets);
	// Opened, every ask in it is seen: the dot in the top bar goes.
	useLayoutEffect(() => {
		props.toHost({type: "seen"});
	}, [asks.asks.length]);
	return (
		<section className="over asks-list" aria-label="asks">
			<h2>
				asks <Sep /> {asks.asks.length} live
			</h2>
			{asks.asks.length === 0 && <p className="quiet">nothing asks you</p>}
			<ul>
				{asks.asks.map((a) => {
					const tile = tileOf(a.ticket);
					return (
						<li key={a.key}>
							{tile === undefined ? (
								<span className="accent" title="no tile shows this ticket">
									{askRow(a, tile)}
								</span>
							) : (
								<button
									type="button"
									className="act accent"
									title={`focus ${tile}`}
									onClick={() => {
										props.toHost({type: "go", tile});
										step({type: "close"});
									}}
								>
									{askRow(a, tile)}
								</button>
							)}
							<Sep />
							<button
								type="button"
								className="act soft"
								onClick={() => props.toHost({type: "later", key: a.key})}
							>
								later
							</button>
						</li>
					);
				})}
			</ul>
			{asks.later.length > 0 && (
				<>
					<button
						type="button"
						className="act soft foot"
						aria-expanded={later}
						onClick={() => step({type: "later", open: !later})}
					>
						{asks.later.length} later
					</button>
					{later && (
						<ul className="later">
							{asks.later.map((a) => (
								<li key={a.key}>
									<span>{askRow(a, tileOf(a.ticket))}</span>
									<Sep />
									<button
										type="button"
										className="act"
										onClick={() => props.toHost({type: "back", key: a.key})}
									>
										bring back
									</button>
								</li>
							))}
						</ul>
					)}
				</>
			)}
			<p className="hint">Only you answer these: in the ticket's own tile.</p>
		</section>
	);
}

/** What the restart does to the jobs, said before the person confirms. */
const JOBS_STOP =
	"Its running jobs stop. Their saved lists stay, and each comes back with attach %n.";

/** A few lines on one item of the top bar, under it: the ledger or the host. */
function ItemLines(props: FrameProps & {readonly what: Part}): ReactNode {
	const {asks, link} = props;
	const body = (): ReactNode => {
		switch (props.what) {
			case "ledger":
				return asks === null ? null : asks.reach === "failed" ? (
					<>
						<h2>The ledger is unreachable</h2>
						<p>{asks.why}</p>
						<p className="hint">
							The asks count is the last one read. It reads again every second.
						</p>
					</>
				) : (
					<h2>The ledger answers</h2>
				);
			case "host":
				return <HostLines link={link} first={!props.attachedOnce} toApp={props.toApp} />;
		}
	};
	return (
		<section className="over item-lines" aria-label={props.what}>
			{body()}
		</section>
	);
}

/** The host, in a few lines: what the old corner notes said, now under its item. */
function HostLines(props: {
	readonly link: LinkNow;
	readonly first: boolean;
	readonly toApp: (m: ToApp) => void;
}): ReactNode {
	const {link, first} = props;
	const restart = (
		<button type="button" className="act" onClick={() => props.toApp({type: "restart"})}>
			Stop the old host and start this one
		</button>
	);
	switch (link.kind) {
		case "up":
			return <h2>The host is up</h2>;
		case "build":
			return (
				<>
					<h2>The host runs older code</h2>
					<p>
						{link.theirs === null
							? `It names no build. This app is build ${link.ours}.`
							: `It is build ${link.theirs}. This app is build ${link.ours}.`}{" "}
						{JOBS_STOP}
					</p>
					{restart}
				</>
			);
		case "version":
			return (
				<>
					<h2>The host speaks link version {link.theirs}</h2>
					<p>This app speaks {link.ours}.</p>
					{restart}
				</>
			);
		case "reconnecting":
			return (
				<>
					<h2>{first ? "Connecting to the host…" : "Reconnecting to the host…"}</h2>
					<p>{link.why}</p>
				</>
			);
		case "stopped":
			return (
				<>
					<h2>{first ? "Could not connect to the host" : "Could not reconnect to the host"}</h2>
					<p>{link.why}</p>
					<p>It stopped trying after five minutes.</p>
					<button type="button" className="act" onClick={() => props.toApp({type: "again"})}>
						Try again
					</button>
				</>
			);
		case "restarting":
			return (
				<>
					<h2>Stopping the old host…</h2>
					<p>Once it has stopped, this app starts its own and attaches.</p>
				</>
			);
	}
}

/**
 * The bottom line: the tile you are in, or the key you just pressed. Its own question
 * (`close t2? (y/n)`) is said here, where tmux says it. An agent's ask never is.
 */
export function BottomLine(props: FrameProps): ReactNode {
	const {desk, frame, armed} = props;
	const question = desk === null ? null : questionWord(desk);
	const left = (): ReactNode => {
		if (question !== null)
			return (
				<span className="prompt" role="alertdialog" aria-label={question}>
					{question}
				</span>
			);
		if (armed)
			return (
				<span className="keying">
					<b>PREFIX</b>
					{prefixLine(props.table).map((k) => (
						<span key={k.key}>
							<Sep />
							<b>{k.key}</b> {k.name}
						</span>
					))}
				</span>
			);
		if (frame.info)
			return (
				<span className="info">
					<b>INFO</b>
					<Sep />
					{frame.explained ?? "point at anything to see what it is"}
				</span>
			);
		if (desk === null) return null;
		return (
			<span className="here" data-info={INFO.here}>
				{hereWord(desk, props.shapes, props.tickets)}
			</span>
		);
	};
	const right = (): ReactNode => {
		if (question !== null) return <span className="quiet">y closes · n keeps it</span>;
		if (armed) return <span className="quiet">esc cancels</span>;
		if (frame.note !== null) return <span className="note">{frame.note}</span>;
		const keys = keyFor(props, "keys");
		const info = keyFor(props, "info");
		return (
			<>
				<Item
					name="info"
					keyed={info}
					info={INFO.info}
					onClick={() => props.step({type: "show", what: "info"})}
				>
					{frame.info ? `${info ?? ""} info off` : `${info ?? ""} info`}
				</Item>
				<Sep />
				<Item
					name="keys"
					keyed={keys}
					info={INFO.keys}
					onClick={() => props.step({type: "show", what: "keys"})}
				>
					{keys ?? ""} keys
				</Item>
			</>
		);
	};
	return (
		<footer className="bottomline">
			<div className="left">{left()}</div>
			<div className="right">{right()}</div>
		</footer>
	);
}

/**
 * The palette (Cmd-K), or every key (C-b ?): each command and its key. Typing
 * narrows it, the arrows move, Enter runs the command as its key would, Escape closes it.
 */
function Palette(props: FrameProps): ReactNode {
	const {frame, step} = props;
	const input = useRef<HTMLInputElement>(null);
	useLayoutEffect(() => {
		input.current?.focus();
	}, []);
	if (frame.over.kind !== "palette") return null;
	const {title, query, at} = frame.over;
	const all = commandsOf(props.prefix, props.table, props.desk?.workspaces.length ?? 0);
	const shown = matching(all, query);
	const run = (i: number) => {
		const c = shown[i];
		if (c === undefined) return;
		props.toHost({type: "run", key: c.runs});
		step({type: "ran", key: c.key});
	};
	return (
		<div className="over palette" role="dialog" aria-label={title}>
			<p className="palh">{title === "keys" ? "every key" : "commands"}</p>
			<input
				ref={input}
				aria-label="find a command"
				value={query}
				placeholder="type a command"
				onChange={(e) => step({type: "query", query: e.currentTarget.value})}
				onKeyDown={(e) => {
					if (e.key === "Escape") step({type: "close"});
					else if (e.key === "ArrowDown") step({type: "move", by: 1, of: shown.length});
					else if (e.key === "ArrowUp") step({type: "move", by: -1, of: shown.length});
					else if (e.key === "Enter") run(at);
					else return;
					e.preventDefault();
				}}
			/>
			<ul>
				{shown.map((c, i) => (
					<li key={c.name}>
						<button
							type="button"
							className={`cmd${i === at ? " on" : ""}`}
							onPointerDown={(e) => e.preventDefault()}
							onClick={() => run(i)}
						>
							<span>{c.name}</span>
							<span className="k">{c.key}</span>
						</button>
					</li>
				))}
			</ul>
			<p className="palf">
				Cmd-K commands <Sep /> Enter runs <Sep /> Esc closes
			</p>
		</div>
	);
}
