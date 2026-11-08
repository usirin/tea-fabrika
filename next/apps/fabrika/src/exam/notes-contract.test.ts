// P8, next/. p22: a program refusal keeps why/now/most; no accepted input, view change or Cmd.
// p25: a fresh throw is a failure with no accepted input. A fold failure keeps every letter.
// P34 owns counting crashes and recovery. This P11 probe is not the unbuilt P13 notes program.
import {existsSync, readdirSync} from "node:fs";
import {resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {Outcome} from "@demlik/tea";
import {Cmd, Machine} from "@demlik/tea/effect";
import {
	Alarm,
	CheckedWriter,
	Incoming,
	ProgramLoader,
	ProgramRunner,
	Recording,
	type Sent,
	type Update,
	WatcherManager,
} from "@kampus/libfabrika";
import {Mailbox, ProcessStore, Writer} from "@kampus/libfabrika/coordination";
import {
	Archive,
	Doorbell,
	Ledger,
	LedgerError,
	RecordManager,
	SpanSink,
} from "@kampus/libfabrika/data";
import {nodeSql} from "@kampus/libfabrika/sqlite";
import {Cause, Effect, Exit, Layer, Schema, Stream} from "effect";
import {describe, expect, it} from "vitest";

const PID = "process_01jc9q4w7z3m8n5r2t6v0xkb4d";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const Save = Schema.Struct({
	type: Schema.Literal("save"),
	value: Schema.Struct({note: Schema.String, base: Schema.Int, body: Schema.String}),
});
const Msg = Schema.Union([Save, Schema.Struct({type: Schema.Literal("throw")})]);
const Model = Schema.Struct({version: Schema.Int, body: Schema.String});
type Model = typeof Model.Type;
const initial: Model = {version: 0, body: ""};
const ping = Cmd.make("ping", {input: Schema.Struct({}), ok: Schema.Null, err: []});
const machine = Machine.make({
	model: Model,
	msg: Msg,
	cmds: [ping],
	init: (saved) => [saved ?? initial, []],
	update: {
		save: (s, m) => [{version: s.version + 1, body: m.value.body}, [ping({})]],
		throw: () => {
			throw new Error("planted fresh step failure");
		},
		ping_ok: (s) => [s, []],
		ping_err: (s) => [s, []],
	},
});
const declaration = {
	name: "notes-probe",
	machine,
	state: {v: 1, schema: Model, upgrades: []},
	msg: Msg,
	view: {data: Model, select: (s: Model) => s},
	refuse: (s: Model, m: typeof Msg.Type) =>
		m.type === "save" && m.value.base !== s.version
			? {why: "changed_elsewhere", now: s.version, most: 100}
			: null,
	inputs: {
		save: {_tag: "write", schema: Save, description: "Save", personOnly: false},
		throw: {_tag: "write", schema: Msg, description: "Fail", personOnly: false},
	},
	outputs: {},
	writes: {},
	wake: () => null,
};
const save = (base: number, body = "same body") =>
	Save.make({type: "save", value: {note: "a", base, body}});
const input = (n: number, m: unknown): Incoming =>
	Schema.decodeUnknownSync(
		Schema.Struct({
			id: Schema.String,
			envelope: Schema.Struct({
				id: Schema.String.pipe(Schema.brand("InputId")),
				by: Writer,
				arrivedAt: Schema.Number,
				input: Schema.Unknown,
			}),
			sentAt: Schema.String,
			seen: Schema.Int,
			span: Schema.Struct({traceId: Schema.String, spanId: Schema.String}),
		}),
	)({
		id: `p8-${n}`,
		envelope: {
			id: `in-${PID}-${n}`,
			by: Writer.cases.agent.make({key: "SHA256:exam-agent", for: "exam-person"}),
			arrivedAt: 1000 + n,
			input: m,
		},
		sentAt: "2026-11-08T10:00:00Z",
		seen: 0,
		span: {traceId: TRACE, spanId: "00f067aa0ba902b7"},
	});

// The outside edges collect notifications and run a harmless Cmd. All step, storage, replay,
// placing and refusal decisions below belong to P11's real ProgramRunner and ProcessStore.
const world = () => {
	const db = new DatabaseSync(":memory:");
	const sql = nodeSql(db);
	const updates: Update[] = [];
	let calls = 0;
	const ledger = Ledger.sql(sql, {reader: "p8"}).pipe(
		Layer.provide(Layer.succeed(Doorbell, {ring: () => Effect.void})),
	);
	const mailbox = Mailbox.layer.pipe(Layer.provide(ledger));
	const store = ProcessStore.layer(sql, {process: PID}).pipe(Layer.provide(ledger));
	const base = Layer.mergeAll(ledger, mailbox, store);
	const recording = Recording.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				SpanSink.layer(sql, {object: PID}),
				RecordManager.sql(() => sql, 64 * 1024),
				Archive.memory,
			),
		),
	);
	const wiring = Layer.mergeAll(
		ProgramLoader.layer(
			{"notes-probe": declaration},
			{
				ping: () =>
					Effect.sync(() => {
						calls++;
						return Outcome.ok(null);
					}),
			},
		),
		Layer.succeed(WatcherManager, {
			publish: (_client, update) =>
				Effect.sync(() => {
					updates.push(update);
				}),
		}),
		Layer.succeed(Alarm, {set: () => Effect.void}),
		recording,
		Layer.effect(
			CheckedWriter,
			Mailbox.pipe(
				Effect.map((m) => ({
					append: (i: Incoming) =>
						m.send("notes:1", i.id, i.envelope.input, {
							by: i.envelope.by.key,
							for: i.envelope.by.for,
							sentAt: i.sentAt,
							seen: i.seen,
							parent: i.envelope.id,
							traceId: i.span.traceId,
							build: "p8-probe",
						}),
					commit: () => Effect.die("probe has no fact writes"),
					own: () => Effect.die("probe has no own writes"),
				})),
			),
		),
	).pipe(Layer.provideMerge(base));
	const runner = ProgramRunner.layer({
		id: PID,
		name: "notes:1",
		program: "notes-probe",
		build: "p8-probe",
		owner: Writer.cases.person.make({key: "SHA256:owner", for: "exam-person"}),
	}).pipe(Layer.provideMerge(wiring));
	return {db, base, runner, updates, calls: () => calls};
};
const history = Mailbox.use((m) => Stream.runCollect(m.read("notes:1", 0)));
const fail = <A, E, R>(work: Effect.Effect<A, E, R>) =>
	work.pipe(
		Effect.exit,
		Effect.map((e) => {
			expect(Exit.isFailure(e), "a throw must stay in the failure channel").toBe(true);
			return Exit.isFailure(e) ? Cause.squash(e.cause) : null;
		}),
	);
