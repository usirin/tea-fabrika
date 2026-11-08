import {Outcome} from "@demlik/tea";
// P34, next/. Real P11 runner, P33 manager and ledger; every wake reopens SQLite files.
// Test wiring contract: layer(descriptor, {policy, recovery:{sql,name,capacity}}).
// restart({id, build}) is the trusted H3 operation. These are implementation choices the plan
// left unnamed, not a second runner. All stepping, counts and replacement are product code.
import {Cmd, Machine} from "@demlik/tea/effect";
import {describe, expect, it} from "@effect/vitest";
import {type Context, Effect, Exit, type Layer as LayerType, Layer, Schema} from "effect";
import {TestClock} from "effect/testing";
import * as fc from "fast-check";
import {Mailbox, ProcessStore, SessionManager, Writer} from "../coordination/index.ts";
import {ProcessManager} from "../coordination/process-manager.ts";
import {
	A,
	B,
	W,
	X,
	brain,
	data,
	first,
	from,
	ids,
	read,
	storage,
	watcher,
} from "../coordination/process.test-support.ts";
import {Activity, Down, Recipient} from "../coordination/process.ts";
import {RecoveryStore} from "../coordination/recovery-store.ts";
import {Ledger, type LedgerError} from "../data/ledger.ts";
import {lineFor} from "../data/log.ts";
import {type Sql} from "../data/referee.ts";
import {
	Alarm,
	CheckedWriter,
	type Incoming,
	ProgramLoader,
	Recording,
	WatcherManager,
} from "./entry.ts";
import {type Descriptor, ProgramRunner} from "./runner.ts";

const NAME = "counter:1";
const BUILD = "build-a";
const policy = {
	maxDeliveries: 3,
	intensity: 5,
	periodMs: 5000,
	backoff: {minMs: 100, maxMs: 800, resetAfterMs: 5000},
};
const person = Writer.cases.person.make({key: "SHA256:person", for: from().for});
const Model = Schema.Struct({count: Schema.Int, replies: Schema.Int});
type Model = typeof Model.Type;
const Msg = Schema.Union([
	Schema.Struct({type: Schema.Literal("add"), n: Schema.Int}),
	Schema.Struct({type: Schema.Literal("poison"), key: Schema.String}),
	Schema.Struct({type: Schema.Literal("work")}),
	Schema.Struct({type: Schema.Literal("refuse")}),
	Schema.Struct({
		type: Schema.Literal("DOWN"),
		ref: Schema.String,
		process: Schema.String,
		why: Schema.String,
		to: Recipient,
	}),
]);
const work = Cmd.make("work", {input: Schema.Struct({}), ok: Schema.Null, err: ["failed"]});
type Wiring = {policy: typeof policy; recovery: {sql: Sql; name: string; capacity: number}};
const runnerLayer: (p: Descriptor, wiring: Wiring) => ReturnType<typeof ProgramRunner.layer> =
	ProgramRunner.layer;

