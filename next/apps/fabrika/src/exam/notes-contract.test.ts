// P8, next/. Real P11/P12 regressions. The tiny program below is exam code, not real notes.
// Source: next/packages/libfabrika/src/app/runner.test.ts at 9b48d622b5d4.
// P13 owns the real notes bindings named at the end of this file.
import {DatabaseSync} from "node:sqlite";
import {Outcome} from "@demlik/tea";
import {Cmd, Machine} from "@demlik/tea/effect";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import {expect, it} from "@effect/vitest";
import {
	Alarm,
	CheckedWriter,
	Id,
	Program,
	ProgramLoader,
	ProgramRunner,
	Recording,
	stepper,
	WatcherManager,
	type Incoming,
	type Refusal,
	type Update,
} from "@kampus/libfabrika";
import {
	Mailbox,
	Owner,
	ProcessManager,
	ProcessStore,
	Recipient,
	Start,
	Writer,
} from "@kampus/libfabrika/coordination";
import {Doorbell, Ledger, LedgerTransaction} from "@kampus/libfabrika/data";
import {nodeSql} from "@kampus/libfabrika/sqlite";
import {Arbitrary, Cause, Effect, Exit, FileSystem, Layer, Result, Schema, Stream} from "effect";
import {TestClock} from "effect/testing";

const opts = {arbitrary: {seed: 119120, runs: 300, size: 4096, concurrency: 1}};
const number = (min: number, max: number) =>
	Schema.Int.check(Schema.isBetween({minimum: min, maximum: max}));
const text = (max: number) => Schema.String.check(Schema.isMinLength(0), Schema.isMaxLength(max));
const Body = Schema.Union([
	text(4096),
	Schema.Literals(["مرحبا 🌱", "\n  trailing  \n", "# heading\n```ts\nconst n = 1;\n```", ""]),
]);
const RefusalCases = Arbitrary.schema(
	Schema.Struct({
		why: text(96),
		now: Schema.optionalKey(number(-4096, 4096)),
		most: Schema.optionalKey(number(-4096, 4096)),
		body: Body,
	}),
);
const ReplayCases = Arbitrary.array(Arbitrary.schema(Body), {minLength: 0, maxLength: 32});
const Model = Schema.Struct({body: Schema.String, version: Schema.Int});
type Model = typeof Model.Type;
const Msg = Schema.Struct({
	type: Schema.Literal("save"),
	body: Schema.String,
	base: Schema.Number,
	work: Schema.Boolean,
});
type Msg = typeof Msg.Type;
const probe = Cmd.make("probe", {input: Schema.Struct({}), ok: Schema.Null, err: []});
const empty = {body: "", version: 0};
const makeProgram = (refuse: (s: Model, m: Msg) => Refusal | null, throws = false) => {
	const machine = Machine.make({
		model: Model,
		msg: Msg,
		cmds: [probe],
		init: (loaded) => [loaded ?? empty, []],
		update: {
			save: (s, m) => {
				if (throws) throw new Error("exam saved fold failed");
				return [{body: m.body, version: s.version + 1}, m.work ? [probe({})] : []];
			},
			probe_ok: (s) => [s, []],
			probe_err: (s) => [s, []],
		},
	});
	return Program.make({
		name: "notes-exam",
		machine,
		state: {v: 1, upgrades: []},
		view: (s) => s,
		refuse,
		inputs: {save: "Exam save"},
		outputs: {},
		writes: {},
		wake: () => null,
	});
};
const person = "person_0000000000e008000000000001";
const process = Schema.decodeUnknownSync(Id.Process)("process_0000000000e008000000000001");
const writer = Writer.cases.agent.make({key: "SHA256:exam-agent", for: person});
const name = "notes-exam:1",
	build = "p8-exam";
const id = (prefix: "input" | "letter", n: number) =>
	`${prefix}_0000000000e008${n.toString(16).padStart(12, "0")}`;
