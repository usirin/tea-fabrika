import type {WindowProps} from "@kampus/fabrika";
import {nameOf} from "@kampus/pipeline/stages/outcome";
import {endedAs} from "@kampus/pipeline/stages/status";
import {stepWords} from "@tea-fabrika/tracker";
import {type KeyboardEvent, type PointerEvent, useRef, useState} from "react";
import type {runs} from "./index.ts";
import {
	type Clip,
	placeOf,
	stopsOf,
	type Trace,
	type Track,
	ticksOf,
	traceOf,
	type Who,
} from "./trace.ts";

// The runs' window: an arrangement, as a music editor shows a song. Track heads on the left,
// each with what the step cost as a small meter; time runs right. A clip is a run, its agent turns
// drawn as small bars; a stripe is a wait on you; a flag on the ruler is your answer. The
// playhead is live at now; drag it back, or move it with the arrow keys from fact to fact, and
// the clips and stripes show the facts up to it, as Elm's debugger replays a program's messages.
// A small component of its own, not a timeline library: see this package's README for why.

const hhmm = (at: number): string =>
	new Date(at).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit", hour12: false});

const usd = (n: number) => `$${n.toFixed(2)}`;

const WHO: {readonly [W in Who]: string} = {
	agent: "agent",
	code: "code",
	person: "a person",
	none: "not run yet",
	ticket: "all steps",
};

function Meter({value, of}: {readonly value: number; readonly of: number}) {
	return (
		<span className="cpu" title={usd(value)}>
			<span>{usd(value)}</span>
			<span className="bar3" aria-hidden="true">
				<i style={{inlineSize: `${of <= 0 ? 0 : Math.min(100, (value / of) * 100)}%`}} />
			</span>
		</span>
	);
}

function Head({track, trace, most}: {track: Track; trace: Trace; most: number}) {
	const name = track.name === "ticket" ? `ticket` : stepWords(track.name);
	return (
		<div className={`trk-h${track.who === "none" ? " nb" : ""}`}>
			<span className="n">
				{name}
				<small>{WHO[track.who]}</small>
			</span>
			{track.who === "person" ? (
				<span />
			) : (
				<Meter value={track.usd} of={track.name === "ticket" ? trace.usd : most} />
			)}
		</div>
	);
}

const labelOf = (clip: Clip): string => {
	if (clip.open) return "running";
	if (clip.ended === null) return "";
	if (clip.ended.outcome.kind === "done") {
		const n = clip.ended.turns;
		return n === 0 ? "code" : `${n} ${n === 1 ? "turn" : "turns"}`;
	}
	return nameOf(clip.ended.outcome);
};

function ClipBox(props: {
	readonly clip: Clip;
	readonly trace: Trace;
	readonly step: string;
	readonly chosen: boolean;
	readonly choose: (run: string) => void;
}) {
	const {clip, trace, step, chosen, choose} = props;
	const left = placeOf(trace, clip.from);
	const width = placeOf(trace, clip.to) - left;
	const turns = clip.ended?.turns ?? 0;
	const cls = [
		"clip",
		clip.open ? "run" : "",
		clip.ended !== null && clip.ended.outcome.kind !== "done" ? "send" : "",
		clip.ended?.outcome.kind === "stuck" ? "stuck" : "",
		chosen ? "sel" : "",
	]
		.filter((c) => c !== "")
		.join(" ");
	const said = `${stepWords(step)}, ${clip.run}, ${hhmm(clip.from)} to ${clip.open ? "the playhead" : hhmm(clip.to)}${
		clip.ended === null ? ", running" : `, ${nameOf(clip.ended.outcome)}, ${usd(clip.ended.usd)}`
	}`;
	return (
		<button
			type="button"
			className={cls}
			style={{insetInlineStart: `${left}%`, inlineSize: `max(4px, ${width}%)`}}
			aria-label={said}
			aria-pressed={chosen}
			onClick={() => choose(clip.run)}
		>
			{turns > 0 ? (
				<span className="turns" aria-hidden="true">
					{Array.from({length: Math.min(turns, 14)}, (_, i) => (
						<i key={String(i)} />
					))}
				</span>
			) : null}
			<span>{labelOf(clip)}</span>
		</button>
	);
}

