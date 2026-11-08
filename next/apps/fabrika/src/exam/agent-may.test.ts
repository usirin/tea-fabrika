// P8, next/, p64/p69, against main's real Door. P12 must add its decided agent allow rule,
// process lookup, view.open and tea message mapping. These laws stay red until that work lands.
import {createHash, generateKeyPairSync, sign} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {afterAll, describe, expect, it} from "@effect/vitest";
import * as C from "@kampus/libfabrika/coordination";
import {
	Archive,
	Chain,
	Doorbell,
	Ledger,
	LedgerTransaction,
	RecordManager,
	SpanSink,
} from "@kampus/libfabrika/data";
import {nodeSql} from "@kampus/libfabrika/sqlite";
import {Effect, Layer, Schema, Stream} from "effect";
import {Door} from "../door.ts";

const PID = "process_01jc9q4w7z3m8n5r2t6v0xkb4d";
const COUNTER = "process_01jc9q4w7z3m8n5r2t6v0xkb4e";
const PERSON = "exam-person",
	URL = "wss://fabrika.test/door",
	SENT = "2026-11-08T10:00:00Z";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const u32 = (n: number) => {
	const b = Buffer.alloc(4);
	b.writeUInt32BE(n);
	return b;
};
const field = (s: string | Uint8Array) => {
	const b = Buffer.from(s);
	return Buffer.concat([u32(b.length), b]);
};
const fingerprint = (b: Uint8Array) =>
	`SHA256:${createHash("sha256").update(b).digest("base64").replace(/=+$/, "")}`;