const incoming = (n: number, body: string, base = 0, work = false): Incoming => ({
	id: id("letter", n),
	envelope: {
		id: Schema.decodeUnknownSync(Id.InputId)(id("input", n)),
		by: writer,
		arrivedAt: n,
		input: {type: "save", body, base, work},
	},
	sentAt: "2030-01-01T00:00:00Z",
	seen: 0,
	span: {traceId: "00000000000000000000000000000001", spanId: "0000000000000001"},
});
const world = Effect.fnUntraced(function* (
	program: ReturnType<typeof makeProgram>,
	supervised = false,
) {
	const db = yield* Effect.acquireRelease(
		Effect.sync(() => new DatabaseSync(":memory:")),
		(db) => Effect.sync(() => db.close()),
	);
	const sql = nodeSql(db);
	const quiet = Layer.succeed(Doorbell, {ring: () => Effect.void});
	const ledger = Layer.mergeAll(Ledger.sql(sql, {reader: "p8"}), LedgerTransaction.layer(sql)).pipe(
		Layer.provide(quiet),
	);
	let nextProcess = 0;
	const manager = ProcessManager.layer(
		{
			owner: Owner.cases.brain.make({}),
			recipient: Recipient.cases.client.make({client: "exam", session: process}),
			by: "SHA256:exam-brain",
		},
		Effect.sync(() => `process_0000000000e008${(++nextProcess).toString(16).padStart(12, "0")}`),
	).pipe(Layer.provide(ledger));
	const shared = Layer.mergeAll(Mailbox.layer, ProcessStore.layer(sql, {process})).pipe(
		Layer.provideMerge(ledger),
	);
	const mail = yield* Mailbox.pipe(Effect.provide(shared));
	const store = yield* ProcessStore.pipe(Effect.provide(shared));
	const log = yield* Ledger.pipe(Effect.provide(ledger));
	const updates: Update[] = [],
		calls: string[] = [];
	let blockAppend = false;
	let alarmAt: number | null = null;
	const append = (i: Incoming) =>
		mail.send(name, i.id, i.envelope.input, {
			by: i.envelope.by.key,
			for: i.envelope.by.for,
			parent: i.envelope.id,
			sentAt: i.sentAt,
			seen: i.seen,
			traceId: i.span.traceId,
			build,
		});
	const wiring = Layer.mergeAll(
		shared,
		ProgramLoader.layer(
			{"notes-exam": program},
			{
				probe: () =>
					Effect.sync(() => {
						calls.push("cmd");
						return Outcome.ok(null);
					}),
			},
		),
		Layer.succeed(CheckedWriter, {
			append: (i) => {
				calls.push("append");
				return blockAppend
					? Effect.succeed({_tag: "refused", why: "seen_ahead"} as const)
					: append(i);
			},
			commit: () => Effect.die("exam has no writes"),
			own: () => Effect.die("exam has no own writes"),
		}),
		Layer.succeed(WatcherManager, {
			publish: (_client, update) =>
				Effect.sync(() => {
					updates.push(update);
				}),
		}),
		Layer.succeed(Alarm, {
			set: (at) =>
				Effect.sync(() => {
					alarmAt = at;
				}),
		}),
		Layer.succeed(Recording, {flush: Effect.void}),
	);
	const runner = () =>
		ProgramRunner.pipe(
			Effect.provide(
				ProgramRunner.layer(
					{id: process, name, program: program.name, build, owner: writer},
					supervised ? {recovery: {sql, name, capacity: 1024 ** 3}} : undefined,
				).pipe(Layer.provide(supervised ? Layer.mergeAll(wiring, manager) : wiring)),
			),
		);
	return {
		runner,
		store,
		append,
		updates,
		calls,
		block: () => {
			blockAppend = true;
		},
		rows: () => Stream.runCollect(log.read(`${name}/inbox`, 0)),
		boot: ProcessManager.use((p) =>
			p.start(
				Start.cases.first.make({id: "p8-start", name, code: {program: program.name, hash: build}}),
				{
					by: writer.key,
					for: person,
					sentAt: "2026-11-09T00:00:00Z",
					seen: 0,
					parent: null,
					traceId: "00000000000000000000000000000001",
					build,
				},
			),
		).pipe(Effect.provide(manager)),
		recover: (runner: typeof ProgramRunner.Service) =>
			Effect.gen(function* () {
				if (alarmAt === null) return yield* Effect.die("crash has no restart alarm");
				const at = alarmAt;
				yield* TestClock.setTime(at);
				yield* runner.due(at);
			}),
		receipts: () =>
			sql
				.exec("SELECT value FROM process_receipts WHERE name=?", name)
				.map((row) => JSON.parse(String(row.value))),
		dead: () => sql.exec("SELECT * FROM entries WHERE stream LIKE '%/dead'"),
		down: () => sql.exec("SELECT * FROM entries WHERE \"_tag\"='down'"),
	};
});
const unchanged = (before: unknown, after: unknown) => expect(after).toEqual(before);
const refusal = (actual: unknown, want: Refusal) =>
	expect(actual).toEqual({_tag: "refused", ...want});
