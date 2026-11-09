// Today's host, T204 PR 1. Contract for LayerRecorder.make({window, by}), record(report), ended().
// The real in-memory ledger supplies deduplication and authoritative `at`. Only lost writes and
// lost acknowledgments are injected. No network, key, live home or paid agent is involved.
import {Ledger, LedgerUnreachable, type Row} from "@kampus/fabrika-old";
import {layerMemory} from "@kampus/fabrika-old/memory";
import {Effect, Logger, Tracer} from "effect";
import {TestClock} from "effect/testing";
import * as fc from "fast-check";
import {assert, describe, expect, it} from "vitest";
import {readFromPage} from "../messages.ts";
import * as frameModule from "../window/frame.ts";
import {FRAME, type Frame, type FrameMsg} from "../window/frame.ts";
const settings = {seed: 119120, numRuns: 60};
const sources = fc.constantFrom(
	{_tag: "click"} as const,
	{_tag: "pointer"} as const,
	{_tag: "focus"} as const,
	{_tag: "word"} as const,
	{_tag: "palette"} as const,
	{_tag: "key", keys: "ctrl+b a"} as const,
	null,
);
const layers = fc.oneof(
	fc.constant({_tag: "palette"} as const),
	fc
		.constantFrom("asks", "jobs", "host", "sync", "agents")
		.map((item) => ({_tag: "popover" as const, item})),
	fc.constantFrom("asks", "jobs", "info").map((name) => ({_tag: "tooltip" as const, for: name})),
);
const input = fc.record({
	id: fc.uuid(),
	instance: fc.uuid(),
	via: sources,
	layer: layers,
	said: fc.option(fc.integer({min: 0, max: 1_000_000}), {nil: null}),
	hostTime: fc.integer({min: 2_000_000, max: 3_000_000}),
	copies: fc.integer({min: 2, max: 5}),
	failure: fc.constantFrom("none" as const, "before" as const, "after" as const),
});
type Generated<A> = A extends fc.Arbitrary<infer Value> ? Value : never;
// The transition API accepts any item name or key string; the generators sample only some.
type Layer = {_tag: "palette"} | {_tag: "popover"; item: string} | {_tag: "tooltip"; for: string};
type Source =
	| {_tag: "click" | "pointer" | "focus" | "word" | "palette"}
	| {_tag: "key"; keys: string}
	| null;
type Change =
	| {_tag: "open"; layer: Layer; via: Source}
	| {_tag: "close"; layer: Layer; reason: string};
type FrameStep = (frame: Frame, msg: FrameMsg) => readonly [Frame, readonly Change[]];
// The recorder law still requires the real PR 1 transition function once it exists.
const frameApi: typeof frameModule & {readonly stepFrame?: FrameStep} = frameModule;
const stepFrame: FrameStep = (frame, msg) => {
	const run = frameApi.stepFrame;
	assert(run !== undefined, "PR 1 must add the real stepFrame transition function");
	return run(frame, msg);
};
interface Report {
	readonly type: "layer";
	readonly id: string;
	readonly instance: string;
	readonly said: number | null;
	readonly change: Change;
}
interface RecorderModule {
	readonly LayerRecorder: {
		readonly make: (from: {window: string; by: string}) => Effect.Effect<
			{
				readonly record: (report: Report) => Effect.Effect<void, unknown>;
				readonly ended: () => Effect.Effect<void, unknown>;
			},
			unknown,
			Ledger
		>;
	};
}
// Load per law so the output-leak plants also run before the builder adds the recorder module.
const recorderModule = (): Promise<RecorderModule> =>
	import(/* @vite-ignore */ new URL("./layers.ts", import.meta.url).href);
const reportOf = (data: Generated<typeof input>) => ({
	type: "layer" as const,
	id: data.id,
	instance: data.instance,
	said: data.said,
	change: {_tag: "open" as const, layer: data.layer, via: data.via},
});
const decode = (row: Row): Record<string, unknown> => JSON.parse(row.data);
const clean = (outputs: Readonly<Record<string, unknown>>, secrets: readonly string[]) => {
	for (const [name, value] of Object.entries(outputs)) {
		const printed = JSON.stringify(value);
		for (const secret of secrets) {
			for (const encoded of [
				secret,
				encodeURIComponent(secret),
				new URLSearchParams({q: secret}).toString().slice(2),
			]) {
				expect(printed, name).not.toContain(encoded);
			}
		}
	}
};

