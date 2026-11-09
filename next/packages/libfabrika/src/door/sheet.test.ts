// T331, next/. Real SQLite, ClientManager, SSHSIG and Door. No server or socket is simulated.
// HTTP-shaped preview answers are compared as bytes, before decoding their body.
import {
	createECDH,
	createHash,
	createHmac,
	createPrivateKey,
	createPublicKey,
	sign,
} from "node:crypto";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {DatabaseSync} from "node:sqlite";
import {format} from "node:util";
import {describe, expect, it, vi} from "@effect/vitest";
import {Effect, Layer, Logger, Redacted, Result, Schema, Stream} from "effect";
import * as Arbitrary from "effect/Arbitrary";
import {TestClock} from "effect/testing";
import {ClientManager} from "../coordination/client-manager.ts";
import {Add, Adds, admitted, allows, EMPTY, MemberFact} from "../coordination/members.ts";
import {ProcessIdGenerator} from "../coordination/process-id.ts";
import {addText, Change, enrollmentText, grantText, revokeText} from "../coordination/text.ts";
import {Archive} from "../data/archive.ts";
import {LedgerTransaction} from "../data/ledger-transaction.ts";
import {Doorbell, Ledger} from "../data/ledger.ts";
import {lineFor} from "../data/log.ts";
import {RecordManager} from "../data/records.ts";
import {SpanSink} from "../data/sink.ts";
import {nodeSql} from "../data/sqlite.ts";
import * as Id from "../id.ts";
import {KeyLine, verifySshsig, writeSshsig} from "../transport/sshsig.ts";
import {Door} from "./door.ts";
import {doorStore} from "./store.ts";

const options = {arbitrary: {runs: 100, size: 32, seed: 119120}};
const int = (minimum: number, maximum: number) =>
	Schema.Int.check(Schema.isBetween({minimum, maximum}));
const text = (minimum: number, maximum: number) =>
	Schema.String.check(Schema.isBetweenLength(minimum, maximum));
const ttl = 600_000; // Existing P10 door test configuration, never a second preview lifetime.
const Flow = Schema.Struct({
	seed: Schema.Array(int(0, 255)).check(Schema.isBetweenLength(32, 32)),
	entropy: Schema.Array(int(0, 255)).check(Schema.isBetweenLength(16, 16)),
	ops: Schema.Array(
		Schema.Literals(["make", "check", "replace", "recover", "refuse", "retry", "cancel", "fail"]),
	).check(Schema.isBetweenLength(1, 40)),
	changes: Schema.Array(
		Schema.Literals(["device", "sheet", "drop", "spent", "tab", "agent"]),
	).check(Schema.isBetweenLength(0, 3)),
	retries: int(0, 3),
	competitors: int(0, 2),
	reuse: int(0, 3),
	age: int(0, 2 * ttl),
	seen: Schema.Literals(["signed", "missing", "changed"]),
	delta: Schema.Union([int(-3, -1), int(1, 3)]),
	first: int(0, 11),
	offset: int(1, 11),
	failureSlot: int(0, 40),
	at: int(0, 86_400_000),
	devices: int(1, 6),
	children: int(0, 6),
	depth: int(0, 6),
	sheets: int(0, 3),
	drops: int(0, 12),
	label: text(0, 32),
	where: text(0, 32),
	name: text(1, 32),
	has: Schema.Array(text(1, 16)).check(Schema.isBetweenLength(0, 4)),
	url: Schema.Literals([
		"http://127.0.0.1:8787/entry/p28",
		"https://fabrika.test/entry/p28",
		"https://cloud.test/entry/p28",
	]),
	refusal: Schema.Literals([
		"malformed",
		"ledger",
		"url",
		"connection",
		"old",
		"reused",
		"unknown",
		"spent",
		"replaced",
		"window",
		"agent",
	]),
	old: Schema.Literals(["lost", "kept"]),
});
const flow = Arbitrary.schema(Flow).pipe(
	Arbitrary.map((a) => ({
		...a,
		failureAt: a.failureSlot % (a.ops.length + 1),
		second: (a.first + a.offset) % 12,
	})),
);
const plant = process.env.P28_PLANT;
const require = createRequire(import.meta.url);
const candidateEntropy = (a: typeof Flow.Type, n: number) => {
	const bytes = Uint8Array.from(a.entropy);
	bytes[15] = (bytes[15]! + n) % 256;
	return bytes;
};
const rejectedSocket = (frames: unknown[]) =>
	class {
		constructor(...args: unknown[]) {
			frames.push({direction: "to-network", args});
			throw new Error("unexpected socket in a local flow");
		}
	};
const SecretFlow = flow.pipe(
	Arbitrary.filter((a) => {
		// Independent fixture generation. Never call product code before capture starts.
		// Resolve only, so an unbuilt P28 is reported before its not-yet-installed dependencies.
		require.resolve("../desktop/sheet.ts");
		const bip39: {
			entropyToMnemonic: (entropy: Uint8Array, list: string[]) => string;
		} = require("@scure/bip39");
		const english: {wordlist: string[]} = require("@scure/bip39/wordlists/english.js");
		const words = Array.from({length: Math.min(40, a.ops.length + 1)}, (_, n) =>
			bip39.entropyToMnemonic(candidateEntropy(a, n), english.wordlist).split(" "),
		).flat();
		const publicText = JSON.stringify([
			"Fixture",
			"fixture",
			"p28",
			"person",
			"name",
			"keys",
			"rank",
			"live",
			"under",
			"spent",
			"replaced",
			"window",
			"agent",
			"recovery",
			"sheet",
			"signer",
			"signature",
			"armored",
			"text",
			"content",
			"result",
			"failure",
			"why",
			"matched",
			"checked",
			"word",
			"slot",
			"input",
			"output",
			"flow",
			"span",
			"request",
			"reply",
			"client",
			"connection",
			"nonce",
			"count",
			"total",
			"version",
			"tag",
			"storage",
			"cancel",
			"release",
			"close",
			"complete",
			"key",
			"seed",
			"read",
			"write",
			"make",
			"check",
			"confirm",
			"keep",
			"sign",
			"recover",
			"preview",
			"next",
			"data",
			"build",
			"parent",
			"cause",
			"message",
			"level",
			"date",
			"exit",
			"test.recovery.flow",
			"members.read",
			"members.write",
			"door.grant",
			"how",
			"touch",
			"typed",
			"kept",
			"old",
			"lost",
			"print",
			"hand",
			"pdf",
			"code",
			"label",
			"where",
			"has",
			"error",
			"start",
			"end",
			"status",
			"value",
			"body",
			"headers",
			"application/json",
			"applied",
			"ignored",
			"not_granted",
			"grant",
			"added",
			"revoked",
			"refused",
			"not_member",
			"not_allowed",
			"bad_signature",
			"stale",
			"sentAt",
			"arrivedAt",
			a.label,
			a.where,
			a.name,
			a.url,
			...a.has,
		]);
		return !words.some((w) =>
			new RegExp(`(^|[^a-zA-Z0-9_-])${w}($|[^a-zA-Z0-9_-])`).test(publicText),
		);
	}),
);
const person = "person_01m6v5270hf3c8x2q7w9z4k5mn",
	sentAt = "2026-11-09T00:00:00.000Z";
const pid = "process_01m6v5270hetdrt4r8h9vvjwjs";
const id = (n: number) => `input_01m6v5270hetdrt4r8${String(n).padStart(8, "0")}`;
const field = (value: Uint8Array | string) => {
	const b = Buffer.from(value),
		n = Buffer.alloc(4);
	n.writeUInt32BE(b.length);
	return Buffer.concat([n, b]);
};
const key = (seed: readonly number[], offset: number) => {
	const bytes = createHash("sha256").update(Buffer.from(seed)).update(String(offset)).digest();
	return seedKey(bytes);
};
const seedKey = (bytes: Uint8Array) => {
	const privateKey = createPrivateKey({
		key: Buffer.concat([
			Buffer.from("302e020100300506032b657004220420", "hex"),
			Buffer.from(bytes),
		]),
		format: "der",
		type: "pkcs8",
	});
	const raw = createPublicKey(privateKey).export({format: "der", type: "spki"}).subarray(-32);
	const blob = Buffer.concat([field("ssh-ed25519"), field(raw)]);
	const line = Schema.decodeUnknownSync(KeyLine)(`ssh-ed25519 ${blob.toString("base64")}`);
	const fingerprint = (b: Uint8Array) =>
		`SHA256:${createHash("sha256").update(b).digest("base64").replace(/=+$/, "")}`;
	return {
		line,
		raw: raw.toString("base64url"),
		fingerprint: fingerprint(raw),
		sshFingerprint: fingerprint(blob),
		sign: (text: string) =>
			writeSshsig({
				text,
				line,
				space: "fabrika-client",
				sign: (b) => Effect.sync(() => new Uint8Array(sign(null, b, privateKey))),
			}),
	};
};
const saw = (how: "sheet" | "device" | "recovery", old: "lost" | "kept" = "lost") => ({
	how,
	check: "touch" as const,
	where: "fixture",
	has: [],
	typed: how === "sheet",
	kept: how === "sheet" ? ("print" as const) : null,
	old: how === "recovery" ? old : null,
});

