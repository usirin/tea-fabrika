// P17a, next/. Two independently built Door layers share real SQLite and membership history.
// Plants: hello-only checks; treating close as permission; stale input/fact admission;
// duplicate before membership; a revoked key rejoining; refusal leaking to every client;
// membership checked only before a paused hello write; decoding a transformed input twice;
// answering a cached placing without checking membership after hashing a settled retry.
import {createHash} from "node:crypto";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {afterAll, beforeEach, describe, expect, it, vi} from "@effect/vitest";
import {Deferred, Effect, Fiber, Layer, Result, Schema, Stream} from "effect";
import {TestClock} from "effect/testing";
import * as fc from "fast-check";
import type {Incoming} from "../app/entry.ts";
import {Sent} from "../app/runner.ts";
import {ClientManager} from "../coordination/client-manager.ts";
import {ProcessIdGenerator} from "../coordination/process-id.ts";
import {NotGranted, SignRequest} from "../coordination/session-manager.ts";
import {grantText, revokeText} from "../coordination/text.ts";
import {Archive} from "../data/archive.ts";
import {LedgerTransaction, type LedgerTurn} from "../data/ledger-transaction.ts";
import {Doorbell, Ledger, type LedgerError} from "../data/ledger.ts";
import {RecordManager} from "../data/records.ts";
import {SpanSink} from "../data/sink.ts";
import {nodeSql} from "../data/sqlite.ts";

let Door: typeof import("@kampus/libfabrika/door").Door;
let IdGenerator: typeof import("../data/id.ts").IdGenerator;
beforeEach(async () => {
	({Door} =
		await vi.importActual<typeof import("@kampus/libfabrika/door")>("@kampus/libfabrika/door"));
	({IdGenerator} = await vi.importActual<typeof import("../data/id.ts")>("../data/id.ts"));
});
const checks = {seed: 119120, numRuns: 20};
const folder = mkdtempSync(join(tmpdir(), "p17-revoke-"));
const opened: DatabaseSync[] = [];
afterAll(() => {
	for (const db of opened) if (db.isOpen) db.close();
	rmSync(folder, {recursive: true, force: true});
});
const url = "https://fabrika.test/entry/p17",
	sentAt = "2026-11-08T04:00:00.000Z";
const person = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const processes = {
	counter: "process_01m6v5270hetdrt4r8h9vvjwjs",
	notes: "process_01m6v5270hetdrt4r8h9vvjwjt",
};
const Input = Schema.TaggedUnion({add: {n: Schema.Int}, save: {text: Schema.String}});
const Fact = Schema.TaggedStruct("saved", {text: Schema.String});
const u32 = (n: number) => {
	const bytes = Buffer.alloc(4);
	bytes.writeUInt32BE(n);
	return bytes;
};
const field = (value: string | Uint8Array) => {
	const bytes = Buffer.from(value);
	return Buffer.concat([u32(bytes.length), bytes]);
};
const web = <A>(call: () => Promise<A>) =>
	Effect.tryPromise({try: call, catch: () => new Error("test crypto failed")});