const failedAs = (exit: Exit.Exit<unknown, unknown>, why: string) => {
	expect(Exit.isFailure(exit)).toBe(true);
	if (Exit.isFailure(exit))
		expect(Cause.squash(exit.cause)).toMatchObject({_tag: "ProgramDown", why});
};
const replayRefuse = (spy: {calls: number}): never => {
	spy.calls++;
	throw new Error("refuse must not run on accepted history");
};

it.effect.prop(
	"p22: program refusal keeps why/now/most without append, view, patch or Cmd",
	{c: RefusalCases},
	({c}) =>
		Effect.gen(function* () {
			const {body, ...want} = c;
			const w = yield* world(makeProgram(() => want));
			const runner = yield* w.runner();
			const before = yield* runner.open("watcher-1");
			yield* runner.open("watcher-2");
			w.updates.length = 0;
			refusal(yield* runner.msg(incoming(1, body, 0, true)), want);
			unchanged(before, yield* runner.open("watcher-1"));
			expect(yield* w.rows()).toEqual([]);
			expect(w.updates.filter((u) => u.type === "patch")).toEqual([]);
			expect(w.calls).toEqual([]);
		}),
	opts,
);

it.prop(
	"p22: malformed fresh shapes are bad_msg; plants cannot replace program refusal",
	{c: RefusalCases},
	({c}) => {
		const {body: _body, ...want} = c;
		const pure = Result.getOrThrow(stepper(makeProgram(() => want)));
		refusal(pure.step(empty, {type: "save", body: 17}), {why: "bad_msg"});
		refusal(pure.step(empty, {type: "save", body: "", base: 0, work: false}), want);
		expect(() => refusal({_tag: "refused", why: `${want.why}!`}, want)).toThrow();
	},
	opts,
);

it.effect.prop(
	"p22: a successful fresh step cannot install or run before append succeeds",
	{body: Arbitrary.schema(text(4096))},
	({body}) =>
		Effect.gen(function* () {
			const w = yield* world(makeProgram(() => null));
			const runner = yield* w.runner(),
				before = yield* runner.open("watcher");
			w.updates.length = 0;
			w.block();
			refusal(yield* runner.msg(incoming(1, body, 0, true)), {why: "seen_ahead"});
			unchanged(before, yield* runner.open("watcher"));
			expect(yield* w.rows()).toEqual([]);
			expect(w.updates.filter((u) => u.type === "patch")).toEqual([]);
			expect(w.calls).toEqual(["append"]);
		}),
	opts,
);

it.effect.prop(
	"p25: a fresh throw is ProgramDown, never a refusal or accepted letter",
	{body: Arbitrary.schema(text(4096))},
	({body}) =>
		Effect.gen(function* () {
			const w = yield* world(makeProgram(() => null, true));
			const runner = yield* w.runner();
			yield* runner.open("watcher");
			w.updates.length = 0;
			failedAs(yield* Effect.exit(runner.msg(incoming(1, body))), "step");
			expect(yield* w.rows()).toEqual([]);
			expect(w.calls).toEqual([]);
			expect(w.updates).toEqual([]);
		}),
	opts,
);

it.effect.prop(
	"p25: accepted replay never calls refuse and original retries survive later saves",
	{bodies: ReplayCases},
	({bodies}) =>
		Effect.gen(function* () {
			const spy = {calls: 0};
			const w = yield* world(makeProgram(() => replayRefuse(spy)));
			const placed = [];
			for (const [i, body] of bodies.entries()) {
				const m = incoming(i + 1, body, i);
				const saved = yield* w.append(m);
				if (saved._tag !== "placed") return yield* Effect.die("exam seed did not append");
				placed.push({id: m.id, rev: saved.rev, pos: saved.pos});
			}
			// Mail alone is not acceptance. Persist accepted placings and the checkpoint before them.
			yield* w.store.save(
				{saved: {v: 1, build, model: empty, after: 0}, turn: null, cmds: []},
				placed,
			);
			const runner = yield* w.runner();
			expect((yield* runner.open("watcher")).view).toEqual({
				body: bodies.at(-1) ?? "",
				version: bodies.length,
			});
			for (const [i, body] of bodies.entries()) {
				const result = yield* runner.msg(incoming(i + 1, body, i));
				expect(result).toEqual({_tag: "accepted", rev: placed[i]?.rev, pos: placed[i]?.pos});
			}
			expect(spy.calls).toBe(0);
			expect(yield* w.rows()).toHaveLength(bodies.length);
			expect(w.calls).toEqual([]);
		}),
	opts,
);