const world = Effect.fnUntraced(function* (a: typeof Flow.Type, publicVector = false) {
	const db = yield* Effect.acquireRelease(
		Effect.sync(() => new DatabaseSync(":memory:")),
		(db) => Effect.sync(() => db.close()),
	);
	const sql = nodeSql(db),
		root = publicVector ? seedKey(Buffer.alloc(32, 1)) : key(a.seed, 0),
		window = publicVector ? seedKey(Buffer.alloc(32, 2)) : key(a.seed, 1),
		sheet = publicVector ? seedKey(independentSeed(new Uint8Array(16))) : key(a.seed, 2),
		fresh = key(a.seed, 3),
		freshWindow = key(a.seed, 4),
		other = key(a.seed, 5),
		agent = key(a.seed, 6);
	if (publicVector) {
		const store = doorStore(sql);
		yield* store.atomic(() =>
			store.set("challengeKey", Schema.String, Buffer.alloc(32, 7).toString("base64url")),
		);
	}
	const notices: {client: string; news: unknown}[] = [],
		frames: unknown[] = [],
		logs: unknown[] = [];
	const founder = {
		name: "Fixture",
		person,
		keys: [root.line],
		window: window.raw,
		by: root.sshFingerprint,
		build: "test",
	};
	const ledger = Ledger.sql(sql, {reader: "p28"}).pipe(
		Layer.provide(Layer.succeed(Doorbell, {ring: () => Effect.void})),
	);
	const env = Layer.mergeAll(
		ledger,
		ClientManager.layer(founder).pipe(Layer.provide(ledger)),
		LedgerTransaction.layer(sql).pipe(
			Layer.provide(Layer.succeed(Doorbell, {ring: () => Effect.void})),
		),
		SpanSink.layer(sql, {object: pid}),
		RecordManager.memory(4 * 1024 * 1024),
		Archive.memory,
		ProcessIdGenerator.layer,
		Id.Generator.layer,
	);
	const layer = Door.layer({
		sql,
		founder,
		name: "p28",
		url: a.url,
		origins: ["https://fabrika.test"],
		versions: [1],
		location: "fixture",
		build: "test",
		waiting: {most: 20, ttl},
		ping: {min: 10_000, max: 60_000},
		inputCap: 1000,
		spentCap: 1000,
		nextProcess: () => ProcessIdGenerator.use((g) => g.next),
		deliver: () => Effect.void,
		notify: (client, news) =>
			Effect.sync(() => {
				notices.push({client, news});
				frames.push({direction: "from-door", client, news});
			}),
		inputs: {schema: Schema.Json, personOnly: [], raw: [], log: Schema.Json},
		facts: {personOnly: []},
	}).pipe(Layer.provideMerge(env));
	const services = yield* Layer.build(layer);
	const door = yield* Door.pipe(Effect.provideContext(services));
	const rows = (stream = "door/members") =>
		Ledger.use((l) => Stream.runCollect(l.read(stream, 0))).pipe(Effect.provideContext(services));
	const members = ClientManager.use((m) => m.members).pipe(Effect.provideContext(services));
	const grant = (signer: ReturnType<typeof key>, text: string) =>
		Effect.gen(function* () {
			const request = {text, armored: yield* signer.sign(text)};
			frames.push({direction: "to-door", method: "grant", request});
			const answer = yield* door.grant(request);
			frames.push({direction: "from-door", answer});
			return answer;
		});
	const add = (
		n: number,
		adds: typeof Adds.Type,
		how: "sheet" | "device" | "recovery",
		drops: readonly string[] = [],
		seen: number | null = null,
	) => ({
		...Add.make({id: id(n), for: person, to: "p28", adds, drops, saw: saw(how), sentAt}),
		seen,
	});
	const install = yield* grant(
		root,
		addText(add(1, Adds.cases.recovery.make({key: sheet.line, v: 1}), "sheet")),
	);
	expect(install._tag).toBe("applied");
	const snapshot = () => sql.exec("SELECT * FROM entries ORDER BY rev");
	return {
		db,
		sql,
		root,
		window,
		sheet,
		fresh,
		freshWindow,
		other,
		agent,
		door,
		rows,
		members,
		grant,
		add,
		snapshot,
		frames,
		logs,
		notices,
		services,
	};
});
type World = Effect.Success<ReturnType<typeof world>>;
const device = (w: World, n: number, seen: number | null, drops: readonly string[] = []) =>
	w.add(
		n,
		Adds.cases.person.make({key: w.fresh.line, window: w.freshWindow.raw}),
		"recovery",
		drops,
		seen,
	);
const preview = (w: World, a: typeof Flow.Type, signer = w.sheet) =>
	Effect.gen(function* () {
		const SheetDoor = yield* Effect.promise(() => import("./sheet.ts"));
		const connection = yield* w.door.connect(),
			nonce = yield* w.door.challenge(connection);
		const text = SheetDoor.previewText({to: "p28", url: a.url, connection, nonce});
		const proof = {text, armored: yield* signer.sign(text)};
		const call = (input = proof, client = connection, url: string = a.url) =>
			Effect.gen(function* () {
				w.frames.push({direction: "to-door", method: "preview", proof: input});
				if (plant === "no-ttl") yield* TestClock.setTime(Number(nonce.split(".")[0]));
				const answer = yield* w.door.preview(
					plant === "other-connection" ? connection : client,
					input,
					{url: plant === "other-url" ? a.url : url},
				);
				if (plant === "skip-nonce-spend" && answer.status === 200)
					w.sql.exec("DELETE FROM door_spent WHERE nonce=?", nonce);
				if (plant === "spend-before-proof" && input.armored === "invalid")
					w.sql.exec("INSERT OR IGNORE INTO door_spent (nonce,until) VALUES (?,?)", nonce, 2 * ttl);
				w.frames.push({direction: "from-door", answer});
				return answer;
			});
		return {connection, nonce, text, proof, call};
	});
const reply = (response: {status: number; headers: readonly [string, string][]; body: string}) => ({
	status: response.status,
	headers: response.headers,
	body: response.body,
});

