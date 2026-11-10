// T285, PR 1, next/. These are keep-laws for the tracing rewrite.
// Every behavior law uses generated calls, attributes or failure points.
import {DatabaseSync} from "node:sqlite";
import {Outcome} from "@demlik/tea";
import {Cmd, Machine} from "@demlik/tea/effect";
import {Cause, Clock, Effect, Exit, Layer, Option, Schema, Stream, Tracer} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {ClientManager} from "../coordination/client-manager.ts";
import {Mailbox} from "../coordination/mailbox.ts";
import {ProcessIdGenerator} from "../coordination/process-id.ts";
import {ProcessManager} from "../coordination/process-manager.ts";
import {ProcessStore} from "../coordination/process-store.ts";
import {Owner, Recipient} from "../coordination/process.ts";
import {SessionManager, Writer} from "../coordination/session-manager.ts";
import {Archive} from "../data/archive.ts";
import {LedgerTransaction} from "../data/ledger-transaction.ts";
import {Doorbell, Ledger, LedgerError} from "../data/ledger.ts";
import {Appended, fromHere, type Line, lineFor} from "../data/log.ts";
import {RecordManager} from "../data/records.ts";
import {type Sql} from "../data/referee.ts";
import {SpanSink} from "../data/sink.ts";
import {nodeSql} from "../data/sqlite.ts";
import {Chain} from "../data/trace.ts";
import {Alarm, CheckedWriter, Incoming, ProgramLoader, Recording, WatcherManager} from "./entry.ts";
import {ProgramRunner} from "./runner.ts";

const CHECK = {seed: 119120, numRuns: 40};

const text = fc.string({
	unit: fc.constantFrom("a", "b", "7", ":", "_"),
	minLength: 1,
	maxLength: 180,
});

const hex = (length: number) =>
	fc
		.string({
			unit: fc.constantFrom(..."0123456789abcdef"),
			minLength: length - 1,
			maxLength: length - 1,
		})
		.map((rest) => `1${rest}`);

const context = fc.record({traceId: hex(32), spanId: hex(16)});

const attributes = fc.record({
	stream: text,
	id: text,
	by: text,
	reader: text,
	build: text,
	value: fc.integer(),
});

const PROCESS = "process_01jc9q4w7zfm8s5r2t6v0xkb4d";
const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const DAY = 86_400_000;
const BIG = 1_000_000_000;
const quiet = Layer.succeed(Doorbell, {ring: () => Effect.void});

const request = Effect.fn("test.request")(function* <A, E, R>(body: Effect.Effect<A, E, R>) {
	return yield* body;
});

const capture = (delegate?: Tracer.Tracer, spans: Array<Tracer.Span> = []) => {
	const tracer = Tracer.make({
		span(options) {
			const span = delegate?.span(options) ?? new Tracer.NativeSpan(options);
			spans.push(span);
			return span;
		},
	});
	return {spans, tracer};
};

const tags = (span: Tracer.Span) => Object.fromEntries(span.attributes);
const parentId = (span: Tracer.Span) => Option.getOrNull(Option.map(span.parent, (p) => p.spanId));

const ended = (span: Tracer.Span, ok: boolean) => {
	expect(span.status._tag, span.name).toBe("Ended");
	const status = span.status;

	if (status._tag !== "Ended") {
		throw new Error(`span did not end: ${span.name}`);
	}

	expect(Exit.isSuccess(status.exit), span.name).toBe(ok);
	expect(status.endTime >= status.startTime, span.name).toBe(true);
};

const child = (span: Tracer.Span, parent: Tracer.AnySpan) => {
	expect(span.traceId, span.name).toBe(parent.traceId);
	expect(parentId(span), span.name).toBe(parent.spanId);
};

const cut = (key: string, value: string) =>
	value.length <= 128
		? {[key]: value}
		: {[key]: value.slice(0, 128), [`${key}.length`]: value.length};

const clock = (now: () => number): Clock.Clock => ({
	currentTimeMillisUnsafe: now,
	currentTimeMillis: Effect.sync(now),
	currentTimeNanosUnsafe: () => BigInt(now()) * 1_000_000n,
	currentTimeNanos: Effect.sync(() => BigInt(now()) * 1_000_000n),
	monotonicTimeNanosUnsafe: () => BigInt(now()) * 1_000_000n,
	monotonicTimeNanos: Effect.sync(() => BigInt(now()) * 1_000_000n),
	sleep: () => Effect.void,
});

const disk = () => {
	const db = new DatabaseSync(":memory:");
	const actual = nodeSql(db);
	const fault = {armed: false};
	const sql: Sql = {
		...actual,
		transaction: (work) => {
			if (fault.armed) {
				fault.armed = false;
				throw new Error("generated storage failure");
			}

			return actual.transaction(work);
		},
	};
	return {db, sql, fault};
};

const line = (
	a: typeof attributes extends fc.Arbitrary<infer A> ? A : never,
	traceId: string,
): Line => ({
	by: a.by,
	for: PERSON,
	sentAt: "2026-11-08T00:00:00.000Z",
	seen: 0,
	parent: null,
	traceId,
	build: a.build,
	_tag: "saved",
	body: {value: a.value},
});

