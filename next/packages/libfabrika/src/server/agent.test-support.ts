// P8, next/, p64/p69, against main's real Door. P12 must add its decided agent allow rule,
// process lookup, view.open and tea message mapping. These laws stay red until that work lands.
import {createHash, generateKeyPairSync, sign} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {expect} from "@effect/vitest";
import {notes} from "@kampus/notes";
import {Effect, Layer, Schema, Stream} from "effect";
import * as C from "../coordination/index.ts";
import {
	Archive,
	Doorbell,
	Ledger,
	LedgerTransaction,
	RecordManager,
	SpanSink,
} from "../data/index.ts";
import {nodeSql} from "../data/sqlite.ts";
import * as Id from "../id.ts";
import {Door} from "./door.ts";

const PID = "process_0000000000e008000000000000";
const COUNTER = "process_0000000000e008000000000001";
const PERSON = "person_0000000000e008000000000000",
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
const opened: DatabaseSync[] = [];

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
		Id.Generator.layer,
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
		nextProcess: () => Id.Generator.use((g) => g.next(Id.Process)),
		inputs: {
			schema: notes.msg,
			personOnly: ["approve"],
			raw: [],
			log: Schema.toCodecJson(notes.msg),
		},
		facts: {personOnly: ["approved"]},
		notify: () => Effect.void,
		deliver: (pid: string, envelope: C.Envelope<unknown>) =>
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
			id: Id.Grant.make("grant_0000000000e008000000000000"),
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

// The full verifier, process manager and door above are real product code. No simulated door.
export const agentDoorFixture = Effect.fn("test.agentDoorFixture")(function* () {
	const w = world();
	yield* Effect.addFinalizer(() =>
		Effect.sync(() => {
			for (const db of opened.splice(0)) if (db.isOpen) db.close();
		}),
	);
	const services = yield* Layer.build(w.door);
	const ready = yield* w.ready.pipe(Effect.provide(services));
	return {
		call: (method: string, params: unknown) =>
			ready.d.route(ready.client, method, params).pipe(Effect.provide(services)),
		grant: Effect.void,
		revoke: Effect.gen(function* () {
			const text = C.revokeText({
				id: Id.Revoke.make("revoke_0000000000e008000000000000"),
				key: w.agent.raw,
				for: PERSON,
				to: "exam-project",
				saw: {label: "Exam", where: "test", how: "panel", check: "touch"},
				sentAt: SENT,
			});
			return yield* ready.d.grant({text, armored: w.root.sign(text)});
		}).pipe(Effect.provide(services)),
		entries: C.Mailbox.use((m) => Stream.runCollect(m.read("notes:1", 0))).pipe(
			Effect.provide(services),
		),
		change: (text: string, signer: "agent" | "person", signedText = text) =>
			ready.d
				.grant({text, armored: (signer === "person" ? w.root : w.agent).sign(signedText)})
				.pipe(Effect.provide(services)),
		agent: w.agent.raw,
		writer: w.agent.fingerprint,
		person: PERSON,
		target: PID,
		other: COUNTER,
	};
});
