// P34, next/. The real door delivers to the real P11 runner and P33 manager on SQLite files.
// P34 extends delivery's callback with {id,sentAt,seen}; its result is the runner's Sent.
import {createHash, generateKeyPairSync, sign} from "node:crypto";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {Machine} from "@demlik/tea/effect";
import {afterAll, describe, expect, it} from "@effect/vitest";
import * as A from "@kampus/libfabrika";
import * as C from "@kampus/libfabrika/coordination";
import {
	Archive,
	Doorbell,
	Ledger,
	LedgerError,
	LedgerTransaction,
	RecordManager,
	SinkError,
	SpanSink,
	type Sql,
} from "@kampus/libfabrika/data";
import {nodeSql} from "@kampus/libfabrika/sqlite";
import {Effect, Layer, Schema, Stream} from "effect";
import {TestClock} from "effect/testing";
import * as fc from "fast-check";
import {Door} from "./door.ts";

const P1 = "process_0000000000e008000000000000";
const P2 = "process_0000000000e008000000000001";
const P3 = "process_0000000000e008000000000002";
const START = "process_0000000000e008000000000003";
const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const NAME = "counter:1";
const URL = "https://fabrika.test/entry/project-socket";
const top = mkdtempSync(join(tmpdir(), "p34-door-"));
const opened: DatabaseSync[] = [];

afterAll(() => {
	for (const db of opened) if (db.isOpen) db.close();
	rmSync(top, {recursive: true, force: true});
});

let file = 0;

const disk = () => {
	const path = join(top, `${++file}.db`);
	let db = new DatabaseSync(path);
	opened.push(db);
	let inner = nodeSql(db);
	const sql: Sql = {
		exec: (q, ...args) => inner.exec(q, ...args),
		transaction: (f) => inner.transaction(f),
		size: () => inner.size(),
	};
	return {
		sql,
		reopen: () => {
			db.close();
			db = new DatabaseSync(path);
			opened.push(db);
			inner = nodeSql(db);
		},
	};
};

const field = (value: string | Uint8Array) => {
	const b = typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
	const size = Buffer.alloc(4);
	size.writeUInt32BE(b.length);
	return Buffer.concat([size, b]);
};

const key = () => {
	const pair = generateKeyPairSync("ed25519");
	const bytes = pair.publicKey.export({format: "der", type: "spki"}).subarray(-32);
	const blob = Buffer.concat([field("ssh-ed25519"), field(bytes)]);
	const fingerprint = (value: Uint8Array) =>
		`SHA256:${createHash("sha256").update(value).digest("base64").replace(/=+$/, "")}`;
	return {
		raw: bytes.toString("base64url"),
		line: `ssh-ed25519 ${blob.toString("base64")}`,
		fingerprint: fingerprint(bytes),
		sshFingerprint: fingerprint(blob),
		sign: (text: string) => {
			const signed = Buffer.concat([
				Buffer.from("SSHSIG"),
				field("fabrika-client"),
				field(""),
				field("sha512"),
				field(createHash("sha512").update(text).digest()),
			]);
			const version = Buffer.alloc(4);
			version.writeUInt32BE(1);
			const packed = Buffer.concat([
				Buffer.from("SSHSIG"),
				version,
				field(blob),
				field("fabrika-client"),
				field(""),
				field("sha512"),
				field(Buffer.concat([field("ssh-ed25519"), field(sign(null, signed, pair.privateKey))])),
			]);
			return `-----BEGIN SSH SIGNATURE-----\n${packed.toString("base64")}\n-----END SSH SIGNATURE-----\n`;
		},
	};
};

const from = () => ({
	by: "SHA256:brain",
	for: PERSON,
	sentAt: "2026-11-08T00:00:00Z",
	seen: 0,
	parent: null,
	traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
	build: "build-a",
});

const Input = Schema.TaggedUnion({press: {poison: Schema.Boolean}});
type DoorOptions = Parameters<typeof Door.layer<typeof Input.Type, never, never, never>>[0];
type Delivery = {process: string; parent: string; letter: string | undefined};

const policy = {
	maxDeliveries: 3,
	intensity: 5,
	periodMs: 5000,
	backoff: {minMs: 100, maxMs: 800, resetAfterMs: 5000},
};