it.effect.prop(
	"p25: a saved fold failure crashes and retains every accepted input",
	{body: Arbitrary.schema(text(4096))},
	({body}) =>
		Effect.gen(function* () {
			const w = yield* world(makeProgram(() => replayRefuse({calls: 0}), true));
			const m = incoming(1, body),
				placed = yield* w.append(m);
			if (placed._tag !== "placed") return yield* Effect.die("seed append refused");
			yield* w.store.save({saved: {v: 1, build, model: empty, after: 0}, turn: null, cmds: []}, [
				{id: m.id, rev: placed.rev, pos: placed.pos},
			]);
			const before = yield* w.rows(),
				runner = yield* w.runner();
			failedAs(yield* Effect.exit(runner.open("watcher")), "saved_letter");
			unchanged(before, yield* w.rows());
			expect(w.updates).toEqual([]);
		}),
	opts,
);

// Source: next/packages/libfabrika/src/workers/supervision.laws.test.ts at 9b48d622b5d4.
it.effect.prop(
	"p25: default delivery limit counts three fresh failures, then returns dead",
	{c: RefusalCases},
	({c}) =>
		Effect.gen(function* () {
			const w = yield* world(
				makeProgram(() => null, true),
				true,
			);
			yield* w.boot;
			const runner = yield* w.runner(),
				input = incoming(1, c.body);
			for (let tries = 1; tries <= 3; tries++) {
				const result = yield* Effect.exit(runner.msg(input));
				if (tries === 3) expect(result).toEqual(Exit.succeed({_tag: "refused", why: "dead"}));
				else failedAs(result, "step");
				expect(w.receipts()).toMatchObject([
					{
						tries,
						errors: Array.from({length: tries}, () => "Error"),
						result: tries === 3 ? {_tag: "refused", why: "dead"} : null,
					},
				]);
				expect(yield* w.rows()).toEqual([]);
				expect(w.dead()).toHaveLength(tries === 3 ? 1 : 0);
				if (tries < 3) yield* w.recover(runner);
			}
		}),
	opts,
);

it.effect.prop(
	"p25: saved failure restarts with backoff, no dead move and no down before the brake",
	{c: RefusalCases},
	({c}) =>
		Effect.gen(function* () {
			const w = yield* world(
				makeProgram(() => replayRefuse({calls: 0}), true),
				true,
			);
			yield* w.boot;
			const input = incoming(1, c.body),
				placed = yield* w.append(input);
			if (placed._tag !== "placed") return yield* Effect.die("seed append refused");
			yield* w.store.save({saved: {v: 1, build, model: empty, after: 0}, turn: null, cmds: []}, [
				{id: input.id, rev: placed.rev, pos: placed.pos},
			]);
			const before = yield* w.rows(),
				runner = yield* w.runner();
			failedAs(yield* Effect.exit(runner.open("watcher")), "saved_letter");
			expect(w.down()).toEqual([]);
			expect(w.dead()).toEqual([]);
			unchanged(before, yield* w.rows());
			yield* w.recover(runner).pipe(Effect.exit);
			unchanged(before, yield* w.rows());
			expect(w.dead()).toEqual([]);
			expect(w.down()).toEqual([]);
			expect(w.receipts().every((r) => r.tries === 0)).toBe(true);
		}),
	opts,
);

it.prop(
	"checker controls: append-first, patch, Cmd, changed refusal and swallowed throw plants fail",
	{c: RefusalCases},
	({c}) => {
		const {body: _body, ...want} = c;
		refusal({_tag: "refused", ...want}, want);
		unchanged(
			{log: [], model: empty, patches: [], cmds: []},
			{log: [], model: empty, patches: [], cmds: []},
		);
		for (const part of ["log", "patches", "cmds"] as const)
			expect(() => unchanged({[part]: []}, {[part]: ["planted"]})).toThrow();
		expect(() => refusal({_tag: "refused", why: "bad_msg", now: 4097}, want)).toThrow();
		expect(() => failedAs(Exit.succeed({_tag: "refused", why: "step"}), "step")).toThrow();
		expect(() => unchanged({body: "saved", version: 1}, empty)).toThrow();
	},
	opts,
);