describe("P28 door", () => {
	it.effect.prop(
		"L7 history: recovery preserves founded and every old note row including authors",
		{a: flow},
		({a}) =>
			Effect.gen(function* () {
				const w = yield* world(a);
				const Saved = Schema.TaggedStruct("saved", {text: Schema.String});
				yield* Ledger.use((l) =>
					l.append(
						"notes",
						id(40),
						lineFor(
							{
								by: w.agent.fingerprint,
								for: person,
								sentAt,
								seen: 2,
								parent: null,
								traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
								build: "test",
							},
							Saved.make({text: a.name}),
						),
					),
				).pipe(Effect.provideContext(w.services));
				const before = yield* w.rows("notes"),
					founding = (yield* w.rows())[0];
				expect(
					(yield* w.grant(w.sheet, addText(device(w, 2, 2, [w.root.line, w.window.raw]))))._tag,
				).toBe("applied");
				const after = yield* w.rows("notes");
				const observed =
					plant === "rewrite-authors"
						? after.map((row) => ({...row, by: w.fresh.fingerprint}))
						: after;
				expect(observed).toEqual(before);
				expect((yield* w.rows())[0]).toEqual(founding);
				expect((yield* w.members).person).toBe(person);
				expect((yield* w.members).name).toBe("Fixture");
			}),
		options,
	);
	it.effect.prop(
		"L10 race: real competing appends have one winner and retries keep the first placing",
		{a: flow},
		({a}) =>
			Effect.gen(function* () {
				const w = yield* world(a);
				const texts = Array.from({length: 1 + a.competitors}, (_, n) =>
					addText(
						w.add(
							2 + n,
							Adds.cases.person.make({
								key: key(a.seed, 20 + n).line,
								window: key(a.seed, 30 + n).raw,
							}),
							"recovery",
							[],
							2,
						),
					),
				);
				const answers = yield* Effect.all(
					texts.map((text) => w.grant(w.sheet, text)),
					{concurrency: 2},
				);
				expect(answers.filter((answer) => answer._tag === "applied")).toHaveLength(1);
				for (const [n, answer] of answers.entries()) {
					const observed = plant === "loser-applied" && n > 0 ? {_tag: "applied"} : answer;
					expect(observed._tag === "applied").toBe(
						n === answers.findIndex((a) => a._tag === "applied"),
					);
					const before = w.snapshot();
					if (answer._tag === "applied" || answer._tag === "ignored")
						for (let retry = 0; retry < a.retries; retry++)
							expect(yield* w.grant(w.sheet, texts[n]!)).toEqual(answer);
					expect(w.snapshot()).toEqual(before);
				}
			}),
		options,
	);
	it.effect(
		"vector: L26 real OpenSSH preview passes once, refuses another connection and spent sheet alike",
		() =>
			Effect.gen(function* () {
				const fixed = Schema.decodeUnknownSync(Flow)({
					seed: Array(32).fill(9),
					entropy: Array(16).fill(0),
					ops: ["recover"],
					changes: [],
					retries: 0,
					competitors: 0,
					reuse: 0,
					age: 0,
					seen: "signed",
					delta: 1,
					first: 0,
					offset: 1,
					failureSlot: 0,
					at: 0,
					devices: 1,
					children: 0,
					depth: 0,
					sheets: 1,
					drops: 0,
					label: "",
					where: "",
					name: "Fixture",
					has: [],
					url: "https://fabrika.test/entry/p28",
					refusal: "reused",
					old: "lost",
				});
				const f: {
					preview: {connection: string};
					signatures: {name: string; text: string; armored: string}[];
				} = JSON.parse(
					readFileSync(
						new URL("../../../../../fixtures/next/recovery/sshsig.json", import.meta.url),
						"utf8",
					),
				);
				const w = yield* world(fixed, true);
				yield* TestClock.setTime(0);
				const v = f.signatures.find((v) => v.name === "preview")!;
				const connection = Schema.decodeUnknownSync(
					Schema.NonEmptyString.pipe(Schema.brand("ConnectionId")),
				)(f.preview.connection);
				const call = (client = connection) =>
					w.door.preview(client, {text: v.text, armored: v.armored}, {url: fixed.url});
				const wrong = yield* call(yield* w.door.connect());
				expect(JSON.parse(wrong.body)).toEqual({_tag: "refused", why: "not_member"});
				const before = w.snapshot();
				expect((yield* call()).status).toBe(200);
				expect(w.snapshot()).toEqual(before);
				const reused = yield* call();
				expect(reply(reused)).toEqual(reply(wrong));
				const recover = f.signatures.find((v) => v.name === "recover")!;
				expect((yield* w.door.grant({text: recover.text, armored: recover.armored}))._tag).toBe(
					"applied",
				);
				expect(reply(yield* call())).toEqual(reply(wrong));
			}),
	);
	it.effect.prop(
		"L12 door: foreign targets/drops and unknown valid signatures write nothing",
		{a: flow},
		({a}) =>
			Effect.gen(function* () {
				const w = yield* world(a),
					before = w.snapshot();
				const foreign = {...device(w, 2, 2), drops: [w.other.line]};
				expect(yield* w.grant(w.root, addText(foreign))).toMatchObject({
					_tag: "refused",
					why: "not_member",
				});
				expect(w.snapshot()).toEqual(before);
				expect(yield* w.grant(w.sheet, addText({...device(w, 3, 2), to: "another"}))).toMatchObject(
					{_tag: "refused", why: "wrong_ledger"},
				);
				expect(w.snapshot()).toEqual(before);
				expect(yield* w.grant(w.other, addText(device(w, 4, 2)))).toMatchObject({
					_tag: "refused",
					why: "not_member",
				});
				expect(w.snapshot()).toEqual(before);
			}),
		options,
	);
	it.effect.prop(
		"L12 unknown: a cryptographically valid unknown sheet gets not_member, never bad_signature",
		{a: flow},
		({a}) =>
			Effect.gen(function* () {
				const w = yield* world(a),
					before = w.snapshot();
				expect(yield* w.grant(w.other, addText(device(w, 2, 2)))).toMatchObject({
					_tag: "refused",
					why: "not_member",
				});
				expect(w.snapshot()).toEqual(before);
			}),
		options,
	);
	it.effect.prop(
		"L12 target: another ledger is refused before any member write",
		{a: flow},
		({a}) =>
			Effect.gen(function* () {
				const w = yield* world(a),
					before = w.snapshot();
				expect(yield* w.grant(w.sheet, addText({...device(w, 2, 2), to: "another"}))).toMatchObject(
					{_tag: "refused", why: "wrong_ledger"},
				);
				expect(w.snapshot()).toEqual(before);
			}),
		options,
	);
	it.effect.prop(
		"L6 integration: lost drops the selected root; kept preserves peers and descendants",
		{a: flow},
		({a}) =>
			Effect.gen(function* () {
				const w = yield* world(a),
					before = yield* w.members;
				const add = {
					...device(w, 2, 2, a.old === "kept" ? [] : [w.root.line, w.window.raw]),
					saw: saw("recovery", a.old),
				};
				expect(before.keys.has(w.fresh.line)).toBe(false);
				expect(before.keys.has(w.freshWindow.raw)).toBe(false);
				const answer = yield* w.grant(w.sheet, addText(add));
				expect(answer._tag).toBe("applied");
				const after = yield* w.members;
				expect(after.keys.get(w.root.line)?.live).toBe(a.old === "kept");
				expect(admitted(after, w.window.raw)).toEqual(
					a.old === "kept" ? {key: w.window.raw, person, as: "window"} : {why: "not_granted"},
				);
				expect(admitted(after, w.freshWindow.raw)).toEqual({
					key: w.freshWindow.raw,
					person,
					as: "window",
				});
				expect(after.keys.get(w.fresh.line)?.under).toBeNull();
				expect(after.spent.has(w.sheet.line)).toBe(true);
			}),
		options,
	);
	it.effect.prop(
		"L13: fresh bound preview reveals only this person and changes no membership",
		{a: flow},
		({a}) =>
			Effect.gen(function* () {
				const w = yield* world(a),
					p = yield* preview(w, a),
					before = w.snapshot(),
					members = yield* w.members;
				const answer = yield* p.call();
				expect(answer.status).toBe(200);
				const body = JSON.parse(answer.body);
				expect(body).toMatchObject({_tag: "preview", person, name: "Fixture", rev: 2});
				expect(body.devices.map((d: {key: string}) => d.key)).toEqual([w.root.line]);
				expect(body.devices[0]).toMatchObject({windows: 1, agents: 0});
				expect(w.snapshot()).toEqual(before);
				expect(yield* w.members).toEqual(members);
				expect(admitted(yield* w.members, w.sheet.raw)).toEqual({why: "not_granted"});
			}),
		options,
	);
	it.effect.prop(
		"L14 [new, a]: all preview refusals have identical status, headers and body",
		{a: flow},
		({a}) =>
			Effect.gen(function* () {
				const answers: ReturnType<typeof reply>[] = [];
				// Every cause on every generated history. Shrinking cannot silently omit a cause.
				for (const cause of [
					"malformed",
					"ledger",
					"url",
					"connection",
					"old",
					"reused",
					"unknown",
					"spent",
					"replaced",
					"window",
					"agent",
				] as const) {
					const w = yield* world(a);
					if (cause === "spent") yield* w.grant(w.sheet, addText(device(w, 2, 2)));
					if (cause === "replaced")
						yield* w.grant(
							w.root,
							addText(w.add(2, Adds.cases.recovery.make({key: w.other.line, v: 1}), "sheet")),
						);
					const p = yield* preview(
						w,
						a,
						cause === "unknown"
							? w.other
							: cause === "window"
								? w.window
								: cause === "agent"
									? w.agent
									: w.sheet,
					);
					const before = w.snapshot();
					if (cause === "reused") yield* p.call();
					if (cause === "old") yield* TestClock.adjust(ttl);
					const SheetDoor = yield* Effect.promise(() => import("./sheet.ts"));
					const text =
						cause === "ledger"
							? SheetDoor.previewText({
									to: "another",
									url: a.url,
									connection: p.connection,
									nonce: p.nonce,
								})
							: p.text;
					const proof = {
						text,
						armored:
							cause === "malformed"
								? "bad"
								: yield* (
										cause === "unknown"
											? w.other
											: cause === "window"
												? w.window
												: cause === "agent"
													? w.agent
													: w.sheet
									).sign(text),
					};
					const connection = cause === "connection" ? yield* w.door.connect() : p.connection;
					const response = yield* p.call(
						proof,
						connection,
						cause === "url" ? `${a.url}/other` : a.url,
					);
					const observed =
						plant === "refusal-oracle" && cause === "spent"
							? {...response, body: '{"_tag":"refused","why":"used"}'}
							: response;
					answers.push(reply(observed));
					expect(JSON.parse(observed.body)).toEqual({_tag: "refused", why: "not_member"});
					expect(w.snapshot()).toEqual(before);
				}
				expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
			}),
		options,
	);
	it.effect.prop(
		"L15 [new, b]: one challenge, connection and ttl; bad signature leaves it unspent",
		{a: flow},
		({a}) =>
			Effect.gen(function* () {
				const w = yield* world(a),
					p = yield* preview(w, a);
				const before = w.sql.exec("SELECT * FROM door_spent");
				const bad = yield* p.call({...p.proof, armored: "invalid"});
				expect(JSON.parse(bad.body)).toMatchObject({why: "not_member"});
				expect(w.sql.exec("SELECT * FROM door_spent")).toEqual(before);
				expect((yield* p.call()).status).toBe(200);
				for (let n = 0; n < a.reuse; n++)
					expect(JSON.parse((yield* p.call()).body)).toMatchObject({why: "not_member"});
				const other = yield* preview(w, a),
					connection = yield* w.door.connect();
				expect(JSON.parse((yield* other.call(other.proof, connection)).body)).toMatchObject({
					why: "not_member",
				});
				yield* TestClock.adjust(a.age);
				const age = yield* other.call();
				expect(age.status === 200).toBe(a.age < ttl);
				const edge = yield* preview(w, a);
				yield* TestClock.adjust(ttl);
				expect(JSON.parse((yield* edge.call()).body)).toMatchObject({why: "not_member"});
			}),
		options,
	);
	it.effect.prop(
		"L16 [new, c] signature: changing signed seen writes nothing and spends nothing",
		{a: flow},
		({a}) =>
			Effect.gen(function* () {
				const w = yield* world(a),
					add = device(w, 2, 2),
					text = addText(add),
					armored = yield* w.sheet.sign(text);
				const changed = addText({...add, seen: 2 + a.delta}),
					before = w.snapshot();
				const answer = yield* w.door.grant({text: changed, armored});
				expect(answer).toMatchObject({_tag: "refused", why: "bad_signature"});
				expect(w.snapshot()).toEqual(before);
				expect((yield* w.members).spent.has(w.sheet.line)).toBe(false);
				expect(JSON.parse(text).add.seen).toBe(2);
				expect(changed).not.toBe(text);
			}),
		options,
	);
	it.effect.prop(
		"L16 [new, c] placement: signed seen is preserved; missing/stale refuses before append",
		{a: flow},
		({a}) =>
			Effect.gen(function* () {
				for (const change of [
					"none",
					"device",
					"sheet",
					"drop",
					"spent",
					"tab",
					"agent",
					"missing",
				] as const) {
					const w = yield* world(a);
					let seen = 2;
					if (change === "drop") {
						const placed = yield* w.grant(
							w.root,
							addText(
								w.add(
									20,
									Adds.cases.person.make({key: w.other.line, window: w.agent.raw}),
									"device",
								),
							),
						);
						if (placed._tag !== "applied") return yield* Effect.die("fixture device was refused");
						seen = (yield* w.rows()).at(-1)!.rev;
					}
					if (change === "device")
						yield* w.grant(
							w.root,
							addText(
								w.add(
									2,
									Adds.cases.person.make({key: w.other.line, window: w.agent.raw}),
									"device",
								),
							),
						);
					if (change === "sheet")
						yield* w.grant(
							w.root,
							addText(w.add(2, Adds.cases.recovery.make({key: w.other.line, v: 1}), "sheet")),
						);
					if (change === "drop")
						yield* w.grant(
							w.root,
							revokeText({
								id: id(2),
								key: w.other.line,
								for: person,
								to: "p28",
								sentAt,
								saw: {label: "fixture", where: "fixture", how: "panel", check: "touch"},
							}),
						);
					if (change === "spent")
						yield* w.grant(
							w.sheet,
							addText(
								w.add(
									2,
									Adds.cases.person.make({key: w.other.line, window: w.agent.raw}),
									"recovery",
									[],
									2,
								),
							),
						);
					if (change === "tab" || change === "agent")
						yield* w.grant(
							w.root,
							grantText({
								id: id(2),
								key: w.agent.raw,
								for: person,
								to: "p28",
								as: change === "tab" ? "window" : "agent",
								sentAt,
								saw: {
									code: "1234",
									label: "fixture",
									where: "fixture",
									how: "command",
									check: "touch",
									has: [],
								},
							}),
						);
					const before = w.snapshot(),
						old = yield* w.members;
					const text = addText(device(w, 3, change === "missing" ? null : seen));
					const first = yield* w.grant(w.sheet, text);
					const stale = ["device", "sheet", "drop", "spent", "missing"].includes(change);
					expect(first).toMatchObject(stale ? {_tag: "refused", why: "stale"} : {_tag: "applied"});
					const rows = yield* w.rows();
					expect(w.snapshot().length).toBe(before.length + (stale ? 0 : 1));
					expect((yield* w.members).spent.has(w.sheet.line)).toBe(
						stale ? old.spent.has(w.sheet.line) : true,
					);
					expect(stale ? old : rows.at(-1)?.seen).toEqual(stale ? yield* w.members : seen);
					if (!stale)
						for (let n = 0; n < a.retries; n++)
							expect(yield* w.grant(w.sheet, text)).toEqual(first);
				}
			}),
		options,
	);
	it.effect.prop(
		"L17 [new, c race]: old Mac's new key cannot hide behind equal counts or raised seen",
		{a: flow},
		({a}) =>
			Effect.gen(function* () {
				for (const attack of ["device", "sheet", "same-count"] as const) {
					const w = yield* world(a),
						rev = (yield* w.rows()).at(-1)!.rev;
					const original = device(w, 5, rev, [w.root.line, w.window.raw]);
					const ownCount = (m: Awaited<Effect.Success<typeof w.members>>) =>
						[...m.keys.values()].filter(
							(k) => k.live && (k.rank === "person" || k.rank === "recovery"),
						).length;
					const beforeCount = ownCount(yield* w.members);
					const signed = yield* w.sheet.sign(addText(original));
					const added = w.add(
						2,
						attack === "sheet"
							? Adds.cases.recovery.make({key: w.other.line, v: 1})
							: Adds.cases.person.make({key: w.other.line, window: w.agent.raw}),
						attack === "sheet" ? "sheet" : "device",
					);
					yield* w.grant(w.root, addText(added));
					if (attack === "same-count")
						yield* w.grant(
							w.other,
							revokeText({
								id: id(3),
								key: w.root.line,
								for: person,
								to: "p28",
								sentAt,
								saw: {label: "fixture", where: "fixture", how: "panel", check: "touch"},
							}),
						);
					const head = (yield* w.rows()).at(-1)!.rev,
						before = w.snapshot(),
						members = yield* w.members;
					expect(attack === "same-count" ? ownCount(members) : beforeCount).toBe(beforeCount);
					// Raising seen to the new head is the exact attack in the exam amendment.
					expect(
						yield* w.door.grant({text: addText({...original, seen: head}), armored: signed}),
					).toMatchObject({_tag: "refused", why: "bad_signature"});
					expect(w.snapshot()).toEqual(before);
					expect(yield* w.members).toEqual(members);
					expect(yield* w.door.grant({text: addText(original), armored: signed})).toMatchObject({
						_tag: "refused",
						why: "stale",
					});
					expect(w.snapshot()).toEqual(before);
					expect(yield* w.members).toEqual(members);
					const p = yield* preview(w, a, w.sheet);
					const answer = yield* p.call();
					if (attack === "sheet") {
						const refused = yield* p.call({...p.proof, armored: "bad"});
						expect(JSON.parse(answer.body)).toEqual({_tag: "refused", why: "not_member"});
						expect(reply(answer)).toEqual(reply(refused));
						expect(w.snapshot()).toEqual(before);
						expect(yield* w.members).toEqual(members);
						continue;
					}
					const read = JSON.parse(answer.body);
					expect(read.rev).toBe(head);
					expect(read.devices.some((d: {key: string}) => d.key === w.other.line)).toBe(true);
					const lost = {
						...device(w, 6, read.rev, [
							...read.devices.map((d: {key: string}) => d.key),
							w.root.line,
						]),
						saw: saw("recovery", "lost"),
					};
					expect((yield* w.grant(w.sheet, addText(lost)))._tag).toBe("applied");
					expect((yield* w.members).keys.get(w.other.line)?.live).toBe(false);
				}
			}),
		options,
	);
	it.effect.prop(
		"L16 generated history: 0..3 member changes, signed/missing/tampered seen, exact retry",
		{
			a: flow.pipe(
				Arbitrary.filter((a) => {
					let peers = 1,
						sheet = true;
					for (const change of a.changes) {
						if (change === "drop" && peers-- === 0) return false;
						if (change === "device") peers++;
						if (change === "sheet") sheet = true;
						if (change === "spent") {
							if (!sheet) return false;
							sheet = false;
							peers++;
						}
					}
					return true;
				}),
			),
		},
		({a}) =>
			Effect.gen(function* () {
				const w = yield* world(a);
				const initial = yield* w.grant(
					w.root,
					addText(
						w.add(20, Adds.cases.person.make({key: w.other.line, window: w.agent.raw}), "device"),
					),
				);
				expect(initial._tag).toBe("applied");
				const seen = (yield* w.rows()).at(-1)!.rev,
					peers = [w.other.line];
				let active = w.sheet;
				const beforeChanges = (yield* w.rows()).length;
				for (const [i, change] of a.changes.entries()) {
					const k = key(a.seed, 50 + i),
						child = key(a.seed, 60 + i),
						n = 30 + i;
					const head = (yield* w.rows()).at(-1)!.rev;
					if (change === "device" || change === "spent") {
						const answer = yield* w.grant(
							change === "spent" ? active : w.root,
							addText(
								w.add(
									n,
									Adds.cases.person.make({key: k.line, window: child.raw}),
									change === "spent" ? "recovery" : "device",
									[],
									head,
								),
							),
						);
						if (answer._tag !== "applied")
							return yield* Effect.die("generated device fixture failed");
						peers.push(k.line);
					} else if (change === "sheet") {
						const answer = yield* w.grant(
							w.root,
							addText(w.add(n, Adds.cases.recovery.make({key: k.line, v: 1}), "sheet")),
						);
						if (answer._tag !== "applied")
							return yield* Effect.die("generated sheet fixture failed");
						active = k;
					} else if (change === "drop") {
						const answer = yield* w.grant(
							w.root,
							revokeText({
								id: id(n),
								key: peers.pop()!,
								to: "p28",
								for: person,
								sentAt,
								saw: {label: "fixture", where: "fixture", how: "panel", check: "touch"},
							}),
						);
						if (answer._tag !== "applied")
							return yield* Effect.die("generated drop fixture failed");
					} else {
						const answer = yield* w.grant(
							w.root,
							grantText({
								id: id(n),
								key: child.raw,
								to: "p28",
								for: person,
								as: change === "tab" ? "window" : "agent",
								sentAt,
								saw: {
									code: "1234",
									label: "fixture",
									where: "fixture",
									how: "command",
									check: "touch",
									has: [],
								},
							}),
						);
						if (answer._tag !== "applied")
							return yield* Effect.die("generated child fixture failed");
					}
				}
				expect((yield* w.rows()).length - beforeChanges).toBe(a.changes.length);
				const before = w.snapshot(),
					members = yield* w.members;
				const add = device(w, 99, a.seen === "missing" ? null : seen),
					text = addText(add),
					armored = yield* w.sheet.sign(text);
				const received = a.seen === "changed" ? addText({...add, seen: seen + a.delta}) : text;
				const first = yield* w.door.grant({text: received, armored});
				const stale = a.seen === "missing" || a.changes.some((c) => c !== "tab" && c !== "agent");
				const refused = stale || a.seen === "changed";
				expect(first).toMatchObject(
					refused
						? {_tag: "refused", why: a.seen === "changed" ? "bad_signature" : "stale"}
						: {_tag: "applied"},
				);
				expect(w.snapshot().length).toBe(before.length + (refused ? 0 : 1));
				expect(refused ? yield* w.members : members).toEqual(members);
				expect(refused ? seen : (yield* w.rows()).at(-1)!.seen).toBe(seen);
				if (!refused)
					for (let n = 0; n < a.retries; n++)
						expect(yield* w.door.grant({text: received, armored})).toEqual(first);
			}),
		options,
	);
	it.effect.prop(
		"L18 door: a window's checked result keeps its original time, retries once and changes no membership",
		{a: flow},
		({a}) =>
			Effect.gen(function* () {
				const C = yield* Effect.promise(() => import("../coordination/sheet-check.ts"));
				const w = yield* world(a),
					members = yield* w.members;
				const checkedAt = new Date(Date.UTC(2026, 10, 9) + a.at).toISOString();
				const check = C.Check.make({
					id: "check_01m6v5270hf3c8x2q7w9z4k5mn",
					to: "p28",
					sentAt: checkedAt,
					matched: a.old === "kept",
				});
				for (const signer of [w.root, w.other]) {
					const text = C.checkText(check),
						before = w.snapshot();
					expect(yield* w.door.checkSheet({text, armored: yield* signer.sign(text)})).toMatchObject(
						{_tag: "refused"},
					);
					expect(w.snapshot()).toEqual(before);
				}
				const text = C.checkText(check),
					proof = {text, armored: yield* w.window.sign(text)};
				const first = yield* w.door.checkSheet(proof),
					rows = yield* w.rows("door/checks");
				expect(first._tag).toBe("applied");
				expect(rows).toHaveLength(1);
				expect(rows[0]).toMatchObject({
					_tag: "checked",
					by: w.window.fingerprint,
					for: person,
					sentAt: checkedAt,
					body: {matched: check.matched},
				});
				expect(yield* w.members).toEqual(members);
				for (let n = 0; n < a.retries; n++) {
					yield* TestClock.adjust(1);
					expect(yield* w.door.checkSheet(proof)).toEqual(first);
				}
				expect(yield* w.rows("door/checks")).toEqual(rows);
				yield* w.grant(
					w.sheet,
					addText(device(w, 300, (yield* w.rows()).at(-1)!.rev, [w.root.line, w.window.raw])),
				);
				const later = C.checkText({...check, id: "check_01m6v5270hf3c8x2q7w9z4k5m1"});
				expect(
					yield* w.door.checkSheet({text: later, armored: yield* w.window.sign(later)}),
				).toMatchObject({_tag: "refused"});
				expect(yield* w.rows("door/checks")).toEqual(rows);
			}),
		options,
	);
	it.effect.prop(
		"L19: removed clients get 4003 and cannot write; counts exclude surviving roots",
		{a: flow},
		({a}) =>
			Effect.gen(function* () {
				const w = yield* world(a);
				const connect = (k: ReturnType<typeof key>, tab: string) =>
					Effect.gen(function* () {
						const client = yield* w.door.connect(),
							nonce = yield* w.door.challenge(client);
						const initialized = yield* w.door.initialize(
							client,
							{
								versions: [1],
								has: [],
								ping: "30s",
								key: k.raw,
								tab,
								nonce,
								platform: "browser",
								os: "ios",
								sentAt,
								signed: yield* k.sign(`fabrika-hello\n${a.url}\n${tab}\n${nonce}`),
							},
							{url: a.url, tab, name: k.fingerprint},
						);
						expect(initialized._tag).toBe("online");
						return client;
					});
				const old = yield* connect(w.window, "old");
				yield* w.grant(
					w.root,
					grantText({
						id: id(2),
						key: w.agent.raw,
						for: person,
						to: "p28",
						as: "agent",
						sentAt,
						saw: {
							code: "1234",
							label: "fixture",
							where: "fixture",
							how: "command",
							check: "touch",
							has: [],
						},
					}),
				);
				const agent = yield* connect(w.agent, "agent");
				const before = yield* w.members;
				expect(
					(yield* w.grant(w.sheet, addText(device(w, 3, 3, [w.root.line, w.window.raw]))))._tag,
				).toBe("applied");
				for (const client of [old, agent]) {
					expect(
						(plant === "skip-close" ? [] : w.notices).some(
							(n) => n.client === client && JSON.stringify(n.news) === '{"close":4003}',
						),
					).toBe(true);
					expect(
						yield* w.door.route(client, "process.send", {
							pid,
							letter: id(4),
							m: {},
							sentAt,
							seen: 0,
						}),
					).toMatchObject({_tag: "refused", why: "not_granted"});
				}
				const SheetDoor = yield* Effect.promise(() => import("./sheet.ts"));
				expect(SheetDoor.removalCounts(before, yield* w.members)).toEqual({
					devices: 1,
					windows: 1,
					agents: 1,
				});
			}),
		options,
	);
});

