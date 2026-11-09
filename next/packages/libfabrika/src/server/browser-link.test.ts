// P23, next/. Real Door, Waiting and menu rules. Only outside replies use test adapters.
import {createHash, createPrivateKey, createPublicKey, sign} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {applyCell} from "@demlik/tea";
import {foldEvents} from "@demlik/tea/pbt";
import {describe, expect, it, vi} from "@effect/vitest";
import {Effect, Layer, Redacted, Schema, Stream} from "effect";
import {Digest} from "effect/crypto";
import {TestClock} from "effect/testing";
import {
	admitted,
	ClientManager,
	GatewayManager,
	ProcessIdGenerator,
} from "../coordination/index.ts";
import {
	Archive,
	Doorbell,
	IdGenerator,
	Ledger,
	LedgerTransaction,
	RecordManager,
	SpanSink,
} from "../data/index.ts";
import {nodeSql} from "../data/sqlite.ts";
import {
	browserLinkFixture,
	Bytes32,
	checks,
	leaks,
	SafeTime,
} from "../desktop/browser-link.test-support.ts";
import {KeyLine, writeSshsig} from "../transport/sshsig.ts";

const doorPath = "./door.ts";
const waitingPath = "../transport/waiting.ts";
const menuPath = "../desktop/menu.ts";
const passPath = "../transport/browser-pass.ts";
const linkPath = "../desktop/browser-link.ts";
// No substitute Door or admission path before P21 lands.
const loadDoor = () => Effect.promise((): Promise<typeof import("./door.ts")> => import(doorPath));
const loadWaiting = () =>
	Effect.promise((): Promise<typeof import("../transport/waiting.ts")> => import(waitingPath));
const loadMenu = () =>
	Effect.promise((): Promise<typeof import("../desktop/menu.ts")> => import(menuPath));
const loadPass = () =>
	Effect.promise((): Promise<typeof import("../transport/browser-pass.ts")> => import(passPath));
const loadLink = () =>
	Effect.promise((): Promise<typeof import("../desktop/browser-link.ts")> => import(linkPath));

const url = "https://fabrika.test/entry/project-socket";
const person = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const processId = "process_01m6v5270hetdrt4r8h9vvjwjs";
const word = Schema.String.check(Schema.isMaxLength(64));
const index = Schema.Int.check(Schema.isBetween({minimum: 0, maximum: 31}));
const order = Schema.Array(Schema.Struct({key: index, tab: index, pass: Schema.Boolean})).check(
	Schema.isMaxLength(64),
);
const code = Schema.Int.check(Schema.isBetween({minimum: 0, maximum: 999_999}));
const tabs = Schema.Int.check(Schema.isBetween({minimum: 1, maximum: 8}));
const browserSeeds = Schema.Array(Bytes32).check(Schema.isBetweenLength(2, 5));
const states = ["live", "used", "expired", "unknown"] as const;

// Generated Ed25519 keys, real SSHSIG signing. Nothing reads a key file.
const key = Effect.fnUntraced(function* (seed: ReadonlyArray<number>, name: string) {
	const secret = createHash("sha256").update(Buffer.from(seed)).update(name).digest();
	const privateKey = createPrivateKey({
		key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), secret]),
		format: "der",
		type: "pkcs8",
	});
	const publicKey = createPublicKey(privateKey).export({format: "der", type: "spki"}).subarray(-32);
	const blob = Buffer.concat([
		Buffer.from("0000000b7373682d6564323535313900000020", "hex"),
		publicKey,
	]);
	const line = yield* Schema.decodeUnknownEffect(KeyLine)(`ssh-ed25519 ${blob.toString("base64")}`);
	const fingerprint = (bytes: Uint8Array) =>
		`SHA256:${createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "")}`;
	return {
		raw: publicKey.toString("base64url"),
		line,
		fingerprint: fingerprint(publicKey),
		by: fingerprint(blob),
		sign: (text: string) =>
			writeSshsig({
				text,
				space: "fabrika-client",
				line,
				sign: (bytes) => Effect.sync(() => new Uint8Array(sign(null, bytes, privateKey))),
			}),
	};
});
type TestKey = Effect.Success<ReturnType<typeof key>>;
type Door = typeof import("./door.ts").Door.Service;
type Row = typeof import("../transport/waiting.ts").Row.Type;
const records = Ledger.use((ledger) => Stream.runCollect(ledger.read("door/members", 0)));

