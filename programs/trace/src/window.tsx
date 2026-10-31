import type {WindowProps} from "@kampus/fabrika";
import {Fragment, type KeyboardEvent} from "react";
import type {trace} from "./index.ts";
import type {Change, Detail, Row, Shown} from "./view.ts";

// The trace's window: a waterfall, as Jaeger draws a trace. Names on the left, nested by parent;
// time runs right, one bar per span in its program's colour, red when it went wrong, its events
// as dots, a step as a mark. Every row that groups others opens with a click or a key, and the
// chosen row opens in place beneath itself: a span as Jaeger's span detail (its tags, its events),
// a step as Elm's debugger and Redux DevTools show one (its Msg, what changed, the state before
// and after, its Cmds). What is open and what is chosen is the program's state: this component
// keeps none, and only sends `toggle` and `choose`.
//
// The keys are the WAI-ARIA tree grid's: ↑ and ↓ move between rows, → opens a row (or moves into
// it), ← closes it (or moves to its parent), Enter and Space do what a click does, Home and End
// jump.

/** How long, in a few characters: `0.8 ms`, `12 ms`, `3.4 s`, `2m 05s`. */
export const took = (ms: number): string => {
	if (ms < 10) return `${Math.round(ms * 10) / 10} ms`;
	if (ms < 1000) return `${Math.round(ms)} ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
	const s = Math.round(ms / 1000);
	return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};

/** The ruler's ticks: a round step that gives at most six. */
const ticksOf = (length: number): readonly number[] => {
	const raw = length / 6;
	const tens = 10 ** Math.floor(Math.log10(raw));
	const step = ([1, 2, 5, 10].map((m) => m * tens).find((s) => s >= raw) ?? 10 * tens) || 1;
	const out: number[] = [];
	for (let t = 0; t <= length + 1e-9; t += step) out.push(t);
	return out;
};

/** A value as JSON: on one line when short, else indented. */
const json = (value: unknown): string => {
	const one = JSON.stringify(value) ?? "undefined";
	return one.length <= 64 ? one : (JSON.stringify(value, null, 2) ?? one);
};

const place = (at: number, length: number) => `${(at / length) * 100}%`;

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

function Bar({row, shown}: {readonly row: Row; readonly shown: Shown}) {
	const colour = row.wrong ? "var(--stuck)" : colourOf(shown, row.service);
	if (row.kind === "step")
		return (
			<span
				className="wf-mark"
				style={{insetInlineStart: place(row.from, shown.length), background: colour}}
				aria-hidden="true"
			/>
		);
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
				{took(width)}
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
	if (tags.length === 0) return <p className="faint">No tags.</p>;
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
	}
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
			default:
				return;
		}
		e.preventDefault();
	};

	if (view.read !== "read")
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

	// Read, and nobody wrote it: no job, no span, no step. Said in words, not drawn as a job of 0 ms.
	if (view.job === null && view.spans === 0 && view.steps === 0)
		return (
			<section className="view trace-view" aria-label="trace">
				<p className="empty">
					This host keeps no record of trace <span className="mono">{view.id}</span>. A job run on
					another host, or before this host kept records, has none here.
				</p>
			</section>
		);

	const focusable = chosen ?? view.rows[0]?.key ?? null;
	return (
		<section className="view trace-view" aria-label={`trace of ${view.title}`}>
			<div className="mapbar">
				<span className="state">
					<b className="mono">{view.title}</b>
				</span>
				<span className="faint">
					{view.spans} {view.spans === 1 ? "span" : "spans"} · {view.steps}{" "}
					{view.steps === 1 ? "step" : "steps"} · {took(view.length)}
					{view.job?.ended == null ? "" : ` · ${view.job.ended.how}`}
				</span>
				<span className="legend" title="one colour per program">
					{view.services.map((s) => (
						<span key={s}>
							<span className="swatch" style={{background: colourOf(view, s)}} aria-hidden="true" />
							{s}
						</span>
					))}
				</span>
				<span className="faint mono">trace {view.id}</span>
			</div>
			{/* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: a tree grid is a table whose rows open and take the keys; the WAI-ARIA tree grid example is this same table with this role, and its cells become grid cells. */}
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
							<div className="wf-track">
								{ticksOf(view.length).map((t) => (
									<span
										key={t}
										className="wf-tick"
										style={{insetInlineStart: place(t, view.length)}}
									>
										{took(t)}
									</span>
								))}
							</div>
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
								onKeyDown={(e) => onKey(e, row)}
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
				Click a row, or use <span className="kbd">↑</span> <span className="kbd">↓</span> to move,{" "}
				<span className="kbd">→</span> <span className="kbd">←</span> to open and close, and{" "}
				<span className="kbd">Enter</span> to open a row's detail. Every step opens to its Msg, the
				state before and after, and its Cmds.
			</p>
		</section>
	);
}