// Signature checks that need membership run here, above the layers they exercise.
type Vector = {name: string; signer: string; text: string; armored: string};
const fixture: {
	keys: Record<string, string>;
	preview: {to: string; url: string; connection: string; nonce: string};
	signatures: Vector[];
} = JSON.parse(
	readFileSync(
		new URL("../../../../../fixtures/next/recovery/sshsig.json", import.meta.url),
		"utf8",
	),
);
const vector = (name: string) => fixture.signatures.find((s) => s.name === name)!;
const check = (v: Vector, text = v.text) =>
	verifySshsig({text, armored: v.armored, signers: [v.signer], space: "fabrika-client"});
const Byte = int(0, 255);
const Input = Schema.Struct({
	seed: Schema.Array(Byte).check(Schema.isBetweenLength(32, 32)),
	credential: Schema.Array(Byte).check(Schema.isBetweenLength(16, 64)),
	uv: Schema.Boolean,
	be: Schema.Boolean,
	bs: Schema.Boolean,
	counter: int(0, 86_400_000),
	text: Schema.String.check(Schema.isBetweenLength(0, 32)),
});
const Point = Schema.Array(Byte).check(Schema.isBetweenLength(65, 65));
const Signature = Schema.Array(Byte).check(Schema.isBetweenLength(64, 64));
const u32 = (n: number) => {
	const b = Buffer.alloc(4);
	b.writeUInt32BE(n);
	return b;
};
const recoveryDoor = Effect.fnUntraced(function* () {
	const db = yield* Effect.acquireRelease(
		Effect.sync(() => new DatabaseSync(":memory:")),
		(db) => Effect.sync(() => db.close()),
	);
	const sql = nodeSql(db),
		quiet = Layer.succeed(Doorbell, {ring: () => Effect.void});
	const ledger = Ledger.sql(sql, {reader: "p28-passkey"}).pipe(Layer.provide(quiet));
	const founder = {
		name: "Fixture",
		person,
		keys: [fixture.keys.person!],
		window: fixture.keys.window!,
		by: "SHA256:fixture",
		build: "test",
	};
	const pid = "process_01m6v5270hetdrt4r8h9vvjwjs";
	const env = Layer.mergeAll(
		ledger,
		ClientManager.layer(founder).pipe(Layer.provide(ledger)),
		LedgerTransaction.layer(sql).pipe(Layer.provide(quiet)),
		SpanSink.layer(sql, {object: pid}),
		RecordManager.memory(4 * 1024 * 1024),
		Archive.memory,
		ProcessIdGenerator.layer,
		Id.Generator.layer,
	);
	const layer = Door.layer({
		sql,
		founder,
		name: "p28",
		url: fixture.preview.url,
		origins: ["https://fabrika.test"],
		versions: [1],
		location: "fixture",
		build: "test",
		waiting: {most: 20, ttl: 600_000},
		ping: {min: 10_000, max: 60_000},
		inputCap: 1000,
		spentCap: 1000,
		nextProcess: () => ProcessIdGenerator.use((g) => g.next),
		deliver: () => Effect.void,
		notify: () => Effect.void,
		inputs: {schema: Schema.Json, personOnly: [], raw: [], log: Schema.Json},
		facts: {personOnly: []},
	}).pipe(Layer.provideMerge(env));
	const context = yield* Layer.build(layer),
		door = yield* Door.pipe(Effect.provideContext(context));
	const sheet = vector("sheet");
	expect((yield* door.grant({text: sheet.text, armored: sheet.armored}))._tag).toBe("applied");
	return {
		door,
		members: ClientManager.use((m) => m.members).pipe(Effect.provideContext(context)),
		snapshot: () => sql.exec("SELECT * FROM entries ORDER BY rev"),
	};
});