describe("T285, ledger tracing keep-laws", () => {
	it("generated calls keep one span, parent, attributes and refusal spans through Ledger.sql", async () => {
		const operation = fc.record({
			op: fc.constantFrom(
				"append",
				"read",
				"wait",
				"bad_line",
				"bad_parent",
				"bad_trace",
				"seen_ahead",
				"id_reused",
				"resend",
			),
			after: fc.nat(8),
		});
		await fc.assert(
			fc.asyncProperty(
				attributes,
				context,
				fc.array(operation, {minLength: 1, maxLength: 16}),
				async (a, ctx, calls) => {
					const d = disk();
					const c = capture();

					try {
						await Effect.runPromise(
							Effect.gen(function* () {
								const ledger = yield* Ledger;
								let head = 0;

								for (const [index, call] of calls.entries()) {
									const before = c.spans.length;
									const parent = yield* Effect.currentSpan;
									const id = `${a.id}/${index}`;
									const input = line(a, ctx.traceId);
									let name: string;
									let expected: Record<string, unknown>;

									if (call.op === "read") {
										const rows = yield* Stream.runCollect(ledger.read(a.stream, call.after));
										name = "ledger.read";
										expected = {
											...cut("messaging.destination.name", a.stream),
											...cut("fab.ledger.reader", a.reader),
											"messaging.operation.type": "receive",
											"fab.ledger.after": call.after,
											"fab.ledger.head": head,
											"fab.ledger.lag": Math.max(0, head - call.after),
											"fab.ledger.rows": rows.length,
											...(rows.length === 0 ? {} : {"fab.ledger.visible_ms": 0}),
										};
									} else if (call.op === "wait") {
										const answer = yield* ledger.wait(a.stream, call.after);
										name = "ledger.wait";
										expected = {
											...cut("messaging.destination.name", a.stream),
											...cut("fab.ledger.reader", a.reader),
											"fab.ledger.after": call.after,
											"fab.ledger.head": head,
											"fab.ledger.lag": Math.max(0, head - call.after),
											"fab.ledger.answer": answer._tag,
										};
									} else {
										const twice = call.op === "id_reused" || call.op === "resend";

										if (twice) {
											yield* ledger.append(a.stream, id, input);
											head++;
										}

										const changed =
											call.op === "bad_line"
												? {...input, by: ""}
												: call.op === "bad_parent"
													? {...input, parent: "bad"}
													: call.op === "bad_trace"
														? {...input, traceId: "bad"}
														: call.op === "seen_ahead"
															? {...input, seen: head + 1}
															: call.op === "id_reused"
																? {...input, body: {changed: a.value}}
																: input;
										const answer = yield* ledger.append(a.stream, id, changed);
										const accepted = call.op === "append";

										if (accepted) {
											head++;
										}

										name = "ledger.append";
										expected = {
											...cut("messaging.destination.name", a.stream),
											...cut("messaging.message.id", id),
											"messaging.operation.type": "send",
											...(["bad_line", "bad_parent", "bad_trace"].includes(call.op)
												? {}
												: {...cut("fab.ledger.by", a.by), "fab.ledger.tag": "saved"}),
											"fab.ledger.answer": call.op === "resend" ? "resent" : answer._tag,
											...(answer._tag === "refused"
												? {"fab.ledger.reason": answer.reason}
												: {"fab.ledger.rev": head, "fab.ledger.pos": head}),
											...(accepted
												? {
														"fab.ledger.rings": c.spans
															.slice(before)
															.filter((s) => s.name === "ledger.ring").length,
													}
												: {}),
										};
										const first = c.spans.slice(before).filter((s) => s.name === name);
										expect(first).toHaveLength(twice ? 2 : 1);
									}

									const spans = c.spans.slice(before).filter((s) => s.name === name);
									const span = spans.at(-1)!;
									ended(span, true);
									child(span, parent);
									expect(tags(span)).toEqual(expected);

									if (call.op === "read" || call.op === "wait") {
										expect(spans).toHaveLength(1);
									}
								}
							}).pipe(
								request,
								Effect.withParentSpan(Tracer.externalSpan(ctx)),
								Effect.provide(Ledger.sql(d.sql, {reader: a.reader}).pipe(Layer.provide(quiet))),
								Effect.provideService(
									Clock.Clock,
									clock(() => 100_000),
								),
								Effect.withTracer(c.tracer),
							),
						);
					} finally {
						d.db.close();
					}
				},
			),
			CHECK,
		);
	});

	it("generated ring failures end failed before recovery, preserving the successful append", async () => {
		await fc.assert(
			fc.asyncProperty(
				attributes,
				context,
				fc.array(fc.constantFrom("ok", "fail", "die", "throw"), {minLength: 1, maxLength: 12}),
				async (a, ctx, modes) => {
					const d = disk();
					const c = capture();
					let mode = "ok";
					const bell = Layer.succeed(Doorbell, {
						ring: () => {
							if (mode === "throw") {
								throw new Error("generated ring throw");
							}

							if (mode === "die") {
								return Effect.die(new Error("generated ring defect"));
							}

							return mode === "fail"
								? Effect.fail(new LedgerError({reason: "unreachable"}))
								: Effect.void;
						},
					});

					try {
						await Effect.runPromise(
							Effect.gen(function* () {
								const ledger = yield* Ledger;

								for (const [index, failure] of modes.entries()) {
									mode = failure;
									const stream = `${a.stream}/${index}`;
									yield* ledger.wait(stream, 0);
									const before = c.spans.length;
									expect((yield* ledger.append(stream, a.id, line(a, ctx.traceId)))._tag).toBe(
										"placed",
									);
									const spans = c.spans.slice(before);
									expect(spans.map((s) => s.name)).toEqual(["ledger.append", "ledger.ring"]);
									const [append, ring] = spans;
									ended(append!, true);
									ended(ring!, failure === "ok");
									child(ring!, append!);
									expect(tags(ring!)).toEqual({
										...cut("messaging.destination.name", stream),
										...cut("fab.ledger.to", a.reader),
										"fab.ledger.after": 0,
										"fab.ledger.rev": index + 1,
										"fab.ledger.ok": failure === "ok",
										...(failure === "ok"
											? {}
											: {"error.type": failure === "fail" ? "LedgerError" : "Error"}),
									});
								}
							}).pipe(
								request,
								Effect.withParentSpan(Tracer.externalSpan(ctx)),
								Effect.withTracer(c.tracer),
								Effect.provide(Ledger.sql(d.sql, {reader: a.reader}).pipe(Layer.provide(bell))),
							),
						);
					} finally {
						d.db.close();
					}
				},
			),
			CHECK,
		);
	});

	it("generated storage failures retain append, read and wait spans and their parents", async () => {
		await fc.assert(
			fc.asyncProperty(
				attributes,
				context,
				fc.array(fc.constantFrom("append", "read", "wait"), {minLength: 1, maxLength: 12}),
				async (a, ctx, calls) => {
					const d = disk();
					const c = capture();

					try {
						await Effect.runPromise(
							Effect.gen(function* () {
								const ledger = yield* Ledger;

								for (const [i, op] of calls.entries()) {
									d.fault.armed = true;
									const before = c.spans.length;
									const parent = yield* Effect.currentSpan;
									const work: Effect.Effect<unknown, LedgerError> =
										op === "append"
											? ledger.append(a.stream, `${a.id}/${i}`, line(a, ctx.traceId))
											: op === "read"
												? Stream.runCollect(ledger.read(a.stream, 0))
												: ledger.wait(a.stream, 0);
									const exit = yield* Effect.exit(work);
									expect(Exit.isFailure(exit)).toBe(true);
									const spans = c.spans.slice(before);
									expect(spans.map((s) => s.name)).toEqual([`ledger.${op}`]);
									ended(spans[0]!, false);
									child(spans[0]!, parent);
									expect(tags(spans[0]!)).toMatchObject({
										"fab.ledger.reason": "storage",
										"error.type": "Error",
									});
								}
							}).pipe(
								request,
								Effect.withParentSpan(Tracer.externalSpan(ctx)),
								Effect.withTracer(c.tracer),
								Effect.provide(Ledger.sql(d.sql, {reader: a.reader}).pipe(Layer.provide(quiet))),
							),
						);
					} finally {
						d.db.close();
					}
				},
			),
			CHECK,
		);
	});
});