const fixture = Effect.fnUntraced(function* (
	Door: typeof import("./door.ts").Door,
	seed: ReadonlyArray<number>,
	inspect: (query: string, params: ReadonlyArray<unknown>) => void = () => {},
) {
	const databases: DatabaseSync[] = [];
	yield* Effect.addFinalizer(() =>
		Effect.sync(() => {
			for (const database of databases) database.close();
		}),
	);
	const open = () => {
		const database = new DatabaseSync(":memory:");
		databases.push(database);
		return nodeSql(database);
	};
	const base = open();
	const sql = {
		...base,
		exec: (...[query, ...params]: Parameters<typeof base.exec>) => {
			inspect(query, params);
			return base.exec(query, ...params);
		},
	};
	const root = yield* key(seed, "person");
	const window = yield* key(seed, "window");
	const founder = {
		name: "Test project",
		person,
		keys: [root.line],
		window: window.raw,
		by: root.by,
		build: "test",
	};
	const quiet = Layer.succeed(Doorbell, {ring: () => Effect.void});
	const ledger = Ledger.sql(sql, {reader: "project"}).pipe(Layer.provide(quiet));
	const clients = ClientManager.layer(founder).pipe(Layer.provideMerge(ledger));
	const parts = new Map<string, ReturnType<typeof nodeSql>>();
	const notices: unknown[] = [];
	const environment = Layer.mergeAll(
		clients,
		LedgerTransaction.layer(sql).pipe(Layer.provide(quiet)),
		SpanSink.layer(sql, {object: processId}),
		RecordManager.sql((name) => {
			const part = parts.get(name) ?? open();
			parts.set(name, part);
			return part;
		}, 64 * 1024),
		Archive.memory,
		IdGenerator.layer,
		ProcessIdGenerator.layer,
		Digest.layerWebCrypto,
		GatewayManager.layer(sql, {
			probe: () => Effect.succeed(null),
			admitted: (raw) =>
				ClientManager.use((manager) => manager.members).pipe(
					Effect.map((members) => !("why" in admitted(members, raw))),
				),
		}).pipe(Layer.provide(clients)),
	);
	const layer = Door.layer({
		sql,
		founder,
		name: "project",
		url,
		origins: ["https://fabrika.test"],
		versions: [1],
		location: "test",
		build: "test",
		waiting: {most: 128, ttl: 600_000},
		ping: {min: 10_000, max: 60_000},
		inputCap: 1000,
		spentCap: 1000,
		nextProcess: () => ProcessIdGenerator.use((generator) => generator.next),
		deliver: () => Effect.void,
		notify: (_client, news) =>
			Effect.sync(() => {
				notices.push(news);
			}),
		inputs: {schema: Schema.Json, personOnly: [], raw: [], log: Schema.Json},
		facts: {personOnly: []},
	}).pipe(Layer.provideMerge(environment));
	return {
		layer,
		window,
		notices,
		stored: () => sql.exec("SELECT name,value FROM door_state"),
		context: {person, ledger: "project", own: window.raw, browser: true},
	};
});

const initialize = Effect.fnUntraced(function* (
	door: Door,
	k: TestKey,
	tab: string,
	online: boolean,
) {
	const client = yield* door.connect();
	const nonce = yield* door.challenge(client);
	const hello = {
		versions: [1],
		has: ["verify"],
		ping: "30s",
		key: k.raw,
		tab,
		nonce,
		platform: "browser",
		os: "linux",
		sentAt: "2026-11-08T04:00:00.000Z",
		signed: yield* k.sign(`fabrika-hello\n${url}\n${tab}\n${nonce}`),
	};
	expect(yield* door.initialize(client, hello, {url, tab, name: k.fingerprint})).toMatchObject(
		online ? {_tag: "online"} : {_tag: "refused", why: "not_granted"},
	);
	return client;
});

// These assertions also judge the deliberately broken answers below. They decide no permissions.
const stableRow = (
	rows: ReadonlyArray<unknown>,
	expected: {key: string; code: string; digest: string | null; tabs: number},
) => {
	expect(rows).toHaveLength(1);
	expect(rows[0]).toMatchObject(expected);
};
const codeFallback = (
	rows: ReadonlyArray<unknown>,
	key: string,
	code: string,
	automatic: number,
	recovery: ReadonlyArray<{_tag: string; key?: string; words: string}>,
) => {
	expect(automatic).toBe(0);
	expect(rows).toContainEqual(expect.objectContaining({key, code}));
	expect(code).toMatch(/^\d{6}$/);
	expect(recovery).toContainEqual(
		expect.objectContaining({_tag: "row", key, words: expect.stringContaining(code)}),
	);
};