describe("P28 signed recovery integration", () => {
	for (const name of [
		"window-add",
		"agent-add",
		"recovery-sheet",
		"recovery-grant",
		"foreign-drop",
		"other-ledger",
		"spent",
		"replaced",
	] as const) {
		it.effect(`vector: L25 real OpenSSH ${name} writes nothing`, () =>
			Effect.gen(function* () {
				const w = yield* recoveryDoor();
				if (name === "spent" || name === "replaced") {
					const setup = vector(name === "spent" ? "recover" : "new-sheet");
					const placed = yield* w.door.grant({text: setup.text, armored: setup.armored});
					if (placed._tag !== "applied") return yield* Effect.die("public fixture setup failed");
				}
				const v = vector(name === "spent" || name === "replaced" ? "recover-again" : name);
				const before = w.snapshot(),
					members = yield* w.members;
				expect(yield* w.door.grant({text: v.text, armored: v.armored})).toMatchObject({
					_tag: "refused",
				});
				expect(w.snapshot()).toEqual(before);
				expect(yield* w.members).toEqual(members);
			}),
		);
	}
	it.effect("vector: L25 real person/recovery adds and forbidden signer/replay facts", () =>
		Effect.gen(function* () {
			let state = Result.getOrThrow(
				allows(
					EMPTY,
					MemberFact.cases.founded.make({
						id: person,
						name: "Fixture",
						keys: [fixture.keys.person!],
						window: fixture.keys.window!,
					}),
				),
			);
			for (const name of ["sheet", "recover"]) {
				const v = vector(name);
				expect((yield* check(v))._tag).toBe("key");
				const change = Schema.decodeUnknownSync(Schema.fromJsonString(Change))(v.text);
				if (change._tag !== "added") return yield* Effect.die("fixture is not an added");
				const fact = MemberFact.cases.added.make({
					add: change.add,
					signed: {text: v.text, armored: v.armored, signer: v.signer},
				});
				const next = allows(state, fact);
				expect(Result.isSuccess(next)).toBe(true);
				state = Result.getOrThrow(next);
				expect(allows(state, fact)).toEqual(Result.succeed(state));
			}
			// Signature validity cannot upgrade the signer's rank or unspend a sheet.
			for (const name of ["window-add", "agent-add", "recovery-sheet", "recovery-grant"]) {
				const v = vector(name),
					change = Schema.decodeUnknownSync(Schema.fromJsonString(Change))(v.text);
				const fact =
					change._tag === "added"
						? MemberFact.cases.added.make({
								add: change.add,
								signed: {text: v.text, armored: v.armored, signer: v.signer},
							})
						: change._tag === "granted"
							? MemberFact.cases.granted.make({
									grant: change.grant,
									signed: {text: v.text, armored: v.armored, signer: v.signer},
								})
							: null;
				if (fact === null) return yield* Effect.die("unexpected fixture");
				expect(Result.isFailure(allows(state, fact))).toBe(true);
			}
		}),
	);
	it.effect("vector: L25 saved recovery text keeps seen inside addText", () =>
		Effect.gen(function* () {
			const v = vector("recover"),
				change = JSON.parse(v.text);
			const text = addText({...Schema.decodeUnknownSync(Add)(change.add), seen: change.add.seen});
			expect(text).toBe(v.text);
			expect((yield* check(v, addText({...change.add, seen: change.add.seen + 1})))._tag).toBe(
				"refused",
			);
		}),
	);
	it.effect(
		"vector: L26 preview text matches real OpenSSH, once only and one refusal after spending",
		() =>
			Effect.gen(function* () {
				const D = yield* Effect.promise(() => import("./sheet.ts"));
				const v = vector("preview");
				expect(D.previewText(fixture.preview)).toBe(v.text);
				expect((yield* check(v))._tag).toBe("key");
				// Dynamic challenge use and spent refusals run against the real door in L14/L15.
				const T = yield* Effect.promise(() => import("../transport/sshsig.ts"));
				expect(yield* T.readSigner(v.armored)).toBe(v.signer);
			}),
	);
	it.effect.prop(
		"L11 passkeys: UV and valid backup flags stay person authority",
		{a: Arbitrary.schema(Input)},
		({a}) =>
			Effect.gen(function* () {
				const curve = createECDH("prime256v1");
				const order = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
				const scalar = (BigInt(`0x${Buffer.from(a.seed).toString("hex")}`) % (order - 1n)) + 1n;
				const secret = Buffer.from(scalar.toString(16).padStart(64, "0"), "hex");
				curve.setPrivateKey(secret);
				const point = curve.getPublicKey();
				expect(Schema.is(Point)([...point])).toBe(true);
				const rp = "fabrika.test",
					origin = "https://fabrika.test";
				const type = "sk-ecdsa-sha2-nistp256@openssh.com";
				const blob = Buffer.concat([field(type), field("nistp256"), field(point), field(rp)]);
				const line = `${type} ${blob.toString("base64")}`;
				const assertionFor = (text: string) => {
					const covered = Buffer.concat([
						Buffer.from("SSHSIG"),
						field("fabrika-client"),
						field(""),
						field("sha512"),
						field(createHash("sha512").update(text).digest()),
					]);
					const client = Buffer.from(
						JSON.stringify({
							type: "webauthn.get",
							challenge: covered.toString("base64url"),
							origin,
							crossOrigin: false,
						}),
					);
					const flags = 1 | (a.uv ? 4 : 0) | (a.be ? 8 : 0) | (a.bs ? 16 : 0);
					const auth = Buffer.concat([
						createHash("sha256").update(rp).digest(),
						Buffer.from([flags]),
						u32(a.counter),
					]);
					const privateKey = createPrivateKey({
						key: {
							kty: "EC",
							crv: "P-256",
							d: secret.toString("base64url"),
							x: point.subarray(1, 33).toString("base64url"),
							y: point.subarray(33).toString("base64url"),
						},
						format: "jwk",
					});
					const signature = sign(
						"sha256",
						Buffer.concat([auth, createHash("sha256").update(client).digest()]),
						{key: privateKey, dsaEncoding: "ieee-p1363"},
					);
					expect(Schema.is(Signature)([...signature])).toBe(true);
					const integer = (b: Buffer) => {
						const stripped = b.toString("hex").replace(/^(00)+/, "");
						const raw = Buffer.from(stripped || "00", "hex");
						return raw[0]! >= 128 ? Buffer.concat([Buffer.from([0]), raw]) : raw;
					};
					const sig = Buffer.concat([
						field("webauthn-sk-ecdsa-sha2-nistp256@openssh.com"),
						field(
							Buffer.concat([
								field(integer(signature.subarray(0, 32))),
								field(integer(signature.subarray(32))),
							]),
						),
						Buffer.from([flags]),
						u32(a.counter),
						field(origin),
						field(client),
						field(""),
					]);
					const packed = Buffer.concat([
						Buffer.from("SSHSIG"),
						u32(1),
						field(blob),
						field("fabrika-client"),
						field(""),
						field("sha512"),
						field(sig),
					]);
					return `-----BEGIN SSH SIGNATURE-----\n${packed.toString("base64")}\n-----END SSH SIGNATURE-----\n`;
				};
				const armored = assertionFor(a.text);
				const checked = yield* verifySshsig({
					text: a.text,
					armored,
					space: "fabrika-client",
					signers: [line],
					policy: {rp, origins: [origin]},
				});
				const valid = a.uv && (!a.bs || a.be);
				expect(checked._tag === "passkey").toBe(valid);
				if (!valid) return;
				expect(checked).toMatchObject({be: a.be, bs: a.bs, counter: a.counter});
				// Real P10 enrollment + P28 recovery, not a hand-labeled person key.
				const w = yield* recoveryDoor();
				const binding = {
					id: "input_01m6v5270hf3c8x2q7w9z4k5m7",
					to: "p28",
					for: person,
					key: line,
					window: fixture.keys.freshWindow!,
				};
				const nonce = yield* w.door.enrollment(binding);
				const proof = assertionFor(enrollmentText({...binding, nonce}));
				const passkey = {
					credential: Buffer.from(a.credential).toString("base64url"),
					rp,
					origin,
					be: a.be,
					bs: a.bs,
					nonce,
					proof,
				};
				const recovered = {
					...Add.make({
						...binding,
						adds: Adds.cases.person.make({key: line, window: fixture.keys.freshWindow!, passkey}),
						drops: [],
						saw: {
							how: "recovery",
							check: "touch",
							where: "fixture",
							has: [],
							typed: false,
							kept: null,
							old: "kept",
						},
						sentAt: "2026-11-09T00:00:00.000Z",
					}),
					seen: 2,
				};
				const recoveryPrivate = createPrivateKey({
					key: Buffer.concat([
						Buffer.from("302e020100300506032b657004220420", "hex"),
						Buffer.from("67f219d59a3125749c6a5f30516438911f80a061dcaec1193e40d1a8527365db", "hex"),
					]),
					format: "der",
					type: "pkcs8",
				});
				const text = addText(recovered),
					signature = yield* writeSshsig({
						text,
						space: "fabrika-client",
						line: Schema.decodeUnknownSync(KeyLine)(fixture.keys.recovery!),
						sign: (bytes) => Effect.sync(() => new Uint8Array(sign(null, bytes, recoveryPrivate))),
					});
				expect((yield* w.door.grant({text, armored: signature}))._tag).toBe("applied");
				expect((yield* w.members).keys.get(line)).toMatchObject({
					rank: "person",
					live: true,
					under: null,
				});
				const nextSheet = Add.make({
					id: "input_01m6v5270hf3c8x2q7w9z4k5m8",
					to: "p28",
					for: person,
					adds: Adds.cases.recovery.make({key: fixture.keys.replacement!, v: 1}),
					drops: [],
					saw: {
						how: "sheet",
						check: "touch",
						where: "fixture",
						has: [],
						typed: true,
						kept: "print",
						old: null,
					},
					sentAt: "2026-11-09T00:00:00.000Z",
				});
				const nextText = addText(nextSheet);
				expect((yield* w.door.grant({text: nextText, armored: assertionFor(nextText)}))._tag).toBe(
					"applied",
				);
				const state = Result.getOrThrow(
					allows(
						EMPTY,
						MemberFact.cases.founded.make({
							id: person,
							name: "Fixture",
							keys: [line],
							window: "passkey-window",
						}),
					),
				);
				const add = Add.make({
					id: "input_01m6v5270hf3c8x2q7w9z4k5mn",
					for: person,
					to: "p28",
					adds: Adds.cases.recovery.make({key: fixture.keys.recovery!, v: 1}),
					drops: [],
					saw: {
						how: "sheet",
						check: "touch",
						where: "fixture",
						has: [],
						typed: true,
						kept: "hand",
						old: null,
					},
					sentAt: "2026-11-09T00:00:00.000Z",
				});
				expect(
					Result.isSuccess(
						allows(
							state,
							MemberFact.cases.added.make({
								add,
								signed: {text: addText(add), armored, signer: line},
							}),
						),
					),
				).toBe(true);
			}),
		options,
	);
});
// Scan raw bytes and recursively decoded output. Never only check one printable representation.
const outputs = ["frames", "ledger", "logs", "spans"] as const;
type Captured = Record<(typeof outputs)[number], readonly unknown[]>;
const forms = (value: Uint8Array | string): string[] => {
	const b = typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
	return [
		...new Set([
			b.toString("utf8"),
			b.toString("hex"),
			b.toString("base64"),
			b.toString("base64url"),
			encodeURIComponent(b.toString("utf8")),
			JSON.stringify([...b]),
		]),
	].filter((s) => s.length > 0);
};
const inspect = (capture: Captured, tokens: readonly string[]) => {
	for (const output of outputs) {
		const queue = [JSON.stringify(capture[output])],
			seen = new Set<string>();
		while (queue.length > 0) {
			const s = queue.pop()!;
			if (seen.has(s)) continue;
			seen.add(s);
			for (const secret of tokens) {
				// Short individual words need word boundaries. Otherwise public signature bytes
				// that happen to spell a word would be a false alarm. Long secrets match anywhere.
				const found = /^[a-zA-Z0-9_-]{3,16}$/.test(secret)
					? new RegExp(`(^|[^a-zA-Z0-9_-])${secret}($|[^a-zA-Z0-9_-])`).test(s)
					: s.includes(secret) || s.replace(/\s+/g, "").includes(secret);
				expect(found, `${output} leaked a generated secret`).toBe(false);
			}
			// JSON values, URL parameters, nested hex/base64, including span content.
			const decoded = Result.try(() => JSON.parse(s));
			if (Result.isSuccess(decoded)) {
				const visit = (v: unknown): void => {
					if (typeof v === "string") queue.push(v);
					else if (Array.isArray(v)) v.forEach(visit);
					else if (v !== null && typeof v === "object") Object.values(v).forEach(visit);
				};
				visit(decoded.success);
			}
			const unurl = Result.try(() => decodeURIComponent(s.replace(/\+/g, "%20")));
			if (Result.isSuccess(unurl) && unurl.success !== s) queue.push(unurl.success);
			for (const match of s.matchAll(/(?:[A-Fa-f0-9]{8,}|[A-Za-z0-9_+/-]{8,}={0,2})/g)) {
				const value = match[0];
				if (/^(?:[a-f0-9]{2}){4,}$/i.test(value))
					queue.push(Buffer.from(value, "hex").toString("utf8"));
				queue.push(Buffer.from(value, "base64").toString("utf8"));
			}
		}
	}
};
const independentSeed = (entropy: Uint8Array) =>
	createHmac("sha256", createHmac("sha256", Buffer.alloc(32)).update(entropy).digest())
		.update(Buffer.concat([Buffer.from("fabrika-recovery-v1"), Buffer.from([1])]))
		.digest();