const key = Effect.fnUntraced(function* () {
	const pair = yield* web(() => crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]));
	const bytes = new Uint8Array(yield* web(() => crypto.subtle.exportKey("raw", pair.publicKey)));
	const blob = Buffer.concat([field("ssh-ed25519"), field(bytes)]);
	const fp = (raw: Uint8Array) =>
		`SHA256:${createHash("sha256").update(raw).digest("base64").replace(/=+$/, "")}`;
	return {
		raw: Buffer.from(bytes).toString("base64url"),
		line: `ssh-ed25519 ${blob.toString("base64")}`,
		fingerprint: fp(bytes),
		sshFingerprint: fp(blob),
		sign: (text: string) =>
			web(() =>
				crypto.subtle.sign(
					"Ed25519",
					pair.privateKey,
					Buffer.concat([
						Buffer.from("SSHSIG"),
						field("fabrika-client"),
						field(""),
						field("sha512"),
						field(createHash("sha512").update(text).digest()),
					]),
				),
			).pipe(
				Effect.map((signature) => {
					const packed = Buffer.concat([
						Buffer.from("SSHSIG"),
						u32(1),
						field(blob),
						field("fabrika-client"),
						field(""),
						field("sha512"),
						field(Buffer.concat([field("ssh-ed25519"), field(new Uint8Array(signature))])),
					]);
					return `-----BEGIN SSH SIGNATURE-----\n${packed
						.toString("base64")
						.match(/.{1,70}/g)
						?.join("\n")}\n-----END SSH SIGNATURE-----\n`;
				}),
			),
	};
});
let homes = 0;
const world = Effect.fnUntraced(function* (input: Schema.Codec<unknown, unknown> = Input) {
	const root = yield* key(),
		old = yield* key(),
		other = yield* key();
	const path = join(folder, `${++homes}.db`);
	const founder = {
		name: "P17",
		person,
		keys: [root.line],
		window: old.raw,
		by: root.sshFingerprint,
		build: "test",
	};
	const deliveries: Incoming[] = [],
		notices: unknown[] = [];
	const controls = {
		letter: "",
		deliver: (_: Incoming): Effect.Effect<void | Sent, LedgerError | NotGranted> => Effect.void,
	};
	const storage = () => {
		const db = new DatabaseSync(path);
		opened.push(db);
		return {db, sql: nodeSql(db)};
	};
	const first = storage();
	const layers = (saved = first, beforeWrite: Effect.Effect<void> = Effect.void) => {
		const quiet = Layer.succeed(Doorbell, {ring: () => Effect.void});
		const ledger = Layer.effect(
			Ledger,
			Ledger.pipe(
				Effect.map((ledger) => ({
					...ledger,
					append: (...args: Parameters<typeof ledger.append>) =>
						(args[0] === "door/hellos" ? beforeWrite : Effect.void).pipe(
							Effect.andThen(ledger.append(...args)),
						),
				})),
			),
		).pipe(Layer.provide(Ledger.sql(saved.sql, {reader: "p17"})), Layer.provide(quiet));
		const transaction = Layer.effect(
			LedgerTransaction,
			LedgerTransaction.pipe(
				Effect.map((transaction) => ({
					transact: <A>(step: (turn: LedgerTurn) => A) =>
						beforeWrite.pipe(Effect.andThen(transaction.transact(step))),
				})),
			),
		).pipe(Layer.provide(LedgerTransaction.layer(saved.sql)), Layer.provide(quiet));
		const env = Layer.mergeAll(
			ledger,
			transaction,
			ClientManager.layer(founder).pipe(Layer.provide(ledger)),
			SpanSink.layer(saved.sql, {object: processes.counter}),
			RecordManager.memory(4 * 1024 * 1024),
			Archive.memory,
			ProcessIdGenerator.layer,
			IdGenerator.layer,
		);
		const layer = Door.layer({
			sql: saved.sql,
			founder,
			name: "p17",
			url,
			origins: ["https://fabrika.test"],
			versions: [1],
			location: "test",
			build: "test",
			waiting: {most: 20, ttl: 600_000},
			ping: {min: 10_000, max: 60_000},
			inputCap: 1000,
			spentCap: 1000,
			nextProcess: () => ProcessIdGenerator.use((g) => g.next),
			deliver: (_process, envelope, span) => {
				const incoming: Incoming = {id: controls.letter, envelope, span, sentAt, seen: 0};
				deliveries.push(incoming);
				return controls.deliver(incoming);
			},
			notify: (client, news) =>
				Effect.sync(() => {
					notices.push({client, news});
				}),
			inputs: {schema: input, personOnly: [], raw: [], log: Schema.toCodecJson(input)},
			facts: {personOnly: []},
		}).pipe(Layer.provideMerge(env));
		return {layer, env};
	};
	return {root, old, other, first, deliveries, notices, controls, layers, storage};
});
type World = Effect.Success<ReturnType<typeof world>>;
type DoorService = typeof Door.Service;
const proof = Effect.fnUntraced(function* (door: DoorService, k: World["old"], tab: string) {
	const client = yield* door.connect(),
		nonce = yield* door.challenge(client);
	return {
		client,
		params: {
			versions: [1],
			has: [],
			ping: "30s",
			key: k.raw,
			tab,
			nonce,
			platform: "browser",
			os: "ios",
			sentAt,
			signed: yield* k.sign(`fabrika-hello\n${url}\n${tab}\n${nonce}`),
		},
		trusted: {url, tab, name: k.fingerprint},
	};
});
const hello = Effect.fnUntraced(function* (door: DoorService, k: World["old"], tab: string) {
	const hello = yield* proof(door, k, tab);
	return {
		client: hello.client,
		result: yield* door.initialize(hello.client, hello.params, hello.trusted),
	};
});
const remove = Effect.fnUntraced(function* (door: DoorService, w: World, id: string) {
	const text = revokeText({
		id,
		key: w.old.raw,
		for: person,
		to: "p17",
		sentAt,
		saw: {label: "Old client", where: "test", how: "panel", check: "touch"},
	});
	expect((yield* door.grant({text, armored: yield* w.root.sign(text)}))._tag).toBe("applied");
});
const setup = Effect.fnUntraced(function* (w: World) {
	const a = yield* Door.pipe(Effect.provide(w.layers().layer));
	const b = yield* Door.pipe(Effect.provide(w.layers().layer));
	const old = yield* hello(a, w.old, "old");
	expect(old.result._tag).toBe("online");
	const text = grantText({
		id: "grant-other",
		key: w.other.raw,
		for: person,
		to: "p17",
		as: "window",
		sentAt,
		saw: {
			code: "1234",
			label: "Other client",
			where: "test",
			how: "compare",
			check: "touch",
			has: [],
		},
	});
	expect((yield* b.grant({text, armored: yield* w.root.sign(text)}))._tag).toBe("applied");
	const other = yield* hello(b, w.other, "other");
	expect(other.result._tag).toBe("online");
	return {a, b, old: old.client, other: other.client};
});
const request = (target: "counter" | "notes", id: string, text: string) => ({
	pid: processes[target],
	letter: id,
	m: target === "counter" ? Input.cases.add.make({n: text.length}) : Input.cases.save.make({text}),
	sentAt,
	seen: 0,
});
const send = (
	door: DoorService,
	client: Parameters<DoorService["route"]>[0],
	w: World,
	target: "counter" | "notes",
	id: string,
	text: string,
) => {
	w.controls.letter = id;
	return door.route(client, "process.send", request(target, id, text));
};
const rows = (w: World, stream: string, saved = w.first) =>
	Ledger.use((l) => Stream.runCollect(l.read(stream, 0))).pipe(Effect.provide(w.layers(saved).env));