describe("T285, coordination tracing keep-laws", () => {
	it("members.read stays lazy and keeps counts, founding parent and refused-read spans", async () => {
		await fc.assert(
			fc.asyncProperty(
				attributes,
				context,
				fc.uniqueArray(text, {minLength: 1, maxLength: 5}),
				fc.array(fc.boolean(), {minLength: 1, maxLength: 10}),
				async (a, ctx, keys, failures) => {
					const d = disk();
					const c = capture();
					const layer = ClientManager.layer({
						name: a.id,
						keys,
						window: null,
						person: PERSON,
						by: a.by,
						build: a.build,
					}).pipe(Layer.provide(Ledger.sql(d.sql, {reader: a.reader}).pipe(Layer.provide(quiet))));

					try {
						await Effect.runPromise(
							Effect.gen(function* () {
								const clients = yield* ClientManager;
								// Layer construction cannot do the first read or the founding write.
								expect(c.spans).toEqual([]);

								for (const fails of failures) {
									d.fault.armed = fails;
									const before = c.spans.length;
									const exit = yield* Effect.exit(request(clients.members));
									expect(Exit.isSuccess(exit)).toBe(!fails);
									const spans = c.spans.slice(before);
									const reads = spans.filter((s) => s.name === "members.read");
									expect(reads).toHaveLength(1);
									const read = reads[0]!;
									ended(read, !fails);
									child(read, spans[0]!);
									expect(tags(read)).toEqual(
										fails
											? {"fab.members.reason": "storage"}
											: {
													"fab.members.events": 1,
													"fab.members.keys": keys.length,
													"fab.members.live": keys.length,
													"fab.members.ignored": 0,
												},
									);

									for (const append of spans.filter((s) => s.name === "ledger.append")) {
										child(append, read);
									}
								}
							}).pipe(
								Effect.withParentSpan(Tracer.externalSpan(ctx)),
								Effect.withTracer(c.tracer),
								Effect.provide(layer),
							),
						);
					} finally {
						d.db.close();
					}
				},
			),
			CHECK,
		);
	});

	it("process.info and process.next keep their spans, including nested id.next and failed calls", async () => {
		await fc.assert(
			fc.asyncProperty(
				context,
				fc.array(
					fc.record({
						op: fc.constantFrom("info", "next"),
						fails: fc.boolean(),
						at: fc.integer({min: 0, max: 2_000_000_000_000}),
					}),
					{minLength: 1, maxLength: 16},
				),
				fc.integer({min: 2 ** 48, max: Number.MAX_SAFE_INTEGER}),
				async (ctx, calls, exhaustedAt) => {
					const d = disk();
					const c = capture();
					const manager = ProcessManager.layer(
						{
							owner: Owner.cases.brain.make({}),
							recipient: Recipient.cases.client.make({client: "test", session: PROCESS}),
							by: "brain",
						},
						Effect.succeed(PROCESS),
					).pipe(Layer.provide(LedgerTransaction.layer(d.sql).pipe(Layer.provide(quiet))));

					try {
						await Effect.runPromise(
							Effect.gen(function* () {
								const processes = yield* ProcessManager;
								const ids = yield* ProcessIdGenerator;
								expect(c.spans).toEqual([]);
								const seen = new Set<string>();

								for (const call of calls) {
									d.fault.armed = call.op === "info" && call.fails;
									const before = c.spans.length;
									const work: Effect.Effect<unknown, LedgerError> =
										call.op === "info" ? processes.info : ids.next;
									const exit = yield* Effect.exit(
										request(work).pipe(
											Effect.provideService(
												Clock.Clock,
												clock(() => call.at),
											),
										),
									);
									const ok = call.op === "next" || !call.fails;
									expect(Exit.isSuccess(exit)).toBe(ok);
									const spans = c.spans.slice(before);
									const selected = spans.filter((s) => s.name === `process.${call.op}`);
									expect(selected).toHaveLength(1);
									ended(selected[0]!, ok);
									child(selected[0]!, spans[0]!);
									expect(tags(selected[0]!)).toEqual({});

									if (call.op === "next" && Exit.isSuccess(exit)) {
										expect(spans.map((s) => s.name)).toEqual([
											"test.request",
											"process.next",
											"id.next",
										]);
										ended(spans[2]!, true);
										child(spans[2]!, selected[0]!);
										const id = String(exit.value);
										expect(id).toMatch(/^process_[0-7][0-9a-hjkmnp-tv-z]{25}$/);
										expect(seen.has(id)).toBe(false);
										seen.add(id);
									}
								}

								const before = c.spans.length;
								const exit = yield* Effect.exit(
									request(ids.next).pipe(
										Effect.provideService(
											Clock.Clock,
											clock(() => exhaustedAt),
										),
									),
								);
								expect(Exit.isFailure(exit)).toBe(true);
								const spans = c.spans.slice(before);
								expect(spans.map((s) => s.name)).toEqual([
									"test.request",
									"process.next",
									"id.next",
								]);
								ended(spans[1]!, false);
								child(spans[1]!, spans[0]!);
								ended(spans[2]!, false);
								child(spans[2]!, spans[1]!);
							}).pipe(
								Effect.withParentSpan(Tracer.externalSpan(ctx)),
								Effect.withTracer(c.tracer),
								Effect.provide(Layer.mergeAll(manager, ProcessIdGenerator.layer)),
							),
						);
					} finally {
						d.db.close();
					}
				},
			),
			CHECK,
		);
	});
});