type Runner = typeof ProgramRunner.Service;
type Change = (
	real: Runner,
	w: ReturnType<typeof world>,
) => Omit<Runner, "msg"> & {
	readonly msg: (
		input: unknown,
	) => Effect.Effect<Sent, Effect.Error<ReturnType<Runner["msg"]>>, CheckedWriter>;
};
const unchanged: Change = (r) => r;
const freshRefusal = (change: Change) => {
	const w = world();
	return Effect.gen(function* () {
		const r = change(yield* ProgramRunner, w);
		yield* r.open("watch");
		const before = yield* history;
		const shown = structuredClone(w.updates);
		expect(yield* r.msg(input(1, save(5))), "program's changed_elsewhere reason survives").toEqual({
			_tag: "refused",
			why: "changed_elsewhere",
			now: 0,
			most: 100,
		});
		expect(yield* history, "no accepted input on refusal").toEqual(before);
		expect(w.updates, "no patch on refusal").toEqual(shown);
		expect(w.calls(), "no Cmd on refusal").toBe(0);
	}).pipe(Effect.provide(w.runner), Effect.ensuring(Effect.sync(() => w.db.close())));
};
const duplicate = (change: Change) => {
	const w = world();
	return Effect.gen(function* () {
		const r = change(yield* ProgramRunner, w);
		const first = input(1, save(0));
		const placed = yield* r.msg(first);
		expect(placed._tag).toBe("accepted");
		yield* r.msg(input(2, save(1, "later")));
		const before = yield* history;
		expect(yield* r.msg(first), "duplicate returns its first placing").toEqual(placed);
		expect(yield* history).toEqual(before);
		// Identical bodies with distinct letters are separate accepted saves.
		expect((yield* r.msg(input(3, save(2, "later"))))._tag).toBe("accepted");
		expect(
			(yield* r.open("read")).view,
			"equal bodies with distinct IDs remain separate saves",
		).toEqual({version: 3, body: "later"});
	}).pipe(Effect.provide(w.runner), Effect.ensuring(Effect.sync(() => w.db.close())));
};
const stale = (change: Change) => {
	const w = world();
	return Effect.gen(function* () {
		const r = change(yield* ProgramRunner, w);
		yield* r.open("watch");
		yield* r.msg(input(1, save(0)));
		for (const base of [0, 2]) {
			const before = yield* history,
				shown = structuredClone(w.updates),
				calls = w.calls();
			expect(
				yield* r.msg(input(10 + base, save(base))),
				"base must equal the true version",
			).toEqual({_tag: "refused", why: "changed_elsewhere", now: 1, most: 100});
			expect(yield* history).toEqual(before);
			expect(w.updates, "no patch on refusal").toEqual(shown);
			expect(w.calls()).toBe(calls);
		}
	}).pipe(Effect.provide(w.runner), Effect.ensuring(Effect.sync(() => w.db.close())));
};