describe("P28 generated secret flows", () => {
	it.effect.prop(
		"L21 [secrets]: full generated flow scans both frame directions, every row/log/span and content",
		{a: SecretFlow},
		({a}) =>
			Effect.gen(function* () {
				const Sheet = yield* Effect.promise(() => import("../desktop/sheet.ts"));
				const Cmds = yield* Effect.promise(() => import("../desktop/recovery-cmds.ts"));
				const Key = yield* Effect.promise(() => import("../desktop/sheet-key.ts"));
				const SheetDoor = yield* Effect.promise(() => import("./sheet.ts"));
				const C = yield* Effect.promise(() => import("../coordination/sheet-check.ts"));
				const operations = ["make", ...a.ops].slice(0, 40);
				const w = yield* world(a);
				yield* Effect.acquireRelease(
					Effect.sync(() =>
						["log", "warn", "error", "info", "debug"].map((name) => {
							const method = Schema.decodeUnknownSync(
								Schema.Literals(["log", "warn", "error", "info", "debug"]),
							)(name);
							return vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
								w.logs.push(format(...args));
							});
						}),
					),
					(spies) =>
						Effect.sync(() =>
							spies.forEach((spy) => {
								spy.mockRestore();
							}),
						),
				);
				const remote = new Proxy(w.door, {
					get(target, name) {
						const method = Reflect.get(target, name);
						if (typeof method !== "function") return method;
						return (...args: unknown[]) =>
							Effect.gen(function* () {
								w.frames.push({direction: "to-door", method: String(name), args});
								const answer = yield* method.apply(target, args);
								w.frames.push({direction: "from-door", method: String(name), answer});
								return answer;
							});
					},
				});
				const logger = Logger.make((entry) => {
					w.logs.push(Logger.formatJson.log(entry));
				});
				yield* Effect.acquireRelease(
					Effect.sync(() => {
						const fetch = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
							w.frames.push({direction: "to-network", input: String(input), init});
							return Promise.reject(new Error("unexpected network request in a local flow"));
						});
						const Socket = globalThis.WebSocket;
						vi.stubGlobal("WebSocket", rejectedSocket(w.frames));
						return () => {
							fetch.mockRestore();
							vi.stubGlobal("WebSocket", Socket);
						};
					}),
					(restore) => Effect.sync(restore),
				);
				const candidates = yield* Effect.forEach(
					operations,
					(_, n) =>
						Effect.gen(function* () {
							const entropy = candidateEntropy(a, n);
							const words: Redacted.Redacted<readonly string[]> = yield* Sheet.wordsFor(
								Redacted.make(entropy),
							);
							return {entropy, words, seed: independentSeed(entropy)};
						}),
					{concurrency: 1},
				).pipe(Effect.provideContext(w.services), Effect.provide(Logger.layer([logger])));
				const tokens = candidates.flatMap((c) => [
					...Redacted.value(c.words).flatMap(forms),
					...forms(c.entropy),
					...forms(c.seed),
					...forms(Redacted.value(c.words).join(" ")),
				]);
				// This is the test's driver. Each operation calls real bounded handlers; product
				// code never receives a "fail/refuse/competitor" test instruction.
				let actor = w.root,
					window = w.window,
					active = candidates[0]!;
				let previous: typeof active | undefined,
					serial = 100;
				let lastProof: {text: string; armored: string} | undefined;
				const queued = new Map<string, unknown>();
				const registrations: {key: string; expected: string; saw: unknown}[] = [];
				const recoveries: {tags: string[]; winner: number; required: boolean}[] = [];
				const send = (proof: {text: string; armored: string}) => {
					lastProof = proof;
					return remote.grant(proof);
				};
				const runOperation = Effect.fnUntraced(function* (op: string, n: number) {
					const candidate = candidates[n]!,
						failed = n === a.failureAt;
					if (op === "make" || op === "replace" || op === "cancel" || op === "fail") {
						const cancel = op === "cancel",
							fail = op === "fail" || failed;
						const words = Redacted.value(candidate.words);
						const result = yield* Effect.result(
							Cmds.makeSheet({
								entropy: Redacted.make(candidate.entropy),
								positions: [a.first, a.second],
								personCheck: () => (cancel ? Effect.fail("canceled") : Effect.succeed("touch")),
								keep: () => (fail ? Effect.fail("printer") : Effect.succeed("print")),
								confirm: () =>
									Effect.succeed([
										{position: a.first, word: Redacted.make(words[a.first]!)},
										{position: a.second, word: Redacted.make(words[a.second]!)},
									]),
								register: (
									publicKey: string,
									saw: typeof import("../coordination/members.ts").AddSaw.Type,
								) =>
									Effect.gen(function* () {
										registrations.push({
											key: publicKey,
											expected: yield* Sheet.publicKey(candidate.words),
											saw,
										});
										const add = {
											...w.add(++serial, Adds.cases.recovery.make({key: publicKey, v: 1}), "sheet"),
											saw,
										};
										const text = addText(add);
										return yield* send({text, armored: yield* actor.sign(text)});
									}),
							}),
						);
						if (Result.isSuccess(result)) {
							previous = active;
							active = candidate;
						}
					} else if (op === "check") {
						const answer = yield* Sheet.check(active.words, yield* w.members);
						const queue = yield* Cmds.checkQueue({
							to: "p28",
							window: window.line,
							sign: window.sign,
							storage: {
								put: (id: string, value: unknown) =>
									failed
										? Effect.fail("storage")
										: Effect.sync(() => {
												queued.set(id, value);
											}),
								remove: (id: string) =>
									Effect.sync(() => {
										queued.delete(id);
									}),
								read: Effect.sync(() => [...queued.values()]),
							},
							send: (proof: {text: string; armored: string}) => remote.checkSheet(proof),
						});
						const checked = C.Check.make({
							id: `check_01m6v5270hetdrt4r8${String(++serial).padStart(8, "0")}`,
							to: "p28",
							matched: answer._tag === "live",
							sentAt: new Date(Date.UTC(2026, 10, 9) + a.at).toISOString(),
						});
						yield* Effect.result(queue.add(checked));
						yield* Effect.result(queue.flush({at: sentAt}));
					} else if (op === "recover" || op === "refuse") {
						if (op === "refuse" && a.refusal === "malformed") {
							const bad = [...Redacted.value(candidate.words)];
							bad[a.first] = `bad-${n}`;
							yield* Effect.result(Sheet.publicKey(Redacted.make(bad)));
						}
						const chosen =
							op === "refuse" && a.refusal === "replaced"
								? (previous ?? candidate)
								: op === "refuse" && a.refusal === "unknown"
									? candidate
									: active;
						const holder = yield* Key.open(chosen.words);
						const connection = yield* remote.connect(),
							nonce = yield* remote.challenge(connection);
						const text = SheetDoor.previewText({
							to: op === "refuse" && a.refusal === "ledger" ? "other" : "p28",
							url: a.url,
							connection,
							nonce,
						});
						const proof = {
							text,
							armored:
								op === "refuse" && a.refusal === "malformed"
									? "malformed"
									: yield* holder.sign(text),
						};
						if (op === "refuse" && a.refusal === "old") yield* TestClock.adjust(ttl);
						const client =
							op === "refuse" && a.refusal === "connection" ? yield* remote.connect() : connection;
						const response = yield* remote.preview(client, proof, {
							url: op === "refuse" && a.refusal === "url" ? `${a.url}/other` : a.url,
						});
						if (op === "refuse" && a.refusal === "reused")
							yield* remote.preview(client, proof, {url: a.url});
						if (op === "refuse" || response.status !== 200) return;
						const read = JSON.parse(response.body);
						const attempts = Array.from({length: 1 + a.competitors}, (_, i) => ({
							person: key(a.seed, 100 + n * 3 + i),
							window: key(a.seed, 300 + n * 3 + i),
						}));
						const answers = yield* Effect.all(
							attempts.map((fresh) =>
								Cmds.recover(
									holder,
									{...read, rev: a.seen === "missing" ? null : read.rev},
									{
										old: a.old,
										personCheck: () => (failed ? Effect.fail("canceled") : Effect.succeed("touch")),
										fresh: () =>
											Effect.succeed({person: fresh.person.line, window: fresh.window.raw}),
										grant: (proof: {text: string; armored: string}) => {
											if (a.seen !== "changed") return send(proof);
											const changed = JSON.parse(proof.text);
											changed.add.seen += a.delta;
											return send({...proof, text: `${JSON.stringify(changed)}\n`});
										},
									},
								),
							),
							{concurrency: 2},
						);
						const winner = answers.findIndex((answer: {_tag: string}) => answer._tag === "applied");
						recoveries.push({
							tags: answers.map((answer: {_tag: string}) => answer._tag),
							winner,
							required: !failed && a.seen === "signed",
						});
						if (winner >= 0) {
							actor = attempts[winner]!.person;
							window = attempts[winner]!.window;
						}
					} else if (op === "retry" && lastProof !== undefined) {
						for (let retry = 0; retry < a.retries; retry++) yield* remote.grant(lastProof);
					}
				});
				for (const [n, op] of operations.entries()) {
					yield* Effect.result(
						Effect.scoped(runOperation(op, n)).pipe(Effect.withSpan("test.recovery.flow")),
					).pipe(Effect.provideContext(w.services), Effect.provide(Logger.layer([logger])));
				}
				yield* Effect.log("p28.flow.complete").pipe(Effect.provide(Logger.layer([logger])));
				for (const registration of registrations) {
					expect(registration.key).toBe(registration.expected);
					expect(registration.saw).toMatchObject({
						how: "sheet",
						check: "touch",
						typed: true,
						kept: "print",
					});
				}
				for (const recovery of recoveries) {
					for (const tag of recovery.tags) expect(["applied", "ignored", "refused"]).toContain(tag);
					expect(!recovery.required || recovery.winner >= 0).toBe(true);
				}
				const capture: Captured = {
					frames: w.frames,
					ledger: [...w.snapshot(), ...queued.values()],
					logs: w.logs,
					spans: w.sql.exec("SELECT row,content FROM unsent"),
				};
				for (const output of outputs)
					expect(capture[output].length, `${output} capture must be connected`).toBeGreaterThan(0);
				inspect(capture, tokens);
				// Every individual word, the phrase, entropy and seed, in every encoding, in every output.
				// These are scanner plants. They do not claim to mutate the missing workflow implementation.
				for (const output of outputs)
					for (const token of tokens) {
						const planted = {...capture, [output]: [...capture[output], {content: token}]};
						expect(() => inspect(planted, tokens)).toThrow();
					}
			}),
		{...options, arbitrary: {...options.arbitrary, maxDiscards: 300}},
	);
	it.prop(
		"L21 plants: each output and each encoding is detected, including individual words",
		{
			a: flow,
			words: Arbitrary.schema(
				Schema.Array(
					Schema.Literals([
						"abandon",
						"about",
						"zoo",
						"wrong",
						"amount",
						"liar",
						"expire",
						"adjust",
						"cage",
						"candy",
						"arch",
						"gather",
						"drum",
						"buyer",
					]),
				).check(Schema.isBetweenLength(12, 12)),
			),
		},
		({a, words}) => {
			// Independent scanner self-check can run before P28 exists. It is not the full-flow law.
			const tokens = [
				...words.flatMap(forms),
				...forms(words.join(" ")),
				...forms(Uint8Array.from(a.entropy)),
				...forms(independentSeed(Uint8Array.from(a.entropy))),
			];
			const clean: Captured = {frames: [null], ledger: [null], logs: [null], spans: [null]};
			expect(() => inspect(clean, tokens)).not.toThrow();
			for (const output of outputs)
				for (const token of tokens)
					expect(() => inspect({...clean, [output]: [{content: token}]}, tokens)).toThrow();
		},
		options,
	);
});