describe("T285, caller context keep-laws", () => {
	it("fromHere copies generated caller context and fields without adding a span", async () => {
		await fc.assert(
			fc.asyncProperty(
				attributes,
				context,
				fc.option(fc.integer({min: 1, max: 100_000}), {nil: null}),
				fc.integer({min: 0, max: 2_000_000_000_000}),
				async (a, ctx, n, at) => {
					const c = capture();
					const input = {
						by: a.by,
						for: PERSON,
						seen: n ?? 0,
						parent: n === null ? null : `in-${PROCESS}-${n}`,
						build: a.build,
					};
					await Effect.runPromise(
						request(
							Effect.gen(function* () {
								expect(yield* fromHere(input)).toEqual({
									...input,
									traceId: ctx.traceId,
									sentAt: new Date(at).toISOString(),
								});
							}),
						).pipe(
							Effect.withParentSpan(Tracer.externalSpan(ctx)),
							Effect.withTracer(c.tracer),
							Effect.provideService(
								Clock.Clock,
								clock(() => at),
							),
						),
					);
					expect(c.spans.map((s) => s.name)).toEqual(["test.request"]);
				},
			),
			CHECK,
		);
	});

	it("fromHere fails without a caller for all generated writers, with no fallback span", () => {
		fc.assert(
			fc.property(attributes, (a) => {
				const c = capture();
				const exit = Effect.runSyncExit(
					fromHere({by: a.by, for: PERSON, seen: 0, parent: null, build: a.build}).pipe(
						Effect.withTracer(c.tracer),
					),
				);
				expect(Exit.isFailure(exit)).toBe(true);
				const failure = Exit.match(exit, {onFailure: Cause.squash, onSuccess: () => undefined});
				expect(Cause.isNoSuchElementError(failure)).toBe(true);
				expect(c.spans).toEqual([]);
			}),
			CHECK,
		);
	});
});