const world = (personOnly = false) => {
	const ledger = storage(),
		state = storage(),
		authority = storage();
	const next = ids(A, B, W, X);
	const controls = {
		throws: true,
		savedThrows: false,
		invalid: false,
		build: BUILD,
		loads: 0,
		init: [] as Array<{build: string; loaded: unknown}>,
		steps: [] as string[],
		cmds: 0,
		adds: 0,
		crashAdd: 0,
		downs: [] as Array<typeof Down.Type>,
	};
	const alarms: Array<number | null> = [];
	const input = (id = "poison", m: unknown = {type: "poison", key: id}): Incoming => ({
		id,
		envelope: {
			id: Schema.decodeUnknownSync(Schema.NonEmptyString.pipe(Schema.brand("InputId")))(
				`in-${X}-${controls.steps.length + 1}`,
			),
			by: person,
			arrivedAt: 0,
			input: m,
		},
		sentAt: "2099-01-01T00:00:00Z",
		seen: 0,
		span: {traceId: from().traceId, spanId: "00f067aa0ba902b7"},
	});
	const makeProgram = () => {
		const machine = Machine.make({
			model: Model,
			msg: Msg,
			cmds: [work],
			init: (loaded) => {
				controls.init.push({build: controls.build, loaded});
				return [loaded ?? {count: 0, replies: 0}, []];
			},
			update: {
				add: (s, m) => {
					controls.adds++;
					if (controls.adds === controls.crashAdd) throw new RangeError("private fold failure");
					if (controls.savedThrows) throw new RangeError("private saved failure");
					return [{...s, count: s.count + m.n}, []];
				},
				poison: (s, m) => {
					controls.steps.push(m.key);
					if (controls.invalid) return [{count: Number.NaN, replies: 0}, []];
					if (controls.throws) {
						const n = controls.steps.filter((key) => key === m.key).length;
						if (n === 2) throw new RangeError("private second failure");
						throw new TypeError("private fresh failure");
					}
					return [{...s, count: s.count + 1}, []];
				},
				work: (s) => [s, [work({})]],
				refuse: (s) => [s, []],
				DOWN: (s, m) => {
					controls.downs.push(Down.make({ref: m.ref, process: m.process, why: m.why, to: m.to}));
					return [{...s, replies: s.replies + 1}, []];
				},
				work_ok: (s) => [{...s, replies: s.replies + 1}, []],
				work_err: (s) => [{...s, replies: s.replies + 1}, []],
			},
		});
		return {
			name: "counter",
			machine,
			state: {v: 1, schema: Model, upgrades: []},
			msg: Msg,
			view: {data: Model, select: (s: Model) => s},
			refuse: (_s: Model, m: typeof Msg.Type) => (m.type === "refuse" ? {why: "bad_msg"} : null),
			inputs: {
				add: {_tag: "write", schema: Msg, description: "Add", personOnly},
				poison: {_tag: "write", schema: Msg, description: "Poison", personOnly: false},
				work: {_tag: "write", schema: Msg, description: "Work", personOnly: false},
				refuse: {_tag: "write", schema: Msg, description: "Refuse", personOnly: false},
			},
			outputs: {},
			writes: {},
			wake: () => null,
		};
	};
	const base = () =>
		Layer.mergeAll(
			data(ledger.sql),
			SessionManager.layer(authority.sql, () => Effect.succeed(person), {
				input: () => false,
				fact: () => false,
			}),
		);
	const manager = () => ProcessManager.layer(brain(), next.next).pipe(Layer.provideMerge(base()));
	const layer = () => {
		const loader = Layer.effect(
			ProgramLoader,
			Effect.gen(function* () {
				const real = yield* ProgramLoader;
				return {
					load: (name: string) =>
						Effect.sync(() => {
							controls.loads++;
						}).pipe(Effect.andThen(real.load(name))),
				};
			}),
		).pipe(
			Layer.provide(
				ProgramLoader.layer(
					{counter: makeProgram()},
					{
						work: () =>
							Effect.sync(() => {
								controls.cmds++;
								return Outcome.ok(null);
							}),
					},
				),
			),
		);
		const checked = Layer.effect(
			CheckedWriter,
			Effect.gen(function* () {
				const mailbox = yield* Mailbox;
				return {
					append: (i: Incoming) =>
						mailbox.send(
							NAME,
							i.id,
							i.envelope.input,
							from({by: i.envelope.by.key, parent: i.envelope.id, sentAt: i.sentAt}),
						),
					commit: () => Effect.die("this program has no write Cmd"),
					own: () => Effect.die("this program has no own Cmd"),
				};
			}),
		).pipe(Layer.provide(Mailbox.layer));
		return runnerLayer(
			{id: A, name: NAME, program: "counter", build: controls.build, owner: person},
			{policy, recovery: {sql: state.sql, name: NAME, capacity: 1024 ** 3}},
		).pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					loader,
					ProcessStore.layer(state.sql, {process: A}),
					checked,
					Layer.succeed(WatcherManager, {publish: () => Effect.void}),
					Layer.succeed(Alarm, {
						set: (at) =>
							Effect.sync(() => {
								alarms.push(at);
							}),
					}),
					Layer.succeed(Recording, {flush: Effect.void}),
					ProcessManager.layer(brain(), next.next),
					Mailbox.layer,
				).pipe(Layer.provideMerge(base())),
			),
		);
	};
	return {
		ledger,
		state,
		authority,
		controls,
		alarms,
		input,
		base,
		manager,
		layer,
		boot: ProcessManager.use((p) => p.start(first(), from())).pipe(Effect.provide(manager())),
		reopen: () => {
			ledger.reopen();
			state.reopen();
			authority.reopen();
		},
	};
};
const lives = read(`processes/${NAME}`);
const inbox = read(`${NAME}/inbox`);
const dead = Effect.forEach([A, B, W, X], (p) => read(`${p}/dead`), {concurrency: 1}).pipe(
	Effect.map((rows) => rows.flat()),
);
const failed = <A, E, R>(e: Effect.Effect<A, E, R>) =>
	e.pipe(
		Effect.exit,
		Effect.tap((exit) => Effect.sync(() => expect(Exit.isFailure(exit)).toBe(true))),
	);
