import {whenOf} from "@tea-fabrika/tracker/window";
import {
	type KeyboardEvent,
	type ReactNode,
	type RefObject,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type {Ask, AsksNow} from "../asks.ts";
import {sentence} from "./pop.ts";
import {Caps, IconOf, useOverlay} from "./pop.tsx";

// The asks list as the asks program's glance (docs/direction/ask-desk.md, PR 326): one row per
// ask, its rec at the right, and the selected row opened under itself with its rec in words and a
// button for each key. Look study (askdesk r3): the keys and the clicks move, set aside, open the
// ticket, and open the note and the picks; an answer itself is written on the ticket's own card,
// since the list has no write yet (ticket 102), so `y`, a sent note and a pick open the ticket.
//
//   ↑ ↓ j k   move          y   take the rec      o   every pick, then 1 to 9
//   ↵         open ticket   n   not the rec: note h   later, or bring back      Esc  back, or close

/** What the glance is in the middle of, on the selected row. */
type Doing = {readonly _tag: "look"} | {readonly _tag: "note"} | {readonly _tag: "picks"};

const LOOK: Doing = {_tag: "look"};

export interface GlanceProps {
	readonly id: string;
	readonly asks: AsksNow;
	readonly now: number;
	/** The ticket's tile, said on its row when one shows it. */
	readonly tileOf: (ticket: number) => string | undefined;
	/** Open the ask's ticket: its tile, else the tracker turned to it. */
	readonly onOpen: (ask: Ask) => void;
	/** Set aside, or bring back. */
	readonly onLater: (ask: Ask) => void;
	readonly onClose: () => void;
}

/** A title's backticked words drawn as typed: `fabrika post` prints … */
function Ticks(props: {readonly text: string}): ReactNode {
	// A title's runs never move: their place is their key.
	return props.text
		.split("`")
		.map((run, i) => (i % 2 === 1 ? <code key={i}>{run}</code> : <span key={i}>{run}</span>));
}

/** The rec in a few words, for the row's right end: `approve`, or `no rec`. */
const recWord = (ask: Ask): string | null => {
	if (ask.kind === "stuck") return null;
	if (ask.rec === undefined || ask.rec._tag === "none") return "no rec";
	return ask.rec.pick;
};

/** A question as it reads: a capital first, and a question mark when it asks one. */
const question = (ask: Ask): string =>
	ask.kind === "stuck" ? `Stuck: ${ask.what}` : `${sentence(ask.what)}?`;

export function AsksGlance(props: GlanceProps): ReactNode {
	const {asks, now} = props;
	const box = useRef<HTMLDivElement>(null);
	const note = useRef<HTMLInputElement>(null);
	const all = [...asks.asks, ...asks.later];
	const [at, setAt] = useState<string | null>(all[0]?.key ?? null);
	const [doing, setDoing] = useState<Doing>(LOOK);
	const [said, setSaid] = useState("");
	useOverlay(box, props.id, () => box.current?.focus(), props.onClose);
	const selected = all.find((a) => a.key === at) ?? all[0];
	const index = selected === undefined ? -1 : all.indexOf(selected);
	const rowId = (ask: Ask) => `${props.id}-${all.indexOf(ask)}`;
	useLayoutEffect(() => {
		if (selected !== undefined)
			document.getElementById(rowId(selected))?.scrollIntoView({block: "nearest"});
		if (doing._tag === "note") note.current?.focus();
	});
	const move = (by: number) => {
		const next = all[Math.min(all.length - 1, Math.max(0, index + by))];
		if (next === undefined) return;
		setAt(next.key);
		setDoing(LOOK);
		setSaid("");
	};
	const select = (ask: Ask) => {
		if (ask.key !== selected?.key) setDoing(LOOK);
		setAt(ask.key);
	};
	const hasRec = (ask: Ask) => ask.rec?._tag === "pick";
	const later = (ask: Ask) => {
		const next = all[index + 1] ?? all[index - 1];
		setAt(next?.key ?? null);
		setDoing(LOOK);
		props.onLater(ask);
	};
	const onKeyDown = (e: KeyboardEvent) => {
		if (e.ctrlKey || e.metaKey || e.altKey || selected === undefined) return;
		const typing = doing._tag === "note";
		const key = e.key;
		const did = (() => {
			if (key === "Escape") {
				if (doing._tag !== "look") return setDoing(LOOK), true;
				return props.onClose(), true;
			}
			if (typing) {
				if (key !== "Enter") return false;
				if ((note.current?.value.trim() ?? "") === "") {
					setSaid("Say why, in a line: the next step reads it.");
					return true;
				}
				return props.onOpen(selected), true;
			}
			switch (key) {
				case "ArrowDown":
				case "j":
					return move(1), true;
				case "ArrowUp":
				case "k":
					return move(-1), true;
				case "Enter":
					return props.onOpen(selected), true;
				case "h":
				case "H":
					return later(selected), true;
				case "y":
					return hasRec(selected) && (props.onOpen(selected), true);
				case "n":
					return (
						selected.kind === "ask" && hasRec(selected) && (setDoing({_tag: "note"}), true)
					);
				case "o":
					return (
						selected.kind === "ask" &&
						(setDoing(doing._tag === "picks" ? LOOK : {_tag: "picks"}), true)
					);
				case "Tab":
					return props.onClose(), true;
			}
			if (doing._tag === "picks" && /^[1-9]$/.test(key)) {
				const pick = selected.picks?.[Number(key) - 1];
				return pick !== undefined && (props.onOpen(selected), true);
			}
			return false;
		})();
		if (did) e.preventDefault();
	};
	const count = asks.asks.length;
	return (
		<div
			ref={box}
			id={props.id}
			className="pop glance from-top"
			role="grid"
			aria-label={`Asks, ${count} waiting`}
			aria-activedescendant={selected === undefined ? undefined : rowId(selected)}
			tabIndex={-1}
			data-over=""
			data-deep={doing._tag === "look" ? undefined : ""}
			onKeyDown={onKeyDown}
		>
			<div className="gl-head" aria-hidden="true">
				<span className="gl-name">Asks</span>
				<span className="gl-n">
					{count === 0 ? "nothing waits on you" : `${count} wait on you`}
				</span>
			</div>
			{all.length === 0 && (
				<p className="gl-empty" role="none">
					Nothing waits on you. A new ask shows here and in the top bar.
				</p>
			)}
			{all.map((ask) => {
				const on = ask.key === selected?.key;
				const aside = asks.later.includes(ask);
				const first = aside && asks.later[0] === ask;
				const tile = props.tileOf(ask.ticket);
				const rec = recWord(ask);
				return (
					<div key={ask.key} className="gl-group" role="rowgroup">
						{first && (
							<div className="gl-later" aria-hidden="true">
								Later <span className="gl-n">{asks.later.length}</span>
							</div>
						)}
						{/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- the grid's own box takes the keys (aria-activedescendant); this is its row for the pointer. */}
						<div
							id={rowId(ask)}
							className={`gl-row${on ? " on" : ""}${aside ? " aside" : ""}`}
							role="row"
							aria-selected={on}
							tabIndex={-1}
							onPointerDown={(e) => {
								if (!(e.target instanceof HTMLButtonElement)) e.preventDefault();
							}}
							onClick={() => (on ? undefined : select(ask))}
							onDoubleClick={() => props.onOpen(ask)}
						>
							<div className="gl-line" role="gridcell">
								<span className="lead">
									<IconOf icon={aside ? "later" : ask.kind} />
								</span>
								<span className="t">{question(ask)}</span>
								{rec !== null && (
									<span className={`rec${rec === "no rec" ? " none" : ""}`}>
										{rec === "no rec" ? rec : <>Rec {rec}</>}
									</span>
								)}
								<span className="s">
									#{ask.ticket} <Ticks text={ask.title} />
									{tile === undefined ? "" : ` · ${tile}`}
								</span>
								<time className="when">{whenOf(ask.at, now)}</time>
							</div>
							{on && (
								<More
									ask={ask}
									doing={doing}
									said={said}
									note={note}
									onYes={() => props.onOpen(ask)}
									onNo={() => setDoing({_tag: "note"})}
									onPicks={() => setDoing(doing._tag === "picks" ? LOOK : {_tag: "picks"})}
									onPick={() => props.onOpen(ask)}
									onOpen={() => props.onOpen(ask)}
								/>
							)}
						</div>
					</div>
				);
			})}
			<div className="gl-foot">
				<span className="hint">
					<Caps caps={["↑", "↓"]} /> Move
				</span>
				{selected !== undefined && (
					<>
						<button type="button" tabIndex={-1} onClick={() => later(selected)}>
							{asks.later.includes(selected) ? "Bring back" : "Later"} <Caps caps={["H"]} />
						</button>
						<button type="button" tabIndex={-1} onClick={() => props.onOpen(selected)}>
							Open <Caps caps={["↵"]} />
						</button>
					</>
				)}
				<span className="gap" />
				<span className="hint">
					<Caps caps={["Esc"]} /> Close
				</span>
			</div>
		</div>
	);
}

/** The selected row, opened: the rec in words, then a button for each key. */
function More(props: {
	readonly ask: Ask;
	readonly doing: Doing;
	readonly said: string;
	readonly note: RefObject<HTMLInputElement | null>;
	readonly onYes: () => void;
	readonly onNo: () => void;
	readonly onPicks: () => void;
	readonly onPick: (pick: string) => void;
	readonly onOpen: () => void;
}): ReactNode {
	const {ask, doing} = props;
	const rec = ask.rec;
	const asking = ask.kind === "ask";
	return (
		<div className="gl-more" role="gridcell">
			{asking && rec?._tag === "pick" && (
				<p className="gl-rec">
					<span className="k">Rec: {rec.pick}</span>, {rec.sure}% sure. {sentence(rec.why)}.{" "}
					{sentence(rec.cost)}.
				</p>
			)}
			{asking && rec?._tag === "none" && <p className="gl-rec">No rec: {rec.why}.</p>}
			{asking && rec === undefined && <p className="gl-rec">No rec on this ask.</p>}
			{doing._tag === "note" && (
				<div className="gl-note">
					<input
						ref={props.note}
						aria-label={`Why not ${rec?._tag === "pick" ? rec.pick : "the rec"}`}
						placeholder={`Why not ${rec?._tag === "pick" ? rec.pick : "the rec"}? The next step reads it.`}
					/>
					<span className="hint">
						<Caps caps={["↵"]} /> Send
					</span>
				</div>
			)}
			{doing._tag === "picks" && (
				<ol className="gl-picks">
					{(ask.picks ?? []).map((pick, i) => (
						<li key={pick}>
							<button type="button" tabIndex={-1} onClick={() => props.onPick(pick)}>
								<Caps caps={[String(i + 1)]} />
								{sentence(pick)}
								{rec?._tag === "pick" && rec.pick === pick && <span className="k"> · rec</span>}
							</button>
						</li>
					))}
				</ol>
			)}
			{props.said !== "" && (
				<p className="gl-said" role="status">
					{props.said}
				</p>
			)}
			{doing._tag !== "note" && (
				<div className="gl-acts">
					{asking && rec?._tag === "pick" && (
						<>
							<button type="button" className="main" tabIndex={-1} onClick={props.onYes}>
								Take rec <Caps caps={["Y"]} />
							</button>
							<button type="button" tabIndex={-1} onClick={props.onNo}>
								Not the rec <Caps caps={["N"]} />
							</button>
						</>
					)}
					{asking ? (
						<button
							type="button"
							tabIndex={-1}
							aria-expanded={doing._tag === "picks"}
							onClick={props.onPicks}
						>
							Every pick <Caps caps={["O"]} />
						</button>
					) : (
						<button type="button" className="main" tabIndex={-1} onClick={props.onOpen}>
							Open the ticket <Caps caps={["↵"]} />
						</button>
					)}
				</div>
			)}
		</div>
	);
}