const world = () => {
	const project = disk(),
		process = disk();
	const partFiles = new Map<string, ReturnType<typeof disk>>();
	const window = key();
	const other = key();
	const founder = {
		name: "Recovery test",
		person: PERSON,
		keys: [window.line],
		window: window.raw,
		by: window.sshFingerprint,
		build: "build-a",
	};
	const owner = C.Writer.cases.person.make({key: window.fingerprint, for: PERSON});
	const deliveries: Delivery[] = [];
	const alarms: Array<number | null> = [];
	let ids = 0;
	const processIds = Effect.runSync(A.Id.Generator.pipe(Effect.provide(A.Id.Generator.layer)));
	let steps = 0;
	const controls = {
		throws: true,
		cutRetryable: false,
		retryableCuts: 0,
		cutRecorded: false,
		cutFlush: false,
		cuts: 0,
		failDelivery: false,
	};
	const Model = Schema.Struct({count: Schema.Int});
	type Model = typeof Model.Type;
	// Wire inputs use _tag, tea uses type. The program's Msg keeps tea's own tag.
	const TeaMsg = Schema.Struct({type: Schema.Literal("press"), poison: Schema.Boolean});
	const tea = Machine.make({
		model: Model,
		msg: TeaMsg,
		cmds: [],
		init: (s) => [s ?? {count: 0}, []],
		update: {
			press: (s, m) => {
				steps++;
				if (m.poison && controls.throws) throw new TypeError("private door failure");
				return [{count: s.count + 1}, []];
			},
		},
	});
	const program = {
		name: "counter",
		machine: tea,
		state: {v: 1, schema: Model, upgrades: []},
		msg: TeaMsg,
		view: {data: Model, select: (s: Model) => s},
		refuse: () => null,
		inputs: {
			press: {_tag: "write", schema: TeaMsg, description: "Press", personOnly: false},
		},
		outputs: {},
		writes: {},
		wake: () => null,
	};
	const quiet = Layer.succeed(Doorbell, {ring: () => Effect.void});
	const data = () =>
		Layer.mergeAll(
			Ledger.sql(project.sql, {reader: "recovery-test"}),
			LedgerTransaction.layer(project.sql),
		).pipe(Layer.provide(quiet));
	const records = RecordManager.sql((name) => {
		let p = partFiles.get(name);
		if (p === undefined) {
			p = disk();
			partFiles.set(name, p);
		}
		return p.sql;
	}, 1024 ** 3);
	const manager = () =>
		C.ProcessManager.layer(
			{
				owner: C.Owner.cases.brain.make({}),
				recipient: C.Recipient.cases.client.make({client: "window", session: START}),
				by: "SHA256:brain",
			},
			Effect.sync(() => {
				const next = [P1, P2, P3][ids++];
				if (next === undefined) throw new Error("unexpected fourth successor");
				return next;
			}),
		).pipe(Layer.provideMerge(data()));
	const env = () =>
		Layer.mergeAll(
			data(),
			C.ClientManager.layer(founder).pipe(Layer.provide(data())),
			records,
			Archive.memory,
			A.Id.Generator.layer,
			Layer.effect(
				SpanSink,
				Effect.gen(function* () {
					const real = yield* SpanSink;
					return {
						...real,
						flush: Effect.suspend(() => {
							if (!controls.cutFlush) return real.flush;
							controls.cutFlush = false;
							controls.cuts++;
							return Effect.fail(new SinkError({why: "storage", held: 0}));
						}),
					};
				}),
			).pipe(Layer.provideMerge(SpanSink.layer(project.sql, {object: START}))),
			manager(),
		);
	const runner = (pid: string) => {
		const layer: (
			p: Parameters<typeof A.ProgramRunner.layer>[0],
			options: {policy: typeof policy; recovery: {sql: Sql; name: string; capacity: number}},
		) => ReturnType<typeof A.ProgramRunner.layer> = A.ProgramRunner.layer;
		return layer(
			{id: pid, name: NAME, program: "counter", build: "build-a", owner},
			{policy, recovery: {sql: process.sql, name: NAME, capacity: 1024 ** 3}},
		).pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					A.ProgramLoader.layer({counter: program}, {}),
					C.ProcessStore.layer(process.sql, {process: pid}),
					C.Mailbox.layer,
					Layer.effect(
						A.CheckedWriter,
						Effect.gen(function* () {
							const m = yield* C.Mailbox;
							return {
								append: (i: A.Incoming) =>
									m.send(NAME, i.id, i.envelope.input, {...from(), parent: i.envelope.id}),
								commit: () => Effect.die("no writes"),
								own: () => Effect.die("no writes"),
							};
						}),
					).pipe(Layer.provide(C.Mailbox.layer)),
					Layer.succeed(A.WatcherManager, {publish: () => Effect.void}),
					Layer.succeed(A.Alarm, {
						set: (at) =>
							Effect.sync(() => {
								alarms.push(at);
							}),
					}),
					Layer.succeed(A.Recording, {flush: Effect.void}),
				).pipe(Layer.provideMerge(env())),
			),
		);
	};
	// Lose the retryable save after the real runner fails, keeping the prior delivered row.
	const doorSql: Sql = {
		...project.sql,
		exec: (query, ...args) => {
			if (
				controls.cutRecorded &&
				query.startsWith("UPDATE door_bindings") &&
				args.some((arg) => typeof arg === "string" && arg.includes('"_tag":"recorded"'))
			) {
				controls.cutRecorded = false;
				controls.cuts++;
				throw new Error("lost recorded save");
			}
			if (
				controls.cutRetryable &&
				query.startsWith("UPDATE door_bindings") &&
				args.some((arg) => typeof arg === "string" && arg.includes('"_tag":"retryable"'))
			) {
				controls.cutRetryable = false;
				controls.retryableCuts++;
				throw new Error("lost retryable save");
			}
			return project.sql.exec(query, ...args);
		},
	};
	const settings = (): DoorOptions => ({
		sql: doorSql,
		founder,
		name: "project-a",
		url: URL,
		origins: ["https://fabrika.test"],
		versions: [1],
		location: "node",
		build: "build-a",
		waiting: {most: 3, ttl: 600000},
		ping: {min: 10000, max: 60000},
		inputCap: 100,
		spentCap: 100,
		nextProcess: () => processIds.next(A.Id.Process).pipe(Effect.orDie),
		notify: () => Effect.void,
		inputs: {schema: Input, personOnly: [], raw: [], log: Schema.toCodecJson(Input)},
		facts: {personOnly: []},
		deliver: (
			pid: string,
			envelope: C.Envelope<typeof Input.Type>,
			span: {traceId: string; spanId: string},
			meta?: {id: string; sentAt: string; seen: number},
		) => {
			deliveries.push({process: pid, parent: envelope.id, letter: meta?.id});
			if (controls.failDelivery) return Effect.fail(new LedgerError({why: "unreachable"}));
			return A.ProgramRunner.use((r) =>
				r.msg({
					id: meta?.id ?? envelope.id,
					envelope: {...envelope, input: {type: "press", poison: envelope.input.poison}},
					sentAt: meta?.sentAt ?? from().sentAt,
					seen: meta?.seen ?? 0,
					span,
				}),
			).pipe(Effect.provide(runner(pid)));
		},
	});
	const layer = () => Door.layer(settings()).pipe(Layer.provideMerge(env()));
	const online = Effect.fnUntraced(function* (who = window) {
		const d = yield* Door;
		const client = yield* d.connect();
		const nonce = yield* d.challenge(client);
		const tab = "recovery-tab";
		const result = yield* d.initialize(
			client,
			{
				versions: [1],
				has: ["verify", "seal"],
				ping: "30s",
				key: who.raw,
				tab,
				nonce,
				platform: "browser",
				os: "ios",
				sentAt: from().sentAt,
				signed: who.sign(`fabrika-hello\n${URL}\n${tab}\n${nonce}`),
			},
			{url: URL, tab, name: who.fingerprint},
		);
		expect(result._tag, "the test must pass real admission before delivery").toBe("online");
		return client;
	});
	return {
		project,
		process,
		deliveries,
		alarms,
		layer,
		runner,
		manager,
		online,
		window,
		other,
		controls,
		steps: () => steps,
		boot: C.ProcessManager.use((p) =>
			p.start(
				C.Start.cases.first.make({
					id: "first",
					name: NAME,
					code: {program: "counter", hash: "build-a"},
				}),
				from(),
			),
		).pipe(Effect.provide(manager())),
		reopen: () => {
			project.reopen();
			process.reopen();
			for (const p of partFiles.values()) p.reopen();
		},
	};
};

