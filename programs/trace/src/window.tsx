import type {WindowProps} from "@kampus/fabrika-old";
import {Kbd} from "@manti-ui/react";
import {Fragment, type KeyboardEvent, type ReactNode} from "react";
import type {trace} from "./index.ts";
import {ticksOf} from "./ruler.ts";
import type {
	Change,
	Detail,
	LaneShown,
	Row,
	Shown,
	State,
	TicketRow,
	TicketShown,
	Tokens,
} from "./view.ts";

// The trace's window: a waterfall, as Jaeger draws a trace. Names on the left, nested by parent;
// time runs right, one bar per span in its program's colour, red when it went wrong, its events
// as dots, a step as a mark. Every row that groups others opens with a click or a key, and the
// chosen row opens in place beneath itself: a span as Jaeger's span detail (its tags, its events),
// a step as Elm's debugger and Redux DevTools show one (its Msg, what changed, the state before
// and after, its Cmds). What is open and what is chosen is the program's state: this component
// keeps none, and only sends `toggle`, `choose`, `step` and `seek`.
//
// The ticket view (ticket 141): one section per lane, oldest first, each on its own axis. A
// folded lane is one line: its steps drawn small in its own time, how it ended in words, and its
// price at list price. An open lane shows its ruler, then a row per step and per wait on a person;
// a step opens to its spans. A bar's colour is its state, never alone: its words are beside it.
// The chosen row's detail sits at the side where the tile is wide, and under the lanes where it
// is not (Honeycomb's sidebar, Datadog's bottom pane). A step row says its tokens, never dollars.
//
// The keys are the WAI-ARIA tree grid's: ↑ and ↓ move between rows, → opens a row (or moves into
// it), ← closes it (or moves to its parent), Enter and Space do what a click does, Home and End
// jump.

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** How long, in a few characters: `0.8 ms`, `12 ms`, `3.4 s`, `2m 05s`. */
export const took = (ms: number): string => {
	if (ms < 10) {
		return `${Math.round(ms * 10) / 10} ms`;
	}

	if (ms < 1000) {
		return `${Math.round(ms)} ms`;
	}

	if (ms < 60_000) {
		return `${(ms / 1000).toFixed(1)} s`;
	}

	const s = Math.round(ms / 1000);
	return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};

/** How long so far, in what one tick a second can show: `12 s`, `2m 05s`. */
const soFar = (ms: number): string => (ms < 60_000 ? `${Math.floor(ms / 1000)} s` : took(ms));