const failureLaw = (change: Change, saved: boolean) => {
	const w = world();
	return Effect.gen(function* () {
		const r = change(yield* ProgramRunner, w);
		if (!saved) {
			yield* r.open("watch");
			expect(yield* fail(r.msg(input(1, {type: "throw"})))).toMatchObject({
				_tag: "ProgramDown",
				why: "step",
			});
			expect(yield* history).toEqual([]);
			expect(w.updates).toHaveLength(1);
		} else {
			const m = yield* Mailbox,
				store = yield* ProcessStore;
			const receipts = [];
			for (const [i, msg] of [save(0), {type: "throw"}, save(1)].entries()) {
				const sent = yield* m.send("notes:1", `saved-${i}`, msg, {
					by: "SHA256:old",
					for: "exam-person",
					sentAt: "old-clock",
					seen: 0,
					parent: null,
					traceId: TRACE,
					build: "old",
				});
				if (sent._tag === "refused") return yield* new LedgerError({why: "refused"});
				receipts.push({id: `saved-${i}`, rev: sent.rev, pos: sent.pos});
			}
			yield* store.save(
				{saved: {v: 1, build: "p8-probe", model: initial, after: 0}, turn: null, cmds: []},
				receipts,
			);
			const before = yield* history;
			expect(yield* fail(r.open("watch"))).toMatchObject({
				_tag: "ProgramDown",
				why: "saved_letter",
			});
			expect(yield* history).toEqual(before);
			expect(w.updates).toEqual([]);
		}
		expect(w.calls()).toBe(0);
	}).pipe(Effect.provide(w.runner), Effect.ensuring(Effect.sync(() => w.db.close())));
};