function Row(props: {
	readonly track: Track;
	readonly trace: Trace;
	readonly chosen: string | null;
	readonly choose: (run: string) => void;
}) {
	const {track, trace, chosen, choose} = props;
	if (track.name === "ticket")
		return (
			<div className="trk">
				{track.clips.map((c) => (
					<span
						key={c.run}
						className="clip root"
						style={{
							insetInlineStart: `${placeOf(trace, c.from)}%`,
							inlineSize: `${placeOf(trace, c.to) - placeOf(trace, c.from)}%`,
						}}
						aria-hidden="true"
					>
						<span>one ticket, all its runs</span>
					</span>
				))}
			</div>
		);
	return (
		<div className={`trk${track.who === "none" ? " nb" : ""}`}>
			{track.waits.map((w) => (
				<span
					key={w.ask}
					className={`wait${w.pick === null ? "" : " done"}`}
					style={{
						insetInlineStart: `${placeOf(trace, w.from)}%`,
						inlineSize: `max(3px, ${placeOf(trace, w.to) - placeOf(trace, w.from)}%)`,
					}}
					title={`waits on you: ${w.what}`}
				/>
			))}
			{track.clips.map((c) => (
				<ClipBox
					key={c.run}
					clip={c}
					trace={trace}
					step={track.name}
					chosen={chosen === c.run}
					choose={choose}
				/>
			))}
		</div>
	);
}

function Chosen({trace, run}: {readonly trace: Trace; readonly run: string}) {
	const track = trace.tracks.find((t) => t.clips.some((c) => c.run === run));
	const clip = track?.clips.find((c) => c.run === run);
	if (track === undefined || clip === undefined) return null;
	const e = clip.ended;
	return (
		<dl className="span-d kv">
			<dt>run</dt>
			<dd>
				<span className="mono">{clip.run}</span>
			</dd>
			<dt>step</dt>
			<dd>
				{stepWords(track.name)}
				{clip.task === null ? null : (
					<>
						, task <span className="mono">{clip.task}</span>
					</>
				)}
			</dd>
			<dt>time</dt>
			<dd>
				{hhmm(clip.from)} to {clip.open ? "the playhead" : hhmm(clip.to)}
			</dd>
			{e === null ? null : (
				<>
					<dt>ended</dt>
					<dd>
						{endedAs(e.outcome, "done")} <span className="mono">{nameOf(e.outcome)}</span>
					</dd>
					<dt>cost</dt>
					<dd>
						<span className="mono">{usd(e.usd)}</span> · {e.turns}{" "}
						{e.turns === 1 ? "turn" : "turns"} ·{" "}
						<span className="mono">{e.input.toLocaleString("en")}</span>{" "}
						<span className="faint">in</span>{" "}
						<span className="mono">{e.output.toLocaleString("en")}</span>{" "}
						<span className="faint">out</span>
					</dd>
				</>
			)}
		</dl>
	);
}

/** The window, drawn afresh for each ticket it lays out: a playhead moved on #7 starts live on #3. */
export function RunsWindow(props: WindowProps<typeof runs>) {
	return <Tracks key={props.view.number ?? 0} {...props} />;
}