/** A letter accepted before the saved model, as P11 marks one: sent and indexed as placed. */
const accepted = (
	id: string,
	m: unknown,
	saved: {saved: unknown; turn: unknown; cmds: ReadonlyArray<unknown>} | null,
) =>
	Effect.gen(function* () {
		const sent = yield* Mailbox.use((box) => box.send(NAME, id, m, from()));
		const checkpoint = saved ?? {
			saved: {v: 1, build: BUILD, model: {count: 0, replies: 0}, after: 0},
			turn: null,
			cmds: [],
		};
		if (sent._tag === "placed")
			yield* ProcessStore.use((s) => s.save(checkpoint, [{id, rev: sent.rev, pos: sent.pos}]));
	});
const recover = (w: ReturnType<typeof world>) =>
	Effect.gen(function* () {
		const deadline = w.alarms.at(-1);
		expect(deadline, "failed process must schedule its saved recovery").toBeTypeOf("number");
		yield* TestClock.setTime(deadline!);
		yield* ProgramRunner.use((r) => r.due(deadline!)).pipe(Effect.provide(w.layer()));
	});

describe("P34 runner supervision", () => {
	it("p80 p55 plant, clear turn in handoff: person-only mail survives a successor's first failed fold", async () => {
		await fc.assert(
			fc.asyncProperty(fc.uuid(), fc.integer({min: 1, max: 1000}), (id, n) =>
				Effect.runPromise(
					Effect.gen(function* () {
						const w = world(true);
						yield* w.boot;
						yield* ProgramRunner.use((r) => failed(r.msg(w.input()))).pipe(
							Effect.provide(w.layer()),
						);
						yield* recover(w);
						// B is A's successor. Preparation succeeds; B's first accepted fold throws.
						w.controls.crashAdd = 2;
						const letter = w.input(id, {type: "add", n});
						const before = yield* Effect.gen(function* () {
							const runner = yield* ProgramRunner;
							yield* failed(runner.msg(letter));
							expect(w.controls.adds).toBe(2);
							expect((yield* lives).filter((row) => row._tag === "down")).toMatchObject([
								{body: {process: A}},
								{body: {process: B, why: "saved_letter"}},
							]);
							const store = yield* ProcessStore;
							const successor = yield* store.select(B);
							expect(yield* successor.load).toMatchObject({
								turn: {_tag: "prepared", id},
								saved: {model: {count: 0}},
							});
							expect(yield* store.placedByAny(id)).toBeNull();
							const rows = yield* inbox;
							expect(rows).toMatchObject([{id, body: {m: {type: "add", n}}}]);
							return rows;
						}).pipe(Effect.provide(w.layer()));
						w.reopen();
						yield* recover(w);
						w.reopen();
						yield* Effect.gen(function* () {
							const runner = yield* ProgramRunner;
							expect((yield* runner.open("recovered")).view).toMatchObject({count: n});
							expect(w.controls.adds).toBe(3);
							expect(yield* inbox).toEqual(before);
							expect(yield* ProcessStore.use((s) => s.placedByAny(id))).toMatchObject({
								id,
								rev: before[0]!.rev,
								pos: before[0]!.pos,
							});
							expect(yield* runner.msg(letter)).toMatchObject({_tag: "accepted"});
							expect((yield* runner.open("resend")).view).toMatchObject({count: n});
							expect(yield* dead).toEqual([]);
						}).pipe(Effect.provide(w.layer()));
					}).pipe(Effect.provide(TestClock.layer())),
				),
			),
			{
				seed: 119120,
				numRuns: 12,
				// T271 review: an appended person-only letter has a turn but no placing yet.
				examples: [["00000000-0000-4000-8000-000000000271", 7]],
			},
		);
	});

	it("P34 p79 plant, skip untyped mail: the watcher program steps on real monitor DOWN signals", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.uniqueArray(fc.uuid(), {minLength: 1, maxLength: 3}),
				fc.constantFrom("normal", "crashed", "shutdown"),
				(refs, why) =>
					Effect.runPromise(
						Effect.gen(function* () {
							const w = world();
							yield* w.boot;
							yield* ProcessManager.use((p) =>
								p.start(first("child:start", "child:1"), from()),
							).pipe(Effect.provide(w.manager()));
							const watching = ProcessManager.layer({...brain(), ...watcher(A)}, ids().next).pipe(
								Layer.provideMerge(w.base()),
							);
							for (const ref of refs)
								yield* ProcessManager.use((p) => p.monitor(ref, B, from())).pipe(
									Effect.provide(watching),
								);
							yield* ProcessManager.use((p) => p.exit(B, why, from())).pipe(
								Effect.provide(w.manager()),
							);
							const expected = refs.map((ref) =>
								Down.make({ref, process: B, why, to: Recipient.cases.process.make({process: A})}),
							);
							// Inspect the manager's actual untyped letters. The test does no translation.
							const before = yield* inbox.pipe(Effect.provide(w.manager()));
							expect(before.map((row) => row.body)).toEqual(
								expected.map((m) => expect.objectContaining({m})),
							);
							w.reopen();
							for (let wake = 0; wake < 2; wake++) {
								yield* Effect.gen(function* () {
									const runner = yield* ProgramRunner;
									expect((yield* runner.open("watcher")).view).toMatchObject({
										count: 0,
										replies: refs.length,
									});
									expect(w.controls.downs).toEqual(expected);
									expect(yield* inbox).toEqual(before);
								}).pipe(Effect.provide(w.layer()));
								w.reopen();
							}
						}),
					),
			),
			{
				seed: 119120,
				numRuns: 12,
				// T271 review: the manager writes _tag: DOWN, with no tea Msg type.
				examples: [[["00000000-0000-4000-8000-000000000271"], "crashed"]],
			},
		);
	});

	it.effect(
		"p80 bounded objects plant, keep every input in one row: a good step writes flat supervision bytes after 1 or 50 good letters without losing receipts",
		() =>
			Effect.gen(function* () {
				const w = world();
				yield* w.boot;
				// Identify P11's tables before supervision creates any. Audit all other tables,
				// whether recovery uses one JSON row or separate rows for letters and observations.
				yield* ProcessStore.use((s) => s.load).pipe(Effect.provide(w.layer()));
				const tables = () =>
					w.state.sql.exec(
						"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
					);
				const processTables = new Set(tables().map((row) => String(row.name)));
				const poison = w.input();
				yield* ProgramRunner.use((r) => failed(r.msg(poison))).pipe(Effect.provide(w.layer()));
				w.reopen();
				yield* recover(w);
				const goodId = (n: number) => `good-${String(n).padStart(3, "0")}`;
				const good = (n: number) =>
					ProgramRunner.use((r) => r.msg(w.input(goodId(n), {type: "add", n: 1}))).pipe(
						Effect.tap((answer) =>
							Effect.sync(() => expect(answer).toMatchObject({_tag: "accepted", pos: n})),
						),
						Effect.provide(w.layer()),
					);
				yield* good(1);
				const recoveryTables = tables().filter((row) => !processTables.has(String(row.name)));
				expect(recoveryTables.length, "audit must cover real supervision storage").toBeGreaterThan(
					0,
				);
				const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
				w.state.sql.exec("CREATE TEMP TABLE p34_supervision_writes (bytes INTEGER NOT NULL)");
				for (const [index, {name}] of recoveryTables.entries()) {
					const table = quote(String(name));
					const columns = w.state.sql.exec(`PRAGMA table_info(${table})`);
					for (const event of ["INSERT", "UPDATE", "DELETE"]) {
						const record = event === "DELETE" ? "OLD" : "NEW";
						const bytes = columns
							.map(({name}) => `coalesce(length(CAST(${record}.${quote(String(name))} AS BLOB)),0)`)
							.join(" + ");
						w.state.sql.exec(
							`CREATE TEMP TRIGGER ${quote(`p34_write_${index}_${event}`)} AFTER ${event} ON ${table}
							BEGIN INSERT INTO p34_supervision_writes (bytes) VALUES (${bytes}); END`,
						);
					}
				}
				const measure = (n: number) =>
					Effect.gen(function* () {
						w.state.sql.exec("DELETE FROM p34_supervision_writes");
						yield* good(n);
						const [row] = w.state.sql.exec(
							"SELECT coalesce(sum(bytes),0) AS bytes FROM p34_supervision_writes",
						);
						return Number(row?.bytes);
					});
				// Sum full row images written by SQL, not the difference in database size.
				// A growing JSON row adds a constant size but rewrites all the older inputs.
				const afterOne = yield* measure(2);
				for (let n = 3; n <= 50; n++) yield* good(n);
				const afterFifty = yield* measure(51);

				const recovery = () => RecoveryStore.layer(w.state.sql, {name: NAME, capacity: 1024 ** 3});
				w.reopen();
				yield* Effect.gen(function* () {
					const r = yield* ProgramRunner;
					expect(yield* r.msg(w.input(goodId(1), {type: "add", n: 2}))).toMatchObject({
						_tag: "refused",
						why: "id_reused",
					});
					expect(yield* r.msg(w.input(goodId(1), {type: "add", n: 1}))).toMatchObject({
						_tag: "accepted",
						pos: 1,
					});
				}).pipe(Effect.provide(w.layer()));
				expect(
					yield* RecoveryStore.use((s) => s.receipt(poison.id)).pipe(Effect.provide(recovery())),
				).toMatchObject({tries: 1, errors: ["TypeError"], result: null});
				yield* ProgramRunner.use((r) => failed(r.msg(poison))).pipe(Effect.provide(w.layer()));
				w.reopen();
				expect(
					yield* RecoveryStore.use((s) => s.receipt(poison.id)).pipe(Effect.provide(recovery())),
				).toMatchObject({tries: 2, errors: ["TypeError", "RangeError"], result: null});
				yield* recover(w);
				expect(
					yield* ProgramRunner.use((r) => r.msg(poison)).pipe(Effect.provide(w.layer())),
				).toMatchObject({_tag: "refused", why: "dead"});
				w.reopen();
				expect(
					yield* RecoveryStore.use((s) => s.input(poison.id)).pipe(Effect.provide(recovery())),
				).toEqual(poison);
				expect(
					yield* RecoveryStore.use((s) => s.receipt(poison.id)).pipe(Effect.provide(recovery())),
				).toMatchObject({
					tries: 3,
					errors: ["TypeError", "RangeError", "TypeError"],
					result: {_tag: "refused", why: "dead"},
				});
				yield* Effect.gen(function* () {
					const r = yield* ProgramRunner;
					expect(yield* r.msg(poison)).toMatchObject({_tag: "refused", why: "dead"});
					expect(
						yield* r.msg({
							...poison,
							envelope: {...poison.envelope, input: {type: "poison", key: "changed"}},
						}),
					).toMatchObject({_tag: "refused", why: "id_reused"});
					expect(w.controls.steps).toEqual(["poison", "poison", "poison"]);
					expect((yield* inbox).map((row) => row.id)).toEqual(
						Array.from({length: 51}, (_, n) => goodId(n + 1)),
					);
					expect((yield* dead).map((row) => row.body)).toMatchObject([{m: poison.id, tries: 3}]);
				}).pipe(Effect.provide(w.layer()));
				// Fixed-width IDs and identical good bodies. Allow 256 bytes for decimal
				// metadata gaining digits across all writes; never an allowance per old letter.
				expect(
					Math.abs(afterFifty - afterOne),
					`supervision bytes per good step: after 1=${afterOne}, after 50=${afterFifty}`,
				).toBeLessThanOrEqual(256);
			}),
	);

	it.effect(
		"P33 authority plant, trust forged dead row: foreign ledger data cannot manufacture a terminal answer",
		() =>
			Effect.gen(function* () {
				const w = world();
				yield* w.boot;
				w.controls.throws = false;
				yield* Effect.gen(function* () {
					yield* Ledger.use((l) =>
						l.append(
							`${A}/dead`,
							"foreign-dead",
							lineFor(from({by: "SHA256:foreign"}), {
								_tag: "dead",
								tries: 3,
								limit: 3,
								m: "poison",
								build: BUILD,
								errors: ["TypeError", "TypeError", "TypeError"],
							}),
						),
					);
					expect(yield* ProgramRunner.use((r) => r.msg(w.input()))).toMatchObject({
						_tag: "accepted",
					});
					expect(w.controls.steps).toEqual(["poison", "poison"]);
					expect((yield* inbox).map((row) => row.id)).toEqual(["poison"]);
				}).pipe(Effect.provide(w.layer()));
			}),
	);
	it.effect(
		"p25 p80 plant, append before preparation or return refusal: first two throws stay unaccepted",
		() =>
			Effect.gen(function* () {
				const w = world();
				yield* w.boot;
				for (let n = 0; n < 2; n++) {
					yield* Effect.gen(function* () {
						const r = yield* ProgramRunner;
						yield* failed(r.msg(w.input()));
						expect(yield* inbox).toEqual([]);
						expect(yield* ProcessStore.use((s) => s.load)).toBeNull();
						expect(w.controls.cmds).toBe(0);
						expect((yield* lives).filter((row) => row._tag === "exited")).toHaveLength(n + 1);
					}).pipe(Effect.provide(w.layer()));
					w.reopen();
					yield* recover(w);
				}
			}),
	);

	it.effect(
		"p80 plant, reset by process or allow try four: third throw records ordered original classes once",
		() =>
			Effect.gen(function* () {
				const w = world();
				yield* w.boot;
				for (let n = 1; n <= 3; n++) {
					yield* Effect.gen(function* () {
						const r = yield* ProgramRunner;
						const answer = yield* Effect.exit(r.msg(w.input()));
						expect(answer).toMatchObject(
							n < 3
								? {_tag: "Failure"}
								: {
										_tag: "Success",
										value: {_tag: "refused", why: "dead"},
									},
						);
					}).pipe(Effect.provide(w.layer()));
					w.reopen();
					if (n < 3) yield* recover(w);
				}
				yield* Effect.gen(function* () {
					const r = yield* ProgramRunner;
					expect(yield* dead).toMatchObject([
						{
							stream: `${W}/dead`,
							body: {
								tries: 3,
								limit: 3,
								m: "poison",
								build: BUILD,
								errors: ["TypeError", "RangeError", "TypeError"],
							},
						},
					]);
					expect(yield* r.msg(w.input())).toMatchObject({_tag: "refused", why: "dead"});
					expect(w.controls.steps).toEqual(["poison", "poison", "poison"]);
					expect(yield* inbox).toEqual([]);
					// The sender has stopped retrying. Read the original body through the real durable store.
					const path = "../coordination/recovery-store.ts";
					type Store = {input: (letter: string) => Effect.Effect<unknown, LedgerError>};
					const {
						RecoveryStore: S,
					}: {
						RecoveryStore: Context.Service<Store, Store> & {
							layer: (sql: Sql, who: {name: string; capacity: number}) => LayerType.Layer<Store>;
						};
					} = yield* Effect.promise(() => import(path));
					expect(
						yield* Effect.gen(function* () {
							return yield* (yield* S).input("poison");
						}).pipe(Effect.provide(S.layer(w.state.sql, {name: NAME, capacity: 1024 ** 3}))),
					).toMatchObject({id: "poison", envelope: {input: {type: "poison", key: "poison"}}});
				}).pipe(Effect.provide(w.layer()));
			}),
	);

	it.effect(
		"p80 plant, global count or reset on unrelated mail: interleaved IDs keep independent counts",
		() =>
			Effect.gen(function* () {
				const w = world();
				yield* w.boot;
				for (const id of ["a", "b", "a"]) {
					yield* ProgramRunner.use((r) => failed(r.msg(w.input(id)))).pipe(
						Effect.provide(w.layer()),
					);
					w.reopen();
					yield* recover(w);
					yield* ProgramRunner.use((r) =>
						r.msg(w.input(`good-${id}-${w.controls.steps.length}`, {type: "add", n: 1})),
					).pipe(Effect.provide(w.layer()));
				}
				yield* Effect.gen(function* () {
					const r = yield* ProgramRunner;
					expect(yield* r.msg(w.input("a"))).toMatchObject({_tag: "refused", why: "dead"});
					expect((yield* dead).map((row) => row.body)).toMatchObject([{m: "a", tries: 3}]);
					expect(w.controls.steps.filter((id) => id === "b")).toHaveLength(1);
				}).pipe(Effect.provide(w.layer()));
			}),
	);

	it.effect(
		"p80 plant, early or duplicate alarm: exactly one successor starts when the saved deadline arrives",
		() =>
			Effect.gen(function* () {
				const w = world();
				yield* w.boot;
				yield* Effect.gen(function* () {
					const r = yield* ProgramRunner;
					yield* failed(r.msg(w.input()));
					expect(w.alarms.at(-1)).toBe(100);
					const loads = w.controls.loads;
					yield* TestClock.setTime(99);
					yield* r.due(99);
					expect(w.controls.loads).toBe(loads);
					expect((yield* lives).filter((row) => row._tag === "restarted")).toEqual([]);
					yield* TestClock.setTime(100);
					yield* r.due(100);
					yield* r.due(100);
					expect((yield* lives).filter((row) => row._tag === "restarted")).toMatchObject([
						{body: {after: A, process: B}},
					]);
				}).pipe(Effect.provide(w.layer()));
			}),
	);

	it.effect(
		"p80 plant, ignore invalid step output: malformed fresh data consumes the same three-attempt allowance",
		() =>
			Effect.gen(function* () {
				const w = world();
				yield* w.boot;
				w.controls.invalid = true;
				for (let n = 0; n < 3; n++) {
					yield* Effect.gen(function* () {
						const answer = yield* Effect.exit(ProgramRunner.use((r) => r.msg(w.input())));
						if (n < 2) expect(Exit.isFailure(answer)).toBe(true);
						else
							expect(answer).toMatchObject({
								_tag: "Success",
								value: {_tag: "refused", why: "dead"},
							});
						expect(yield* inbox).toEqual([]);
					}).pipe(Effect.provide(w.layer()));
					w.reopen();
					if (n < 2) yield* recover(w);
				}
			}),
	);

	it.effect(
		"p80 plant, count refusal or a failed Cmd as poison: only fresh preparation failures consume attempts",
		() =>
			Effect.gen(function* () {
				const w = world();
				yield* w.boot;
				yield* Effect.gen(function* () {
					const r = yield* ProgramRunner;
					for (let n = 0; n < 4; n++)
						expect(yield* r.msg(w.input("refusal", {type: "refuse"}))).toMatchObject({
							_tag: "refused",
							why: "bad_msg",
						});
					yield* r.msg(w.input("work", {type: "work"}));
					expect(yield* dead).toEqual([]);
					expect((yield* lives).filter((row) => row._tag === "exited")).toEqual([]);
					expect(w.controls.cmds).toBe(1);
				}).pipe(Effect.provide(w.layer()));
			}),
	);

	it.effect(
		"p80 p55 plant, skip or dead-letter saved input: failure preserves the inbox and checkpoint",
		() =>
			Effect.gen(function* () {
				const w = world();
				yield* w.boot;
				yield* ProgramRunner.use((r) => r.msg(w.input("good", {type: "add", n: 7}))).pipe(
					Effect.provide(w.layer()),
				);
				let before: unknown;
				yield* Effect.gen(function* () {
					const saved = yield* ProcessStore.use((s) => s.load);
					before = saved;
					yield* accepted("saved-bad", {type: "add", n: 9}, saved);
				}).pipe(Effect.provide(w.layer()));
				w.controls.savedThrows = true;
				w.reopen();
				yield* Effect.gen(function* () {
					yield* failed(ProgramRunner.use((r) => r.open("wake")));
					expect((yield* lives).filter((row) => row._tag === "down")).toMatchObject([
						{body: {process: A, why: "saved_letter", until: expect.any(Number)}},
					]);
					expect((yield* inbox).map((row) => row.id)).toEqual(["good", "saved-bad"]);
					expect(yield* ProcessStore.use((s) => s.load)).toEqual(before);
					expect(yield* dead).toEqual([]);
				}).pipe(Effect.provide(w.layer()));
			}),
	);

	it.effect(
		"p80 plant, resend wakes down or moves until: no load, step or start before saved deadline",
		() =>
			Effect.gen(function* () {
				const w = world();
				yield* w.boot;
				yield* ProcessStore.use((s) => s.load).pipe(
					Effect.flatMap((saved) => accepted("saved", {type: "add", n: 1}, saved)),
					Effect.provide(w.layer()),
				);
				w.controls.savedThrows = true;
				yield* ProgramRunner.use((r) => failed(r.open("wake"))).pipe(Effect.provide(w.layer()));
				const loads = w.controls.loads;
				const rows = yield* lives.pipe(Effect.provide(w.manager()));
				const down = rows.find((row) => row._tag === "down");
				expect(down, "saved failure must go down").toBeDefined();
				w.reopen();
				yield* Effect.gen(function* () {
					const r = yield* ProgramRunner;
					for (let n = 0; n < 3; n++) yield* Effect.exit(r.msg(w.input()));
					expect(w.controls.loads).toBe(loads);
					expect(w.controls.steps).toEqual([]);
					expect(yield* lives).toEqual(rows);
					expect(w.alarms.at(-1)).toBe(
						Schema.decodeUnknownSync(Schema.Struct({until: Schema.Int}))(down!.body).until,
					);
				}).pipe(Effect.provide(w.layer()));
			}),
	);

	it.effect(
		"wake probe plant, constructor means crash: idle or absent marker keeps the live ID",
		() =>
			Effect.gen(function* () {
				const w = world();
				yield* w.boot;
				for (const mark of [false, true]) {
					if (mark)
						yield* ProcessStore.use((s) => s.activity(Activity.cases.idle.make({process: A}))).pipe(
							Effect.provide(w.layer()),
						);
					w.reopen();
					yield* Effect.gen(function* () {
						yield* ProgramRunner.use((r) => r.open("wake"));
						expect(yield* ProcessManager.use((p) => p.info)).toMatchObject([{process: A}]);
						expect(
							(yield* lives).filter((row) => ["exited", "restarted"].includes(row._tag)),
						).toEqual([]);
					}).pipe(Effect.provide(w.layer()));
				}
			}),
	);

	it.effect(
		"wake probe plant, startup-only handler: caught throw exits before runner reconstruction",
		() =>
			Effect.gen(function* () {
				const w = world();
				yield* w.boot;
				yield* Effect.gen(function* () {
					const r = yield* ProgramRunner;
					yield* failed(r.msg(w.input()));
					expect(yield* ProcessManager.use((p) => p.isLive(A))).toBe(false);
					expect((yield* lives).filter((row) => row._tag === "exited")).toHaveLength(1);
					expect(w.alarms.at(-1)).toBe(100);
				}).pipe(Effect.provide(w.layer()));
			}),
	);

	it.effect(
		"p80 H3 plant, reuse rejected model or old build: explicit restart calls new init and folds without old Cmds",
		() =>
			Effect.gen(function* () {
				const w = world();
				yield* w.boot;
				yield* ProgramRunner.use((r) => r.msg(w.input("accepted", {type: "add", n: 7}))).pipe(
					Effect.provide(w.layer()),
				);
				yield* ProcessStore.use((s) =>
					s.save({
						saved: {v: 999, build: BUILD, after: 0, model: {rejected: true}},
						turn: null,
						cmds: [
							{
								id: `${A}/1/0`,
								cmd: work({}),
								state: "dispatched",
								parent: null,
								traceId: from().traceId,
								build: BUILD,
							},
						],
					}),
				).pipe(Effect.provide(w.layer()));
				w.controls.build = "build-b";
				w.reopen();
				yield* Effect.gen(function* () {
					const r = yield* ProgramRunner;
					expect(r.restart, "P34 trusted Restart operation is missing").toBeTypeOf("function");
					yield* r.restart({id: "restart-explicit", build: "build-b"});
					expect(w.controls.init).toContainEqual({build: "build-b", loaded: null});
					expect((yield* r.open("new")).view).toEqual({count: 7, replies: 0});
					expect(w.controls.cmds).toBe(0);
					expect((yield* inbox).map((row) => row.id)).toEqual(["accepted"]);
					expect((yield* lives).filter((row) => row._tag === "restarted")).toMatchObject([
						{body: {after: A, build: "build-b"}},
					]);
				}).pipe(Effect.provide(w.layer()));
			}),
	);
});