const request = (poison = true, letter = "poison") => ({
	pid: P1,
	letter,
	m: Input.cases.press.make({poison}),
	sentAt: from().sentAt,
	seen: 0,
});

const recover = (w: ReturnType<typeof world>) =>
	Effect.gen(function* () {
		const at = w.alarms.at(-1);
		expect(at).toBeTypeOf("number");
		yield* TestClock.setTime(at!);
		yield* A.ProgramRunner.use((r) => r.due(at!)).pipe(Effect.provide(w.runner(P1)));
	});

describe("P34 door recovery", () => {
	// Enumerate the states, then generate IDs and resend counts within every case.
	// A random choice of state could leave the same missing branch untested again.
	for (const state of ["allocated", "recorded", "delivered", "retryable"] as const) {
		for (const holds of [false, true]) {
			it(`p69 plant, rebind only some states: ${state}, inbox ${holds ? "holds" : "lacks"} the letter`, async () => {
				await fc.assert(
					fc.asyncProperty(fc.uuid(), fc.integer({min: 2, max: 4}), (letter, resends) =>
						Effect.runPromise(
							Effect.gen(function* () {
								const w = world();
								const queued = request(false, letter);
								const binding = () => {
									const [row] = w.project.sql.exec(
										"SELECT value FROM door_bindings WHERE letter=?",
										`${P1}/${letter}`,
									);
									return Schema.decodeUnknownSync(
										Schema.fromJsonString(
											Schema.Struct({
												id: Schema.String,
												process: Schema.String,
												state: Schema.Struct({_tag: Schema.String}),
											}),
										),
									)(row?.value);
								};
								const inbox = Ledger.use((l) => Stream.runCollect(l.read(`${NAME}/inbox`, 0)));
								yield* w.boot;
								const old = yield* Effect.gen(function* () {
									const client = yield* w.online();
									// Fail the next boundary, leaving exactly this durable state.
									w.controls.cutRecorded = state === "allocated";
									// Review 5: the recorded row survives a failed trace flush.
									w.controls.cutFlush = state === "recorded";
									w.controls.cutRetryable = state === "delivered";
									w.controls.failDelivery = true;
									expect(
										yield* Effect.exit(Door.use((d) => d.route(client, "process.send", queued))),
									).toMatchObject({_tag: "Failure"});
									expect(binding()).toMatchObject({process: P1, state: {_tag: state}});
									expect(w.controls.cuts + w.controls.retryableCuts).toBe(
										state === "retryable" ? 0 : 1,
									);
									expect(yield* inbox).toEqual([]);
									return binding().id;
								}).pipe(Effect.provide(w.layer()));
								w.reopen();
								w.controls.failDelivery = false;
								// Acceptance can race the door's saved state. Use the real runner,
								// keeping the unfinished door row, never fabricating a receipt.
								if (holds)
									yield* A.ProgramRunner.use((r) =>
										r.msg({
											id: letter,
											envelope: {
												id: Schema.decodeUnknownSync(A.Id.InputId)(old),
												by: C.Writer.cases.person.make({key: w.window.fingerprint, for: PERSON}),
												arrivedAt: 0,
												input: {type: "press", poison: false},
											},
											sentAt: queued.sentAt,
											seen: queued.seen,
											span: {traceId: from().traceId, spanId: "00f067aa0ba902b7"},
										}),
									).pipe(Effect.provide(w.runner(P1)));
								yield* A.ProgramRunner.use((r) =>
									r.restart({id: `replace-${letter}`, build: "build-a"}),
								).pipe(Effect.provide(w.runner(P1)));
								w.reopen();
								yield* Effect.gen(function* () {
									const client = yield* w.online();
									const d = yield* Door;
									expect(yield* C.ProcessManager.use((p) => p.resolve(P1))).toMatchObject({
										name: NAME,
										state: {_tag: "live", process: P2},
									});
									yield* A.ProgramRunner.use((r) => r.open("successor")).pipe(
										Effect.provide(w.runner(P2)),
									);
									const before = yield* inbox;
									expect(before).toHaveLength(holds ? 1 : 0);
									let steps = w.steps();
									for (let n = 0; n < resends; n++) {
										expect(yield* d.route(client, "process.send", queued)).toMatchObject({
											_tag: "ok",
											result: {_tag: "accepted", pos: 1},
										});
										if (!holds && n === 0) steps = w.steps();
										expect(w.steps(), "resends must not apply an accepted letter again").toBe(
											steps,
										);
									}
									const rows = yield* inbox;
									expect(rows).toMatchObject([{id: letter, pos: 1}]);
									if (holds) {
										expect(rows).toEqual(before);
										expect(binding()).toMatchObject({id: old, process: P1});
									} else {
										const delivery = w.deliveries.at(-1)!;
										const signed = yield* Effect.result(
											d
												.signer(delivery.parent, P2, "saved")
												.pipe(Effect.provideService(C.SignRequest, {id: `write-${letter}`})),
										);
										expect({delivery, signed}).toMatchObject({
											delivery: {process: P2, letter},
											signed: {
												_tag: "Success",
												success: {parent: delivery.parent, by: {key: w.window.fingerprint}},
											},
										});
										expect(delivery.parent).not.toBe(old);
										expect(
											yield* d.append({
												id: `write-${letter}`,
												parent: delivery.parent,
												process: P2,
												kind: "saved",
												stream: `${NAME}/events`,
												fact: Schema.TaggedStruct("saved", {count: Schema.Int}).make({count: 1}),
											}),
										).toMatchObject({_tag: "placed"});
										expect(
											yield* Ledger.use((l) => Stream.runCollect(l.read(`${NAME}/events`, 0))),
										).toMatchObject([
											{id: `write-${letter}`, parent: delivery.parent, by: w.window.fingerprint},
										]);
									}
									expect(
										yield* Effect.result(
											d
												.signer(old, P2, "saved")
												.pipe(Effect.provideService(C.SignRequest, {id: `old-${letter}`})),
										),
									).toMatchObject({_tag: "Failure", failure: {why: "not_delivered"}});
								}).pipe(Effect.provide(w.layer()));
							}).pipe(Effect.provide(TestClock.layer())),
						),
					),
					{seed: 119120, numRuns: 12},
				);
			});
		}
	}

	it("p69 plant, bind a first delivery to the addressed process: queued input reaches the live successor and signs there", async () => {
		await fc.assert(
			fc.asyncProperty(fc.uuid(), (letter) =>
				Effect.runPromise(
					Effect.gen(function* () {
						const w = world();
						const queued = request(false, letter);
						yield* w.boot;
						const old = yield* Effect.gen(function* () {
							const client = yield* w.online();
							const d = yield* Door;
							expect(yield* Effect.exit(d.route(client, "process.send", request()))).toMatchObject({
								_tag: "Failure",
							});
							return w.deliveries[0]!.parent;
						}).pipe(Effect.provide(w.layer()));
						w.reopen();
						yield* recover(w);
						w.controls.throws = false;
						w.reopen();
						yield* Effect.gen(function* () {
							const client = yield* w.online();
							const d = yield* Door;
							expect(yield* C.ProcessManager.use((p) => p.resolve(P1))).toMatchObject({
								name: NAME,
								state: {_tag: "live", process: P2},
							});
							expect(
								w.project.sql.exec(
									"SELECT id FROM door_bindings WHERE letter=?",
									`${P1}/${letter}`,
								),
							).toEqual([]);
							expect(yield* d.route(client, "process.send", queued)).toMatchObject({
								_tag: "ok",
								result: {_tag: "accepted", pos: 1},
							});
							const view = yield* A.ProgramRunner.use((r) => r.open(client)).pipe(
								Effect.provide(w.runner(P2)),
							);
							expect(view).toMatchObject({view: {count: 1}});
							const delivery = w.deliveries.at(-1)!;
							const oldWrite = yield* Effect.result(
								d
									.signer(old, P2, "saved")
									.pipe(Effect.provideService(C.SignRequest, {id: `old-${letter}`})),
							);
							const freshWrite = yield* Effect.result(
								d
									.signer(delivery.parent, P2, "saved")
									.pipe(Effect.provideService(C.SignRequest, {id: `fresh-${letter}`})),
							);
							expect({delivery, oldWrite, freshWrite}).toMatchObject({
								delivery: {process: P2, letter},
								oldWrite: {_tag: "Failure", failure: {why: "not_delivered"}},
								freshWrite: {
									_tag: "Success",
									success: {parent: delivery.parent, by: {key: w.window.fingerprint}},
								},
							});
							expect(
								yield* d.append({
									id: `fresh-${letter}`,
									parent: delivery.parent,
									process: P2,
									kind: "saved",
									stream: `${NAME}/events`,
									fact: Schema.TaggedStruct("saved", {count: Schema.Int}).make({count: 1}),
								}),
							).toMatchObject({_tag: "placed"});
							const ledger = yield* Ledger;
							expect(yield* Stream.runCollect(ledger.read(`${NAME}/events`, 0))).toMatchObject([
								{
									id: `fresh-${letter}`,
									parent: delivery.parent,
									by: w.window.fingerprint,
									_tag: "saved",
									body: {count: 1},
								},
							]);
						}).pipe(Effect.provide(w.layer()));
					}).pipe(Effect.provide(TestClock.layer())),
				),
			),
			{
				seed: 119120,
				numRuns: 12,
				// T271 review 4: the client's queued letter first reaches the door after replacement.
				examples: [["00000000-0000-4000-8000-000000000271"]],
			},
		);
	});

	it("p69 plant, trust delivered as final: resend after a lost retryable save gets a checked successor parent", async () => {
		await fc.assert(
			fc.asyncProperty(fc.uuid(), (letter) =>
				Effect.runPromise(
					Effect.gen(function* () {
						const w = world();
						yield* w.boot;
						w.controls.cutRetryable = true;
						const old = yield* Effect.gen(function* () {
							const client = yield* w.online();
							const d = yield* Door;
							expect(
								yield* Effect.exit(d.route(client, "process.send", request(true, letter))),
							).toMatchObject({_tag: "Failure"});
							expect(w.controls.retryableCuts).toBe(1);
							const [binding] = w.project.sql.exec(
								"SELECT json_extract(value, '$.state._tag') AS state FROM door_bindings WHERE letter=?",
								`${P1}/${letter}`,
							);
							expect(binding?.state).toBe("delivered");
							expect(yield* C.ProcessManager.use((p) => p.isLive(P1))).toBe(false);
							expect(
								yield* Ledger.use((l) => Stream.runCollect(l.read(`${NAME}/inbox`, 0))),
							).toEqual([]);
							return w.deliveries[0]!.parent;
						}).pipe(Effect.provide(w.layer()));
						w.reopen();
						yield* recover(w);
						w.controls.throws = false;
						w.reopen();
						yield* Effect.gen(function* () {
							const client = yield* w.online();
							const d = yield* Door;
							expect(yield* C.ProcessManager.use((p) => p.isLive(P2))).toBe(true);
							expect(yield* d.route(client, "process.send", request(true, letter))).toMatchObject({
								_tag: "ok",
								result: {_tag: "accepted"},
							});
							const delivery = w.deliveries.at(-1)!;
							const oldWrite = yield* Effect.result(
								d
									.signer(old, P2, "saved")
									.pipe(Effect.provideService(C.SignRequest, {id: `old-${letter}`})),
							);
							const freshWrite = yield* Effect.result(
								d
									.signer(delivery.parent, P2, "saved")
									.pipe(Effect.provideService(C.SignRequest, {id: `fresh-${letter}`})),
							);
							expect({delivery, oldWrite, freshWrite}).toMatchObject({
								delivery: {process: P2, letter, parent: expect.not.stringContaining(old)},
								oldWrite: {_tag: "Failure", failure: {why: "not_delivered"}},
								freshWrite: {
									_tag: "Success",
									success: {parent: delivery.parent, by: {key: w.window.fingerprint}},
								},
							});
						}).pipe(Effect.provide(w.layer()));
					}).pipe(Effect.provide(TestClock.layer())),
				),
			),
			{
				seed: 119120,
				numRuns: 12,
				// T271 re-review: the door crashes between delivered and retryable, before acceptance.
				examples: [["00000000-0000-4000-8000-000000000271"]],
			},
		);
	});

	it.effect(
		"p80 plant, void delivery hides placing: forward the real runner result and stable outbox ID",
		() =>
			Effect.gen(function* () {
				const w = world();
				yield* w.boot;
				yield* Effect.gen(function* () {
					const client = yield* w.online();
					const d = yield* Door;
					expect(yield* d.route(client, "process.send", request(false, "good"))).toMatchObject({
						_tag: "ok",
						result: {_tag: "accepted", rev: expect.any(Number), pos: 1},
					});
					expect(w.deliveries).toMatchObject([{letter: "good"}]);
				}).pipe(Effect.provide(w.layer()));
			}),
	);

	it.effect(
		"p80 plant, dedupe by text or lose terminal reply: three fresh attempts survive reopen and stop the outbox",
		() =>
			Effect.gen(function* () {
				const w = world();
				yield* w.boot;
				for (let n = 0; n < 3; n++) {
					yield* Effect.gen(function* () {
						const client = yield* w.online();
						const d = yield* Door;
						expect(yield* Effect.exit(d.route(client, "process.send", request()))).toMatchObject(
							n < 2 ? {_tag: "Failure"} : {_tag: "Success", value: {_tag: "refused", why: "dead"}},
						);
					}).pipe(Effect.provide(w.layer()));
					w.reopen();
					if (n < 2) yield* recover(w);
				}
				yield* Effect.gen(function* () {
					const client = yield* w.online();
					const d = yield* Door;
					expect(yield* d.route(client, "process.send", request())).toMatchObject({
						_tag: "refused",
						why: "dead",
					});
					expect(w.steps()).toBe(3);
					expect(yield* d.route(client, "process.send", request(false))).toMatchObject({
						_tag: "refused",
						why: "id_reused",
					});
					const grant = C.Grant.make({
						id: "other-caller",
						key: w.other.raw,
						for: PERSON,
						to: "project-a",
						as: "window",
						saw: {
							code: "1234",
							label: "Other browser",
							where: "test",
							how: "compare",
							check: "touch",
							has: ["verify"],
						},
						sentAt: from().sentAt,
					});
					const text = C.grantText(grant);
					expect(yield* d.grant({text, armored: w.window.sign(text)})).toMatchObject({
						_tag: "applied",
					});
					const other = yield* w.online(w.other);
					expect(yield* d.route(other, "process.send", request())).toMatchObject({
						_tag: "refused",
						why: "id_reused",
					});
					expect(w.steps()).toBe(3);
				}).pipe(Effect.provide(w.layer()));
			}),
	);

	it.effect(
		"p69 plant, retarget every old parent: fresh retry gets a checked new parent while queued old work stays refused",
		() =>
			Effect.gen(function* () {
				const w = world();
				yield* w.boot;
				yield* Effect.gen(function* () {
					const client = yield* w.online();
					const d = yield* Door;
					yield* Effect.exit(d.route(client, "process.send", request()));
					const old = w.deliveries[0]!.parent;
					const p = yield* C.ProcessManager;
					if (yield* p.isLive(P1)) yield* p.exit(P1, "crashed", from());
					yield* p.start(
						C.Start.cases.again.make({
							id: "replacement",
							name: NAME,
							after: P1,
							why: "crashed",
							code: {program: "counter", hash: "build-a"},
						}),
						from(),
					);
					w.controls.throws = false;
					yield* Effect.exit(d.route(client, "process.send", request()));
					expect(w.deliveries.at(-1)?.process).toBe(P2);
					const fresh = w.deliveries.at(-1)!.parent;
					expect(fresh).not.toBe(old);
					expect(
						yield* Effect.flip(
							d
								.signer(old, P2, "saved")
								.pipe(Effect.provideService(C.SignRequest, {id: "old-queued"})),
						),
					).toMatchObject({why: "not_delivered"});
					expect(
						yield* d
							.signer(fresh, P2, "saved")
							.pipe(Effect.provideService(C.SignRequest, {id: "fresh-write"})),
					).toMatchObject({parent: fresh, by: {key: w.window.fingerprint}});
				}).pipe(Effect.provide(w.layer()));
			}),
	);
});