function Tracks({view, send}: WindowProps<typeof runs>) {
	// The playhead: `null` is live, at now; a time is a replay up to it.
	const [at, setAt] = useState<number | null>(null);
	const [chosen, setChosen] = useState<string | null>(null);
	const lane = useRef<HTMLDivElement>(null);
	const timeline = view.ticket?.timeline ?? [];
	const now = view.now === 0 ? (timeline.at(-1)?.at ?? 0) : view.now;
	const shown: Trace = traceOf(timeline, now, at ?? now);
	const live = at === null || at >= shown.to;
	const most = Math.max(0.01, ...shown.tracks.filter((t) => t.name !== "ticket").map((t) => t.usd));
	const stops = stopsOf(timeline);

	const moveTo = (t: number | null) => setAt(t === null || t >= shown.to ? null : t);
	const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
		const box = lane.current?.getBoundingClientRect();
		if (box === undefined || box.width === 0) return;
		const f = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
		moveTo(shown.from + f * (shown.to - shown.from));
	};
	const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
		const head = shown.upTo;
		if (e.key === "ArrowLeft") moveTo(stops.findLast((s) => s < head) ?? shown.from);
		else if (e.key === "ArrowRight") moveTo(stops.find((s) => s > head) ?? null);
		else if (e.key === "Home") moveTo(shown.from);
		else if (e.key === "End") moveTo(null);
		else return;
		e.preventDefault();
	};

	const n = view.number === null ? "" : `${view.number}`;
	if (view.ticket === null)
		return (
			<section className="view runs-view" aria-label="runs">
				<p className="empty">
					{view.unreachable !== null
						? `The ledger cannot be read: ${view.unreachable}`
						: !view.ready
							? "Reading the ledger."
							: view.number === null
								? "No ticket yet: pick one in the tracker, or start it with --ticket."
								: `No ticket #${n}.`}
				</p>
			</section>
		);

	const head = placeOf(shown, shown.upTo);
	return (
		<section className="view runs-view" aria-label={`runs of ${n}`}>
			<div className="mapbar">
				<span className="state" role="status">
					{live ? (
						<>
							<span className="dot" aria-hidden="true" />
							<span>Live. The playhead follows now.</span>
						</>
					) : (
						<span>
							Replaying at <span className="mono prim">{hhmm(shown.upTo)}</span>: #{n} as it was
							then.
						</span>
					)}
				</span>
				<span className="faint">
					#{n} · {shown.spans} {shown.spans === 1 ? "run" : "runs"} · {usd(shown.usd)}
				</span>
				<span className="legend">
					<span>
						<span className="wait swatch" aria-hidden="true" />
						waits on you
					</span>
					<span>
						<span className="turn-bar" aria-hidden="true" />
						one agent turn
					</span>
				</span>
				{live ? null : (
					<button type="button" className="btn sm" onClick={() => moveTo(null)}>
						Back to now
					</button>
				)}
			</div>
			<div className="arr-body">
				<div className="arr-heads">
					<div />
					{shown.tracks.map((t) => (
						<Head key={t.name} track={t} trace={shown} most={most} />
					))}
				</div>
				<div
					className="arr-time"
					ref={lane}
					onPointerDown={(e) => {
						if ((e.target as HTMLElement).closest(".clip") !== null) return;
						e.currentTarget.setPointerCapture(e.pointerId);
						fromPointer(e);
					}}
					onPointerMove={(e) => {
						if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e);
					}}
				>
					<div className="ruler">
						{ticksOf(shown).map((t) => (
							<span
								key={t}
								className={`tk${placeOf(shown, t) > 96 ? " end" : ""}`}
								style={{insetInlineStart: `${placeOf(shown, t)}%`}}
							>
								{hhmm(t)}
							</span>
						))}
						{shown.markers.map((m) => (
							<span
								key={`${m.at}-${m.says}`}
								className={`mk${m.kind === "answer" && m.says === "approve" ? "" : " no"}`}
								style={{insetInlineStart: `${placeOf(shown, m.at)}%`}}
							>
								{m.kind === "answer" && m.says === "approve" ? "✓ approve" : m.says}
							</span>
						))}
					</div>
					<div className="grid" aria-hidden="true">
						{ticksOf(shown).map((t) => (
							<i key={t} className="gl" style={{insetInlineStart: `${placeOf(shown, t)}%`}} />
						))}
					</div>
					{shown.tracks.map((t) => (
						<Row
							key={t.name}
							track={t}
							trace={shown}
							chosen={chosen}
							choose={(run) => {
								// Picked, not let go: the run's trace id goes out on `id`, for `trace` to open.
								if (chosen !== run) send({type: "choose", value: {run}});
								setChosen(chosen === run ? null : run);
							}}
						/>
					))}
					{live ? null : <div className="after" style={{insetInlineStart: `${head}%`}} />}
					<div className={`ph${live ? " live" : ""}`} style={{insetInlineStart: `${head}%`}}>
						<button
							type="button"
							className="ph-h"
							role="slider"
							aria-label="Playhead"
							aria-valuemin={shown.from}
							aria-valuemax={shown.to}
							aria-valuenow={shown.upTo}
							aria-valuetext={live ? `now, ${hhmm(shown.upTo)}` : hhmm(shown.upTo)}
							onKeyDown={onKey}
						/>
					</div>
				</div>
			</div>
			<div className="arr-foot">
				{chosen === null ? null : <Chosen trace={shown} run={chosen} />}
				<p className="note">
					Drag the playhead, or focus it and use <span className="kbd">←</span>{" "}
					<span className="kbd">→</span> to step from fact to fact. <span className="kbd">End</span>{" "}
					goes back to now. Like Elm's debugger, the runs are replayed from the facts up to that
					time.
				</p>
			</div>
		</section>
	);
}