describe("today's LayerRecorder", () => {
	it("preserves source and supplied clocks, binds identity at the host, and retries without duplicate rows", async () => {
		const {LayerRecorder} = await recorderModule();
		await fc.assert(
			fc.asyncProperty(input, async (data) => {
				await Effect.runPromise(
					Effect.gen(function* () {
						yield* TestClock.setTime(data.hostTime);
						const ledger = yield* Ledger;
						let pending = data.failure;
						const attempted: string[] = [];
						const fault = () =>
							new LedgerUnreachable({method: "send", message: "Made-up lost write acknowledgment"});
						const tapped = Ledger.of({
							...ledger,
							send: (inbox, id, event, fence) =>
								Effect.gen(function* () {
									attempted.push(id);
									const failure = pending;
									pending = "none";
									if (failure === "before") return yield* fault();
									const result = yield* ledger.send(inbox, id, event, fence);
									if (failure === "after") return yield* fault();
									return result;
								}),
						});
						const recorder = yield* LayerRecorder.make({window: "window-1", by: "user:test"}).pipe(
							Effect.provideService(Ledger, tapped),
						);
						const report = reportOf(data);
						for (let i = 0; i < data.copies; i++)
							yield* recorder.record(report).pipe(Effect.ignore);
						// An acknowledged event replayed into a fresh service still lands only once.
						const restarted = yield* LayerRecorder.make({window: "window-1", by: "user:test"});
						yield* restarted.record(report);
						const rows = (yield* ledger.read(0, 100)).filter((row) => row.id === data.id);
						expect(rows).toHaveLength(1);
						expect(new Set(attempted)).toEqual(new Set([data.id]));
						const row = rows[0]!;
						expect(row.writer).toBe("user:test");
						expect(row.at).toBe(data.hostTime);
						expect(decode(row)).toMatchObject({
							window: "window-1",
							instance: data.instance,
							said: data.said,
							change: report.change,
						});
					}).pipe(
						// Keep the full generated clock range without replaying idle 25 ms alarms.
						Effect.provide(layerMemory({tickMs: data.hostTime + 1})),
						Effect.provide(TestClock.layer()),
						Effect.scoped,
					),
				);
			}),
			settings,
		);
	});
	it("[secrets] typed content stays out of outgoing messages, ledger data, recorder logs and spans through generated failures", async () => {
		const {LayerRecorder} = await recorderModule();
		await fc.assert(
			fc.asyncProperty(
				input,
				fc.record({
					query: fc.uuid(),
					note: fc.uuid(),
					terminal: fc.uuid(),
					order: fc.array(
						fc.constantFrom("open" as const, "query" as const, "note" as const, "escape" as const),
						{minLength: 1, maxLength: 20},
					),
				}),
				async (data, words) => {
					const secrets = [
						`made-up query ${words.query}/?`,
						`made-up note ${words.note}/?`,
						`made-up terminal ${words.terminal}/?`,
					];
					const logs: unknown[] = [];
					const spans: Tracer.Span[] = [];
					const outgoing: unknown[] = [];
					const sent: unknown[] = [];
					const rows = await Effect.runPromise(
						Effect.gen(function* () {
							const ledger = yield* Ledger;
							const underlying = yield* Effect.tracer;
							let pending = data.failure;
							const tapped = Ledger.of({
								...ledger,
								send: (inbox, id, event, fence) =>
									Effect.gen(function* () {
										sent.push(event);
										const failure = pending;
										pending = "none";
										// A transport error can itself contain private data. Diagnostics must not print it.
										if (failure === "before")
											return yield* new LedgerUnreachable({method: "send", message: secrets[0]!});
										const row = yield* ledger.send(inbox, id, event, fence);
										if (failure === "after")
											return yield* new LedgerUnreachable({method: "send", message: secrets[1]!});
										return row;
									}),
							});
							const tracer = Tracer.make({
								span: (options) => {
									const span = underlying.span(options);
									spans.push(span);
									return span;
								},
							});
							return yield* Effect.gen(function* () {
								const recorder = yield* LayerRecorder.make({
									window: "window-private",
									by: "user:test",
								});
								let frame = FRAME;
								let n = 0;
								for (const action of [...words.order, "open", "query", "note", "escape"] as const) {
									const msg =
										action === "open"
											? {type: "palette" as const}
											: action === "query"
												? {type: "query" as const, query: secrets[0]!}
												: action === "note"
													? {type: "say" as const, note: secrets[1]!}
													: {type: "escape" as const, desk: {armed: false, asking: false}};
									// A made-up terminal line lives below the frame; never pass it to the recorder.
									const privateState = {frame, terminal: secrets[2]!};
									const [next, changes]: readonly [Frame, readonly Change[]] = stepFrame(
										privateState.frame,
										msg,
									);
									for (const change of changes) {
										const report = {...reportOf(data), id: `${data.id}-${n++}`, change};
										expect(readFromPage(report).kind).toBe("read");
										outgoing.push(report);
										for (let copy = 0; copy < data.copies; copy++)
											yield* recorder.record(report).pipe(Effect.ignore);
									}
									frame = next;
								}
								return yield* ledger.read(0, 100);
							}).pipe(
								Effect.provideService(Ledger, tapped),
								Effect.withTracer(tracer),
								Effect.provide(
									Logger.layer([
										Logger.make((event) => {
											logs.push(Logger.formatSimple.log(event));
										}),
									]),
								),
							);
						}).pipe(Effect.provide(layerMemory()), Effect.scoped),
					);
					const outputs = {
						outgoing,
						ledger: {rows, sent},
						logs,
						spans: spans.map((span) => ({
							name: span.name,
							attributes: [...span.attributes],
							status: span.status,
							links: span.links,
						})),
					};
					expect(outgoing.length).toBeGreaterThan(0);
					expect(rows.length).toBeGreaterThan(0);
					expect(data.failure === "none" || logs.length > 0).toBe(true);
					clean(outputs, secrets);
					// Each named output gets its own leak plant. None is hidden behind another failure.
					for (const name of ["outgoing", "ledger", "logs", "spans"] as const) {
						for (const secret of secrets)
							expect(() => clean({...outputs, [name]: {leaked: secret}}, secrets)).toThrow();
					}
				},
			),
			{...settings, numRuns: 30},
		);
	});
	it("a disconnected window records uncertainty, never an invented Escape", async () => {
		const {LayerRecorder} = await recorderModule();
		await fc.assert(
			fc.asyncProperty(input, async (data) => {
				await Effect.runPromise(
					Effect.gen(function* () {
						const ledger = yield* Ledger;
						const recorder = yield* LayerRecorder.make({window: "window-ended", by: "user:test"});
						yield* recorder.record(reportOf(data));
						yield* recorder.ended();
						const facts = (yield* ledger.read(0, 100)).map(decode);
						expect(JSON.stringify(facts)).toContain("uncertain");
						expect(JSON.stringify(facts)).not.toContain('"reason":"escape"');
					}).pipe(Effect.provide(layerMemory()), Effect.scoped),
				);
			}),
			settings,
		);
	});
	it("an acknowledged event is sent once, rows are kind layer, and a bad report writes nothing and warns", async () => {
		const {LayerRecorder} = await recorderModule();
		await fc.assert(
			fc.asyncProperty(input, async (data) => {
				const logs: string[] = [];
				await Effect.runPromise(
					Effect.gen(function* () {
						const ledger = yield* Ledger;
						const sends: string[] = [];
						const tapped = Ledger.of({
							...ledger,
							send: (inbox, id, event, fence) =>
								Effect.suspend(() => {
									sends.push(id);
									return ledger.send(inbox, id, event, fence);
								}),
						});
						const recorder = yield* LayerRecorder.make({
							window: "window-once",
							by: "user:test",
						}).pipe(Effect.provideService(Ledger, tapped));
						// An extra property from the page is refused before any write, with a warning.
						const bad = yield* recorder
							.record({...reportOf(data), extra: "x"} as never)
							.pipe(Effect.flip);
						expect(bad).toBeDefined();
						expect(sends).toEqual([]);
						expect(logs.length).toBe(1);
						expect(logs[0]).not.toBe("");
						expect(logs[0]).toMatch(/\S/);
						const report = reportOf(data);
						for (let i = 0; i < data.copies; i++) yield* recorder.record(report);
						expect(sends).toEqual([data.id]);
						// Open then close drops the interval: a later end sends nothing uncertain.
						const close = {
							...report,
							id: `${data.id}-close`,
							change: {_tag: "close" as const, layer: data.layer, reason: "escape"},
						};
						yield* recorder.record(close);
						yield* recorder.ended();
						expect(sends).toEqual([data.id, `${data.id}-close`]);
						// An interval still open at the end is closed once, under its own id.
						const other = {...report, id: `${data.id}-other`, instance: `${data.instance}-2`};
						yield* recorder.record(other);
						yield* recorder.ended();
						yield* recorder.ended();
						const key = `uncertain/window-once/${data.instance}-2`;
						expect(sends.filter((id) => id.startsWith("uncertain/"))).toEqual([key]);
						const rows = (yield* ledger.read(0, 100)).filter((row) =>
							[data.id, `${data.id}-close`, `${data.id}-other`, key].includes(row.id ?? ""),
						);
						expect(rows).toHaveLength(4);
						for (const row of rows) expect(row.kind).toBe("layer");
					}).pipe(
						Effect.provide(layerMemory()),
						Effect.provide(
							Logger.layer([
								Logger.make((event) => {
									logs.push([event.message].flat().join(" "));
								}),
							]),
						),
						Effect.scoped,
					),
				);
			}),
			{...settings, numRuns: 20},
		);
	});
	it("the privacy law rejects a separately planted leak in every named output and encoding", () => {
		fc.assert(
			fc.property(fc.uuid(), (id) => {
				const secret = `made-up typed words ${id}/?&`;
				const empty = {outgoing: [], ledger: [], logs: [], spans: []};
				clean(empty, [secret]);
				for (const name of Object.keys(empty)) {
					for (const leaked of [
						secret,
						encodeURIComponent(secret),
						new URLSearchParams({q: secret}).toString().slice(2),
					]) {
						expect(() => clean({...empty, [name]: [{leaked}]}, [secret])).toThrow();
					}
				}
			}),
			settings,
		);
	});
});