const notesFiles = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	return yield* fs.exists(new URL("../../../../programs/notes", import.meta.url).pathname);
}).pipe(Effect.provide(NodeFileSystem.layer));
// Source presence, never a caught import error. P13 installs a test-local driver over its real
// program/runner here. These observations are exam types, not a proposed product API.
type NotesSnapshot = {
	readonly log: ReadonlyArray<unknown>;
	readonly model: unknown;
	readonly view: unknown;
	readonly patches: ReadonlyArray<unknown>;
	readonly cmds: ReadonlyArray<unknown>;
};
type SavedAnswer =
	| {readonly _tag: "accepted"; readonly rev: number; readonly pos: number}
	| {readonly _tag: "refused"; readonly why: string; readonly now?: number; readonly most?: number};
type NotesDriver = {
	readonly most: number;
	readonly snapshot: Effect.Effect<NotesSnapshot>;
	readonly save: (s: {
		readonly id: string;
		readonly note: string;
		readonly body: string;
		readonly base: number;
		readonly sentAt: string;
		readonly by: typeof writer;
	}) => Effect.Effect<SavedAnswer>;
	readonly frozen: Effect.Effect<{
		readonly a3: SavedAnswer;
		readonly a4: SavedAnswer;
		readonly retryA3: SavedAnswer;
		readonly staleA3: SavedAnswer;
		readonly history: ReadonlyArray<{
			readonly note: string;
			readonly version: number;
			readonly body: string;
		}>;
		readonly final: ReadonlyArray<{
			readonly note: string;
			readonly version: number;
			readonly body: string;
		}>;
		readonly refuseCalls: number;
	}>;
};
const requireNotes = (): NotesDriver => {
	throw new Error(
		"P13 started: bind the real notes program, store and MOST before its build; missing bindings are a failure",
	);
};
const notes = Effect.fnUntraced(function* (ctx: {skip: (reason?: string) => never}) {
	if (!(yield* notesFiles)) ctx.skip("not built: P13 notes");
	return requireNotes();
});
const note = "note_0000000000e008000000000001";
const saveInput = (n: number, body: string, base: number) => ({
	id: id("letter", n),
	note,
	body,
	base,
	sentAt: "2030-01-01T00:00:00Z",
	by: writer,
});
const accepted = (a: SavedAnswer) => {
	expect(a._tag).toBe("accepted");
	return a;
};
const unchangedNotes = (before: NotesSnapshot, after: NotesSnapshot) =>
	expect(after).toEqual(before);

