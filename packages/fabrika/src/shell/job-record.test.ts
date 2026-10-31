import {Effect, Layer, Redacted} from "effect";
import {Miniflare} from "miniflare";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {newToken} from "../host/door.ts";
import {layerTracesHttp, recordsHttp} from "../host/http.ts";
import {recordInside} from "../host/inside.ts";
import {type JobTrace, jobStorage, jobWrites, Traces} from "../host/traces.ts";
import {ledgerOptions} from "../host/worker-options.ts";
import {pipe, start} from "../program/program.ts";
import {runTraceId} from "../program/trace-id.ts";
import {traceOf} from "../program/trace.ts";
import {lineSpan} from "./execute.ts";
import {seq, tally} from "./small.ts";
import {tracing} from "./trace/otel.ts";

// The JobRecord's "done when" (docs/direction/a-job-record-holds-its-trace.md): `seq --to 3 |
// tally`, run against the ledger's Miniflare twin, leaves one record that holds both runs' state,
// every span, and tally's three `add` steps. Everything reaches the record over HTTP through the
// ledger's door, as a host on the laptop reaches it: the runs' storage, the host's two job writes,
// and the spans, which the OTLP exporter posts to `/<ledger>/v1/traces`.
//
// The two runs are started here the way tsh starts a line's stages (./execute.ts): the
// last first, the first piped into it, both inside the line's span. Until part A moves jobs onto
// the host, nothing in tsh hands a job its record, so the test is that host.

const LEDGER = "demo";
const SEQ = "seq-3f9a1c02";
const TALLY = "tally-5d02c7a1";
const LINE = "seq --to 3 | tally";
const secret = newToken("fabrika_l_");
let mf: Miniflare;
let url = "";

beforeAll(async () => {
	mf = new Miniflare(
		ledgerOptions({persist: false, direct: 0, door: {kind: "local", person: "owner", secret}}),
	);
	await mf.ready;
	url = (await mf.unsafeGetDirectURL()).origin;
});
afterAll(async () => {
	await mf.dispose();
});

const http = () => ({url, ledger: LEDGER, token: secret});

/** One job, `seq --to 3 | tally`, its runs kept in its record and its spans sent there. */
const runJob = (trace: string) =>
	Effect.gen(function* () {
		const calls = yield* recordsHttp(http());
		const storage = jobStorage(calls, trace);
		const job = jobWrites(calls, trace);
		yield* job.began({n: 1, text: LINE, host: "laptop", at: Date.now()});
		const spans = tracing(
			`${url}/${LEDGER}`,
			{},
			{authorization: `Bearer ${Redacted.value(secret)}`},
		);
		yield* Effect.gen(function* () {
			const counted = yield* start(tally, {}, {}, {id: TALLY, storage});
			if (counted.kind !== "running") return yield* Effect.die("tally did not start");
			const counting = yield* pipe(
				{program: seq, flags: {to: 3}, keeping: {id: SEQ, storage}},
				"n",
				counted,
				"add",
			);
			if (counting.kind !== "running") return yield* Effect.die("seq did not start");
			yield* counting.run.ended;
			yield* counted.run.ended;
		}).pipe(
			Effect.withSpan(LINE, lineSpan(SEQ, LINE)),
			Effect.scoped,
			// The tracer's scope ends here, and its last batch goes out first.
			Effect.provide(spans),
		);
		yield* job.ended("done", Date.now());
	}).pipe(Effect.scoped);

const read = (trace: string) =>
	Effect.runPromise(
		Effect.gen(function* () {
			return yield* (yield* Traces).read(trace);
		}).pipe(Effect.provide(Layer.fresh(layerTracesHttp(http())))),
	);