describe("P11 notes-shaped contract probe", () => {
	it("p22 fresh program refusal keeps its fields and changes nothing accepted", () =>
		Effect.runPromise(freshRefusal(unchanged)));
	it("p53 accepted duplicate survives later saves; equal bodies are not duplicates", () =>
		Effect.runPromise(duplicate(unchanged)));
	it("p54 stale and ahead bases both report the true current version and publish nothing", () =>
		Effect.runPromise(stale(unchanged)));
	it("p25 a fresh reducer throw is ProgramDown, not a refusal", () =>
		Effect.runPromise(failureLaw(unchanged, false)));
	it("p25 accepted poison is retained on fold failure, including all later letters", () =>
		Effect.runPromise(failureLaw(unchanged, true)));
	it("plant p22: replacing the program reason with bad_msg is caught", async () => {
		await expect(
			Effect.runPromise(
				freshRefusal((r) => ({
					...r,
					msg: (i) =>
						r.msg(i).pipe(Effect.map((s) => (s._tag === "refused" ? {...s, why: "bad_msg"} : s))),
				})),
			),
		).rejects.toThrow(/changed_elsewhere/);
	});
	it("plant p22: append before refusal is caught", async () => {
		await expect(
			Effect.runPromise(
				freshRefusal((r) => ({
					...r,
					msg: (i) =>
						CheckedWriter.use((c) => c.append(Schema.decodeUnknownSync(Incoming)(i))).pipe(
							Effect.andThen(r.msg(i)),
						),
				})),
			),
		).rejects.toThrow(/no accepted input/);
	});
	it("plant p53: checking base before duplicate ID is caught", async () => {
		await expect(
			Effect.runPromise(
				duplicate((r) => ({
					...r,
					msg: (raw) => {
						const i = Schema.decodeUnknownSync(Incoming)(raw);
						return r
							.open("probe")
							.pipe(
								Effect.flatMap(({view}) =>
									Schema.is(Save)(i.envelope.input) &&
									i.envelope.input.value.base !== Schema.decodeUnknownSync(Model)(view).version
										? Effect.succeed<Sent>({_tag: "refused", why: "changed_elsewhere"})
										: r.msg(i),
								),
							);
					},
				})),
			),
		).rejects.toThrow(/duplicate returns/);
	});
	it("plant p53: deduplicating by body is caught", async () => {
		await expect(
			Effect.runPromise(
				duplicate((r) => {
					const prior = new Map<string, Sent>();
					return {
						...r,
						msg: (raw) => {
							const i = Schema.decodeUnknownSync(Incoming)(raw),
								m = Schema.decodeUnknownSync(Save)(i.envelope.input);
							const old = prior.get(m.value.body);
							return old
								? Effect.succeed(old)
								: r.msg(i).pipe(
										Effect.tap((sent) =>
											Effect.sync(() => {
												prior.set(m.value.body, sent);
											}),
										),
									);
						},
					};
				}),
			),
		).rejects.toThrow(/distinct IDs/);
	});
	it("plant p54: comparing base with less-than accepts an ahead base", async () => {
		await expect(
			Effect.runPromise(
				stale((r) => ({
					...r,
					msg: (raw) => {
						const i = Schema.decodeUnknownSync(Incoming)(raw),
							m = Schema.decodeUnknownSync(Save)(i.envelope.input);
						return m.value.base > 1
							? Effect.succeed<Sent>({_tag: "accepted", rev: 99, pos: 99})
							: r.msg(i);
					},
				})),
			),
		).rejects.toThrow(/base must equal/);
	});
	it("plant p25: converting a thrown step to refusal fails the failure-channel check", async () => {
		const bad = failureLaw(
			(r) => ({
				...r,
				msg: (i) =>
					r
						.msg(i)
						.pipe(Effect.catch(() => Effect.succeed<Sent>({_tag: "refused", why: "bad_msg"}))),
			}),
			false,
		);
		await expect(Effect.runPromise(bad)).rejects.toThrow(/failure channel/);
	});
	it("plant p25: skipping a saved poison letter fails the fold-failure check", async () => {
		const bad = failureLaw(
			(r) => ({
				...r,
				open: (client) =>
					r
						.open(client)
						.pipe(Effect.catch(() => Effect.succeed({rev: 3, view: {version: 2, body: "later"}}))),
			}),
			true,
		);
		await expect(Effect.runPromise(bad)).rejects.toThrow(/failure channel/);
	});
	it("plant p54: publishing a patch for refusal is caught", async () => {
		await expect(
			Effect.runPromise(
				stale((r, w) => ({
					...r,
					msg: (i) =>
						r.msg(i).pipe(
							Effect.tap((s) =>
								Effect.sync(() => {
									if (s._tag === "refused")
										w.updates.push({type: "patch", base: 1, rev: 1, patch: []});
								}),
							),
						),
				})),
			),
		).rejects.toThrow(/no patch on refusal/);
	});
});

// Exam coverage is independent of module loading. An import error is never "not built".
const sources = (dir: string): string[] =>
	!existsSync(dir)
		? []
		: readdirSync(dir, {withFileTypes: true}).flatMap((e) =>
				e.isDirectory()
					? sources(resolve(dir, e.name))
					: /(?<!\.test)\.tsx?$/.test(e.name)
						? [resolve(dir, e.name)]
						: [],
			);
const notes = resolve(import.meta.dirname, "../../../../programs/notes");
it("P13 notes compatibility binding", (ctx) => {
	if (sources(notes).length === 0)
		return ctx.skip("not built: P13 real notes; P11 probe above is not notes coverage");
	throw new Error(
		"P13 source exists: require its complete notes target, declared dependency and compatibility binding; never report an import failure as absent",
	);
});