describe("T285, sink keep-law", () => {
	it("generated flushes, record walks and health archives add no sink spans", async () => {
		const sample = fc.record({
			name: text,
			value: fc.oneof(text, fc.integer(), fc.boolean()),
			failure: fc.constantFrom("ok", "fail", "die"),
			ms: fc.nat(1000),
		});
		await fc.assert(
			fc.asyncProperty(
				context,
				fc.boolean(),
				fc.array(sample, {minLength: 1, maxLength: 12}),
				fc.array(fc.constantFrom("flush", "summaries", "content"), {minLength: 1, maxLength: 10}),
				async (ctx, job, samples, calls) => {
					const d = disk();
					const parts: Array<DatabaseSync> = [];
					const known = new Map<string, Sql>();
					const records = RecordManager.sql((name) => {
						const found = known.get(name);

						if (found !== undefined) {
							return found;
						}

						const db = new DatabaseSync(":memory:");
						parts.push(db);
						const sql = nodeSql(db);
						known.set(name, sql);
						return sql;
					}, BIG);
					const layer = Layer.mergeAll(
						SpanSink.layer(d.sql, {object: "tracing-test"}),
						records,
						Archive.memory,
					);
					const chain = job ? Chain.cases.job.make({process: PROCESS}) : Chain.cases.spans.make({});
					let now = 100 * DAY;

					try {
						await Effect.runPromise(
							Effect.gen(function* () {
								const sink = yield* SpanSink;
								const records = yield* RecordManager;

								for (const [index, sample] of samples.entries()) {
									yield* Effect.gen(function* () {
										now += sample.ms;

										if (sample.failure === "fail") {
											return yield* Effect.fail(new LedgerError({reason: "storage"}));
										}

										if (sample.failure === "die") {
											return yield* Effect.die(new Error(`failure ${sample.name}`));
										}
									}).pipe(
										Effect.withSpan(`sample.${index}`, {
											attributes: {
												"test.value": sample.value,
												...(job ? {"fab.process": PROCESS} : {}),
											},
											links: [{span: Tracer.externalSpan(ctx), attributes: {"test.index": index}}],
										}),
										Effect.exit,
									);
								}

								expect((yield* sink.flush).sent).toBe(samples.length);
								expect(d.db.prepare("SELECT count(*) AS n FROM health").get()?.n).toBe(
									samples.length,
								);
								const original = yield* Stream.runCollect(records.read(chain));
								expect(original.map((s) => s.name)).toEqual(samples.map((_, i) => `sample.${i}`));

								for (const [index, row] of original.entries()) {
									const sample = samples[index]!;
									expect(row.ok).toBe(sample.failure === "ok");
									expect(BigInt(row.endTimeUnixNano) - BigInt(row.startTimeUnixNano)).toBe(
										BigInt(sample.ms) * 1_000_000n,
									);
									expect(row.attributes).toEqual({
										...(typeof sample.value === "string"
											? cut("test.value", sample.value)
											: {"test.value": sample.value}),
										...(job ? {"fab.process": PROCESS} : {}),
										...(sample.failure === "ok"
											? {}
											: {"error.type": sample.failure === "fail" ? "LedgerError" : "Error"}),
									});
									expect(row.links).toEqual([{...ctx, attributes: {"test.index": index}}]);
								}

								// Old health rows must really take the archive path, including hashing.
								now += 20 * DAY;
								yield* sink.summaries(0, now);

								for (const call of calls) {
									if (call === "flush") {
										expect((yield* sink.flush).sent).toBe(0);
									} else if (call === "summaries") {
										yield* sink.summaries(0, now);
									} else {
										for (const row of original) {
											yield* records.content(chain, row.spanId);
										}
									}
								}

								expect((yield* sink.flush).sent).toBe(0);
								expect(
									Number(d.db.prepare("SELECT count(*) AS n FROM archived").get()?.n),
								).toBeGreaterThan(0);
								expect(d.db.prepare("SELECT count(*) AS n FROM unsent").get()?.n).toBe(0);
								expect(yield* Stream.runCollect(records.read(chain))).toEqual(original);
							}).pipe(
								Effect.provide(layer),
								Effect.provideService(
									Clock.Clock,
									clock(() => now),
								),
							),
						);
					} finally {
						d.db.close();

						for (const db of parts) {
							db.close();
						}
					}
				},
			),
			CHECK,
		);
	});
});

// A small real program. The checked writer is the test's door adapter; the runner,
// mailbox, session manager, process store, sink and record manager are the real ones.
const Model = Schema.Struct({replies: Schema.Int});

const Msg = Schema.Union([
	Schema.Struct({type: Schema.Literal("work"), value: Schema.Int}),
	Schema.Struct({
		type: Schema.Literal("write"),
		value: Schema.Int,
		own: Schema.Boolean,
		stream: Schema.String,
		parent: Schema.optionalKey(Schema.String),
	}),
	Schema.Struct({type: Schema.Literal("throw")}),
	Schema.Struct({type: Schema.Literal("timer"), at: Schema.Number}),
]);

const work = Cmd.make("work", {
	input: Schema.Struct({value: Schema.Int}),
	ok: Schema.Int,
	err: ["handler_failed", "bad_cmd"],
});

const write = Cmd.make("write", {
	input: Schema.Struct({stream: Schema.String, write: Schema.Json}),
	ok: Schema.Json,
	err: ["seen_ahead", "bad_cmd"],
});

