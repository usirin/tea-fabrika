import {foldEvents, stubCtxThrowingProxy} from "@demlik/tea/pbt";
import type {JobTrace, Span, Writer} from "@kampus/fabrika-old";
import {LANE} from "@kampus/pipeline/stages/traced";
import type {Entry, Fact} from "@kampus/pipeline/tickets/ticket";
import {describe, expect, it} from "vitest";
import {type Model, trace} from "./machine.ts";
import {MIN, T0} from "./t117.ts";
import {shownOf} from "./view.ts";

// The ticket view finds the spans under its steps from an index of its lane's record, built once
// for that record: never once for each step row, never again on each redraw. Today's version. On
// 2026-11-03 the view called `childrenOf` for each step row on every redraw, and each call walked
// the whole record (./ticket.children.test.ts has the numbers).
//
// What the view can be seen to do: read the record's spans. The record here counts each read of
// one of its spans, so a law can say how many passes over the record a redraw makes. The index may
// be built when the record is read (in `update`, kept in the model) or on the first redraw that
// needs it (a cache keyed on the record, as Elm's Html.Lazy keys on its arguments). Either passes;
// a walk of the record per row, or per redraw, does not.

const ctx = stubCtxThrowingProxy<undefined>();
const NUMBER = 117;
const LANE_A = "d4".repeat(16);
const ROWS = 16;
const CHILDREN = 200;

const laneWriter: Writer = {kind: "agent", id: "lane", for: "owner"};
const owner: Writer = {kind: "user", id: "owner"};

const runOf = (i: number): string => `r-build-${i + 1}`;

/** A ticket of `rows` steps in one lane, one minute each, filed an hour before. */
const ticketOf = (rows: number): readonly Entry[] => {
	const facts: Fact[] = [{type: "filed", title: "A made-up ticket", body: ""}];
	const at: number[] = [T0 - 60 * MIN];
	for (let i = 0; i < rows; i++) {
		const run = runOf(i);
		facts.push(
			{type: "started", run, stage: "build", task: null, log: null, trace: LANE_A},
			{
				type: "ended",
				run,
				stage: "build",
				outcome: {kind: "done", part: false},
				usd: 0,
				input: 1_000,
				output: 100,
				turns: 1,
				cached: 0,
			},
		);
		at.push(T0 + 2 * i * MIN, T0 + (2 * i + 1) * MIN);
	}
	return facts.map((fact, i) => ({
		pos: i + 1,
		ticket: NUMBER,
		by: fact.type === "filed" ? owner : laneWriter,
		at: at[i] ?? T0,
		fact,
	}));
};

/**
 * The lane's record: a "run a step" span for each of `ROWS` runs, each with `CHILDREN` spans
 * under it, whatever the ticket's rows. Its spans count each read of one of them into `reads`.
 */
const countingRecord = (): {readonly record: JobTrace; readonly reads: {n: number}} => {
	const spans: Span[] = [];
	const idOf = (n: number) => n.toString(16).padStart(16, "0");
	let next = 1;
	for (let i = 0; i < ROWS; i++) {
		const from = T0 + 2 * i * MIN;
		const root = idOf(next++);
		const base = {service: "pipeline", status: "ok" as const, events: [], by: "agent:lane"};
		spans.push({
			...base,
			span: root,
			parent: null,
			name: "run a step",
			start: from,
			end: from + MIN,
			tags: {[LANE.run]: runOf(i)},
		});
		for (let c = 0; c < CHILDREN; c++)
			spans.push({
				...base,
				span: idOf(next++),
				parent: root,
				name: "turn",
				start: from + c,
				end: from + c + 1,
				tags: {},
			});
	}
	const reads = {n: 0};
	const counted = new Proxy(spans, {
		get: (target, key, receiver) => {
			if (typeof key === "string" && /^\d+$/.test(key)) reads.n++;
			return Reflect.get(target, key, receiver);
		},
	});
	return {
		record: {trace: LANE_A, job: null, runs: [], spans: counted, steps: [], opened: []},
		reads,
	};
};

const SPANS = ROWS * (CHILDREN + 1);

/**
 * A ticket of `rows` steps with its lane's record read, and the record's reads. The first read of
 * the facts opens the newest lane, so its step rows are drawn.
 */
const opened = (rows: number): {readonly s: Model; readonly reads: {n: number}} => {
	const {record, reads} = countingRecord();
	const s = foldEvents(trace, ctx, null, [
		{type: "ticket", number: NUMBER},
		{type: "facts", number: NUMBER, timeline: ticketOf(rows)},
		{type: "got", trace: record},
	]).finalState;
	expect(s.open).toEqual([`lane:${LANE_A}`]);
	return {s, reads};
};

/** The spans of the record read while drawing `s`, a ticket of `rows` steps, once. */
const readsDrawing = (s: Model, reads: {n: number}, rows: number): number => {
	const before = reads.n;
	const lanes = shownOf(s).ticket?.lanes ?? [];
	// Not a vacuous pass: every step row is drawn, and each finds its spans.
	const steps = lanes.flatMap((l) => l.rows.filter((r) => r.kind === "step"));
	expect(steps.map((r) => (r.kind === "step" ? [r.run, r.opens] : null))).toEqual(
		Array.from({length: rows}, (_, i) => [runOf(i), true]),
	);
	return reads.n - before;
};

describe("the ticket view's spans under its steps", () => {
	it(`reads the record no more for ${ROWS} step rows than for 1: the index is built once per record, not per row`, () => {
		const one = opened(1);
		const many = opened(ROWS);
		const oneRow = readsDrawing(one.s, one.reads, 1);
		const manyRows = readsDrawing(many.s, many.reads, ROWS);
		// Each row past the first may look up a span or two, never walk the record's 3,216.
		expect(
			manyRows,
			`${ROWS} rows read ${manyRows} spans; 1 row read ${oneRow}`,
		).toBeLessThanOrEqual(oneRow + 2 * (ROWS - 1));
	});

	it("reads none of the record again on a second redraw of the same state", () => {
		const {s, reads} = opened(ROWS);
		readsDrawing(s, reads, ROWS);
		const again = readsDrawing(s, reads, ROWS);
		expect(again, `a second redraw read ${again} of ${SPANS} spans`).toBeLessThanOrEqual(2 * ROWS);
	});
});