// Ephemeral signing keys exist only in memory. SSHSIG bytes match transport's public format.
const key = () => {
	const pair = generateKeyPairSync("ed25519");
	const raw = pair.publicKey.export({type: "spki", format: "der"}).subarray(-32);
	const blob = Buffer.concat([field("ssh-ed25519"), field(raw)]);
	return {
		raw: raw.toString("base64url"),
		line: `ssh-ed25519 ${blob.toString("base64")}`,
		fingerprint: fingerprint(raw),
		sshFingerprint: fingerprint(blob),
		sign: (text: string) => {
			const signed = Buffer.concat([
				Buffer.from("SSHSIG"),
				field("fabrika-client"),
				field(""),
				field("sha512"),
				field(createHash("sha512").update(text).digest()),
			]);
			const signature = Buffer.concat([
				field("ssh-ed25519"),
				field(sign(null, signed, pair.privateKey)),
			]);
			const bytes = Buffer.concat([
				Buffer.from("SSHSIG"),
				u32(1),
				field(blob),
				field("fabrika-client"),
				field(""),
				field("sha512"),
				field(signature),
			]);
			return `-----BEGIN SSH SIGNATURE-----\n${bytes
				.toString("base64")
				.match(/.{1,70}/g)
				?.join("\n")}\n-----END SSH SIGNATURE-----\n`;
		},
	};
};
const saw = {
	code: "1234",
	label: "Exam agent",
	where: "test",
	how: "compare",
	check: "touch",
	has: ["verify"],
} as const;
const Input = Schema.TaggedUnion({
	save: {note: Schema.String, base: Schema.Int, body: Schema.String},
	approve: {answer: Schema.String},
	press: {},
});
const save = Input.cases.save.make({note: "a", base: 0, body: "checked save"});
const request = (letter = "save", pid = PID) => ({pid, letter, m: save, sentAt: SENT, seen: 0});
const opened: DatabaseSync[] = [];
afterAll(() => {
	for (const db of opened) if (db.isOpen) db.close();
});
const world = () => {
	const db = new DatabaseSync(":memory:");
	opened.push(db);
	const sql = nodeSql(db);
	const root = key(),
		window = key(),
		agent = key();
	const founder = {
		name: "Exam",
		person: PERSON,
		keys: [root.line],
		window: window.raw,
		by: root.sshFingerprint,
		build: "p8",
	};
	const deliveries: Array<{pid: string; envelope: C.Envelope<unknown>}> = [];
	const ledger = Ledger.sql(sql, {reader: "p8"}).pipe(
		Layer.provide(Layer.succeed(Doorbell, {ring: () => Effect.void})),
	);
	const clients = C.ClientManager.layer(founder).pipe(Layer.provideMerge(ledger));
	const parts = new Map<string, ReturnType<typeof nodeSql>>();
	const records = RecordManager.sql((name) => {
		const old = parts.get(name);
		if (old) return old;
		const part = new DatabaseSync(":memory:");
		opened.push(part);
		const storage = nodeSql(part);
		parts.set(name, storage);
		return storage;
	}, 64 * 1024);
	let generated = 0;
	const processes = C.ProcessManager.layer(
		{
			owner: C.Owner.cases.brain.make({}),
			recipient: C.Recipient.cases.process.make({process: PID}),
			by: "SHA256:brain",
		},
		Effect.sync(() => (generated++ === 0 ? PID : COUNTER)),
	).pipe(
		Layer.provide(
			LedgerTransaction.layer(sql).pipe(
				Layer.provide(Layer.succeed(Doorbell, {ring: () => Effect.void})),
			),
		),
	);
	const env = Layer.mergeAll(
		clients,
		C.Mailbox.layer.pipe(Layer.provide(clients)),
		processes,
		SpanSink.layer(sql, {object: PID}),
		records,
		Archive.memory,
		C.ProcessIdGenerator.layer,
	);
	const door = Door.layer({
		sql,
		founder,
		name: "exam-project",
		url: URL,
		origins: ["https://fabrika.test"],
		versions: [1],
		location: "test",
		build: "p8",
		waiting: {most: 20, ttl: 600000},
		ping: {min: 10000, max: 60000},
		inputCap: 1000,
		spentCap: 1000,
		nextProcess: () => C.ProcessIdGenerator.use((g) => g.next),
		inputs: {schema: Input, personOnly: ["approve"], raw: [], log: Schema.toCodecJson(Input)},
		facts: {personOnly: ["approved"]},
		notify: () => Effect.void,
		deliver: (pid, envelope) =>
			C.Mailbox.use((m) =>
				Effect.gen(function* () {
					deliveries.push({pid, envelope});
					yield* m.send("notes:1", envelope.id, envelope.input, {
						by: envelope.by.key,
						for: envelope.by.for,
						parent: envelope.id,
						sentAt: SENT,
						seen: 0,
						traceId: TRACE,
						build: "p8",
					});
				}),
			),
	}).pipe(Layer.provideMerge(env));
	const hello = (
		d: typeof Door.Service,
		k: ReturnType<typeof key>,
		label: string,
		claim = "agent",
	) =>
		Effect.gen(function* () {
			const client = yield* d.connect(),
				nonce = yield* d.challenge(client);
			const tab = `tab-${label}`;
			const answer = yield* d.initialize(
				client,
				{
					versions: [1],
					has: ["verify"],
					ping: "30s",
					key: k.raw,
					tab,
					nonce,
					platform: "browser",
					os: "ios",
					sentAt: SENT,
					signed: k.sign(`fabrika-hello\n${URL}\n${tab}\n${nonce}`),
					as: claim,
				},
				{url: URL, tab, name: k.fingerprint},
			);
			expect(answer._tag, "valid signed initialization").toBe("online");
			return client;
		});
	const ready = Effect.gen(function* () {
		const d = yield* Door;
		yield* hello(d, window, "person");
		const text = C.grantText({
			id: "grant-agent",
			key: agent.raw,
			for: PERSON,
			to: "exam-project",
			as: "agent",
			saw,
			sentAt: SENT,
		});
		expect((yield* d.grant({text, armored: root.sign(text)}))._tag, "person-signed grant").toBe(
			"applied",
		);
		// Seed authoritative process records, never a target name supplied by the caller.
		for (const [pid, name, program] of [
			[PID, "notes:1", "notes"],
			[COUNTER, "notes:counter-lookalike", "counter"],
		] as const) {
			const started = yield* C.ProcessManager.use((p) =>
				p.start(C.Start.cases.first.make({id: `start-${pid}`, name, code: {program, hash: "p8"}}), {
					by: window.fingerprint,
					for: PERSON,
					parent: null,
					traceId: TRACE,
					sentAt: SENT,
					seen: 0,
					build: "p8",
				}),
			);
			expect(started.process).toBe(pid);
		}
		return {d, client: yield* hello(d, agent, "agent", "window")};
	});
	return {door, ready, hello, agent, root, window, deliveries};
};
const refused = (answer: unknown) =>
	expect(answer, "agent method allow rule").toMatchObject({_tag: "refused", why: "not_for_agents"});