const machine = Machine.make({
	model: Model,
	msg: Msg,
	cmds: [work, write],
	init: (saved) => [saved ?? {replies: 0}, []],
	update: {
		work: (s, m) => [s, [work({value: m.value})]],
		write: (s, m) => [
			s,
			[
				write({
					stream: m.stream,
					write: m.own
						? {_tag: "own", event: {_tag: "saved", value: m.value}}
						: {_tag: "caused", parent: m.parent ?? "", event: {_tag: "saved", value: m.value}},
				}),
			],
		],
		throw: () => {
			throw new Error("generated step failure");
		},
		timer: (s) => [s, []],
		work_ok: (s) => [{replies: s.replies + 1}, []],
		work_err: (s) => [{replies: s.replies + 1}, []],
		write_ok: (s) => [{replies: s.replies + 1}, []],
		write_err: (s) => [{replies: s.replies + 1}, []],
	},
});

const program = {
	name: "trace-test",
	machine,
	state: {v: 1, schema: Model, upgrades: []},
	msg: Msg,
	view: {data: Model, select: (m: typeof Model.Type) => m},
	refuse: () => null,
	inputs: {
		work: {_tag: "write", schema: Msg, description: "Work", personOnly: false},
		write: {_tag: "write", schema: Msg, description: "Write", personOnly: false},
		throw: {_tag: "write", schema: Msg, description: "Throw", personOnly: false},
	},
	outputs: {},
	writes: {saved: {schema: Schema.TaggedStruct("saved", {value: Schema.Int}), personOnly: false}},
	wake: () => null,
};

const decodeIncoming = Schema.decodeUnknownSync(Incoming);

const runnerWorld = (
	a: {readonly name: string; readonly build: string; readonly key: string},
	signer: {readonly traceId: string; readonly spanId: string},
) => {
	const data = disk(),
		state = disk(),
		sessions = disk(),
		sink = disk();
	const spans: Array<Tracer.Span> = [];
	const flushes: Array<ReadonlyArray<string>> = [];
	const fault = {at: "none"};
	const owner = Writer.cases.person.make({key: a.key, for: PERSON});
	const base = Layer.mergeAll(
		Ledger.sql(data.sql, {reader: "runner-test"}).pipe(Layer.provide(quiet)),
		SessionManager.layer(sessions.sql, () => Effect.succeed(owner), {
			input: () => false,
			event: () => false,
		}),
		SpanSink.layer(sink.sql, {object: PROCESS}),
		RecordManager.memory(BIG),
		Archive.memory,
	);
	const checked = Layer.effect(
		CheckedWriter,
		Effect.gen(function* () {
			const ledger = yield* Ledger;
			const mailbox = yield* Mailbox;
			const sessions = yield* SessionManager;
			return {
				append: Effect.fnUntraced(function* (input: Incoming) {
					if (fault.at === "append_storage") {
						return yield* new LedgerError({reason: "storage"});
					}

					return yield* mailbox.send(a.name, input.id, input.envelope.input, {
						by: input.envelope.by.key,
						for: PERSON,
						sentAt: input.sentAt,
						seen: input.seen,
						parent: input.envelope.id,
						traceId: input.span.traceId,
						build: a.build,
					});
				}),
				commit: Effect.fnUntraced(function* (
					...[id, session, stream, event]: Parameters<typeof CheckedWriter.Service.commit>
				) {
					const receipt = yield* sessions.receipt(id, session.parent, PROCESS, event._tag);

					if (fault.at === "write_storage") {
						return yield* new LedgerError({reason: "storage"});
					}

					if (fault.at === "write_refused") {
						return Appended.cases.refused.make({reason: "seen_ahead"});
					}

					return yield* ledger.append(
						stream,
						id,
						lineFor(
							{
								by: receipt.by.key,
								for: PERSON,
								parent: receipt.parent,
								traceId: receipt.traceId,
								seen: 0,
								sentAt: "2026-11-08T00:00:00.000Z",
								build: a.build,
							},
							event,
						),
					);
				}),
				own: Effect.fnUntraced(function* (
					...[id, stream, event]: Parameters<typeof CheckedWriter.Service.own>
				) {
					if (fault.at === "write_storage") {
						return yield* new LedgerError({reason: "storage"});
					}

					if (fault.at === "write_refused") {
						return Appended.cases.refused.make({reason: "seen_ahead"});
					}

					return yield* ledger.append(
						stream,
						id,
						lineFor(
							yield* fromHere({
								by: owner.key,
								for: PERSON,
								parent: null,
								seen: 0,
								build: a.build,
							}).pipe(Effect.orDie),
							event,
						),
					);
				}),
			};
		}),
	);
	const adapters = Layer.mergeAll(
		ProgramLoader.layer(
			{[program.name]: program},
			{
				work: Effect.fnUntraced(function* (_cmd: unknown) {
					if (fault.at === "handler_fail") {
						return yield* Effect.fail(new Error("generated handler failure"));
					}

					if (fault.at === "handler_die") {
						return yield* Effect.die(new Error("generated handler defect"));
					}

					return Outcome.ok(1);
				}),
			},
		),
		ProcessStore.layer(state.sql, {process: PROCESS}),
		Layer.succeed(WatcherManager, {publish: () => Effect.void}),
		Layer.succeed(Alarm, {set: () => Effect.void}),
		checked,
		Recording.layer,
	).pipe(Layer.provideMerge(Mailbox.layer.pipe(Layer.provideMerge(base))));
	const observed = Layer.mergeAll(
		Layer.effect(
			Tracer.Tracer,
			Effect.map(Tracer.Tracer, (tracer) => capture(tracer, spans).tracer),
		),
		Layer.effect(
			Recording,
			Effect.map(Recording, (actual) => ({
				flush: Effect.sync(() => {
					const runner = spans.filter((s) => s.name.startsWith("runner."));

					for (const span of runner) {
						expect(span.status._tag, `${span.name} must end before flush`).toBe("Ended");
					}

					flushes.push(runner.map((s) => s.spanId));
				}).pipe(Effect.andThen(actual.flush)),
			})),
		),
	).pipe(Layer.provideMerge(adapters));
	const layer = ProgramRunner.layer({
		id: PROCESS,
		name: a.name,
		program: program.name,
		build: a.build,
		owner,
	}).pipe(Layer.provideMerge(observed));
	const input = (n: number, m: unknown) =>
		decodeIncoming({
			id: `letter-${n}`,
			envelope: {
				id: `input_0000000000e008${n.toString(16).padStart(12, "0")}`,
				by: owner,
				arrivedAt: n,
				input: m,
			},
			sentAt: "2026-11-08T00:00:00.000Z",
			seen: 0,
			span: signer,
		});
	return {
		layer,
		spans,
		flushes,
		fault,
		input,
		close: () => {
			for (const d of [data, state, sessions, sink]) {
				d.db.close();
			}
		},
	};
};

