import type {WindowProps} from "@kampus/fabrika";
import type {CSSProperties, KeyboardEvent, ReactNode} from "react";
import type {trace} from "./index.ts";
import {inline, linesOf, needsTree} from "./value.ts";
import type {Change, Detail, Row, Shown} from "./view.ts";

// The trace's window: a waterfall, as Jaeger and Honeycomb draw a trace, and the chosen row's
// detail beside it, as Linear's side peek and Honeycomb's span panel sit. Names on the left,
// nested by parent; time runs right on a ruler with faint grid lines, one bar per span in its
// program's color, red with the word "error" when it went wrong, its events as dots, a step as a
// mark. A wide tile puts the detail on the right; a narrow one puts it under the waterfall, as
// Chrome DevTools does. The job's own detail shows first, as a trace viewer selects the root.
//
// A step's detail leads with what changed, as Redux DevTools' Diff tab does, then its Msg, the
// state after with the changed keys marked, and its Cmds. Values are trees, one key per line, as
// Elm's debugger draws a Model. A section with nothing in it is not drawn.
//
// What is open and what is chosen is the program's state: this component keeps none, and only
// sends `toggle` and `choose`. The keys are the WAI-ARIA tree grid's: ↑ and ↓ move between rows,
// → opens a row (or moves into it), ← closes it (or moves to its parent), Enter and Space do what
// a click does, Home and End jump, and Esc closes the detail. No line of the window explains them:
// they are the keys every tree takes, named on each row for a screen reader.