/** A long gap, in its two largest units: `18 h 30 min`, `2 d 4 h`. Under an hour, as `took`. */
const gap = (ms: number): string => {
	if (ms < HOUR) {
		return took(ms);
	}

	if (ms < DAY) {
		const m = Math.round(ms / MIN);
		return m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)} h ${m % 60} min`;
	}

	const h = Math.round(ms / HOUR);
	return h % 24 === 0 ? `${h / 24} d` : `${Math.floor(h / 24)} d ${h % 24} h`;
};

/** A tick's label, in the ruler's own round units: `0`, `500 ms`, `1.5 s`, `5 min`, `1 h 30 min`. */
const tickLabel = (ms: number): string => {
	if (ms === 0) {
		return "0";
	}

	if (ms < SEC) {
		return `${ms} ms`;
	}

	if (ms < MIN) {
		return `${ms / SEC} s`;
	}

	if (ms < HOUR) {
		const s = (ms % MIN) / SEC;
		return s === 0 ? `${ms / MIN} min` : `${Math.floor(ms / MIN)} min ${s} s`;
	}

	if (ms < DAY) {
		const m = (ms % HOUR) / MIN;
		return m === 0 ? `${ms / HOUR} h` : `${Math.floor(ms / HOUR)} h ${m} min`;
	}

	return `${Math.round((ms / DAY) * 10) / 10} d`;
};

/** A clock time on this machine, to the minute. */
const hhmm = (at: number): string =>
	new Date(at).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit", hour12: false});

/** A clock time on this machine, to the second. */
const hhmmss = (at: number): string =>
	new Date(at).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	});

/** A count of tokens, short: `870`, `12k`, `1.2M`. */
const count = (n: number): string => {
	if (n < 1000) {
		return String(n);
	}

	if (n < 1_000_000) {
		return `${Math.round(n / 1000)}k`;
	}

	return `${Math.round(n / 100_000) / 10}M`;
};

/** A known price, never `$0.00`: under a cent says so, and a known nothing is "no charge". */
const dollars = (usd: number): string => {
	if (usd === 0) {
		return "no charge";
	}

	if (usd < 0.005) {
		return "under $0.01";
	}

	return `$${usd.toFixed(2)}`;
};

/** A value as JSON: on one line when short, else indented. */
const json = (value: unknown): string => {
	const one = JSON.stringify(value) ?? "undefined";
	return one.length <= 64 ? one : (JSON.stringify(value, null, 2) ?? one);
};

/** A place on an axis, as a share of its length, kept on the axis. */
const place = (at: number, length: number) =>
	`${(Math.min(length, Math.max(0, at)) / length) * 100}%`;

/** A service's colour: its place in the trace's list, one of six. */
const colourOf = (shown: Shown, service: string) =>
	`var(--svc-${Math.max(0, shown.services.indexOf(service)) % 6})`;

const KIND_WORD: Readonly<Record<Row["kind"], string>> = {
	job: "job",
	span: "span",
	run: "run",
	turns: "an agent's turns",
	machine: "machine run",
	step: "step",
};

/** The ruler: ranked ticks, rank 0 to 3, the finer ranks shown only where the ruler is wide (window.css). */
function Ruler({length}: {readonly length: number}) {
	return (
		<div className="wf-track wf-ruler">
			{ticksOf(length).map((t) => (
				<span
					key={t.t}
					className={`wf-tick r${t.rank}`}
					style={{insetInlineStart: place(t.t, length)}}
				>
					{tickLabel(t.t)}
				</span>
			))}
		</div>
	);
}

function Bar({row, shown}: {readonly row: Row; readonly shown: Shown}) {
	const colour = row.wrong ? "var(--stuck)" : colourOf(shown, row.service);

	if (row.kind === "step") {
		return (
			<span
				className="wf-mark"
				style={{insetInlineStart: place(row.from, shown.length), background: colour}}
				aria-hidden="true"
			/>
		);
	}

	const width = Math.max(0, row.to - row.from);
	return (
		<>
			<span
				className={`wf-span${row.wrong ? " wrong" : ""}`}
				style={{
					insetInlineStart: place(row.from, shown.length),
					inlineSize: `max(2px, ${place(width, shown.length)})`,
					background: colour,
				}}
				aria-hidden="true"
			>
				{row.dots.map((d, i) => (
					<i
						key={`${d.name}-${String(i)}`}
						className="wf-dot"
						style={{insetInlineStart: width === 0 ? "0" : `${((d.at - row.from) / width) * 100}%`}}
						title={`${d.name} at +${took(d.at)}`}
					/>
				))}
			</span>
			<span
				className="wf-took"
				style={{insetInlineStart: `calc(${place(row.to, shown.length)} + 6px)`}}
				aria-hidden="true"
			>
				{row.kind === "job" && shown.running !== null ? soFar(width) : took(width)}
			</span>
		</>
	);
}

function ChangeLine({change}: {readonly change: Change}) {
	switch (change.op) {
		case "add":
			return (
				<li className="add">
					<span className="mono">{change.path}</span> added <code>{json(change.after)}</code>
				</li>
			);
		case "remove":
			return (
				<li className="remove">
					<span className="mono">{change.path}</span> removed <code>{json(change.before)}</code>
				</li>
			);
		case "replace":
			return (
				<li className="replace">
					<span className="mono">{change.path}</span> <code>{json(change.before)}</code> →{" "}
					<code>{json(change.after)}</code>
				</li>
			);
	}
}

function Pre({label, value}: {readonly label: string; readonly value: unknown}) {
	return (
		<figure className="wf-json">
			<figcaption>{label}</figcaption>
			<pre>{json(value)}</pre>
		</figure>
	);
}

function Tags({tags}: {readonly tags: readonly (readonly [string, string])[]}) {
	if (tags.length === 0) {
		return <p className="faint">No tags.</p>;
	}

	return (
		<table className="wf-tags">
			<tbody>
				{tags.map(([k, v]) => (
					<tr key={k}>
						<th scope="row" className="mono">
							{k}
						</th>
						<td className="mono">{v}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

function JobFacts({job}: {readonly job: NonNullable<Shown["job"]>}) {
	return (
		<dl className="kv">
			<dt>job</dt>
			<dd>
				<span className="mono">%{job.n}</span> <span className="mono">{job.text}</span>
			</dd>
			<dt>started</dt>
			<dd>
				by <span className="mono">{job.by}</span> on <span className="mono">{job.host}</span>
			</dd>
			<dt>ended</dt>
			<dd>
				{job.ended === null
					? "still running"
					: `${job.ended.how}, after ${took(job.ended.at - job.started)}`}
			</dd>
		</dl>
	);
}

function RunFacts({run}: {readonly run: NonNullable<Extract<Detail, {kind: "span"}>["run"]>}) {
	return (
		<dl className="kv">
			<dt>run</dt>
			<dd className="mono">{run.run}</dd>
			<dt>status</dt>
			<dd>{run.status}</dd>
			<dt>flags</dt>
			<dd>
				<code>{json(run.flags)}</code>
			</dd>
		</dl>
	);
}

/** What a step's price is, in words and never a figure: the figure is in its lane's line. */
const PRICED: Readonly<Record<Extract<Detail, {kind: "run"}>["priced"], string>> = {
	known: "known, in its lane's line, at list price",
	unknown: "no list price for this model",
	none: "none: code ran it, no model",
	pending: "not yet: it has not ended",
	never: "none: it never ended, so no tokens were counted",
};

function Opened({detail}: {readonly detail: Detail}) {
	switch (detail.kind) {
		case "step":
			return (
				<section
					className="wf-detail"
					aria-label={`step ${detail.n} of ${detail.machine} ${detail.id}`}
				>
					<p className="wf-detail-h">
						<b>
							{detail.machine} {detail.id}
						</b>{" "}
						step {detail.n} <span className="faint">at +{took(detail.at)}, run</span>{" "}
						<span className="mono faint">{detail.run}</span>
					</p>
					<Pre label="Msg" value={detail.msg} />
					<section className="wf-diff" aria-label="what changed">
						<h4>What changed</h4>
						{detail.before.kind === "start" ? (
							<p className="faint">The first step: the state before it is the machine's start.</p>
						) : detail.changes.length === 0 ? (
							<p className="faint">Nothing: the state stayed as it was.</p>
						) : (
							<ul>
								{detail.changes.map((c) => (
									<ChangeLine key={`${c.op}${c.path}`} change={c} />
								))}
							</ul>
						)}
					</section>
					<div className="wf-states">
						{detail.before.kind === "kept" ? (
							<Pre label="State before" value={detail.before.state} />
						) : (
							<figure className="wf-json">
								<figcaption>State before</figcaption>
								<p className="faint">The machine's start: no row keeps it.</p>
							</figure>
						)}
						<Pre label="State after" value={detail.after} />
					</div>
					<section aria-label="Cmds">
						<h4>Cmds</h4>
						{detail.cmds.length === 0 ? (
							<p className="faint">None.</p>
						) : (
							<ul className="wf-cmds">
								{detail.cmds.map((c, i) => (
									<li key={String(i)}>
										<code>{json(c)}</code>
									</li>
								))}
							</ul>
						)}
					</section>
				</section>
			);
		case "span":
			return (
				<section className="wf-detail" aria-label={`span ${detail.name}`}>
					<p className="wf-detail-h">
						<b>{detail.service}</b> {detail.name}{" "}
						<span className="faint">
							{took(detail.took)}, from +{took(detail.at)}
						</span>{" "}
						{detail.status === "error" ? <span className="wf-bad">error</span> : null}
					</p>
					{detail.job === null ? null : <JobFacts job={detail.job} />}
					{detail.run === null ? null : <RunFacts run={detail.run} />}
					<h4>Tags</h4>
					<Tags tags={detail.tags} />
					<h4>Events</h4>
					{detail.events.length === 0 ? (
						<p className="faint">None.</p>
					) : (
						<ol className="wf-events">
							{detail.events.map((e, i) => (
								<li key={`${e.name}-${String(i)}`}>
									<span className="mono faint">+{took(e.at)}</span> {e.name}
									{e.tags.length === 0 ? null : (
										<span className="faint"> {e.tags.map(([k, v]) => `${k}=${v}`).join(", ")}</span>
									)}
								</li>
							))}
						</ol>
					)}
					<p className="faint mono">
						span {detail.span}
						{detail.parent === null ? ", a root" : `, under ${detail.parent}`}
					</p>
				</section>
			);
		case "machine":
			return (
				<section className="wf-detail" aria-label={`machine run ${detail.machine} ${detail.id}`}>
					<p className="wf-detail-h">
						<b>
							{detail.machine} {detail.id}
						</b>{" "}
						{detail.steps} {detail.steps === 1 ? "step" : "steps"}, run{" "}
						<span className="mono faint">{detail.run}</span>
					</p>
					<Pre label="State after its newest step" value={detail.state} />
				</section>
			);
		case "group":
			return (
				<section className="wf-detail" aria-label={detail.name}>
					<p className="wf-detail-h">
						<b>{detail.name}</b> groups {detail.size} {detail.size === 1 ? "row" : "rows"}
					</p>
					{detail.job === null ? null : <JobFacts job={detail.job} />}
					{detail.run === null ? null : <RunFacts run={detail.run} />}
				</section>
			);
		case "run":
			return (
				<section className="wf-detail" aria-label={`step ${detail.stage}`}>
					<p className="wf-detail-h">
						<b>{detail.stage}</b> {detail.outcome}{" "}
						<span className="faint">
							from {hhmmss(detail.at)}, {detail.state === "running" ? "so far " : ""}
							{took(detail.took)}
						</span>
					</p>
					<dl className="kv">
						<dt>run</dt>
						<dd className="mono">{detail.run}</dd>
						<dt>ran by</dt>
						<dd>
							{detail.model === null ? (
								"code"
							) : (
								<>
									<span className="mono">{detail.model}</span>
									{detail.harness === null ? null : (
										<span className="faint"> on {detail.harness}</span>
									)}
								</>
							)}
						</dd>
						{/* A step code ran spends no tokens: its zeros are no count, so no row. */}
						{detail.tokens === null || detail.model === null ? null : (
							<>
								<dt>tokens</dt>
								<dd>
									{detail.tokens.input.toLocaleString("en-US")} in, of them{" "}
									{detail.tokens.cached.toLocaleString("en-US")} cached;{" "}
									{detail.tokens.output.toLocaleString("en-US")} out
								</dd>
							</>
						)}
						<dt>price</dt>
						<dd>{PRICED[detail.priced]}</dd>
					</dl>
				</section>
			);
		case "ask":
			return (
				<section className="wf-detail" aria-label={`wait: ${detail.what}`}>
					<p className="wf-detail-h">
						<b>{detail.what}</b>
					</p>
					<dl className="kv">
						<dt>asked</dt>
						<dd>{hhmmss(detail.at)}</dd>
						<dt>answer</dt>
						<dd>
							{detail.pick === null ? (
								detail.state === "cut" ? (
									"never answered: a newer lane began first"
								) : (
									`none yet, waiting ${took(detail.took)} so far`
								)
							) : (
								<>
									<b>{detail.pick}</b>
									{detail.by === null ? null : (
										<>
											{" "}
											by <span className="mono">{detail.by}</span>
										</>
									)}
									, after {took(detail.took)}
								</>
							)}
						</dd>
						<dt>ask</dt>
						<dd className="mono">{detail.ask}</dd>
					</dl>
				</section>
			);
	}
}

/**
 * The head of a record shown: its line, then what is in it, the time and how the job stands, in
 * that order from the first read to the last. `drawn`: false while there is nothing to count or
 * to colour yet. The time is so far while the job runs, once a tick told it, and final after.
 */
function Head({view, drawn}: {readonly view: Shown; readonly drawn: boolean}) {
	const {running} = view;
	const time =
		running === null ? took(view.length) : running.took === null ? "" : soFar(running.took);
	const how = view.job?.ended?.how ?? "";
	const parts: readonly ReactNode[] = [
		...(drawn
			? [
					`${view.spans} ${view.spans === 1 ? "span" : "spans"}`,
					`${view.steps} ${view.steps === 1 ? "step" : "steps"}`,
				]
			: []),
		...(time === "" ? [] : [time]),
		...(running === null ? [] : [<RunningWord key="running" />]),
		...(how === "" ? [] : [how]),
	];
	return (
		<div className="mapbar">
			<span className="state">
				<b className="mono">{view.title}</b>
			</span>
			<span className="faint">
				<Dotted parts={parts} />
			</span>
			{drawn ? (
				<span className="legend" title="one colour per program">
					{view.services.map((s) => (
						<span key={s}>
							<span className="swatch" style={{background: colourOf(view, s)}} aria-hidden="true" />
							{s}
						</span>
					))}
				</span>
			) : null}
			<span className="faint mono trace-id">trace {view.id}</span>
		</div>
	);
}

/** Parts of a line, a middle dot between each. */
function Dotted({parts}: {readonly parts: readonly ReactNode[]}) {
	return parts.map((part, i) => (
		<Fragment key={String(i)}>
			{i === 0 ? null : " · "}
			{part}
		</Fragment>
	));
}

/** The word a running job carries, with the same quiet dot a live run has elsewhere. */
function RunningWord() {
	return (
		<span className="trace-running">
			<span className="dot run live" aria-hidden="true" />
			running
		</span>
	);
}

/** The row elements of the grid, in order, for the keys to move between. */
const rowsIn = (grid: Element | null): HTMLElement[] =>
	grid === null ? [] : [...grid.querySelectorAll<HTMLElement>("[data-row]")];

/** A tree grid's row, as its keys see it. */
interface TreeRow {
	readonly key: string;
	readonly depth: number;
	readonly opens: boolean;
	readonly open: boolean;
}

/** The WAI-ARIA tree grid's keys on one row, among all the rows shown in order. */
const onTreeKey = (
	e: KeyboardEvent<HTMLTableRowElement>,
	row: TreeRow,
	rows: readonly TreeRow[],
	toggle: (key: string) => void,
	press: () => void,
) => {
	const all = rowsIn(e.currentTarget.closest("[role=treegrid]"));
	const here = all.indexOf(e.currentTarget);
	const go = (i: number) => all[Math.max(0, Math.min(all.length - 1, i))]?.focus();

	switch (e.key) {
		case "ArrowDown":
			go(here + 1);
			break;
		case "ArrowUp":
			go(here - 1);
			break;
		case "Home":
			go(0);
			break;
		case "End":
			go(all.length - 1);
			break;
		case "ArrowRight":
			if (row.opens && !row.open) {
				toggle(row.key);
			} else if (row.open) {
				go(here + 1);
			}

			break;
		case "ArrowLeft": {
			if (row.open && row.opens) {
				toggle(row.key);
			} else {
				const at = rows.findIndex((r) => r.key === row.key);
				const parent = rows.slice(0, at).findLast((r) => r.depth < row.depth);

				if (parent !== undefined) {
					go(rows.indexOf(parent));
				}
			}

			break;
		}
		case "Enter":
		case " ":
			press();
			break;
		default:
			return;
	}

	e.preventDefault();
};

type Send = WindowProps<typeof trace>["send"];

export function TraceWindow({view, send}: WindowProps<typeof trace>) {
	if (view.shows === "ticket") {
		return <TicketWindow view={view} send={send} />;
	}

	return <JobWindow view={view} send={send} />;
}

function JobWindow({view, send}: {readonly view: Shown; readonly send: Send}) {
	const chosen = view.chosen?.key ?? null;
	const toggle = (row: string) => send({type: "toggle", value: {row}});
	const choose = (row: string | null) => send({type: "choose", value: {row}});
	/** A click, or Enter or Space: a grouped row opens or closes, and shows its detail. */
	const press = (row: Row) => {
		if (row.opens) {
			toggle(row.key);

			if (chosen !== row.key) {
				choose(row.key);
			}
		} else {
			choose(chosen === row.key ? null : row.key);
		}
	};

	if (view.read !== "read") {
		return (
			<section className="view trace-view" aria-label="trace">
				<p className="empty">
					{view.read === "unread"
						? `The record of ${view.id ?? "this trace"} cannot be read: ${view.why ?? "no reason given"}`
						: view.read === "reading"
							? "Reading the record."
							: "Pick a run, and its trace shows here."}
				</p>
			</section>
		);
	}

	// Read, and nobody wrote it: no job, no span, no step. Said in words, not drawn as a job of 0 ms.
	if (view.job === null && view.spans === 0 && view.steps === 0) {
		return (
			<section className="view trace-view" aria-label="trace">
				<p className="empty">
					This host keeps no record of trace <span className="mono">{view.id}</span>. A job run on
					another host, or before this host kept records, has none here.
				</p>
			</section>
		);
	}

	// A job begun with nothing in it yet: the word and the time in the head and one plain line under
	// it, as Linear's empty states are. An axis or a bar would be a finished run that never was. A
	// job with only its line's span in has something to draw: its row, running to now.
	if (view.running !== null && view.empty) {
		return (
			<section className="view trace-view" aria-label={`trace of ${view.title}`}>
				<Head view={view} drawn={false} />
				<p className="empty">Nothing in the record yet. Spans and steps show here as they come.</p>
			</section>
		);
	}

	const focusable = chosen ?? view.rows[0]?.key ?? null;
	return (
		<section className="view trace-view" aria-label={`trace of ${view.title}`}>
			<Head view={view} drawn={true} />
			{/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role -- a tree grid is a table whose rows open and take the keys; the WAI-ARIA tree grid example is this same table with this role, and its cells become grid cells. */}
			<table className="wf" role="treegrid" aria-label="spans and steps" aria-readonly="true">
				<colgroup>
					<col className="wf-c-name" />
					<col />
				</colgroup>
				<thead>
					<tr className="wf-row wf-head">
						<th scope="col" className="wf-name">
							name
						</th>
						<th scope="col" className="wf-lane">
							<Ruler length={view.length} />
						</th>
					</tr>
				</thead>
				<tbody>
					{view.rows.map((row) => (
						<Fragment key={row.key}>
							<tr
								className={`wf-row${row.key === chosen ? " sel" : ""}${row.wrong ? " wrong" : ""}`}
								data-row={row.key}
								aria-level={row.depth + 1}
								aria-expanded={row.opens ? row.open : undefined}
								aria-selected={row.key === chosen}
								aria-label={`${KIND_WORD[row.kind]} ${row.name}${row.note === "" ? "" : `, ${row.note}`}`}
								tabIndex={row.key === focusable ? 0 : -1}
								onClick={() => press(row)}
								onKeyDown={(e) => onTreeKey(e, row, view.rows, toggle, () => press(row))}
							>
								<td className="wf-name">
									<span
										className="wf-in"
										style={{paddingInlineStart: `calc(${row.depth} * 14px + 6px)`}}
									>
										<span className="wf-caret" aria-hidden="true">
											{row.opens ? (row.open ? "▾" : "▸") : ""}
										</span>
										<span
											className="wf-swatch"
											style={{
												background: row.wrong ? "var(--stuck)" : colourOf(view, row.service),
											}}
											aria-hidden="true"
										/>
										<span className={row.kind === "step" ? "mono" : ""}>{row.name}</span>
										{row.note === "" ? null : <span className="faint wf-note">{row.note}</span>}
									</span>
								</td>
								<td className="wf-lane">
									<div className="wf-track">
										<Bar row={row} shown={view} />
									</div>
								</td>
							</tr>
							{row.key === chosen && view.chosen !== null ? (
								<tr className="wf-open">
									<td colSpan={2}>
										<Opened detail={view.chosen} />
									</td>
								</tr>
							) : null}
						</Fragment>
					))}
				</tbody>
			</table>
			<p className="note">
				Click a row, or use <Kbd>↑</Kbd> <Kbd>↓</Kbd> to move, <Kbd>→</Kbd> <Kbd>←</Kbd> to open and
				close, and <Kbd>Enter</Kbd> to open a row's detail. Every step opens to its Msg, the state
				before and after, and its Cmds.
			</p>
		</section>
	);
}

// The ticket view.

/** A ticket's rows as the keys see them: each lane, then its rows while it is open. */
type Line =
	| {readonly kind: "lane"; readonly lane: LaneShown; readonly tree: TreeRow}
	| {
			readonly kind: "row";
			readonly lane: LaneShown;
			readonly row: TicketRow;
			readonly tree: TreeRow;
	  };

const linesOf = (ticket: TicketShown): readonly Line[] =>
	ticket.lanes.flatMap((lane): Line[] => [
		{kind: "lane", lane, tree: {key: lane.key, depth: 0, opens: lane.opens, open: lane.open}},
		...lane.rows.map((row): Line => ({
			kind: "row",
			lane,
			row,
			tree: {
				key: row.key,
				depth: row.depth,
				opens: row.kind === "step" || row.kind === "span" ? row.opens : row.kind === "calls",
				open: row.kind === "wait" ? false : row.open,
			},
		})),
	]);

/** The ticket's line: its lanes, steps and waits, and its price at list price. */
const summaryWords = (s: TicketShown["summary"]): readonly string[] => [
	`${s.lanes} ${s.lanes === 1 ? "lane" : "lanes"}`,
	`${s.steps} ${s.steps === 1 ? "step" : "steps"}`,
	...(s.waits === 0
		? []
		: [`${s.waits} ${s.waits === 1 ? "wait" : "waits"} on a person, ${took(s.waited)} in all`]),
	...(s.usd === null
		? s.unknown === 0
			? []
			: ["no list price"]
		: [
				`${dollars(s.usd)} at list price${
					s.unknown === 0
						? ""
						: `, and ${s.unknown} ${s.unknown === 1 ? "step" : "steps"} with no list price`
				}`,
			]),
];

/**
 * A lane's price, for its line: its known prices summed, said in words to be at list price (decision
 * 7), or why there is none. The words wrap under the dollars when the tile is narrow.
 */
function LanePrice({summary}: {readonly summary: LaneShown["summary"]}) {
	if (summary.usd === null) {
		return summary.unknown === 0 ? null : "no list price";
	}

	return (
		<>
			<span className="tv-usd">{dollars(summary.usd)}</span>{" "}
			<span className="faint tv-usd">at list price</span>
		</>
	);
}

/**
 * A lane that is one instant, as one whose only step never ended: a length or a ruler would say
 * "1 ms", which nothing took, so it shows neither.
 */
const instant = (lane: LaneShown): boolean => !lane.live && lane.length <= 1;

/** The replay: one fact back, one on, and back to live. */
function Replay({ticket, send}: {readonly ticket: TicketShown; readonly send: Send}) {
	const {at, stop, stops} = ticket.replay;
	const live = at === null;
	return (
		<div className="tv-replay" role="group" aria-label="replay">
			<span className="faint" role="status">
				{live ? "live" : `fact ${stop} of ${stops}, ${hhmmss(at)}`}
			</span>
			<button
				type="button"
				className="btn sm quiet"
				aria-label="one fact back"
				disabled={stops === 0 || stop <= 1}
				onClick={() => send({type: "step", value: {by: -1}})}
			>
				‹
			</button>
			<button
				type="button"
				className="btn sm quiet"
				aria-label="one fact on"
				disabled={live}
				onClick={() => send({type: "step", value: {by: 1}})}
			>
				›
			</button>
			<button
				type="button"
				className="btn sm quiet"
				aria-pressed={live}
				disabled={live}
				onClick={() => send({type: "seek", value: {at: null}})}
			>
				Live
			</button>
		</div>
	);
}

/** Where a bar's words go: after it, before it, or inside it when it fills the axis. */
const labelAt = (from: number, to: number, length: number): "after" | "before" | "inside" =>
	to / length <= 0.62 ? "after" : from / length >= 0.38 ? "before" : "inside";

/** A bar on a lane's axis, its state's colour, with its words beside it or inside it. */
function LaneBar({
	from,
	to,
	length,
	state,
	words,
}: {
	readonly from: number;
	readonly to: number;
	readonly length: number;
	readonly state: State | "span" | "wrong";
	readonly words: string;
}) {
	const where = labelAt(from, to, length);
	const start = place(from, length);
	const end = place(to, length);
	return (
		<>
			<span
				className={`tv-bar ${state}`}
				style={{insetInlineStart: start, inlineSize: `max(2px, calc(${end} - ${start}))`}}
				aria-hidden="true"
			>
				{where === "inside" ? <span className="tv-words in">{words}</span> : null}
			</span>
			{where === "inside" ? null : (
				<span
					className={`tv-words ${where}`}
					style={
						where === "after"
							? {insetInlineStart: `calc(${end} + 6px)`}
							: {insetInlineEnd: `calc(100% - ${start} + 6px)`}
					}
					aria-hidden="true"
				>
					{words}
				</span>
			)}
		</>
	);
}

/** A step's tokens, short, in the order in, cached, out. */
function TokenCounts({tokens}: {readonly tokens: Tokens}) {
	return (
		<span
			className="tv-tokens"
			title={`${tokens.input.toLocaleString("en-US")} in, ${tokens.cached.toLocaleString("en-US")} cached, ${tokens.output.toLocaleString("en-US")} out`}
		>
			{count(tokens.input)} in <span className="tv-cached">· {count(tokens.cached)} cached </span>·{" "}
			{count(tokens.output)} out
		</span>
	);
}

/** A row's name, words and bar, by kind. */
const rowParts = (
	row: TicketRow,
): {
	readonly label: string;
	readonly name: ReactNode;
	readonly words: string;
	readonly state: State | "span" | "wrong";
} => {
	const length = row.to - row.from;

	switch (row.kind) {
		case "step":
			return {
				label: `step ${row.stage}, ${row.outcome}${row.state === "cut" ? "" : `, ${took(length)}`}`,
				name: (
					<>
						<span className="tv-stage">{row.stage}</span>
						<span className="faint tv-note">{row.model ?? "code"}</span>
					</>
				),
				words:
					row.state === "cut"
						? row.outcome
						: `${row.state === "running" ? soFar(length) : took(length)} · ${row.outcome}`,
				state: row.state,
			};
		case "wait":
			return {
				label: `wait on a person: ${row.what}, ${row.pick ?? (row.state === "cut" ? "never answered" : "not answered")}`,
				name: (
					<>
						<span className="tv-stage">wait</span>
						<span className="faint tv-note">{row.what}</span>
					</>
				),
				words:
					row.state === "waiting"
						? `waiting · ${soFar(length)}`
						: row.state === "cut"
							? "never answered"
							: `${row.pick} · ${took(length)}`,
				state: row.state,
			};
		case "span":
			return {
				label: `span ${row.name}, ${row.service}`,
				name: (
					<>
						<span>{row.name}</span>
						<span className="faint tv-note">{row.service}</span>
					</>
				),
				words: took(length),
				state: row.wrong ? "wrong" : "span",
			};
		case "calls":
			return {
				label: `${row.count} HTTP ${row.count === 1 ? "call" : "calls"}`,
				name: <span>{`${row.count} ${row.count === 1 ? "call" : "calls"}`}</span>,
				words: took(length),
				state: "span",
			};
	}
};

function TicketWindow({view, send}: {readonly view: Shown; readonly send: Send}) {
	const {ticket} = view;

	if (view.read !== "read" || ticket === null) {
		return (
			<section className="view trace-view" aria-label={view.title}>
				<p className="empty">
					{view.read === "unread"
						? `The facts of ${view.title} cannot be read: ${view.why ?? "no reason given"}`
						: `Reading the facts of ${view.title}.`}
				</p>
			</section>
		);
	}

	const chosen = view.chosen?.key ?? null;
	const toggle = (row: string) => send({type: "toggle", value: {row}});
	const choose = (row: string | null) => send({type: "choose", value: {row}});
	const lines = linesOf(ticket);
	const trees = lines.map((l) => l.tree);
	/** A lane folds; a step or a span opens and shows its detail; a wait shows its detail. */
	const press = (line: Line) => {
		if (line.kind === "lane") {
			if (line.lane.opens) {
				toggle(line.lane.key);
			}

			return;
		}

		const {row} = line;

		if (row.kind === "calls") {
			return toggle(row.key);
		}

		if ((row.kind === "step" || row.kind === "span") && row.opens) {
			toggle(row.key);

			if (chosen !== row.key) {
				choose(row.key);
			}
		} else {
			choose(chosen === row.key ? null : row.key);
		}
	};
	const focusable = chosen ?? lines[0]?.tree.key ?? null;
	const rowProps = (line: Line, label: string) => ({
		"data-row": line.tree.key,
		"aria-level": line.tree.depth + 1,
		"aria-expanded": line.tree.opens ? line.tree.open : undefined,
		"aria-selected": line.tree.key === chosen,
		"aria-label": label,
		tabIndex: line.tree.key === focusable ? 0 : -1,
		onClick: () => press(line),
		onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) =>
			onTreeKey(e, line.tree, trees, toggle, () => press(line)),
	});

	return (
		<section className="view trace-view" aria-label={`trace of ticket ${ticket.number}`}>
			<div className="mapbar">
				<span className="state">
					<b>{ticket.number}</b> {view.title}
				</span>
			</div>
			<div className="tv-line">
				<span className="faint">
					<Dotted parts={summaryWords(ticket.summary)} />
				</span>
				<Replay ticket={ticket} send={send} />
			</div>
			{ticket.lanes.length === 0 ? (
				<p className="empty">
					No lane has run on this ticket yet. Its steps show here as they start.
				</p>
			) : (
				<div className="tv-body">
					<table
						className="wf tv"
						// oxlint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role -- a tree grid is a table whose rows open and take the keys, as in the WAI-ARIA tree grid example.
						role="treegrid"
						aria-label="lanes, steps and waits"
						aria-readonly="true"
					>
						<colgroup>
							<col className="wf-c-name" />
							<col />
							<col className="tv-c-end" />
						</colgroup>
						<tbody>
							{lines.map((line) => {
								if (line.kind === "lane") {
									const {lane} = line;
									const restart =
										lane.restart === null
											? ""
											: `${gap(lane.restart.after)} later, restarted from ${lane.restart.from}`;
									return (
										<Fragment key={lane.key}>
											{restart === "" ? null : (
												<tr className="tv-gap" aria-hidden="true">
													<td colSpan={3}>{restart}</td>
												</tr>
											)}
											<tr
												className={`wf-row tv-lane${lane.open ? " open" : ""}`}
												{...rowProps(
													line,
													`lane ${lane.n}, ${lane.outcome}${restart === "" ? "" : `, ${restart}`}`,
												)}
											>
												<td className="wf-name">
													<span className="wf-in" style={{paddingInlineStart: "6px"}}>
														<span className="wf-caret" aria-hidden="true">
															{lane.opens ? (lane.open ? "▾" : "▸") : ""}
														</span>
														<b>Lane {lane.n}</b>
														<span className="faint tv-note">
															{hhmm(lane.at)}
															{instant(lane)
																? ""
																: ` · ${lane.live ? soFar(lane.length) : took(lane.length)}`}
														</span>
													</span>
												</td>
												<td className="wf-lane">
													{lane.open ? (
														instant(lane) ? null : (
															<Ruler length={lane.length} />
														)
													) : (
														<div className="wf-track">
															<span className="tv-mini" aria-hidden="true">
																{lane.bars.map((b, i) => (
																	<span
																		key={String(i)}
																		className={`tv-bar ${b.state}`}
																		style={{
																			insetInlineStart: place(b.from, lane.length),
																			inlineSize: `max(2px, ${place(b.to - b.from, lane.length)})`,
																		}}
																	/>
																))}
															</span>
															<span className={`tv-words tv-out ${lane.state}`}>
																{lane.outcome}
															</span>
														</div>
													)}
												</td>
												<td className="tv-end">
													<LanePrice summary={lane.summary} />
												</td>
											</tr>
										</Fragment>
									);
								}

								const {row, lane} = line;
								const parts = rowParts(row);
								return (
									<tr
										key={row.key}
										className={`wf-row tv-${row.kind}${row.key === chosen ? " sel" : ""}`}
										{...rowProps(line, parts.label)}
									>
										<td className="wf-name">
											<span
												className="wf-in"
												style={{paddingInlineStart: `calc(${row.depth} * 14px + 6px)`}}
											>
												<span className="wf-caret" aria-hidden="true">
													{line.tree.opens ? (line.tree.open ? "▾" : "▸") : ""}
												</span>
												{parts.name}
											</span>
										</td>
										<td className="wf-lane">
											<div className="wf-track">
												<LaneBar
													from={row.from}
													to={row.to}
													length={lane.length}
													state={parts.state}
													words={parts.words}
												/>
											</div>
										</td>
										<td className="tv-end">
											{row.kind === "step" && row.tokens !== null ? (
												<TokenCounts tokens={row.tokens} />
											) : null}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
					{view.chosen === null ? null : (
						<aside className="tv-detail" aria-label="detail">
							<Opened detail={view.chosen} />
						</aside>
					)}
				</div>
			)}
			<p className="note">
				Click a lane to fold it, a step to open its spans. <Kbd>↑</Kbd> <Kbd>↓</Kbd> move,{" "}
				<Kbd>→</Kbd> <Kbd>←</Kbd> open and close, <Kbd>Enter</Kbd> shows a row's detail. ‹ and ›
				replay the ticket one fact at a time.
			</p>
		</section>
	);
}