it.effect.prop(
	"not built: P13 / p52 saves exact bytes and writer; skewed writer clocks never decide",
	{c: RefusalCases},
	({c}, ctx) =>
		Effect.gen(function* () {
			const a = yield* notes(ctx),
				b = requireNotes();
			accepted(yield* a.save(saveInput(1, c.body, 0)));
			accepted(yield* b.save({...saveInput(1, c.body, 0), sentAt: "1990-01-01T00:00:00Z"}));
			const left = yield* a.snapshot,
				right = yield* b.snapshot;
			expect(left.model).toEqual(right.model);
			expect(left.view).toEqual(right.view);
			expect(left.log).toHaveLength(1);
			expect(left.log[0]).toMatchObject({
				by: writer.key,
				for: writer.for,
				sentAt: "2030-01-01T00:00:00Z",
				body: {m: {type: "save", value: {body: c.body}}},
			});
		}),
	opts,
);
it.effect.prop(
	"not built: P13 / p53 retries after later saves, distinct IDs with equal bodies and repeated refusals",
	{bodies: ReplayCases},
	({bodies}, ctx) =>
		Effect.gen(function* () {
			const d = yield* notes(ctx),
				body = bodies.join("\n").slice(0, 4096);
			const original = accepted(yield* d.save(saveInput(1, body, 0)));
			accepted(yield* d.save(saveInput(2, body, 1)));
			const before = yield* d.snapshot;
			expect(before.log).toHaveLength(2);
			expect(yield* d.save(saveInput(1, body, 0))).toEqual(original);
			unchangedNotes(before, yield* d.snapshot);
			for (let i = 0; i < 2; i++) {
				expect(yield* d.save(saveInput(3, body, 0))).toEqual({
					_tag: "refused",
					why: "changed_elsewhere",
					now: 2,
				});
				unchangedNotes(before, yield* d.snapshot);
			}
		}),
	opts,
);
const BaseCases = Arbitrary.schema(
	Schema.Struct({
		version: number(0, 64),
		numerator: number(-64, 64),
		denominator: number(2, 8),
		future: number(2, 64),
		body: text(4096),
	}),
);
it.effect.prop(
	"not built: P13 / p54 every unequal base, including zero, negative, fractional and future",
	{c: BaseCases},
	({c}, ctx) =>
		Effect.gen(function* () {
			const d = yield* notes(ctx);
			accepted(yield* d.save(saveInput(1, c.body, 0)));
			const before = yield* d.snapshot;
			for (const base of [0, -1, -64, c.future, c.numerator / c.denominator, c.version]) {
				if (base === 1) continue;
				expect(yield* d.save(saveInput(2, c.body, base))).toMatchObject({_tag: "refused"});
				unchangedNotes(before, yield* d.snapshot);
			}
		}),
	opts,
);
it.effect.prop(
	"not built: P13 / p54 concurrent same-base saves accept exactly one",
	{c: RefusalCases},
	({c}, ctx) =>
		Effect.gen(function* () {
			const d = yield* notes(ctx);
			const answers = yield* Effect.all(
				[d.save(saveInput(1, c.body, 0)), d.save(saveInput(2, `${c.body}!`, 0))],
				{concurrency: 2},
			);
			expect(answers.filter((a) => a._tag === "accepted")).toHaveLength(1);
			expect(answers.filter((a) => a._tag === "refused")).toEqual([
				{_tag: "refused", why: "changed_elsewhere", now: 1},
			]);
			expect((yield* d.snapshot).log).toHaveLength(1);
		}),
	opts,
);
it.effect.prop(
	"not built: P13 / p54 bodies on both sides of notes' actual MOST",
	{c: BaseCases},
	(_c, ctx) =>
		Effect.gen(function* () {
			const first = yield* notes(ctx);
			expect(first.most).toBeGreaterThan(0);
			for (const length of [first.most - 1, first.most, first.most + 1]) {
				const d = requireNotes(),
					before = yield* d.snapshot;
				const a = yield* d.save(saveInput(1, "a".repeat(length), 0));
				if (length <= d.most) accepted(a);
				else {
					expect(a).toMatchObject({_tag: "refused", most: d.most});
					unchangedNotes(before, yield* d.snapshot);
				}
			}
		}),
	opts,
);
it.effect(
	"not built: P13 / format: frozen A3 replay/retry/stale and independent per-note history",
	(ctx) =>
		Effect.gen(function* () {
			const d = yield* notes(ctx),
				actual = yield* d.frozen;
			expect(actual.a3).toMatchObject({_tag: "accepted"});
			expect(actual.a4).toMatchObject({_tag: "accepted"});
			expect(actual.retryA3).toEqual(actual.a3);
			expect(actual.staleA3).toEqual({_tag: "refused", why: "changed_elsewhere", now: 4});
			expect(actual.refuseCalls).toBe(0);
			expect(actual.history.map((h) => h.version)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
			expect(actual.history.map((h) => h.body)).toEqual([
				"",
				"B trailing  ",
				"A\nsecond line\n",
				"B 🌱",
				"A مرحبا\n```ts\nconst n = 3;\n```  ",
				"B kept from A",
				"A final  \n",
				"B final 🧪\nשלום",
			]);
			expect(actual.final).toEqual([
				{note: "note_0000000000e008000000000002", version: 4, body: "B final 🧪\nשלום"},
				{note, version: 4, body: "A final  \n"},
			]);
		}),
);

it.prop(
	"P13 checker controls/plants: replace row, duplicate-by-body, base-before-ID and less-than guard fail",
	{c: BaseCases},
	({c}) => {
		const first = {id: id("letter", 1), body: c.body},
			second = {id: id("letter", 2), body: c.body};
		const before: NotesSnapshot = {
			log: [first, second],
			model: {version: 2},
			view: {version: 2},
			patches: [],
			cmds: [],
		};
		unchangedNotes(before, structuredClone(before));
		for (const bad of [
			{...before, log: [second]},
			{...before, log: [first]},
			{...before, model: {version: 3}},
			{...before, patches: ["future base accepted"]},
		])
			expect(() => unchangedNotes(before, bad)).toThrow();
		const original: SavedAnswer = {_tag: "accepted", rev: 3, pos: 1};
		expect(() => expect({_tag: "refused", why: "changed_elsewhere"}).toEqual(original)).toThrow();
	},
	opts,
);