const matrix: ReadonlyArray<readonly [string, unknown, "ok" | "parked" | "not_for_agents"]> = [
	["ledger.read", {stream: "notes:1/inbox", after: 0}, "ok"],
	["ledger.wait", {stream: "empty", after: 0}, "parked"],
	["view.open", {pid: PID}, "ok"],
	["process.send", request(), "ok"],
	["door.watch", {}, "not_for_agents"],
	["door.deny", {key: "stranger"}, "not_for_agents"],
	["spans.read", {chain: Chain.cases.job.make({process: PID}), after: 0}, "not_for_agents"],
	[
		"spans.content",
		{chain: Chain.cases.job.make({process: PID}), spanId: "00f067aa0ba902b7"},
		"not_for_agents",
	],
	[
		"spans.deleteContent",
		{chain: Chain.cases.job.make({process: PID}), spanId: "00f067aa0ba902b7", why: "test"},
		"not_for_agents",
	],
	["window.msg", {pid: PID, m: save}, "not_for_agents"],
	["window.open", {pid: PID}, "not_for_agents"],
	["future.method", {}, "not_for_agents"],
];
describe("p64 every current public route and an unknown future method", () => {
	for (const [method, params, want] of matrix)
		it.effect(`${method} answers ${want} from its signed agent grant`, () => {
			const w = world();
			return Effect.gen(function* () {
				const {d, client} = yield* w.ready;
				const answer = yield* d.route(client, method, params);
				const expected = want === "not_for_agents" ? {_tag: "refused", why: want} : {_tag: want};
				expect(answer, "agent method allow rule").toMatchObject(expected);
			}).pipe(Effect.provide(w.door));
		});
	it.effect("trusted process program wins over a notes-like name and caller label", () => {
		const w = world();
		return Effect.gen(function* () {
			const {d, client} = yield* w.ready;
			refused(
				yield* d.route(client, "process.send", {
					...request("counter", COUNTER),
					program: "notes",
					target: "notes:1",
				}),
			);
			expect(w.deliveries).toEqual([]);
		}).pipe(Effect.provide(w.door));
	});
	it.effect("person-only input has no agent delivery", () => {
		const w = world();
		return Effect.gen(function* () {
			const {d, client} = yield* w.ready;
			refused(
				yield* d.route(client, "process.send", {
					...request("approve"),
					m: Input.cases.approve.make({answer: "yes"}),
				}),
			);
			expect(w.deliveries).toEqual([]);
		}).pipe(Effect.provide(w.door));
	});
	it.effect("p69 accepted agent input keeps the checked key and person in Mailbox.read", () => {
		const w = world();
		return Effect.gen(function* () {
			const {d, client} = yield* w.ready;
			expect((yield* d.route(client, "process.send", request()))._tag).toBe("ok");
			const rows = yield* C.Mailbox.use((m) => Stream.runCollect(m.read("notes:1", 0)));
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({by: w.agent.fingerprint, for: PERSON});
			expect(rows[0]?.by).not.toBe(w.window.fingerprint);
			expect(w.deliveries[0]?.envelope.by).toEqual(
				C.Writer.cases.agent.make({key: w.agent.fingerprint, for: PERSON}),
			);
		}).pipe(Effect.provide(w.door));
	});
	it.effect("p64 removal blocks later writes on the same connection", () => {
		const w = world();
		return Effect.gen(function* () {
			const {d, client} = yield* w.ready;
			yield* d.route(client, "process.send", request());
			const text = C.revokeText({
				id: "remove",
				key: w.agent.raw,
				for: PERSON,
				to: "exam-project",
				saw: {label: "Exam", where: "test", how: "panel", check: "touch"},
				sentAt: SENT,
			});
			expect((yield* d.grant({text, armored: w.root.sign(text)}))._tag).toBe("applied");
			const before = yield* C.Mailbox.use((m) => Stream.runCollect(m.read("notes:1", 0)));
			expect(yield* d.route(client, "process.send", request("after-remove"))).toMatchObject({
				_tag: "refused",
				why: "not_granted",
			});
			expect(yield* C.Mailbox.use((m) => Stream.runCollect(m.read("notes:1", 0)))).toEqual(before);
		}).pipe(Effect.provide(w.door));
	});
	it.effect("agent signatures cannot grant or revoke; editing a signed role fails", () => {
		const w = world();
		return Effect.gen(function* () {
			const {d} = yield* w.ready;
			const grant = {
				id: "agent-grant",
				key: w.window.raw,
				for: PERSON,
				to: "exam-project",
				as: "window",
				saw,
				sentAt: SENT,
			} as const;
			const revoke = C.revokeText({
				id: "agent-revoke",
				key: w.window.raw,
				for: PERSON,
				to: "exam-project",
				saw: {label: "Exam", where: "test", how: "panel", check: "touch"},
				sentAt: SENT,
			});
			for (const text of [C.grantText(grant), revoke])
				expect((yield* d.grant({text, armored: w.agent.sign(text)}))._tag).toBe("refused");
			const agentText = C.grantText({...grant, as: "agent"});
			expect(
				(yield* d.grant({text: C.grantText(grant), armored: w.root.sign(agentText)}))._tag,
			).toBe("refused");
		}).pipe(Effect.provide(w.door));
	});
	it("plant: default allow and a client-claimed person role are caught", () => {
		expect(() => refused({_tag: "ok", result: null})).toThrow(/agent method allow rule/);
	});
});
