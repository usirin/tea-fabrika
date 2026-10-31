import {Kbd} from "@manti-ui/react";
import {
	type KeyboardEvent,
	type ReactNode,
	type RefObject,
	useEffect,
	useEffectEvent,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {createPortal} from "react-dom";
import {
	activeIn,
	type Cap,
	foldId,
	type Hint,
	hintsOf,
	type Icon,
	type MenuDo,
	marked,
	menuKey,
	neighborOf,
	type Row,
	type Section,
	sentence,
	stopsOf,
	tipWait,
	type Words,
} from "./pop.ts";

// What opens over the desk, drawn: one raised box of rows for every popover, in the program
// windows' own font and sizes (docs/direction/popovers.md). Its rules are pop.ts's; this file
// lays them out and wires the keys, focus and pointer.
//
//   <Menu id="pop-asks" label="Asks" from="top" count={2} sections={...} foot={...} empty={...}
//         onAct={open} onSecond={later} onClose={close} />        a menu: rows that each do something
//   <Palette id="pop-palette" label="Commands" chip="t2 · ticket #1" ... />   a combobox in a modal dialog
//   <Panel id="pop-lines" label="The host">...</Panel>             a few lines and a button
//   const tip = useTip({name: "Asks", typed: false, caps: ["⌃B", "A"], word: "asks"}, quiet)   a tooltip
//
// Each takes focus when it opens, closes on a press outside it, and gives focus back where it
// was. Escape is the page's (desk.tsx): it closes whatever is open. Only one is open at a time:
// the frame holds one `over` (frame.ts).

/** Keycaps, Manti's, in the UI's own font, with the Mac's glyphs: `⌃B` `A` (theme.css). */
export function Caps(props: {readonly caps: readonly Cap[]}): ReactNode {
	return (
		<span className="caps">
			{props.caps.map((c) => (
				<Kbd key={c}>{c}</Kbd>
			))}
		</span>
	);
}

/** A row's state, as a shape and a color: never color alone. The top bar's host item wears one too. */
export function IconOf(props: {readonly icon: Icon}): ReactNode {
	const ring = (extra: ReactNode, dashed = false) => (
		<svg
			className={`ic ic-${props.icon}`}
			viewBox="0 0 16 16"
			width="16"
			height="16"
			aria-hidden="true"
		>
			<circle
				cx="8"
				cy="8"
				r="6.25"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeDasharray={dashed ? "2.2 2.2" : undefined}
			/>
			{extra}
		</svg>
	);
	switch (props.icon) {
		case "ask":
			return ring(<circle cx="8" cy="8" r="2.75" fill="currentColor" />);
		case "stuck":
			return ring(
				<>
					<path d="M8 4.75v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
					<circle cx="8" cy="11" r="0.9" fill="currentColor" />
				</>,
			);
		case "later":
			return ring(null, true);
		// Half full, as Linear draws a thing in progress.
		case "running":
			return ring(<path d="M8 4.25a3.75 3.75 0 0 1 0 7.5z" fill="currentColor" />);
		case "failed":
			return ring(
				<path
					d="M6 6l4 4M10 6l-4 4"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
				/>,
			);
		case "stopped":
			return ring(
				<rect x="5.75" y="5.75" width="4.5" height="4.5" rx="0.75" fill="currentColor" />,
			);
		case "done":
			return ring(
				<path
					d="M5.4 8.2l1.8 1.8 3.4-3.6"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>,
			);
	}
}

/**
 * A box over the desk: focus moves into it (`into`) when it opens, a press outside it closes it,
 * and when it closes focus goes back to where it was, unless the press outside put it somewhere
 * else. A press on the item that opened it (`aria-controls` its id) is left to that item, which
 * closes it as a menu button does.
 */
const useOverlay = (
	box: RefObject<HTMLElement | null>,
	id: string,
	into: () => void,
	onClose: () => void,
) => {
	const moveIn = useEffectEvent(into);
	useLayoutEffect(() => {
		const before = document.activeElement;
		const el = box.current;
		moveIn();
		return () => {
			const now = document.activeElement;
			const lost = now === null || now === document.body || el?.contains(now) === true;
			if (lost && before instanceof HTMLElement && before.isConnected) before.focus();
		};
	}, [box]);
	useEffect(() => {
		const down = (e: PointerEvent) => {
			const t = e.target;
			if (!(t instanceof Element) || box.current?.contains(t) === true) return;
			if (t.closest(`[aria-controls="${id}"]`) !== null) return;
			onClose();
		};
		document.addEventListener("pointerdown", down, true);
		return () => document.removeEventListener("pointerdown", down, true);
	}, [box, id, onClose]);
};

/** A footer of key hints: `↑ ↓ Move   ↵ Open   H Later   Esc Close`. */
function Foot(props: {readonly hints: readonly Hint[]; readonly children?: ReactNode}): ReactNode {
	return (
		<div className="pop-foot" aria-hidden="true">
			{props.children}
			<span className="hints">
				{props.hints.map((h) => (
					<span key={h.name} className="hint">
						<Caps caps={h.caps} /> {h.name}
					</span>
				))}
			</span>
		</div>
	);
}

/** What a menu shows with no rows: one calm line and what to expect, never a blank box. */
export interface Empty {
	readonly title: string;
	/** What to expect; typed words in it, such as a tsh command, are drawn as code. */
	readonly sub: Words;
}

export interface MenuProps {
	/** Its element's id: the item that opens it names it in `aria-controls`. */
	readonly id: string;
	/** Its name, said by a screen reader and shown at its head: `Asks`. */
	readonly label: string;
	/**
	 * Where the item that opens it is: under the top bar's right end (the asks list), or over the
	 * bottom line's left end (the jobs list). It opens beside its item.
	 */
	readonly from: "top" | "bottom";
	/** Shown beside the label, muted: `Asks 2`. */
	readonly count: number | null;
	readonly sections: readonly Section[];
	readonly foot: readonly Hint[];
	/** Shown in the first section when it has no rows. */
	readonly empty: Empty;
	/** Enter or a click on a row: its own thing. The menu closes itself if it should. */
	readonly onAct: (row: Row) => void;
	/** H, or a click on the active row's second button. */
	readonly onSecond: (row: Row) => void;
	readonly onClose: () => void;
}

/**
 * A menu (WAI-ARIA `menu`): a raised box of rows that each do something. Focus moves into it;
 * the arrows, J and K move the active row; Enter does the row's thing; H its second; a letter
 * jumps to the next row that starts with it; Tab or a press outside closes it. The active row is
 * the one the pointer is on too, and only it shows its second thing, in place of its time.
 */
export function Menu(props: MenuProps): ReactNode {
	const box = useRef<HTMLDivElement>(null);
	const [at, setAt] = useState<string | null>(null);
	const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
	const stops = stopsOf(props.sections, folded);
	const active = activeIn(stops, at);
	const domId = (stop: string) => `${props.id}-${stops.findIndex((s) => s.id === stop)}`;
	useOverlay(box, props.id, () => box.current?.focus(), props.onClose);
	const activeId = active?.id;
	const showActive = useEffectEvent((stop: string) => {
		document.getElementById(domId(stop))?.scrollIntoView({block: "nearest"});
	});
	useLayoutEffect(() => {
		if (activeId !== undefined) showActive(activeId);
	}, [activeId]);
	const run = (did: MenuDo) => {
		switch (did.do) {
			case "move":
				return setAt(did.to);
			case "act":
				return props.onAct(did.row);
			case "second":
				setAt(neighborOf(stops, did.row.id));
				return props.onSecond(did.row);
			case "fold": {
				const next = new Set(folded);
				if (!next.delete(did.section)) next.add(did.section);
				return setFolded(next);
			}
			case "close":
				return props.onClose();
		}
	};
	const onKeyDown = (e: KeyboardEvent) => {
		const did = menuKey(stops, active?.id ?? null, {
			key: e.key,
			mods: e.ctrlKey || e.altKey || e.metaKey,
		});
		if (did === null) return;
		e.preventDefault();
		run(did);
	};
	const head = (
		<div className="pop-head" aria-hidden="true">
			{props.label}
			{props.count !== null && <span className="n">{props.count}</span>}
		</div>
	);
	// Nothing to pick: a dialog that says so in one calm line, never a menu with no items.
	if (stops.length === 0)
		return (
			<div
				ref={box}
				id={props.id}
				className={`pop menu from-${props.from}`}
				role="dialog"
				aria-label={props.label}
				tabIndex={-1}
				data-over=""
				onKeyDown={onKeyDown}
			>
				{head}
				<div className="pop-empty">
					<EmptyLine empty={props.empty} />
				</div>
			</div>
		);
	const [first] = props.sections;
	return (
		<div
			ref={box}
			id={props.id}
			className={`pop menu from-${props.from}`}
			role="menu"
			aria-label={props.label}
			aria-activedescendant={active === undefined ? undefined : domId(active.id)}
			tabIndex={-1}
			data-over=""
			onKeyDown={onKeyDown}
		>
			{head}
			{first?.rows.length === 0 && (
				<div className="pop-empty" role="none">
					<EmptyLine empty={props.empty} />
				</div>
			)}
			{props.sections.map((section, i) =>
				section.rows.length === 0 && !section.fold ? null : (
					// a menu's items are grouped with role group, by WAI-ARIA's menu pattern; a fieldset groups form fields, not menu items.
					<div
						key={section.id}
						className={`pop-section${i > 0 ? " ruled" : ""}`}
						role="group"
						aria-label={section.title ?? props.label}
					>
						{section.fold && (
							// oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- the menu's own box takes the keys (aria-activedescendant); this is its row for the pointer.
							<div
								id={domId(foldId(section.id))}
								className={`pop-fold${active?.id === foldId(section.id) ? " on" : ""}`}
								role="menuitem"
								aria-expanded={!folded.has(section.id)}
								tabIndex={-1}
								onPointerDown={(e) => e.preventDefault()}
								onPointerMove={() => setAt(foldId(section.id))}
								onClick={() => run({do: "fold", section: section.id})}
							>
								<svg
									className="pop-chev"
									viewBox="0 0 12 12"
									width="12"
									height="12"
									aria-hidden="true"
								>
									<path
										d="M3 4.5l3 3 3-3"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.4"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
								</svg>
								{section.title}
								<span className="n">{section.rows.length}</span>
							</div>
						)}
						{/* A heading that does not fold is words only: the group's label says it. */}
						{!section.fold && section.title !== null && (
							<div className="pop-group" aria-hidden="true">
								{section.title}
							</div>
						)}
						{!folded.has(section.id) &&
							section.rows.map((row) => (
								<MenuRow
									key={row.id}
									id={domId(row.id)}
									row={row}
									on={active?.id === row.id}
									onPoint={() => setAt(row.id)}
									onAct={() => props.onAct(row)}
									onSecond={() => run({do: "second", row})}
								/>
							))}
					</div>
				),
			)}
			<Foot hints={hintsOf(props.foot, active)} />
		</div>
	);
}

/** The calm line a menu shows with no rows: a done mark, what it means, and what to expect. */
function EmptyLine(props: {readonly empty: Empty}): ReactNode {
	return (
		<>
			<IconOf icon="done" />
			<span className="t">{props.empty.title}</span>
			<span className="s">
				<WordsOf words={props.empty.sub} />
			</span>
		</>
	);
}

/** A row's words: the typed pieces in mono (`<code>`), the rest in the UI's own font. */
export function WordsOf(props: {readonly words: Words}): ReactNode {
	const {words} = props;
	if (typeof words === "string") return words;
	// A row's pieces never move: their place is their key.
	return words.map((p, k) =>
		p.typed ? <code key={k}>{p.text}</code> : <span key={k}>{p.text}</span>,
	);
}

/**
 * Rows in a panel: the same row as a menu's (icon, title, muted line, time at the right), but
 * plain lines to read, not stops to act on, as the agents attached now.
 */
export function Lines(props: {readonly rows: readonly Row[]}): ReactNode {
	return (
		<ul className="pop-lines">
			{props.rows.map((row) => (
				<li key={row.id} className={`pop-row${row.sub === null ? "" : " two"}`}>
					<span className="lead">{row.icon !== null && <IconOf icon={row.icon} />}</span>
					<span className="text">
						<span className="t">
							<WordsOf words={row.title} />
						</span>
						{row.sub !== null && (
							<span className="s">
								<WordsOf words={row.sub} />
							</span>
						)}
					</span>
					{row.side !== null && <span className="side">{row.side}</span>}
				</li>
			))}
		</ul>
	);
}

/** One row of a menu: its icon, its title and the line under it, and its time or second thing. */
function MenuRow(props: {
	readonly id: string;
	readonly row: Row;
	readonly on: boolean;
	readonly onPoint: () => void;
	readonly onAct: () => void;
	readonly onSecond: () => void;
}): ReactNode {
	const {row, on} = props;
	return (
		// oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- the menu's own box takes the keys (aria-activedescendant); this is its row for the pointer.
		<div
			id={props.id}
			className={`pop-row${row.sub === null ? "" : " two"}${on ? " on" : ""}`}
			role="menuitem"
			tabIndex={-1}
			data-icon={row.icon ?? undefined}
			aria-keyshortcuts={row.second === null ? undefined : row.second.cap}
			onPointerDown={(e) => e.preventDefault()}
			onPointerMove={props.onPoint}
			onClick={props.onAct}
		>
			<span className="lead">{row.icon !== null && <IconOf icon={row.icon} />}</span>
			<span className="text">
				<span className="t">
					<WordsOf words={row.title} />
				</span>
				{row.sub !== null && (
					<span className="s">
						<WordsOf words={row.sub} />
					</span>
				)}
			</span>
			{on && row.second !== null ? (
				// The pointer's way to the row's second thing; the keyboard's is its key, said by
				// `aria-keyshortcuts`. Not a second focus stop: a menu item holds no buttons.
				<span
					className="pop-second"
					aria-hidden="true"
					onClick={(e) => {
						e.stopPropagation();
						props.onSecond();
					}}
				>
					{row.second.name}
					<Caps caps={[row.second.cap]} />
				</span>
			) : (
				row.side !== null && <span className="side">{row.side}</span>
			)}
		</div>
	);
}

/**
 * One option of the palette: its name, as written, the tsh word that does the same, and its keys.
 * A row as a menu's is: the name its title, the word its muted line (typed, so in mono), the keys
 * at its right.
 */
export interface Option {
	readonly id: string;
	readonly name: string;
	readonly word: string;
	readonly caps: readonly Cap[];
}

/** A name or a word in runs, the matched ones bold: `<mark>`. */
function Marked(props: {readonly text: string; readonly query: string}): ReactNode {
	// A text's runs never move: their place is their key.
	return marked(props.text, props.query).map((r, k) =>
		r.mark ? <mark key={k}>{r.text}</mark> : <span key={k}>{r.text}</span>,
	);
}

export interface PaletteProps {
	readonly id: string;
	/** Its name: `Commands`, or `Keyboard shortcuts`. */
	readonly label: string;
	/** What its commands act on, named on top: `t2 · ticket #1`. */
	readonly chip: string;
	readonly query: string;
	/** The commands that match, in sections; `at` counts down all of them. */
	readonly sections: readonly {readonly title: string; readonly options: readonly Option[]}[];
	readonly at: number;
	/** How many match, in words: `19 commands`. */
	readonly count: string;
	readonly onQuery: (query: string) => void;
	readonly onMove: (by: number) => void;
	readonly onRun: (at: number) => void;
	readonly onClose: () => void;
}

const PALETTE_FOOT: readonly Hint[] = [
	{caps: ["↵"], name: "Run"},
	{caps: ["Esc"], name: "Close"},
];

/**
 * The palette (WAI-ARIA combobox in a modal dialog): a text box over a list of commands. Typing
 * narrows the list, its matched letters bold; the arrows move the picked command; Enter runs it;
 * Tab stays in the box; a press outside closes it.
 */
export function Palette(props: PaletteProps): ReactNode {
	const box = useRef<HTMLDivElement>(null);
	const input = useRef<HTMLInputElement>(null);
	const list = `${props.id}-list`;
	const optionId = (i: number) => `${props.id}-o${i}`;
	useOverlay(box, props.id, () => input.current?.focus(), props.onClose);
	const picked = optionId(props.at);
	useLayoutEffect(() => {
		document.getElementById(picked)?.scrollIntoView({block: "nearest"});
	}, [picked]);
	const total = props.sections.reduce((n, s) => n + s.options.length, 0);
	let i = -1;
	return (
		<>
			<div className="scrim" aria-hidden="true" />
			<div
				ref={box}
				id={props.id}
				className="pop palette"
				role="dialog"
				aria-modal="true"
				aria-label={props.label}
				data-over=""
			>
				<div className="chip-row">
					<span className="chip">{props.chip}</span>
				</div>
				<input
					ref={input}
					className="find"
					role="combobox"
					aria-label={`Find ${props.label.toLowerCase()}`}
					aria-expanded="true"
					aria-controls={list}
					aria-autocomplete="list"
					aria-activedescendant={total === 0 ? undefined : optionId(props.at)}
					value={props.query}
					placeholder="Type a command…"
					spellCheck={false}
					onChange={(e) => props.onQuery(e.currentTarget.value)}
					onKeyDown={(e) => {
						if (e.key === "ArrowDown") props.onMove(1);
						else if (e.key === "ArrowUp") props.onMove(-1);
						else if (e.key === "Enter") props.onRun(props.at);
						else if (e.key !== "Tab") return;
						e.preventDefault();
					}}
				/>
				<div className="list" id={list} role="listbox" aria-label={props.label}>
					{total === 0 && (
						<div className="pop-empty" role="none">
							<span className="t">Nothing matches “{props.query}”</span>
						</div>
					)}
					{props.sections.map((s) => (
						// options in a listbox are grouped with role group, by WAI-ARIA's listbox pattern; a fieldset groups form fields, not options.
						<div key={s.title} role="group" aria-labelledby={`${props.id}-${s.title}`}>
							<div className="pop-group" id={`${props.id}-${s.title}`} role="presentation">
								{s.title}
							</div>
							{s.options.map((c) => {
								i += 1;
								const n = i;
								return (
									// oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- the text box takes the keys (aria-activedescendant); this is its option for the pointer.
									<div
										key={c.id}
										id={optionId(n)}
										className={`pop-cmd${n === props.at ? " on" : ""}`}
										role="option"
										tabIndex={-1}
										aria-selected={n === props.at}
										onPointerDown={(e) => e.preventDefault()}
										onPointerMove={() => {
											if (n !== props.at) props.onMove(n - props.at);
										}}
										onClick={() => props.onRun(n)}
									>
										<span className="text">
											<span className="name">
												<Marked text={sentence(c.name)} query={props.query} />
											</span>
											<code className="word">
												<Marked text={c.word} query={props.query} />
											</code>
										</span>
										<Caps caps={c.caps} />
									</div>
								);
							})}
						</div>
					))}
				</div>
				<Foot hints={PALETTE_FOOT}>
					<span className="count">{props.count}</span>
				</Foot>
			</div>
		</>
	);
}

/**
 * A panel (a non-modal WAI-ARIA `dialog`): a few lines on one item of the top bar, and the one
 * thing to do about it, if any. Focus moves in, so Tab reaches its button.
 */
export function Panel(props: {
	readonly id: string;
	readonly label: string;
	readonly onClose: () => void;
	readonly children: ReactNode;
}): ReactNode {
	const box = useRef<HTMLDivElement>(null);
	useOverlay(box, props.id, () => box.current?.focus(), props.onClose);
	return (
		<div
			ref={box}
			id={props.id}
			className="pop panel"
			role="dialog"
			aria-label={props.label}
			tabIndex={-1}
			data-over=""
		>
			{props.children}
		</div>
	);
}

/**
 * What a tooltip says: a name, typed (a program's name, in mono) or not, its keys, and the tsh
 * word that does the same, typed so in mono too. `null`: no word does it (Try again).
 */
export interface Tip {
	readonly name: string;
	readonly typed: boolean;
	readonly caps: readonly Cap[];
	readonly word: string | null;
}

/** When the last tooltip went, so the next one along shows at once (pop.ts, `tipWait`). */
let lastGone: number | null = null;

/** Where a tooltip sits: under its item in the window's top half, over it in the bottom half. */
const placeOf = (r: DOMRect) => ({
	...(r.top < window.innerHeight / 2
		? {top: r.bottom + 6}
		: {bottom: window.innerHeight - r.top + 6}),
	...(r.left + r.width / 2 > window.innerWidth / 2
		? {right: Math.max(8, window.innerWidth - r.right)}
		: {left: Math.max(8, r.left)}),
});

/**
 * A tooltip (WAI-ARIA `tooltip`) for one item: its name, its keys and its tsh word, after the pointer rests
 * 700 ms (at once within 300 ms of the last one), or at once on keyboard focus. Escape, a press
 * or the pointer leaving hides it. `quiet`: something lies over the desk, or info mode explains
 * the item already, so it never shows.
 *
 *   const tip = useTip({name: "Asks", typed: false, caps: ["⌃B", "A"], word: "asks"}, quiet);
 *   <button {...tip.on}>2 ask you</button>{tip.node}
 */
export const useTip = (tip: Tip, quiet: boolean) => {
	const [at, setAt] = useState<DOMRect | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const id = useRef(`tip-${Math.random().toString(36).slice(2, 9)}`).current;
	const hide = () => {
		clearTimeout(timer.current);
		setAt((was) => {
			if (was !== null) lastGone = Date.now();
			return null;
		});
	};
	useEffect(() => {
		if (quiet) hide();
	}, [quiet]);
	useEffect(() => () => clearTimeout(timer.current), []);
	useEffect(() => {
		if (at === null) return;
		const key = (e: globalThis.KeyboardEvent) => {
			if (e.key === "Escape") hide();
		};
		window.addEventListener("keydown", key, true);
		return () => window.removeEventListener("keydown", key, true);
	}, [at]);
	const show = (el: Element, wait: number) => {
		clearTimeout(timer.current);
		if (quiet) return;
		timer.current = setTimeout(() => setAt(el.getBoundingClientRect()), wait);
	};
	return {
		on: {
			"aria-describedby": at === null ? undefined : id,
			onPointerEnter: (e: {readonly currentTarget: Element}) =>
				show(e.currentTarget, tipWait(Date.now(), lastGone)),
			onPointerLeave: hide,
			onPointerDownCapture: hide,
			onFocus: (e: {readonly currentTarget: Element}) => {
				if (e.currentTarget.matches(":focus-visible")) show(e.currentTarget, 0);
			},
			onBlur: hide,
		},
		node:
			at === null
				? null
				: createPortal(
						<div className="tip" id={id} role="tooltip" style={placeOf(at)}>
							{tip.typed ? <code>{tip.name}</code> : <span>{tip.name}</span>}
							{tip.caps.length > 0 && <Caps caps={tip.caps} />}
							{tip.word !== null && <code className="word">{tip.word}</code>}
						</div>,
						document.body,
					),
	};
};
