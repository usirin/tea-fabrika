// P23, next/. P19 owns desktopJournal({home, forward}); a successful forward acknowledges rows.
// Keep the import deferred until P19 supplies the real export. Never substitute an in-memory journal.
import {mkdtempSync, readdirSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {NodeServices} from "@effect/platform-node";
import {describe, expect, it} from "@effect/vitest";
import {Arbitrary, Context, Effect, Exit, Layer, Logger, Schema, Scope, Tracer} from "effect";
import {Bytes32, checks, leaks, secretForms} from "./browser-link.test-support.ts";
import type * as Founding from "./founding.ts";
import type * as Recording from "./recording.ts";

type Row = typeof Recording.BrowserObservation.Type;
type Journal = (options: {
	readonly home: string;
	readonly forward: (rows: ReadonlyArray<Row>) => Effect.Effect<void, Founding.DesktopDown>;
}) => Layer.Layer<Recording.DesktopRecording>;
const recordingPath = "./recording.ts",
	foundingPath = "./founding.ts";
const load = () =>
	Effect.promise(
		(): Promise<typeof Recording & {readonly desktopJournal: Journal}> => import(recordingPath),
	);
const Interval = Schema.Int.check(Schema.isBetween({minimum: 0, maximum: 4}));
const Flow = Schema.Array(
	Schema.Struct({
		down: Interval,
		lost: Schema.Boolean,
		retries: Interval,
		cut: Schema.Literals(["none", "put", "flush", "retry"]),
	}),
).check(Schema.isBetweenLength(1, 12));

// Compare complete rows, so a journal that keeps only IDs cannot pass.
const sameRows = (expected: ReadonlyArray<Row>, actual: ReadonlyMap<string, Row>) => {
	expect([...actual.keys()].sort()).toEqual([...new Set(expected.map((row) => row.id))].sort());
	for (const row of expected) expect(actual.get(row.id)).toEqual(row);
};
const noPass = (pass: string, outputs: unknown) => expect(leaks(pass, outputs)).toBe(false);
const files = (home: string): ReadonlyArray<Uint8Array> =>
	readdirSync(home, {withFileTypes: true}).flatMap((entry) =>
		entry.isDirectory() ? files(join(home, entry.name)) : [readFileSync(join(home, entry.name))],
	);

describe("P23 browser observations", () => {
	it.effect.prop(
		"[secrets] observations survive unavailable intervals, lost acknowledgments, retries and reopen cuts",
		{bytes: Bytes32, flow: Flow},
		({bytes, flow}) =>
			Effect.gen(function* () {
				const r = yield* load();
				expect(r.desktopJournal, "P19 desktop/recording.ts must export desktopJournal").toBeTypeOf(
					"function",
				);
				const f: typeof Founding = yield* Effect.promise(() => import(foundingPath));
				const raw = Buffer.from(bytes).toString("base64url");
				const checked = yield* Arbitrary.checkEffect(
					Arbitrary.array(Arbitrary.schema(r.BrowserObservation), {minLength: 1, maxLength: 6}),
					(batch) =>
						Effect.scoped(
							Effect.gen(function* () {
								const home = yield* Effect.sync(() => mkdtempSync(join(tmpdir(), "p23-journal-")));
								yield* Effect.addFinalizer(() =>
									Effect.sync(() => rmSync(home, {recursive: true, force: true})),
								);
								const rows = [...new Map(batch.map((row) => [row.id, row])).values()];
								const received = new Map<string, Row>(),
									acked = new Map<string, Row>();
								const diagnostics: unknown[] = [],
									sent: Row[][] = [],
									spans: Tracer.NativeSpan[] = [];
								let up = false,
									lose = false;
								const forward = (values: ReadonlyArray<Row>) =>
									Effect.gen(function* () {
										noPass(raw, values);
										if (!up) return yield* new f.DesktopDown({why: "startup"});
										for (const row of values) {
											expect(acked.has(row.id), "a successful forward must not be retried").toBe(
												false,
											);
											yield* Schema.decodeUnknownEffect(r.BrowserObservation)(row);
											received.set(row.id, row);
										}
										sent.push([...values]);
										if (lose) return yield* new f.DesktopDown({why: "startup"});
										for (const row of values) acked.set(row.id, row);
									});
								const tracer = Tracer.make({
									span(options) {
										const span = new Tracer.NativeSpan(options);
										spans.push(span);
										return span;
									},
								});
								const logger = Logger.make((event) => {
									diagnostics.push({message: event.message, cause: event.cause});
								});
								let scope = yield* Scope.make();
								const open = () =>
									Effect.gen(function* () {
										const services = yield* Layer.buildWithScope(
											r.desktopJournal({home, forward}).pipe(Layer.provide(NodeServices.layer)),
											scope,
										);
										return Context.get(services, r.DesktopRecording);
									});
								const inspect = () => {
									noPass(raw, {
										rows: [...received.values()],
										files: files(home),
										diagnostics,
										spans: spans.map((span) => ({
											name: span.name,
											attributes: [...span.attributes],
											events: span.events,
											status: span.status,
										})),
									});
								};
								yield* Effect.addFinalizer(() =>
									Scope.close(scope, Exit.void).pipe(
										Effect.withTracer(tracer),
										Effect.provide(Logger.layer([logger])),
										Effect.tap(() => Effect.sync(inspect)),
									),
								);
								let rec = yield* open().pipe(
									Effect.withTracer(tracer),
									Effect.provide(Logger.layer([logger])),
								);
								const reopen = Effect.gen(function* () {
									yield* Scope.close(scope, Exit.void);
									inspect();
									scope = yield* Scope.make();
									rec = yield* open();
								});
								const flush = Effect.gen(function* () {
									diagnostics.push(yield* Effect.exit(rec.flush));
									inspect();
								});
								yield* Effect.gen(function* () {
									// Every generated batch first crosses an unavailable brain and an actual reopen.
									const first = rows[0];
									if (!first) return yield* Effect.die("generated observation batch is empty");
									yield* rec.put(first);
									yield* flush;
									yield* reopen;
									// The receiver saves the batch but loses its reply. Pending rows must survive this cut.
									up = true;
									lose = true;
									yield* flush;
									sameRows([first], received);
									expect(acked.size).toBe(0);
									yield* reopen;
									for (const [n, row] of rows.slice(1).entries()) {
										const step = flow[n % flow.length];
										if (!step) return yield* Effect.die("generated journal flow is empty");
										up = step.down === 0;
										lose = step.lost;
										yield* rec.put(row);
										up = false;
										for (let n = 0; n < step.down; n++) yield* flush;
										if (step.cut === "put") yield* reopen;
										up = true;
										lose = step.lost;
										yield* flush;
										if (step.cut === "flush") yield* reopen;
										for (let n = 0; n < step.retries; n++) {
											yield* flush;
											if (step.cut === "retry") yield* reopen;
										}
									}
									up = true;
									lose = false;
									yield* flush;
									sameRows(rows, acked);
									const total = sent.flat().length;
									yield* flush;
									yield* reopen;
									yield* flush;
									expect(sent.flat().length).toBe(total);
									inspect();
								}).pipe(Effect.withTracer(tracer), Effect.provide(Logger.layer([logger])));
								return true;
							}),
						),
					{...checks.arbitrary, runs: 40},
				);
				expect(checked).toMatchObject({_tag: "Passed"});
			}),
		{arbitrary: {...checks.arbitrary, runs: 20}},
	);
	it.prop(
		"[secrets] plants catch pass or URL leaks in rows and diagnostics",
		{bytes: Bytes32},
		({bytes}) => {
			const raw = Buffer.from(bytes).toString("base64url");
			for (const destination of ["rows", "files", "diagnostics", "spans"])
				for (const form of secretForms(raw)) {
					expect(() => noPass(raw, {[destination]: form})).toThrow();
					expect(() =>
						noPass(raw, {[destination]: `https://test.example/#pass=${form}`}),
					).toThrow();
				}
		},
		checks,
	);
});