/** How long, in a few characters: `0.8 ms`, `12 ms`, `3.4 s`, `2m 05s`. */
export const took = (ms: number): string => {
	if (ms < 10) return `${Math.round(ms * 10) / 10} ms`;
	if (ms < 1000) return `${Math.round(ms)} ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
	const s = Math.round(ms / 1000);
	return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};

/** The ruler's step: a round one that gives at most five ticks after 0, as Jaeger's ruler has. */
const stepOf = (length: number): number => {
	const raw = length / 5;
	const tens = 10 ** Math.floor(Math.log10(raw));
	return ([1, 2, 5, 10].map((m) => m * tens).find((s) => s >= raw) ?? 10 * tens) || 1;
};

const ticksOf = (length: number, step: number): readonly number[] => {
	const out: number[] = [];
	for (let t = 0; t <= length + 1e-9; t += step) out.push(t);
	return out;
};

const place = (at: number, length: number) => `${(at / length) * 100}%`;

/** A trace id, short as git's: the first seven characters, the whole one in its tooltip. */
const shortId = (id: string) => id.slice(0, 7);

/** A service's color: its place in the trace's list, one of six. */
const colorOf = (shown: Shown, service: string) =>
	`var(--svc-${Math.max(0, shown.services.indexOf(service)) % 6})`;

const KIND_WORD: Readonly<Record<Row["kind"], string>> = {
	job: "job",
	span: "span",
	run: "run",
	turns: "an agent's turns",
	machine: "machine run",
	step: "step",
};

/** How the job stands, in one word with its color: the frame's rule, no color without its word. */
const standing = (job: Shown["job"]): {readonly word: string; readonly tone: string} | null => {
	if (job === null) return null;
	if (job.ended === null) return {word: "running", tone: "w-run"};
	if (job.ended.how === "failed") return {word: "failed", tone: "w-stuck"};
	return {word: job.ended.how, tone: job.ended.how === "done" ? "w-done" : "muted"};
};

function Bar({row, shown}: {readonly row: Row; readonly shown: Shown}) {
	const color = row.wrong ? "var(--stuck)" : colorOf(shown, row.service);
	if (row.kind === "step")
		return (
			<span
				className="wf-mark"
				style={{insetInlineStart: place(row.from, shown.length), background: color}}
				aria-hidden="true"
			/>
		);
	const width = Math.max(0, row.to - row.from);
	return (
		<>
			<span
				className="wf-span"
				style={{
					insetInlineStart: place(row.from, shown.length),
					inlineSize: `max(2px, ${place(width, shown.length)})`,
					background: color,
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
				{took(width)}
			</span>
		</>
	);
}

/** A value as a tree: one key per line, nested ones indented, the changed ones marked. */
function Tree({value, changed}: {readonly value: unknown; readonly changed?: ReadonlySet<string>}) {
	return (
		<ul className="tv">
			{linesOf(value, changed).map((l) => (
				<li
					key={l.path}
					className={`tv-l${l.changed ? " changed" : ""}`}
					style={{paddingInlineStart: `calc(${l.depth} * var(--s-4))`}}
				>
					{l.key === null ? null : <span className="tv-k">{l.key}</span>}
					<span className={`tv-v ${l.kind}`}>{l.text}</span>
					{l.changed ? <span className="sr">, changed</span> : null}
				</li>
			))}
		</ul>
	);
}

/** The detail's box: beside the waterfall or under it, its content kept in sight as the view scrolls. */
function Shell({label, children}: {readonly label: string; readonly children: ReactNode}) {
	return (
		<aside className="pk" aria-label={label}>
			<div className="pk-in">{children}</div>
		</aside>
	);
}

/** A value on one line when it fits; else how big it is: `{3 keys}`. */
function Value({value}: {readonly value: unknown}) {
	return <code className="tv-i">{inline(value)}</code>;
}

function Section({title, children}: {readonly title: string; readonly children: ReactNode}) {
	return (
		<section className="pk-s" aria-label={title}>
			<h4>{title}</h4>
			{children}
		</section>
	);
}

/**
 * One change, as Redux DevTools draws it: the path, the old value dim, then the new one. Not
 * struck through, as Redux strikes it: on a one-digit value the line hides the digit.
 */
function ChangeLine({change}: {readonly change: Change}) {
	const big = change.op !== "remove" && needsTree(change.after);
	return (
		<li className={`pk-ch ${change.op}`}>
			<div className="pk-ch-l">
				<span className="pk-path">{change.path === "" ? "the whole state" : change.path}</span>
				{change.op === "add" ? (
					<>
						<span className="faint">added</span> <Value value={change.after} />
					</>
				) : change.op === "remove" ? (
					<>
						<span className="faint">removed</span> <Value value={change.before} />
					</>
				) : (
					<>
						<span className="pk-was">{inline(change.before)}</span>
						<span className="faint" aria-hidden="true">
							→
						</span>
						<span className="sr">became</span>
						<Value value={change.after} />
					</>
				)}
			</div>
			{big ? <Tree value={change.after} /> : null}
		</li>
	);
}

/** A label and its value, as Linear lists an issue's properties. */
type Fact = readonly [string, ReactNode];

function Facts({rows}: {readonly rows: readonly Fact[]}) {
	return (
		<dl className="kv pk-kv">
			{rows.flatMap(([label, value]) => [
				<dt key={`${label}-t`}>{label}</dt>,
				<dd key={`${label}-d`}>{value}</dd>,
			])}
		</dl>
	);
}

type Job = NonNullable<Shown["job"]>;
type Run = NonNullable<Extract<Detail, {kind: "span"}>["run"]>;

const jobFacts = (job: Job, id: string | null): readonly Fact[] => [
	["Started by", job.by],
	["Host", job.host],
	[
		"Ended",
		job.ended === null
			? "still running"
			: `${job.ended.how} after ${took(job.ended.at - job.started)}`,
	],
	...(id === null
		? []
		: [
				[
					"Trace",
					<span key="id" className="mono pk-sel">
						{id}
					</span>,
				] as const,
			]),
];

const runFacts = (run: Run): readonly Fact[] => [
	[
		"Run",
		<span key="run" className="mono">
			{run.run}
		</span>,
	],
	["Status", run.status],
	[
		"Flags",
		needsTree(run.flags) ? (
			<Tree key="flags" value={run.flags} />
		) : (
			<Value key="flags" value={run.flags} />
		),
	],
];

function Head({
	title,
	sub,
	onClose,
}: {
	readonly title: ReactNode;
	readonly sub: ReactNode;
	readonly onClose: () => void;
}) {
	return (
		<div className="pk-h">
			<div className="pk-t">
				<h3>{title}</h3>
				<p className="pk-sub">{sub}</p>
			</div>
			<button
				type="button"
				className="pk-x"
				onClick={onClose}
				title="Close"
				aria-label="Close the detail"
				aria-keyshortcuts="Escape"
			>
				<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
					<path
						d="M3 3l6 6M9 3l-6 6"
						stroke="currentColor"
						strokeWidth="1.4"
						strokeLinecap="round"
					/>
				</svg>
			</button>
		</div>
	);
}

function Peek({
	detail,
	id,
	onClose,
}: {
	readonly detail: Detail;
	readonly id: string | null;
	readonly onClose: () => void;
}) {
	switch (detail.kind) {
		case "step": {
			const changed = new Set(detail.changes.map((c) => c.path));
			return (
				<Shell label={`step ${detail.n} of ${detail.machine} ${detail.id}`}>
					<Head
						title={detail.name}
						sub={
							<>
								{detail.machine} {detail.id} · step {detail.n} of {detail.of} · +{took(detail.at)}
							</>
						}
						onClose={onClose}
					/>
					<Section title="Changes">
						{detail.before.kind === "start" ? (
							<p className="faint">
								The first step: it starts the machine, so there is no state before it.
							</p>
						) : detail.changes.length === 0 ? (
							<p className="faint">None: the state stayed as it was.</p>
						) : (
							<ul className="pk-chs">
								{detail.changes.map((c) => (
									<ChangeLine key={`${c.op}${c.path}`} change={c} />
								))}
							</ul>
						)}
					</Section>
					<Section title="Msg">
						<Tree value={detail.msg} />
					</Section>
					<Section title="State after">
						<Tree value={detail.after} changed={changed} />
					</Section>
					{detail.cmds.length === 0 ? null : (
						<Section title={detail.cmds.length === 1 ? "Cmd" : `Cmds · ${detail.cmds.length}`}>
							<ol className="pk-cmds">
								{detail.cmds.map((c, i) => (
									<li key={String(i)}>
										<Tree value={c} />
									</li>
								))}
							</ol>
						</Section>
					)}
					<p className="pk-meta">
						run <span className="mono">{detail.run}</span>
					</p>
				</Shell>
			);
		}
		case "span":
			return (
				<Shell label={`span ${detail.name}`}>
					<Head
						title={
							<>
								{detail.name}
								{detail.status === "error" ? <span className="pk-bad">error</span> : null}
							</>
						}
						sub={
							<>
								{[detail.service, detail.op]
									.filter((w) => w !== detail.name)
									.map((w) => `${w} · `)
									.join("")}
								{took(detail.took)} · from +{took(detail.at)}
							</>
						}
						onClose={onClose}
					/>
					{detail.job === null ? null : <Facts rows={jobFacts(detail.job, id)} />}
					{detail.run === null ? null : <Facts rows={runFacts(detail.run)} />}
					{detail.tags.length === 0 ? null : (
						<Section title="Tags">
							<table className="pk-tags">
								<tbody>
									{detail.tags.map(([k, v]) => (
										<tr key={k}>
											<th scope="row">{k}</th>
											<td>{v}</td>
										</tr>
									))}
								</tbody>
							</table>
						</Section>
					)}
					{detail.events.length === 0 ? null : (
						<Section title={`Events · ${detail.events.length}`}>
							<ol className="pk-evs">
								{detail.events.map((e, i) => (
									<li key={`${e.name}-${String(i)}`} className="pk-ev">
										<span className="pk-at">+{took(e.at)}</span>
										<span>{e.name}</span>
										{e.tags.length === 0 ? null : (
											<span className="faint pk-evt">
												{e.tags.map(([k, v]) => `${k}=${v}`).join(", ")}
											</span>
										)}
									</li>
								))}
							</ol>
						</Section>
					)}
					<p className="pk-meta">
						span <span className="mono">{detail.span}</span>
						{detail.parent === null ? null : (
							<>
								{" "}
								under <span className="mono">{detail.parent}</span>
							</>
						)}
					</p>
				</Shell>
			);
		case "machine":
			return (
				<Shell label={`machine run ${detail.machine} ${detail.id}`}>
					<Head
						title={
							<>
								{detail.machine} {detail.id}
							</>
						}
						sub={`${detail.steps} ${detail.steps === 1 ? "step" : "steps"}`}
						onClose={onClose}
					/>
					<Section title="State after its last step">
						<Tree value={detail.state} />
					</Section>
					<p className="pk-meta">
						run <span className="mono">{detail.run}</span>
					</p>
				</Shell>
			);
		case "group":
			return (
				<Shell label={detail.name}>
					<Head
						title={detail.name}
						sub={
							detail.job === null
								? `${detail.size} ${detail.size === 1 ? "row" : "rows"} under it`
								: `job %${detail.job.n}`
						}
						onClose={onClose}
					/>
					{detail.job === null ? null : <Facts rows={jobFacts(detail.job, id)} />}
					{detail.run === null ? null : <Facts rows={runFacts(detail.run)} />}
				</Shell>
			);
	}
}

/** What a trace with nothing to draw says: a short title and one line, as Linear's empty views do. */
function Empty({
	title,
	line,
	tone,
	id = null,
}: {
	readonly title: string;
	readonly line: ReactNode;
	readonly tone?: "bad";
	/** The trace it is about, short, the whole id in its tooltip. */
	readonly id?: string | null;
}) {
	return (
		<section className="view trace-view" aria-label="trace">
			<div
				className={`tr-empty${tone === "bad" ? " bad" : ""}`}
				role={tone === "bad" ? "alert" : "status"}
			>
				<p className="tr-empty-t">{title}</p>
				<p>{line}</p>
				{id === null ? null : (
					<p className="mono tr-empty-id" title={`trace ${id}`}>
						trace {shortId(id)}
					</p>
				)}
			</div>
		</section>
	);
}

/** The row elements of the grid, in order, for the keys to move between. */
const rowsIn = (grid: Element | null): HTMLElement[] =>
	grid === null ? [] : [...grid.querySelectorAll<HTMLElement>("[data-row]")];

export function TraceWindow({view, send}: WindowProps<typeof trace>) {
	const chosen = view.chosen?.key ?? null;
	const toggle = (row: string) => send({type: "toggle", value: {row}});
	const choose = (row: string | null) => send({type: "choose", value: {row}});
	/** A click, or Enter or Space: a grouped row opens or closes, and shows its detail. */
	const press = (row: Row) => {
		if (row.opens) {
			toggle(row.key);
			if (chosen !== row.key) choose(row.key);
		} else choose(chosen === row.key ? null : row.key);
	};

	const onKey = (e: KeyboardEvent<HTMLTableRowElement>, row: Row) => {
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
				if (row.opens && !row.open) toggle(row.key);
				else if (row.open) go(here + 1);
				break;
			case "ArrowLeft": {
				if (row.open) toggle(row.key);
				else {
					const parent = view.rows
						.slice(
							0,
							view.rows.findIndex((r) => r.key === row.key),
						)
						.findLast((r) => r.depth < row.depth);
					if (parent !== undefined) go(view.rows.indexOf(parent));
				}
				break;
			}
			case "Enter":
			case " ":
				press(row);
				break;
			case "Escape":
				if (chosen === null) return;
				choose(null);
				break;
			default:
				return;
		}
		e.preventDefault();
	};

	if (view.read === "unread")
		return (
			<Empty
				tone="bad"
				title="This record cannot be read"
				line={view.why ?? "No reason was given."}
				id={view.id}
			/>
		);
	if (view.read === "reading")
		return <Empty title="Reading the record" line="It shows here as soon as it is read." />;
	if (view.read === "waiting")
		return (
			<Empty
				title="No trace yet"
				line={
					<>
						Pick a run in <span className="mono">runs</span>, or open one with{" "}
						<span className="mono">trace --id</span>.
					</>
				}
			/>
		);

	// Read, and nobody wrote it: no job, no span, no step. Said in words, not drawn as a job of 0 ms.
	if (view.job === null && view.spans === 0 && view.steps === 0)
		return (
			<Empty
				title="No record of this trace here"
				line="A job run on another host, or before this host kept records, has none here."
				id={view.id}
			/>
		);

	const focusable = chosen ?? view.rows[0]?.key ?? null;
	const state = standing(view.job);
	const step = stepOf(view.length);
	const grid = `${(step / view.length) * 100}%`;
	return (
		<section className="view trace-view" aria-label={`trace of ${view.title}`}>
			<header className="tr-head">
				<h2 className="tr-title" title={view.title}>
					{view.title}
				</h2>
				<span className="tr-facts">
					{state === null ? null : <span className={state.tone}>{state.word}</span>}
					<span>{took(view.length)}</span>
					<span>
						{view.spans} {view.spans === 1 ? "span" : "spans"}
					</span>
					{view.steps === 0 ? null : (
						<span>
							{view.steps} {view.steps === 1 ? "step" : "steps"}
						</span>
					)}
				</span>
				{view.services.length < 2 ? null : (
					<span className="tr-legend" title="One color per program">
						{view.services.map((s) => (
							<span key={s}>
								<span className="tr-sw" style={{background: colorOf(view, s)}} aria-hidden="true" />
								{s}
							</span>
						))}
					</span>
				)}
				{view.id === null ? null : (
					<span className="tr-id mono" title={`trace ${view.id}`}>
						{shortId(view.id)}
					</span>
				)}
			</header>
			<div className={`tr-body${view.chosen === null ? "" : " peeking"}`}>
				{/* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: a tree grid is a table whose rows open and take the keys; the WAI-ARIA tree grid example is this same table with this role, and its cells become grid cells. */}
				<table className="wf" role="treegrid" aria-label="spans and steps" aria-readonly="true">
					<colgroup>
						<col className="wf-c-name" />
						<col />
					</colgroup>
					<thead>
						<tr className="wf-row wf-head">
							<th scope="col" className="wf-name">
								<span className="sr">name</span>
							</th>
							<th scope="col" className="wf-lane">
								<div className="wf-track">
									{ticksOf(view.length, step).map((t) => (
										<span
											key={t}
											className="wf-tick"
											style={{insetInlineStart: place(t, view.length)}}
										>
											{t === 0 ? "0" : took(t)}
										</span>
									))}
								</div>
							</th>
						</tr>
					</thead>
					<tbody style={{"--grid": grid} as CSSProperties}>
						{view.rows.map((row) => (
							<tr
								key={row.key}
								className={`wf-row${row.key === chosen ? " sel" : ""}`}
								data-row={row.key}
								aria-level={row.depth + 1}
								aria-expanded={row.opens ? row.open : undefined}
								aria-selected={row.key === chosen}
								aria-label={`${KIND_WORD[row.kind]} ${row.name}${row.note === "" ? "" : `, ${row.note}`}${row.wrong ? ", error" : ""}`}
								aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Enter Escape"
								tabIndex={row.key === focusable ? 0 : -1}
								onClick={() => press(row)}
								onKeyDown={(e) => onKey(e, row)}
							>
								<td className="wf-name">
									<span
										className="wf-in"
										style={{paddingInlineStart: `calc(${row.depth} * var(--s-4))`}}
									>
										<span className={`wf-caret${row.open ? " open" : ""}`} aria-hidden="true">
											{row.opens ? (
												<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
													<path
														d="M3.5 2l3 3-3 3"
														fill="none"
														stroke="currentColor"
														strokeWidth="1.3"
														strokeLinecap="round"
														strokeLinejoin="round"
													/>
												</svg>
											) : null}
										</span>
										<span
											className="wf-swatch"
											style={{background: row.wrong ? "var(--stuck)" : colorOf(view, row.service)}}
											aria-hidden="true"
										/>
										<span className="wf-label">{row.name}</span>
										{row.wrong ? <span className="wf-bad">error</span> : null}
										{row.note === "" ? null : <span className="wf-note">{row.note}</span>}
									</span>
								</td>
								<td className="wf-lane">
									<div className="wf-track">
										<Bar row={row} shown={view} />
									</div>
								</td>
							</tr>
						))}
					</tbody>
				</table>
				{view.chosen === null ? null : (
					<Peek detail={view.chosen} id={view.id} onClose={() => choose(null)} />
				)}
			</div>
		</section>
	);
}