const last = (w: World) => {
	const incoming = w.deliveries.at(-1);
	if (!incoming) throw new Error("door did not deliver an input");
	return incoming;
};

describe("P17a, revoke stops writes at the final door", () => {
	it("a hello paused before its final write cannot land after revoke", async () => {
		await fc.assert(
			fc.asyncProperty(fc.boolean(), fc.uuid(), async (revokeFirst, tab) => {
				await Effect.runPromise(
					Effect.gen(function* () {
						const w = yield* world(),
							d = yield* setup(w);
						const before = (yield* rows(w, "door/hellos")).filter(
							(row) => row.by === w.old.fingerprint,
						).length;
						const entered = yield* Deferred.make<void>(),
							release = yield* Deferred.make<void>();
						// Pause both write services before their real SQLite transaction. This also
						// reaches a hello once the builder moves it to appendAdmitted.
						const gate = Deferred.succeed(entered, undefined).pipe(
							Effect.andThen(Deferred.await(release)),
						);
						const door = yield* Door.pipe(Effect.provide(w.layers(w.first, gate).layer));
						const pending = yield* Effect.forkChild(Effect.result(hello(door, w.old, tab)));
						yield* Deferred.await(entered);
						if (revokeFirst) yield* remove(d.b, w, "revoke");
						yield* Deferred.succeed(release, undefined);
						const result = yield* Fiber.join(pending);
						if (!revokeFirst) yield* remove(d.b, w, "revoke");
						const revoke = (yield* rows(w, "door/members")).at(-1);
						expect(revoke?._tag).toBe("revoked");
						const hellos = (yield* rows(w, "door/hellos")).filter(
							(row) => row.by === w.old.fingerprint,
						);
						const answer = Result.isFailure(result)
							? Schema.is(NotGranted)(result.failure)
								? "not_granted"
								: result.failure
							: result.success.result._tag === "refused"
								? result.success.result.why
								: result.success.result._tag;
						// Plant: the hello checks membership only before the pause.
						expect({
							answer,
							hellos: hellos.length - before,
							afterRevoke: hellos.filter((row) => row.rev > (revoke?.rev ?? 0)).length,
						}).toEqual({
							answer: revokeFirst ? "not_granted" : "online",
							hellos: revokeFirst ? 0 : 1,
							afterRevoke: 0,
						});
					}).pipe(Effect.provide(TestClock.layer())),
				);
			}),
			{
				...checks,
				// Review regression: revoke lands while this hello's final write is paused.
				examples: [[true, "paused-hello"]],
			},
		);
	});
	it("a transforming program input is decoded once and delivered with its decoded value", async () => {
		await fc.assert(
			fc.asyncProperty(fc.integer(), fc.uuid(), async (n, letter) => {
				await Effect.runPromise(
					Effect.gen(function* () {
						const input = Schema.TaggedStruct("add", {n: Schema.NumberFromString});
						const w = yield* world(input),
							d = yield* setup(w);
						w.controls.letter = letter;
						const answer = yield* d.a.route(d.old, "process.send", {
							pid: processes.counter,
							letter,
							m: {_tag: "add", n: String(n)},
							sentAt,
							seen: 0,
						});
						expect(answer._tag).toBe("ok");
						expect(w.deliveries).toHaveLength(1);
						const incoming = last(w);
						expect(incoming.envelope.input).toEqual({_tag: "add", n});
						// Plant: decode the already decoded input a second time in accept.
						expect(yield* Effect.result(d.a.accept(incoming))).toMatchObject({
							_tag: "Success",
							success: {_tag: "placed"},
						});
						const inbox = yield* rows(w, `${processes.counter}/inbox`);
						expect(inbox).toHaveLength(1);
						expect(inbox[0]?.body).toEqual({m: {_tag: "add", n}});
					}).pipe(Effect.provide(TestClock.layer())),
				);
			}),
			{
				...checks,
				// Review regression: NumberFromString turns "7" into 7 before accept.
				examples: [[7, "transformed-input"]],
			},
		);
	});
	it("a route paused after its online check cannot record authenticated input after revoke", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.constantFrom("counter", "notes"),
				fc.boolean(),
				fc.uuid(),
				async (target, revokeFirst, token) => {
					await Effect.runPromise(
						Effect.gen(function* () {
							const w = yield* world(),
								d = yield* setup(w);
							const entered = yield* Deferred.make<void>(),
								release = yield* Deferred.make<void>();
							const digest = crypto.subtle.digest.bind(crypto.subtle),
								marker = `queued-input-${token}`;
							let paused = false;
							const spy = vi
								.spyOn(crypto.subtle, "digest")
								.mockImplementation((algorithm, data) => {
									const bytes = ArrayBuffer.isView(data)
										? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
										: new Uint8Array(data);
									if (!paused && new TextDecoder().decode(bytes).includes(marker)) {
										paused = true;
										return Effect.runPromise(
											Deferred.succeed(entered, undefined).pipe(
												Effect.andThen(Deferred.await(release)),
												Effect.andThen(web(() => digest(algorithm, data))),
											),
										);
									}
									return digest(algorithm, data);
								});
							try {
								const pending = yield* Effect.forkChild(
									Effect.result(send(d.a, d.old, w, target, marker, token)),
								);
								yield* Deferred.await(entered);
								if (revokeFirst) yield* remove(d.b, w, "revoke");
								yield* Deferred.succeed(release, undefined);
								const result = yield* Fiber.join(pending);
								const refused = Result.isFailure(result)
									? result.failure._tag === "NotGranted"
									: result.success._tag === "refused" && result.success.why === "not_granted";
								expect(refused).toBe(revokeFirst);
								expect(yield* rows(w, "door/inputs")).toHaveLength(revokeFirst ? 0 : 1);
								expect(w.deliveries).toHaveLength(revokeFirst ? 0 : 1);
							} finally {
								spy.mockRestore();
							}
						}).pipe(Effect.provide(TestClock.layer())),
					);
				},
			),
			checks,
		);
	});
	it("a settled retry paused after online rechecks revoke before answering its cached placing", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.constantFrom("counter", "notes"),
				fc.boolean(),
				fc.uuid(),
				fc.string({maxLength: 30}),
				async (target, revokeFirst, token, text) => {
					await Effect.runPromise(
						Effect.gen(function* () {
							const w = yield* world(),
								d = yield* setup(w);
							w.controls.deliver = Effect.fnUntraced(function* (incoming: Incoming) {
								const placing = yield* d.a.accept(incoming);
								if (placing._tag !== "placed") return Sent.cases.refused.make({why: placing.why});
								return Sent.cases.accepted.make({rev: placing.rev, pos: placing.pos});
							});
							const marker = `settled-retry-${token}`;
							const first = yield* send(d.a, d.old, w, target, marker, text);
							expect(first).toMatchObject({_tag: "ok", result: {_tag: "accepted"}});
							const inbox = yield* rows(w, `${processes[target]}/inbox`);
							expect(inbox).toHaveLength(1);
							const inputs = yield* rows(w, "door/inputs");
							const entered = yield* Deferred.make<void>(),
								release = yield* Deferred.make<void>();
							const digest = crypto.subtle.digest.bind(crypto.subtle);
							let paused = false;
							const spy = vi
								.spyOn(crypto.subtle, "digest")
								.mockImplementation((algorithm, data) => {
									const bytes = ArrayBuffer.isView(data)
										? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
										: new Uint8Array(data);
									if (!paused && new TextDecoder().decode(bytes).includes(marker)) {
										paused = true;
										return Effect.runPromise(
											Deferred.succeed(entered, undefined).pipe(
												Effect.andThen(Deferred.await(release)),
												Effect.andThen(web(() => digest(algorithm, data))),
											),
										);
									}
									return digest(algorithm, data);
								});
							try {
								const pending = yield* Effect.forkChild(
									Effect.result(send(d.a, d.old, w, target, marker, text)),
								);
								// Request hashing follows online(); the settled reply is still pending.
								yield* Deferred.await(entered);
								if (revokeFirst) yield* remove(d.b, w, "revoke");
								yield* Deferred.succeed(release, undefined);
								const result = yield* Fiber.join(pending);
								if (!revokeFirst) yield* remove(d.b, w, "revoke");
								const answer = Result.isFailure(result)
									? Schema.is(NotGranted)(result.failure)
										? {why: "not_granted"}
										: result.failure
									: result.success._tag === "refused"
										? {why: result.success.why}
										: result.success;
								// Plant: answer the cached placing without a final membership check.
								expect({
									answer,
									inbox: yield* rows(w, `${processes[target]}/inbox`),
									inputs: yield* rows(w, "door/inputs"),
									deliveries: w.deliveries.length,
								}).toEqual({
									answer: revokeFirst ? {why: "not_granted"} : first,
									inbox,
									inputs,
									deliveries: 1,
								});
							} finally {
								spy.mockRestore();
							}
						}).pipe(Effect.provide(TestClock.layer())),
					);
				},
			),
			checks,
		);
	});
	it("two Door layers on one ledger stop the open old client, even when it ignores close", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.constantFrom("counter", "notes"),
				fc.integer({min: 1, max: 5}),
				fc.integer({min: 1, max: 5}),
				fc.boolean(),
				fc.string({maxLength: 30}),
				async (target, before, after, ignoreClose, text) => {
					await Effect.runPromise(
						Effect.gen(function* () {
							const w = yield* world(),
								d = yield* setup(w);
							for (let n = 0; n < before; n++) {
								expect((yield* send(d.a, d.old, w, target, `before-${n}`, text))._tag).toBe("ok");
								expect((yield* d.a.accept(last(w)))._tag).toBe("placed");
							}
							yield* TestClock.setTime(500);
							yield* remove(d.b, w, "revoke");
							if (!ignoreClose) yield* d.a.disconnect(d.old);
							for (let n = 0; n < after; n++)
								expect(yield* send(d.a, d.old, w, target, `late-${n}`, text)).toMatchObject({
									_tag: "refused",
									why: "not_granted",
								});
							expect((yield* rows(w, `${processes[target]}/inbox`)).map((row) => row.id)).toEqual(
								Array.from({length: before}, (_, n) => `before-${n}`),
							);
							expect((yield* send(d.b, d.other, w, target, "other-live", text))._tag).toBe("ok");
							expect((yield* d.b.accept(last(w)))._tag).toBe("placed");
						}).pipe(Effect.provide(TestClock.layer())),
					);
				},
			),
			checks,
		);
	});
	it("a delayed inbox append, including an exact duplicate, rechecks after revoke and reopen", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.constantFrom("counter", "notes"),
				fc.boolean(),
				fc.boolean(),
				fc.boolean(),
				fc.string({maxLength: 30}),
				async (target, revokeFirst, reopen, duplicate, text) => {
					await Effect.runPromise(
						Effect.gen(function* () {
							const w = yield* world(),
								d = yield* setup(w);
							expect((yield* send(d.a, d.old, w, target, "delayed", text))._tag).toBe("ok");
							const incoming = last(w);
							if (duplicate) expect((yield* d.a.accept(incoming))._tag).toBe("placed");
							if (revokeFirst) yield* remove(d.b, w, "revoke");
							if (reopen) w.first.db.close();
							const door = reopen
								? yield* Door.pipe(Effect.provide(w.layers(w.storage()).layer))
								: d.a;
							const result = yield* Effect.result(door.accept(incoming));
							expect(Result.isFailure(result)).toBe(revokeFirst);
							if (revokeFirst && Result.isFailure(result))
								expect(result.failure).toMatchObject({_tag: "NotGranted"});
							if (!revokeFirst && Result.isSuccess(result))
								expect(result.success._tag).toBe("placed");
							const saved = reopen ? w.storage() : w.first;
							const stored = yield* Ledger.use((l) =>
								Stream.runCollect(l.read(`${processes[target]}/inbox`, 0)),
							).pipe(Effect.provide(w.layers(saved).env));
							expect(stored).toHaveLength(duplicate || !revokeFirst ? 1 : 0);
						}).pipe(Effect.provide(TestClock.layer())),
					);
				},
			),
			checks,
		);
	});
	it("a caused fact paused after receipt checking cannot cross a revoke on another Door", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.constantFrom("counter", "notes"),
				fc.boolean(),
				fc.boolean(),
				fc.string({minLength: 1, maxLength: 20}),
				async (target, revokeFirst, reopen, text) => {
					await Effect.runPromise(
						Effect.gen(function* () {
							const w = yield* world(),
								d = yield* setup(w);
							yield* send(d.a, d.old, w, target, "cause", text);
							const incoming = last(w);
							const id = "queued-fact",
								parent = incoming.envelope.id;
							yield* d.a
								.signer(parent, processes[target], "saved")
								.pipe(Effect.provideService(SignRequest, {id}));
							if (reopen) w.first.db.close();
							const saved = reopen ? w.storage() : w.first;
							const door = reopen ? yield* Door.pipe(Effect.provide(w.layers(saved).layer)) : d.a;
							const remover = reopen
								? yield* Door.pipe(Effect.provide(w.layers(saved).layer))
								: d.b;
							const entered = yield* Deferred.make<void>(),
								release = yield* Deferred.make<void>();
							const digest = crypto.subtle.digest.bind(crypto.subtle),
								marker = `p17-queued-${text}`,
								encodedMarker = JSON.stringify(marker);
							let paused = false;
							const spy = vi
								.spyOn(crypto.subtle, "digest")
								.mockImplementation((algorithm, data) => {
									const bytes = ArrayBuffer.isView(data)
										? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
										: new Uint8Array(data);
									if (!paused && new TextDecoder().decode(bytes).includes(encodedMarker)) {
										paused = true;
										return Effect.runPromise(
											Deferred.succeed(entered, undefined).pipe(
												Effect.andThen(Deferred.await(release)),
												Effect.andThen(web(() => digest(algorithm, data))),
											),
										);
									}
									return digest(algorithm, data);
								});
							try {
								const pending = yield* Effect.forkChild(
									Effect.result(
										door.append({
											id,
											parent,
											process: processes[target],
											kind: "saved",
											stream: "notes",
											fact: Fact.make({text: marker}),
										}),
									),
								);
								yield* Deferred.await(entered);
								if (revokeFirst) yield* remove(remover, w, "revoke");
								yield* Deferred.succeed(release, undefined);
								const result = yield* Fiber.join(pending);
								expect(Result.isFailure(result)).toBe(revokeFirst);
								if (revokeFirst && Result.isFailure(result))
									expect(result.failure).toMatchObject({_tag: "NotGranted"});
								expect(yield* rows(w, "notes", saved)).toHaveLength(revokeFirst ? 0 : 1);
							} finally {
								spy.mockRestore();
							}
						}).pipe(Effect.provide(TestClock.layer())),
					);
				},
			),
			{
				...checks,
				// P17a regression: JSON-escaped text used to miss the pause after receipt checking.
				examples: [["notes", true, false, '"\n\\']],
			},
		);
	});
	it("old-key challenges cannot reconnect or regrant it; a separate admitted client keeps writing", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.constantFrom("counter", "notes"),
				fc.boolean(),
				fc.integer({min: 1, max: 4}),
				fc.string({maxLength: 30}),
				async (target, challengeFirst, attempts, text) => {
					await Effect.runPromise(
						Effect.gen(function* () {
							const w = yield* world(),
								d = yield* setup(w);
							const pending = challengeFirst ? yield* proof(d.a, w.old, "before-revoke") : null;
							yield* remove(d.b, w, "revoke");
							if (pending !== null)
								expect(
									yield* d.a.initialize(pending.client, pending.params, pending.trusted),
								).toMatchObject({_tag: "refused", why: "not_granted"});
							for (let n = 0; n < attempts; n++) {
								expect((yield* hello(d.a, w.old, `reconnect-${n}`)).result).toMatchObject({
									_tag: "refused",
									why: "not_granted",
								});
								expect((yield* send(d.b, d.other, w, target, `live-${n}`, text))._tag).toBe("ok");
								expect((yield* d.b.accept(last(w)))._tag).toBe("placed");
							}
							const textGrant = grantText({
								id: "regrant",
								key: w.old.raw,
								for: person,
								to: "p17",
								as: "window",
								sentAt,
								saw: {
									code: "1234",
									label: "Old client",
									where: "test",
									how: "compare",
									check: "touch",
									has: [],
								},
							});
							expect(
								(yield* d.b.grant({text: textGrant, armored: yield* w.root.sign(textGrant)}))._tag,
							).toBe("refused");
							expect(yield* rows(w, `${processes[target]}/inbox`)).toHaveLength(attempts);
						}).pipe(Effect.provide(TestClock.layer())),
					);
				},
			),
			checks,
		);
	});
	it("the internal inbox operation refuses changed bindings and bodies before any append", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.constantFrom("counter", "notes"),
				fc.string({maxLength: 30}),
				async (target, text) => {
					await Effect.runPromise(
						Effect.gen(function* () {
							const w = yield* world(),
								d = yield* setup(w);
							yield* send(d.a, d.old, w, target, "bound", text);
							const incoming = last(w);
							const malformed = yield* Effect.result(
								d.a.accept({...incoming, envelope: {...incoming.envelope, input: {}}}),
							);
							expect(malformed).toMatchObject({
								_tag: "Failure",
								failure: {_tag: "LedgerError", why: "bad_row"},
							});
							for (const changed of [
								{...incoming, id: "another-letter"},
								{
									...incoming,
									envelope: {
										...incoming.envelope,
										by: {...incoming.envelope.by, key: w.other.fingerprint},
									},
								},
								{
									...incoming,
									envelope: {
										...incoming.envelope,
										input: Input.cases.save.make({text: `${text}-changed`}),
									},
								},
							]) {
								const result = yield* Effect.result(d.a.accept(changed));
								expect(
									Result.isFailure(result) ||
										(Result.isSuccess(result) && result.success._tag === "refused"),
								).toBe(true);
							}
							expect(yield* rows(w, `${processes[target]}/inbox`)).toEqual([]);
							expect((yield* d.a.accept(incoming))._tag).toBe("placed");
						}).pipe(Effect.provide(TestClock.layer())),
					);
				},
			),
			checks,
		);
	});
});
