import type {WindowProps, Writer} from "@kampus/fabrika";
import {nameOf} from "@kampus/pipeline/stages/outcome";
import type {Entry} from "@kampus/pipeline/tickets/ticket";
import {Kbd} from "@manti-ui/react";
import {
	type Head,
	lineOf,
	type OpenAsk,
	type Row,
	type StepNow,
	stepWords,
} from "@tea-fabrika/tracker";
import {whenOf} from "@tea-fabrika/tracker/window";
import {type KeyboardEvent, type ReactNode, useState} from "react";
import type {ticket} from "./index.ts";
import type {Page} from "./view.ts";

// The ticket's window, drawn as Linear draws an issue: the title, one card that says whose turn
// it is, the body, the activity with each row opening in place, a comment box, and the
// properties in a quiet column beside it. The accent colour means "your turn" and nothing else.
// It holds only what a person is in the middle of: the rows they opened, what they typed.

type Send = WindowProps<typeof ticket>["send"];

const SPARK = (
	<svg viewBox="0 0 10 10" aria-hidden="true">
		<path d="M5 0.8 6.1 3.9 9.2 5 6.1 6.1 5 9.2 3.9 6.1 0.8 5 3.9 3.9Z" fill="currentColor" />
	</svg>
);

const CHECK = (
	<svg viewBox="0 0 10 10" aria-hidden="true">
		<path
			d="M2.5 5.2 4.3 7 7.6 3.2"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.4"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

const CHEVRON = (
	<svg className="chev" viewBox="0 0 14 14" aria-hidden="true">
		<path
			d="M5.5 3.5 9 7l-3.5 3.5"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.4"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

/** Who wrote it, as a mark: a person a circle with their initial, an agent a square. */
export function Mark(props: {
	readonly by: Writer;
	readonly turn?: boolean;
	readonly big?: boolean;
}) {
	const {by, turn = false, big = false} = props;
	const size = big ? " lg" : "";
	return by.kind === "user" ? (
		<span className={`m p${turn ? " you" : ""}${size}`} aria-hidden="true">
			{by.id.slice(0, 1).toUpperCase()}
		</span>
	) : (
		<span className={`m a${size}`} aria-hidden="true">
			{SPARK}
		</span>
	);
}

/** Who wrote it, in words: a person by their id, an agent by its id in code type. */
export function Who({by}: {readonly by: Writer}) {
	return by.kind === "user" ? (
		<span className="who">{by.id}</span>
	) : (
		<>
			<span className="who ag">{by.id}</span>
			<span className="sr"> (an agent)</span>
		</>
	);
}

/** Text with `code` in backticks drawn in code type, as the mockup and GitHub draw it. */
export function Ticks({text}: {readonly text: string}) {
	return (
		<>
			{text.split("`").map((part, i) =>
				i % 2 === 1 ? (
					// the parts of one string, in order, never moved
					<span key={i} className="mono">
						{part}
					</span>
				) : (
					part
				),
			)}
		</>
	);
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** A pick as a button says it: the first letter up. */
const said = (pick: string) => pick.slice(0, 1).toUpperCase() + pick.slice(1);

/** The main button's words: the ask itself when it starts with its pick, "Approve plan v1". */
const primaryWords = (ask: OpenAsk, pick: string) =>
	ask.what.startsWith(`${pick} `) ? said(ask.what) : said(pick);

function AskCard(props: {
	readonly ask: OpenAsk;
	readonly page: Page;
	readonly now: number;
	readonly send: Send;
}) {
	const {ask, page, now, send} = props;
	const [first, ...rest] = ask.picks;
	const [other, setOther] = useState<string | null>(null);
	const [note, setNote] = useState("");
	const saw = {title: page.opened.ticket.title, body: page.body};
	const ticket = page.opened.ticket.number;
	const answer = (pick: string, text: string) =>
		send({type: "answer", value: {ticket, ask: ask.ask, pick, note: text, saw}});
	return (
		<section className="turnc you" aria-label="Whose turn">
			<span className="m p you lg" aria-hidden="true">
				Y
			</span>
			<div className="what">
				<span className="big">
					<span className="w-you">Your turn</span> · {ask.what}
				</span>
				<span className="sub">
					<Mark by={ask.by} />
					<Who by={ask.by} /> asked at {whenOf(ask.at, now)}
					{page.plan !== null && (
						<>
							<span aria-hidden="true">·</span>
							{page.plan.tasks.length} task{page.plan.tasks.length === 1 ? "" : "s"}
						</>
					)}
				</span>
			</div>
			<div className="acts">
				{rest.map((pick) => (
					<button
						key={pick}
						type="button"
						className="btn quiet"
						aria-expanded={other === pick}
						onClick={() => setOther(other === pick ? null : pick)}
					>
						{said(pick)}
					</button>
				))}
				<button type="button" className="btn turn" onClick={() => answer(first, "")}>
					{primaryWords(ask, first)}
				</button>
			</div>
			{other !== null && (
				<div className="noform">
					<label className="sr" htmlFor="ticket-note">
						Why {other}
					</label>
					<textarea
						id="ticket-note"
						rows={2}
						placeholder={`Why ${other}? The note goes with your answer.`}
						value={note}
						onChange={(e) => setNote(e.target.value)}
					/>
					<div className="row2">
						<button type="button" className="btn quiet sm" onClick={() => setOther(null)}>
							Cancel
						</button>
						<button
							type="button"
							className="btn sm"
							onClick={() => {
								answer(other, note.trim());
								setOther(null);
								setNote("");
							}}
						>
							Send {other}
						</button>
					</div>
				</div>
			)}
		</section>
	);
}

/** One card that says whose turn it is: yours, with the ask's buttons, or what runs or ended. */
function TurnCard(props: {
	readonly head: Head;
	readonly page: Page;
	readonly now: number;
	readonly send: Send;
}) {
	const {head, page, now, send} = props;
	const line = lineOf(head, (at) => whenOf(at, now));
	switch (head._tag) {
		case "asks":
			return <AskCard ask={head.asks[0]} page={page} now={now} send={send} />;
		case "running":
			return (
				<section className="turnc" aria-label="Whose turn">
					<span className="m a lg" aria-hidden="true">
						{SPARK}
					</span>
					<div className="what">
						<span className="big">
							<span className="muted">{line}</span>
						</span>
						<span className="sub">
							<span className="dot run live" />
							<span className="w-run">running</span>
							<span aria-hidden="true">·</span>
							run {head.run}, since {whenOf(head.since, now)}
						</span>
					</div>
				</section>
			);
		case "stuck":
			return (
				<section className="turnc stuck" aria-label="Whose turn">
					<span className="m s lg" aria-hidden="true" />
					<div className="what">
						<span className="big">
							<span className="w-stuck">Stuck</span> · {head.stage}
						</span>
						<span className="sub">{line}. Nothing runs until someone looks.</span>
					</div>
				</section>
			);
		case "done":
			return (
				<section className="turnc" aria-label="Whose turn">
					<span className="m s lg" aria-hidden="true">
						{CHECK}
					</span>
					<div className="what">
						<span className="big">Done</span>
						<span className="sub">
							<span className="w-done">✓</span> {line.replace(/^done: /, "")}
							<span aria-hidden="true">·</span>
							{usd(page.usd)} in all
						</span>
					</div>
				</section>
			);
		default:
			return (
				<section className="turnc" aria-label="Whose turn">
					<span className="m s lg" aria-hidden="true" />
					<div className="what">
						<span className="big">{said(line)}</span>
						<span className="sub">Nothing waits on you.</span>
					</div>
				</section>
			);
	}
}

/** The nine steps as a meter: one bar each, done, running, yours, or not yet. */
function Meter({steps}: {readonly steps: readonly StepNow[]}) {
	const cls: Record<StepNow["state"], string> = {
		none: "",
		done: "d",
		running: "run",
		you: "you",
		stuck: "bad",
	};
	return (
		<span className="meter" aria-hidden="true">
			{steps.map((s) => (
				<i key={s.step} className={cls[s.state]} />
			))}
		</span>
	);
}

function Status({head, now}: {readonly head: Head; readonly now: number}) {
	const line = lineOf(head, (at) => whenOf(at, now));
	if (head._tag === "asks") return <span className="w-you trunc">waits on you</span>;
	if (head._tag === "running")
		return (
			<>
				<span className="dot run live" />
				<span className="trunc">{line}</span>
			</>
		);
	if (head._tag === "done")
		return (
			<>
				<span className="w-done">✓</span>
				<span className="trunc">{line}</span>
			</>
		);
	if (head._tag === "stuck") return <span className="w-stuck trunc">{line}</span>;
	return <span className="trunc">{line}</span>;
}

/** The properties, as Linear keeps them. A program it is made of is named as the line to type. */
function Props(props: {readonly page: Page; readonly number: number; readonly now: number}) {
	const {page, number, now} = props;
	const at = page.steps.find(
		(s) => s.state === "running" || s.state === "you" || s.state === "stuck",
	);
	return (
		<dl className="props">
			<dt>Status</dt>
			<dd>
				<Status head={page.opened.head} now={now} />
			</dd>
			<dt>Filed by</dt>
			<dd>
				{page.filed === null ? (
					<span className="faint">nobody</span>
				) : (
					<>
						<Mark by={page.filed.by} />
						<Who by={page.filed.by} />
					</>
				)}
			</dd>
			<dt>Step</dt>
			<dd>
				<Meter steps={page.steps} />
				<span className="trunc">{at === undefined ? "none running" : stepWords(at.step)}</span>
			</dd>
			<dt>Plan</dt>
			<dd>
				{page.plan === null ? (
					<span className="faint">none yet</span>
				) : (
					<>
						<span className="mono prim">v{page.plan.version}</span>
						<span className="faint">
							{page.plan.tasks.length} task{page.plan.tasks.length === 1 ? "" : "s"}
						</span>
					</>
				)}
			</dd>
			<dt>PR</dt>
			<dd>
				{page.pr === null ? (
					<span className="faint">none yet</span>
				) : (
					<>
						<span className="mono prim">{page.pr.url.replace(/^.*\/pull\//, "#")}</span>
						<span className="faint">{page.pr.state}</span>
					</>
				)}
			</dd>
			<dt>Checks</dt>
			<dd>
				{page.pr === null ? (
					<span className="faint">no PR yet</span>
				) : (
					<span className="trunc">{page.pr.checks}</span>
				)}
			</dd>
			<dt>Cost</dt>
			<dd>
				<span className="mono prim">{usd(page.usd)}</span>
			</dd>
			<dt>Runs</dt>
			<dd>
				<code className="cmd">runs --ticket {number}</code>
			</dd>
		</dl>
	);
}

/** A body's paragraphs, each with where it starts in the body: its key, as no two start alike. */
export const paragraphsOf = (body: string): readonly {at: number; text: string}[] => {
	const out: {at: number; text: string}[] = [];
	let from = 0;
	for (const text of body.split(/\n\s*\n/)) {
		const at = body.indexOf(text, from);
		from = at + text.length;
		if (text.trim() !== "") out.push({at, text});
	}
	return out;
};

/** A value of a fact, in a few words: text as it is, a list joined, an outcome by its name. */
const wordsOf = (key: string, value: unknown): ReactNode => {
	if (value === null) return <span className="faint">null</span>;
	if (key === "outcome" && typeof value === "object")
		return <span className="mono">{nameOf(value as Parameters<typeof nameOf>[0])}</span>;
	if (key === "usd" && typeof value === "number") return <span className="mono">{usd(value)}</span>;
	if (Array.isArray(value))
		return value.length === 0 ? (
			<span className="faint">none</span>
		) : (
			<span className="mono">
				{value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ")}
			</span>
		);
	if (typeof value === "object") return <span className="mono">{JSON.stringify(value)}</span>;
	if (key === "body" || key === "note") return <span className="muted">{String(value)}</span>;
	return <span className="mono">{String(value)}</span>;
};

/** What opens under a row: the fact's own fields, and the entry it came in. */
function Detail({entry, now}: {readonly entry: Entry; readonly now: number}) {
	const {type: _type, ...fields} = entry.fact;
	return (
		<dl className="kv">
			{Object.entries(fields).map(([key, value]) => [
				<dt key={`${key}-k`}>{key}</dt>,
				<dd key={`${key}-v`}>{wordsOf(key, value)}</dd>,
			])}
			<dt>entry</dt>
			<dd>
				<span className="faint">pos</span> <span className="mono">{entry.pos}</span>{" "}
				<span className="faint">by</span>{" "}
				<span className="mono">
					{entry.by.kind}:{entry.by.id}
				</span>{" "}
				<span className="faint">at</span> {whenOf(entry.at, now)}
			</dd>
		</dl>
	);
}

function Activity(props: {
	readonly rows: readonly Row[];
	readonly timeline: readonly Entry[];
	readonly now: number;
}) {
	const {rows, timeline, now} = props;
	const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
	const flip = (pos: number) =>
		setOpen((was) => {
			const next = new Set(was);
			if (next.has(pos)) next.delete(pos);
			else next.add(pos);
			return next;
		});
	// J and K move between rows, as Linear's lists do; Enter or Space opens one, as a button does.
	const walk = (e: KeyboardEvent<HTMLOListElement>) => {
		if (e.key !== "j" && e.key !== "k") return;
		const all = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(".act-r")];
		const at = all.indexOf(document.activeElement as HTMLButtonElement);
		const next = all[Math.max(0, Math.min(all.length - 1, at + (e.key === "j" ? 1 : -1)))];
		next?.focus();
		e.preventDefault();
	};
	return (
		<>
			<div className="act-h">
				<h2>Activity</h2>
				<span className="faint">{rows.length}</span>
				<span className="hint">
					<Kbd>J</Kbd>
					<Kbd>K</Kbd> move <Kbd>↵</Kbd> open
				</span>
			</div>
			<ol className="acts-l" onKeyDown={walk}>
				{rows.map((row) => {
					const entry = timeline.find((e) => e.pos === row.pos);
					const shown = open.has(row.pos);
					return (
						<li key={row.pos} className={`act${shown ? " open" : ""}`}>
							<button
								type="button"
								className="act-r"
								aria-expanded={shown}
								aria-controls={`fact-${row.pos}`}
								onClick={() => flip(row.pos)}
							>
								<Mark by={row.by} />
								<span className="line trunc">
									<Who by={row.by} />
									<span className="w">{row.text}</span>
									{row.more !== "" && <span className="code trunc">{row.more}</span>}
									{row.body !== null && row.type !== "filed" && (
										<span className="quote trunc">{row.body}</span>
									)}
								</span>
								<time>{whenOf(row.at, now)}</time>
								{CHEVRON}
							</button>
							{shown && entry !== undefined && (
								<div className="act-x" id={`fact-${row.pos}`}>
									<Detail entry={entry} now={now} />
								</div>
							)}
						</li>
					);
				})}
			</ol>
		</>
	);
}

function Composer(props: {readonly ticket: number; readonly send: Send; readonly saving: number}) {
	const {ticket, send, saving} = props;
	const [text, setText] = useState("");
	const body = text.trim();
	const post = (changes: boolean) => {
		if (body === "") return;
		send({
			type: "comment",
			value: changes ? {ticket, body, asks: "changes"} : {ticket, body},
		});
		setText("");
	};
	return (
		<div className="composer">
			<label className="sr" htmlFor="ticket-composer">
				Leave a comment
			</label>
			<textarea
				id="ticket-composer"
				rows={2}
				placeholder="Leave a comment"
				value={text}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
						e.preventDefault();
						post(false);
					}
				}}
			/>
			<div className="cf">
				<span className="sp">
					{saving > 0 ? (
						`saving ${saving}`
					) : (
						<>
							<Kbd>⌘</Kbd>
							<Kbd>↵</Kbd> to send
						</>
					)}
				</span>
				<button
					type="button"
					className="btn quiet sm"
					disabled={body === ""}
					title="A person's request stops build until a new plan or a new approval"
					onClick={() => post(true)}
				>
					Request changes
				</button>
				<button type="button" className="btn sm" disabled={body === ""} onClick={() => post(false)}>
					Comment
				</button>
			</div>
		</div>
	);
}

/**
 * The window, drawn afresh for each ticket it shows: a half-written comment or an opened row of
 * #7 never shows on #3 when a pipe moves it there.
 */
export function TicketWindow(props: WindowProps<typeof ticket>) {
	return <OneTicket key={props.view.number ?? 0} {...props} />;
}

function OneTicket({view, send}: WindowProps<typeof ticket>) {
	const {number, page, now} = view;
	if (!view.ready)
		return (
			<div className="view ticket-view">
				<p className="view-empty">Reading the ledger</p>
			</div>
		);
	if (number === null)
		return (
			<div className="view ticket-view">
				<p className="view-empty">
					No ticket yet: pick one in the tracker, or start it with --ticket.
				</p>
			</div>
		);
	if (page === null)
		return (
			<div className="view ticket-view">
				<p className="view-empty">No ticket #{number} on this ledger.</p>
			</div>
		);
	const {opened} = page;
	const paragraphs = paragraphsOf(page.body);
	return (
		<div className="view ticket-view">
			<div className="tkv">
				<div className="tk-main">
					<div className="tk-col">
						<div>
							<div className="idl">
								<span className="mono">#{number}</span>
								{page.filed !== null && (
									<span>
										filed by {page.filed.by.id}, {whenOf(page.filed.at, now)}
									</span>
								)}
								{opened.ticket.state === "closed" && <span className="tag">closed</span>}
							</div>
							<h1 className="tk-title">
								<Ticks text={opened.ticket.title} />
							</h1>
						</div>
						{view.unreachable !== null && (
							<p className="alert" role="alert">
								The ledger did not answer: {view.unreachable}
							</p>
						)}
						{view.failed !== null && (
							<p className="alert" role="alert">
								A write did not land: {view.failed.why}
							</p>
						)}
						<TurnCard head={opened.head} page={page} now={now} send={send} />
						<section className="props-inline" aria-label="Properties">
							<Props page={page} number={number} now={now} />
						</section>
						<div className="desc">
							{paragraphs.length === 0 ? (
								<p className="empty">No description.</p>
							) : (
								paragraphs.map((p) => (
									<p key={p.at}>
										<Ticks text={p.text} />
									</p>
								))
							)}
						</div>
						<section aria-label="Activity">
							<Activity rows={opened.rows} timeline={opened.ticket.timeline} now={now} />
							<Composer ticket={number} send={send} saving={view.saving.length} />
						</section>
					</div>
				</div>
				<aside className="tk-side" aria-label="Properties">
					<div>
						<h3>Properties</h3>
						<Props page={page} number={number} now={now} />
					</div>
					<div className="made">
						<h3>Made of</h3>
						<span>
							A lane and its steps, writing facts to one ledger stream. Type this in a tile to see
							them:
						</span>
						<code className="cmd">map --ticket {number}</code>
					</div>
				</aside>
			</div>
		</div>
	);
}