describe("a job's record, on the Miniflare twin", () => {
	it("holds both runs' state, every span and three add steps after seq --to 3 | tally", async () => {
		const trace = runTraceId(SEQ);
		await Effect.runPromise(runJob(trace));
		const got: JobTrace = await read(trace);

		expect(got.trace).toBe(trace);
		expect(got.job).toMatchObject({n: 1, text: LINE, by: "user:owner", host: "laptop"});
		expect(got.job?.ended?.how).toBe("done");

		expect(got.runs.map((r) => r.run).sort()).toEqual([SEQ, TALLY]);
		expect(got.runs.find((r) => r.run === TALLY)?.machines).toEqual([
			{machine: "count", id: "total"},
		]);
		expect(got.runs.every((r) => r.status === "ended")).toBe(true);

		expect(got.steps.map((s) => [s.machine, s.id, s.n, s.msg, s.state, s.cmds])).toEqual([
			["count", "total", 1, {type: "add", n: 1}, {total: 1}, []],
			["count", "total", 2, {type: "add", n: 2}, {total: 3}, []],
			["count", "total", 3, {type: "add", n: 3}, {total: 6}, []],
		]);
		expect(got.steps.every((s) => s.run === TALLY && s.by === "user:owner")).toBe(true);

		// Every span: the line's root, each run's, and tally's machine. None hangs off a span
		// the record does not hold, but the root, whose made-up parent the view drops.
		const root = got.spans.find((s) => s.name === LINE);
		expect(root).toMatchObject({service: "tsh", parent: null, by: "user:owner"});
		// The line, each run, tally's machine: the record's own writes are not traced.
		expect(got.spans.map((s) => [s.service, s.name]).sort()).toEqual([
			["seq", "run"],
			["tally", "count"],
			["tally", "run"],
			["tsh", LINE],
		]);
		const ids = new Set(got.spans.map((s) => s.span));
		expect(got.spans.filter((s) => s.parent !== null && !ids.has(s.parent))).toEqual([]);
		const machine = got.spans.find((s) => s.name === "count");
		expect(machine?.events.filter((e) => e.name === "msg add")).toHaveLength(3);
		const seqRun = got.spans.find((s) => s.service === "seq" && s.tags["tea.run.id"] === SEQ);
		expect(seqRun?.events.filter((e) => e.name === "sent n")).toHaveLength(3);
	}, 30_000);

	it("nests a child run under its parent's span, which only the record names while it is open", async () => {
		// As a host serves a hosted name: the lane's span opens and is kept at once; its stage,
		// started from another host before the lane ends, asks the record where to nest.
		const trace = runTraceId("lane:700");
		const spans = tracing(
			`${url}/${LEDGER}`,
			{},
			{authorization: `Bearer ${Redacted.value(secret)}`},
		);
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const job = jobWrites(yield* recordsHttp(http()), trace);
				return yield* Effect.gen(function* () {
					const lane = yield* Effect.makeSpanScoped("lane:700", {parent: traceOf("lane:700")});
					yield* job.opened("lane:700", lane.spanId, Date.now());
					const up = yield* job.spanOf("lane:700");
					yield* Effect.void.pipe(
						Effect.withSpan("lane:700:build"),
						Effect.withParentSpan(up ?? traceOf("lane:700")),
					);
					return {lane: lane.spanId, none: yield* job.spanOf("lane:701")};
				}).pipe(Effect.scoped, Effect.provide(spans));
			}).pipe(Effect.scoped),
		);
		expect(seen.none).toBeNull();
		const got = await read(trace);
		expect(got.opened).toMatchObject([{run: "lane:700", span: seen.lane, by: "user:owner"}]);
		const build = got.spans.find((s) => s.name === "lane:700:build");
		const lane = got.spans.find((s) => s.name === "lane:700");
		expect(lane?.span).toBe(seen.lane);
		expect(build?.parent).toBe(seen.lane);
	}, 30_000);

	it("keeps a span sent twice once, and refuses one that is not OTLP", async () => {
		const trace = "0123456789abcdef0123456789abcdef";
		const body = {
			resourceSpans: [
				{
					resource: {attributes: [{key: "service.name", value: {stringValue: "probe"}}]},
					scopeSpans: [
						{
							spans: [
								{
									traceId: trace,
									spanId: "0123456789abcdef",
									name: "probe",
									startTimeUnixNano: "1730000000000000000",
									endTimeUnixNano: "1730000000001500000",
								},
							],
						},
					],
				},
			],
		};
		const post = (b: unknown, type = "application/json") =>
			fetch(`${url}/${LEDGER}/v1/traces`, {
				method: "POST",
				headers: {authorization: `Bearer ${Redacted.value(secret)}`, "content-type": type},
				body: JSON.stringify(b),
			});
		expect((await post(body)).status).toBe(200);
		expect((await post(body)).status).toBe(200);
		expect((await post({resourceSpans: "no"})).status).toBe(400);
		expect((await post(body, "application/x-protobuf")).status).toBe(415);
		const noDoor = await fetch(`${url}/${LEDGER}/v1/traces`, {
			method: "POST",
			headers: {"content-type": "application/json"},
			body: JSON.stringify(body),
		});
		expect(noDoor.status).toBe(401);
		const got = await read(trace);
		expect(got.spans).toEqual([
			{
				span: "0123456789abcdef",
				parent: null,
				name: "probe",
				service: "probe",
				start: 1730000000000,
				end: 1730000000001.5,
				status: "unset",
				tags: {},
				events: [],
				by: "user:owner",
			},
		]);
		// Each ledger's records are its own: the same trace under another ledger is empty.
		const other = (await recordInside(mf, "other", trace).dump()) as {spans: unknown[]};
		expect(other.spans).toEqual([]);
	});
});