describe("T285, runner tracing keep-laws", () => {
	it("generated reply conflicts keep the refusal reason and the pending Cmd", async () => {
		await fc.assert(
			fc.asyncProperty(context, attributes, async (ctx, a) => {
				const w = runnerWorld({name: "refused-reply", build: a.build, key: a.by}, ctx);

				try {
					await Effect.runPromise(
						Effect.gen(function* () {
							const ledger = yield* Ledger;
							const runner = yield* ProgramRunner;
							const store = yield* ProcessStore;
							// This unrelated first row reserves the answer id for the next input at position 2.
							const id = `${PROCESS}/2/0/answer`;
							expect(
								yield* ledger.append("refused-reply/inbox", id, line(a, ctx.traceId)),
							).toMatchObject({_tag: "placed", pos: 1});
							const error = yield* Effect.flip(
								runner.msg(w.input(1, {type: "work", value: a.value})),
							);
							expect(error).toMatchObject({
								_tag: "LedgerError",
								reason: "refused",
								message: "id_reused",
							});
							expect((yield* store.load)?.cmds).toHaveLength(1);
							const entries = yield* Stream.runCollect(ledger.read("refused-reply/inbox", 0));
							expect(entries.filter((entry) => entry.id === id)).toHaveLength(1);
							expect(entries.find((entry) => entry.id === id)?.body).toEqual({value: a.value});
						}).pipe(Effect.withParentSpan(Tracer.externalSpan(ctx)), Effect.provide(w.layer)),
					);
				} finally {
					w.close();
				}
			}),
			CHECK,
		);
	});

	it("generated successful Cmds save typed answers and update the model once", async () => {
		await fc.assert(
			fc.asyncProperty(
				context,
				fc.array(
					fc.record({
						value: fc.integer(),
						at: fc.integer({min: 0, max: 2_000_000_000_000}),
					}),
					{minLength: 1, maxLength: 12},
				),
				async (ctx, calls) => {
					const w = runnerWorld({name: "reply-test", build: "test", key: "test"}, ctx);
					let now = 0;

					try {
						await Effect.runPromise(
							Effect.gen(function* () {
								const runner = yield* ProgramRunner;
								const ledger = yield* Ledger;

								for (const [index, call] of calls.entries()) {
									now = call.at;
									yield* runner.msg(w.input(index + 1, {type: "work", value: call.value}));
									const entries = yield* Stream.runCollect(ledger.read("reply-test/inbox", 0));
									const answers = entries.filter((entry) => entry.id.endsWith("/answer"));
									expect(answers).toHaveLength(index + 1);
									expect(answers.at(-1)?.body).toEqual({
										m: {
											type: "work_ok",
											cmd: {type: "work", value: call.value},
											value: 1,
											at: call.at,
										},
									});
									expect((yield* runner.open("inspect")).view).toEqual({replies: index + 1});
								}
							}).pipe(
								Effect.withParentSpan(Tracer.externalSpan(ctx)),
								Effect.provide(w.layer),
								Effect.provideService(
									Clock.Clock,
									clock(() => now),
								),
							),
						);
					} finally {
						w.close();
					}
				},
			),
			CHECK,
		);
	});

	it("generated operations keep names, attributes, parents, signer links and refusal spans", async () => {
		const action = fc.record({
			op: fc.constantFrom(
				"open",
				"bad_client",
				"due",
				"work",
				"handler_fail",
				"handler_die",
				"own",
				"caused",
				"write_refused",
				"write_storage",
				"append_storage",
				"bad_input",
				"refuse",
				"step_throw",
			),
			value: fc.integer(),
			client: fc.string({minLength: 1, maxLength: 20}),
		});
		await fc.assert(
			fc.asyncProperty(
				context,
				context,
				fc.record({
					name: fc.string({unit: fc.constantFrom("a", "b", "7"), minLength: 1, maxLength: 30}),
					build: text,
					key: text,
				}),
				fc.array(action, {minLength: 1, maxLength: 12}),
				async (ctx, signer, a, calls) => {
					const w = runnerWorld(a, signer);

					try {
						await Effect.runPromise(
							Effect.gen(function* () {
								const runner = yield* ProgramRunner;
								const sessions = yield* SessionManager;
								const records = yield* RecordManager;

								for (const [index, call] of calls.entries()) {
									w.fault.at = call.op;
									const n = index + 1;
									const writing = ["own", "caused", "write_refused", "write_storage"].includes(
										call.op,
									);
									const handling = ["work", "handler_fail", "handler_die"].includes(call.op);
									const stream = `facts/${a.name}`;
									const m = writing
										? {type: "write", value: call.value, own: call.op === "own", stream}
										: call.op === "step_throw"
											? {type: "throw"}
											: call.op === "refuse"
												? {type: "unknown", value: call.value}
												: {type: "work", value: call.value};
									const input = w.input(n, m);

									if (writing && call.op !== "own") {
										yield* sessions.record({
											id: input.envelope.id,
											by: input.envelope.by,
											client: a.key,
											process: PROCESS,
											name: "write",
											personOnly: false,
											digest: JSON.stringify(m),
											traceId: signer.traceId,
											span: signer,
											arrivedAt: n,
										});
										yield* sessions.delivered(input.envelope.id, PROCESS);
									}

									const op =
										call.op === "open" || call.op === "bad_client"
											? "open"
											: call.op === "due"
												? "due"
												: "step";
									const body: Effect.Effect<unknown, unknown> =
										op === "open"
											? runner.open(call.op === "bad_client" ? "" : call.client)
											: op === "due"
												? runner.due(call.value)
												: runner.msg(call.op === "bad_input" ? {value: call.value} : input);
									const before = w.spans.length;
									const flushes = w.flushes.length;
									const exit = yield* Effect.exit(request(body));
									const ok = ![
										"bad_client",
										"bad_input",
										"step_throw",
										"write_storage",
										"append_storage",
									].includes(call.op);
									expect(
										Exit.isSuccess(exit),
										`${call.op}: ${Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "success"}`,
									).toBe(ok);
									expect(w.flushes.length, call.op).toBe(flushes + 1);
									const spans = w.spans.slice(before);
									const expected = [
										`runner.${op}`,
										...(writing || handling ? ["runner.cmd"] : []),
										...(writing ? ["runner.write"] : []),
									];
									const selected = spans.filter((s) => s.name.startsWith("runner."));
									expect(
										selected.map((s) => s.name),
										call.op,
									).toEqual(expected);
									const root = spans.find((s) => s.name === "test.request")!;
									const operation = selected[0]!;
									ended(operation, ok);
									child(operation, root);
									expect(tags(operation)).toEqual({
										"fab.process": PROCESS,
										"fab.runner.name": a.name,
										...(op === "step" && call.op !== "bad_input"
											? {"fab.runner.letter": input.id}
											: {}),
									});

									if (writing || handling) {
										const cmd = selected[1]!;
										const letter = (yield* Stream.runCollect(
											(yield* Ledger).read(`${a.name}/inbox`, 0),
										)).find((entry) => entry.id === input.id)!;
										ended(cmd, !["handler_fail", "handler_die", "write_storage"].includes(call.op));
										child(cmd, operation);
										expect(tags(cmd)).toEqual({
											"fab.process": PROCESS,
											"fab.runner.cmd": writing ? "write" : "work",
											"fab.runner.id": `${PROCESS}/${letter.pos}/0`,
										});

										if (writing) {
											const write = selected[2]!;
											ended(write, call.op !== "write_storage");
											child(write, cmd);

											if (call.op === "own") {
												expect(write.links).toEqual([]);
											} else {
												expect(
													write.links.map(({span, attributes}) => ({
														traceId: span.traceId,
														spanId: span.spanId,
														attributes,
													})),
												).toEqual([{...signer, attributes: {}}]);
											}

											expect(tags(write)).toEqual({
												"fab.process": PROCESS,
												"fab.runner.write": tags(cmd)["fab.runner.id"],
												"fab.runner.stream": stream,
											});
										}
									}

									const rows = (yield* Stream.runCollect(
										records.read(Chain.cases.job.make({process: PROCESS})),
									)).filter((s) => s.name.startsWith("runner."));
									const all = w.spans.filter((s) => s.name.startsWith("runner."));
									expect(rows.map((s) => s.spanId).sort()).toEqual(all.map((s) => s.spanId).sort());

									for (const span of selected) {
										const row = rows.find((s) => s.spanId === span.spanId)!;
										expect(row).toMatchObject({
											name: span.name,
											traceId: ctx.traceId,
											parentSpanId: parentId(span),
										});
										expect(row.attributes).toMatchObject(tags(span));
										const status = span.status;

										if (status._tag !== "Ended") {
											expect.unreachable("runner span still open");
										}

										expect(row.startTimeUnixNano).toBe(String(status.startTime));
										expect(row.endTimeUnixNano).toBe(String(status.endTime));
										expect(row.ok).toBe(Exit.isSuccess(status.exit));
									}
								}
							}).pipe(Effect.withParentSpan(Tracer.externalSpan(ctx)), Effect.provide(w.layer)),
						);
					} finally {
						w.close();
					}
				},
			),
			CHECK,
		);
	});
});