describe("P23 real Door hash and code fallback", () => {
	it.effect.prop(
		"secure bytes give the same shared digest in BrowserLink.prepare and the Door before storage",
		{bytes: Bytes32, seed: Bytes32, at: SafeTime, label: word},
		({bytes, seed, at, label}) =>
			Effect.gen(function* () {
				const {Door} = yield* loadDoor();
				const codec = yield* loadPass();
				const {BrowserLink} = yield* loadLink();
				const {Waiting} = yield* loadWaiting();
				const hashing = vi.spyOn(codec, "passDigest");
				yield* Effect.addFinalizer(() => Effect.sync(() => hashing.mockRestore()));
				yield* TestClock.setTime(at);
				const raw = Buffer.from(bytes).toString("base64url");
				const linkFixture = yield* browserLinkFixture({bytes});
				const prepared = yield* BrowserLink.use((link) => link.prepare).pipe(
					Effect.provide(linkFixture.layer),
				);
				const pass = yield* Schema.decodeUnknownEffect(codec.PassSecret)(raw);
				const expected = yield* codec.passDigest(pass).pipe(Effect.provide(Digest.layerWebCrypto));
				expect(prepared.pass.digest).toBe(expected);
				expect(expected).toBe(createHash("sha256").update(raw, "utf8").digest("base64url"));
				hashing.mockClear();
				let writes = 0;
				const world = yield* fixture(Door, seed, (query, params) => {
					// Observe every write, including intermediate storage, rather than just the final row.
					expect(leaks(raw, [query, params])).toBe(false);
					if (query.startsWith("INSERT") && params[0] === "waiting") {
						writes++;
						expect(hashing).toHaveBeenCalledTimes(1);
						expect(hashing.mock.calls.every(([pass]) => Redacted.isRedacted(pass))).toBe(true);
						expect(Redacted.value(hashing.mock.calls[0]![0])).toBe(raw);
						expect(String(params[1])).toContain(expected);
					}
				});
				yield* Effect.gen(function* () {
					const door = yield* Door;
					const owner = yield* initialize(door, world.window, "owner", true);
					const browser = yield* key(seed, "browser");
					const client = yield* initialize(door, browser, "tab", false);
					const before = yield* records;
					const reply = yield* door.knock(client, {label, pass: raw});
					const watched = yield* door.watch(owner);
					expect(writes).toBeGreaterThan(0);
					expect(watched.rows).toHaveLength(1);
					expect(watched.rows[0]).toMatchObject({key: browser.raw, digest: expected});
					expect(watched.rows[0]).not.toHaveProperty("pass");
					expect(reply).toEqual({
						_tag: "ok",
						result: {code: watched.rows[0]!.code, until: watched.rows[0]!.until},
					});
					const saved = world.stored().find((row) => row.name === "waiting");
					const state = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Waiting))(
						saved?.value,
					);
					expect(state.rows).toEqual(watched.rows);
					expect(leaks(raw, [world.stored(), watched, reply, world.notices, yield* records])).toBe(
						false,
					);
					expect(yield* records).toEqual(before);
				}).pipe(Effect.provide(world.layer));
			}).pipe(Effect.scoped),
		checks,
	);
	it.effect.prop(
		"used, expired and unknown links keep normal code rows while only a live match signs",
		{
			bytes: Bytes32,
			seeds: browserSeeds,
			at: SafeTime,
			knocks: order,
			elapsed: Schema.Int.check(Schema.isBetween({minimum: 1, maximum: 59_999})),
		},
		({bytes, seeds, at, knocks, elapsed}) =>
			Effect.gen(function* () {
				const {Door} = yield* loadDoor();
				const menu = yield* loadMenu();
				const {BrowserLink} = yield* loadLink();
				for (const state of states) {
					yield* Effect.scoped(
						Effect.gen(function* () {
							yield* TestClock.setTime(at);
							const links = yield* browserLinkFixture({bytes});
							const prepared = yield* BrowserLink.use((link) => link.prepare).pipe(
								Effect.provide(links.layer),
							);
							const raw = Buffer.from(bytes).toString("base64url");
							const world = yield* fixture(Door, bytes);
							yield* Effect.gen(function* () {
								const door = yield* Door;
								const owner = yield* initialize(door, world.window, "owner", true);
								const keys = yield* Effect.forEach(seeds, (seed, i) => key(seed, `browser-${i}`), {
									concurrency: 1,
								});
								const messages: import("../desktop/menu.ts").MenuMsg[] = [
									{type: "connected", context: world.context},
								];
								if (state !== "unknown")
									messages.push({type: "open_browser", pass: prepared.pass, at});
								const before = yield* records;
								if (state === "used") {
									const used = yield* key(bytes, "used");
									const client = yield* initialize(door, used, "used", false);
									yield* door.knock(client, {label: "Used", pass: raw});
									messages.push({type: "rows", rows: (yield* door.watch(owner)).rows, at: at + 1});
								}
								const initial = foldEvents(menu.menuMachine, {}, null, messages);
								expect(
									initial.steps
										.flatMap((step) => step.cmds)
										.filter((cmd) => cmd.type === "menu_sign"),
								).toHaveLength(state === "used" ? 1 : 0);
								let model = initial.steps.at(-1)!.next;
								const now = state === "expired" ? at + 60_000 + elapsed - 1 : at + elapsed;
								yield* TestClock.setTime(now);
								const clients = new Map<string, Effect.Success<ReturnType<Door["connect"]>>>();
								const codes = new Map<string, string>();
								let signed = 0;
								// Generated knock orders precede guaranteed coverage of every key, then repeat.
								const schedule = [
									...knocks,
									...keys.map((_, key) => ({key, tab: 0, pass: true})),
									...knocks,
								];
								for (const operation of schedule) {
									const k = keys[operation.key % keys.length]!;
									const tab = `${k.raw}-${operation.tab}`;
									const client = clients.get(tab) ?? (yield* initialize(door, k, tab, false));
									clients.set(tab, client);
									const reply = yield* door.knock(
										client,
										operation.pass ? {label: "Browser", pass: raw} : {label: "Browser"},
									);
									const watched = yield* door.watch(owner);
									const row = watched.rows.find((row: Row) => row.key === k.raw)!;
									expect(row).toBeDefined();
									expect(reply).toEqual({_tag: "ok", result: {code: row.code, until: row.until}});
									expect(row.code).toBe(codes.get(k.raw) ?? row.code);
									codes.set(k.raw, row.code);
									const [next, cmds] = applyCell(menu.menuMachine, model, {
										type: "rows",
										rows: watched.rows,
										at: now,
									});
									model = next;
									const automatic = cmds.filter((cmd) => cmd.type === "menu_sign");
									signed += automatic.length;
									expect(cmds.some((cmd) => cmd.type === "menu_check")).toBe(false);
									if (state !== "live")
										codeFallback(
											model.rows,
											k.raw,
											row.code,
											automatic.length,
											menu.menuView(model),
										);
									expect(yield* records).toEqual(before);
									expect(
										admitted(yield* ClientManager.use((manager) => manager.members), k.raw),
									).toHaveProperty("why", "not_granted");
									expect(
										leaks(raw, [world.stored(), watched, reply, model, cmds, world.notices]),
									).toBe(false);
								}
								expect(signed).toBe(state === "live" ? 1 : 0);
							}).pipe(Effect.provide(world.layer));
						}),
					);
				}
			}),
		checks,
	);
	it.effect.prop(
		"an existing waiting key attaches a fresh link through the real Door without changing its code or row",
		{bytes: Bytes32, seed: Bytes32, at: SafeTime, total: tabs, knocks: order},
		({bytes, seed, at, total, knocks}) =>
			Effect.gen(function* () {
				const {Door} = yield* loadDoor();
				const {BrowserLink} = yield* loadLink();
				const world = yield* fixture(Door, seed);
				yield* TestClock.setTime(at);
				yield* Effect.gen(function* () {
					const door = yield* Door;
					const owner = yield* initialize(door, world.window, "owner", true);
					const browser = yield* key(seed, "browser");
					const clients = yield* Effect.forEach(
						Array.from({length: total}, (_, i) => i),
						(i) => initialize(door, browser, `tab-${i}`, false),
						{concurrency: 1},
					);
					const first = yield* door.knock(clients[0]!, {label: "Waiting"});
					const original = (yield* door.watch(owner)).rows[0]!;
					stableRow((yield* door.watch(owner)).rows, {
						key: browser.raw,
						code: original.code,
						digest: null,
						tabs: 1,
					});
					const links = yield* browserLinkFixture({bytes});
					const prepared = yield* BrowserLink.use((link) => link.prepare).pipe(
						Effect.provide(links.layer),
					);
					const raw = Buffer.from(bytes).toString("base64url");
					const seen = new Set([clients[0]!]);
					const before = yield* records;
					// No pass before prepare. A later no-pass knock must also keep the attached digest.
					const schedule = [
						{tab: total - 1, pass: true},
						...knocks,
						...clients.map((_, tab) => ({tab, pass: false})),
					];
					for (const operation of schedule) {
						const client = clients[operation.tab % total]!;
						seen.add(client);
						const reply = yield* door.knock(
							client,
							operation.pass ? {label: "Linked", pass: raw} : {label: "Waiting"},
						);
						const watched = yield* door.watch(owner);
						stableRow(watched.rows, {
							key: browser.raw,
							code: original.code,
							digest: prepared.pass.digest,
							tabs: seen.size,
						});
						expect(reply).toEqual(first);
						expect(leaks(raw, [world.stored(), watched, reply, world.notices])).toBe(false);
						expect(yield* records).toEqual(before);
					}
				}).pipe(Effect.provide(world.layer));
			}).pipe(Effect.scoped),
		checks,
	);
	it.effect.prop(
		"Waiting.knock keeps generated codes and tab counts while attaching a later digest",
		{
			key: word,
			digest: word,
			total: tabs,
			codes: Schema.Array(code).check(Schema.isBetweenLength(2, 65)),
			knocks: order,
			at: SafeTime,
		},
		({key, digest, total, codes, knocks, at}) =>
			Effect.gen(function* () {
				const {Waiting, Row} = yield* loadWaiting();
				let state = yield* Schema.decodeUnknownEffect(Waiting)({rows: [], most: 2, ttl: 600_000});
				const firstCode = String(codes[0]).padStart(6, "0");
				const seen = new Set<string>();
				let attached = false;
				const schedule = [
					{tab: 0, pass: false},
					...knocks.map((k) => ({...k, pass: false})),
					{tab: total - 1, pass: true},
					...knocks,
					...Array.from({length: total}, (_, tab) => ({tab, pass: false})),
				];
				for (const [i, operation] of schedule.entries()) {
					const client = `tab-${operation.tab % total}`;
					seen.add(client);
					attached ||= operation.pass;
					const row = yield* Schema.decodeUnknownEffect(Row)({
						key,
						label: "Browser",
						where: "test",
						code: String(codes[i % codes.length]).padStart(6, "0"),
						has: [],
						as: "window",
						pass: null,
						digest: operation.pass ? digest : null,
						until: at + 600_000,
						clients: [client],
						tabs: 1,
					});
					state = Waiting.knock(state, {...row, client, at});
					stableRow(state.rows, {
						key,
						code: firstCode,
						digest: attached ? digest : null,
						tabs: seen.size,
					});
					expect(state.rows[0]).not.toHaveProperty("pass");
				}
			}),
		checks,
	);
	it.prop(
		"plants reject automatic grants, discarded requests and missing code recovery rows",
		{key: word, n: code},
		({key, n}) => {
			const code = String(n).padStart(6, "0");
			const rows = [{key, code}];
			const recovery = [{_tag: "row", key, words: `Compare ${code}`}];
			codeFallback(rows, key, code, 0, recovery);
			expect(() => codeFallback(rows, key, code, 1, recovery)).toThrow();
			expect(() => codeFallback([], key, code, 0, recovery)).toThrow();
			expect(() => codeFallback(rows, key, code, 0, [])).toThrow();
		},
		checks,
	);
	it.prop(
		"plants reject a permanently null digest and a second row for the waiting key",
		{key: word, digest: Schema.NonEmptyString, n: code, tabs},
		({key, digest, n, tabs}) => {
			const expected = {key, code: String(n).padStart(6, "0"), digest, tabs};
			stableRow([expected], expected);
			expect(() => stableRow([{...expected, digest: null}], expected)).toThrow();
			expect(() => stableRow([expected, {...expected}], expected)).toThrow();
			expect(() => stableRow([{...expected, code: `${expected.code}0`}], expected)).toThrow();
		},
		checks,
	);
	it.prop(
		"plants reject hash encodings that differ from the shared UTF-8 base64url format",
		{bytes: Bytes32},
		({bytes}) => {
			const raw = Buffer.from(bytes).toString("base64url");
			const expected = createHash("sha256").update(raw, "utf8").digest("base64url");
			for (const wrong of [
				createHash("sha256").update(raw).digest("hex"),
				createHash("sha256").update(Buffer.from(bytes)).digest("base64url"),
				`${expected}=`,
			])
				expect(() => expect(wrong).toBe(expected)).toThrow();
			expect(leaks(raw, [{digest: expected}])).toBe(false);
			expect(() => expect(leaks(raw, [{digest: expected, pass: raw}])).toBe(false)).toThrow();
		},
		checks,
	);
});
