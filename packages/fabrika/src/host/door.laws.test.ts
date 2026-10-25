import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {arbMsg, arbRecordMsg, type MsgArbitraryTable} from "@demlik/tea/pbt";
import {Effect, Layer, ManagedRuntime} from "effect";
import {FetchHttpClient} from "effect/http";
import {TestClock} from "effect/testing";
import * as fc from "fast-check";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import type {DoorConfig, Stamp} from "./door.ts";
import * as realDoor from "./door.ts";
import type {Keys, KeysUnreachable, Signers} from "./keys.ts";
import * as realKeys from "./keys.ts";
import * as realGitHub from "./keys-github.ts";
import * as rules from "./rules.ts";
import {dispatch, openDb} from "./sqlite-driver.ts";
import {keyLineOf, sign} from "./sshsig.ts";
import * as realWriter from "./writer.ts";

// The door's laws, on fast-check (and tea's pbt for the request stream): properties over random
// runs of logins, invites, joins, removes, appends, grants, challenges and clock moves, against the
// real Door on node:sqlite, the same file workerd runs. A fake keys service and a clock the test
// turns. GitHub's own answer (`layerGitHub`) runs over a fake fetch and Effect's TestClock. Real
// GitHub, the network and Cloudflare are never touched.
//
// Nobody writes their own exam: this file writes the laws and never the door's code. Each planted
// mistake is a text edit on a COPY of door.ts, writer.ts, keys.ts or keys-github.ts, imported from
// a temp folder, so the real code is untouched. The exact list of laws each plant breaks is checked
// below, as the app's laws files do (apps/fabrika/src/desk/desk.laws.test.ts).

// ---------------------------------------------------------------- the module under test

/** The pieces of the door the laws read. The real import, or a planted copy. */
type Mod = Pick<
	typeof realDoor,
	| "Door"
	| "trustedArgs"
	| "holderOf"
	| "stampText"
	| "grantText"
	| "MEMBERS"
	| "SESSION_MS"
	| "CHALLENGE_MS"
> &
	Pick<typeof realWriter, "writerOf" | "writerText"> &
	Pick<typeof realKeys, "Keys" | "KeysUnreachable" | "layerNobody"> &
	Pick<typeof realGitHub, "layerGitHub" | "KEYS_CACHE_MS">;

const real: Mod = {...realDoor, ...realWriter, ...realKeys, ...realGitHub};

const madeDirs: string[] = [];
const runtimes: ManagedRuntime.ManagedRuntime<Keys, never>[] = [];
afterAll(async () => {
	for (const rt of runtimes) await rt.dispose();
	for (const d of madeDirs) rmSync(d, {recursive: true, force: true});
});

type File = "door" | "writer" | "keys" | "keys-github";
const FILES: readonly string[] = ["door", "rules", "sshsig", "writer", "keys", "keys-github"];

/** A copy of the door's files with one edit, imported from its own folder. The real code stays as it is. */
async function plant(file: File, from: string, to: string): Promise<Mod> {
	const dir = mkdtempSync(join(import.meta.dirname, ".door-laws-plant-"));
	madeDirs.push(dir);
	for (const f of FILES) {
		let text = readFileSync(join(import.meta.dirname, `${f}.ts`), "utf8");
		if (f === file) {
			const count = text.split(from).length - 1;
			if (count !== 1)
				throw new Error(`plant edit on ${f}: "${from}" found ${count} times, want 1`);
			text = text.replace(from, to);
		}
		writeFileSync(join(dir, `${f}.ts`), text);
	}
	const url = (f: string) => pathToFileURL(join(dir, `${f}.ts`)).href;
	const d = (await import(/* @vite-ignore */ url("door"))) as typeof realDoor;
	const w = (await import(/* @vite-ignore */ url("writer"))) as typeof realWriter;
	const k = (await import(/* @vite-ignore */ url("keys"))) as typeof realKeys;
	const g = (await import(/* @vite-ignore */ url("keys-github"))) as typeof realGitHub;
	return {...d, ...w, ...k, ...g};
}

// ---------------------------------------------------------------- the harness

const ORIGIN = "https://ledger.test";
const NS = "fabrika-ledger";

type Key = {readonly line: string; readonly sign: (text: string) => Promise<string>};
const newKey = async (): Promise<Key> => {
	const pair = (await crypto.subtle.generateKey({name: "Ed25519"}, true, [
		"sign",
		"verify",
	])) as CryptoKeyPair;
	const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
	return {line: keyLineOf(raw), sign: (text) => sign(text, NS, pair.privateKey, raw)};
};

/** A pool of Ed25519 keys, made once and reused, so a law's many runs do not each make keys. */
let POOL: Key[] = [];
beforeAll(async () => {
	POOL = await Promise.all(Array.from({length: 12}, () => newKey()));
});
/** The nth key of the pool. */
const key = (i: number): Key => {
	const k = POOL[i];
	if (k === undefined) throw new Error(`no key ${i}`);
	return k;
};

type World = {
	readonly door: InstanceType<Mod["Door"]>;
	readonly db: ReturnType<typeof openDb>["db"];
	/** Who goes by each name, as the fake keys service answers. */
	readonly people: Map<string, Signers>;
	/** `down`: the keys service is unreachable. */
	readonly state: {down: boolean};
	readonly clock: {t: number};
	readonly mod: Mod;
};

/** A runtime over `layer`, disposed after the laws. */
const runtimeOf = (layer: Layer.Layer<Keys>): ManagedRuntime.ManagedRuntime<Keys, never> => {
	const rt = ManagedRuntime.make(layer);
	runtimes.push(rt);
	return rt;
};

/** The keys service as far as the door asks: `people`, read at each question, or unreachable. */
const fakeKeys = (mod: Mod, people: Map<string, Signers>, state: {down: boolean}) =>
	runtimeOf(
		Layer.succeed(
			mod.Keys,
			mod.Keys.of({
				of: (name): Effect.Effect<Signers | null, KeysUnreachable> =>
					state.down
						? Effect.fail(new mod.KeysUnreachable({why: "down for the law"}))
						: Effect.sync(() => people.get(name) ?? null),
			}),
		),
	);

const sharedWorld = (mod: Mod, o: {founder?: string; sessionMs?: number} = {}): World => {
	const {db} = openDb(":memory:");
	rules.migrate(db);
	const clock = {t: 1_000_000};
	const people = new Map<string, Signers>();
	const state = {down: false};
	const config: DoorConfig = {
		kind: "shared",
		founder: o.founder ?? "github:7",
		origin: null,
		sessionMs: o.sessionMs ?? mod.SESSION_MS,
	};
	const door = new mod.Door(db, config, fakeKeys(mod, people, state), {now: () => clock.t});
	return {door, db, people, state, clock, mod};
};

const localDoor = (mod: Mod, person: string, secretHash: string): InstanceType<Mod["Door"]> => {
	const {db} = openDb(":memory:");
	rules.migrate(db);
	const config: DoorConfig = {kind: "local", person, secretHash};
	return new mod.Door(db, config, runtimeOf(mod.layerNobody), {now: () => 1_000_000});
};

const closedDoor = (mod: Mod): InstanceType<Mod["Door"]> => {
	const {db} = openDb(":memory:");
	rules.migrate(db);
	return new mod.Door(db, {kind: "closed"}, runtimeOf(mod.layerNobody), {now: () => 1_000_000});
};

const addressOf = (W: World, object: string) => W.door.address(ORIGIN, object);

const mustOk = <T>(r: {ok: true; value: T} | {ok: false; status: number; why: string}): T => {
	if (!r.ok) throw new Error(`refused ${r.status}: ${r.why}`);
	return r.value;
};

const loginWith = (W: World, name: string, key: Key, object = "demo") => {
	const c = W.door.challenge(addressOf(W, object));
	return key
		.sign(mustOk(c).text)
		.then((signature) => W.door.login({name, challenge: mustOk(c).text, signature}));
};

const agentLogin = async (W: World, o: {object?: string; grant: string; by: Key; signer: Key}) => {
	const address = addressOf(W, o.object ?? "demo");
	const c = W.door.challenge(address);
	const text = mustOk(c).text;
	return W.door.agentLogin(address, {
		grant: o.grant,
		granted: await o.by.sign(o.grant),
		challenge: text,
		signature: await o.signer.sign(text),
	});
};

/** How many sessions the door has stored, live or not. */
const sessionCount = (W: World): number =>
	Number(W.db.all("SELECT COUNT(*) AS n FROM door_sessions")[0]?.n);

const ensure = (cond: boolean, msg: string): void => {
	if (!cond) throw new Error(msg);
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- random requests (tea's pbt)

/** A write request on the wire, as a tagged message: the four methods an agent or a person may call. */
type Req =
	| {readonly type: "register"; readonly name: string}
	| {readonly type: "append"; readonly stream: string; readonly kind: string}
	| {readonly type: "exit"; readonly name: string}
	| {readonly type: "claim"; readonly name: string; readonly host: string};

const name = fc.constantFrom("ticket:1", "plan:2", "counter:3", "t/inbox", "a:1/b");
const kind = fc.constantFrom("note", "filed", "commented", "built");
const host = fc.constantFrom("host-a", "h1", "host-a@17", "L12");
const reqTable: MsgArbitraryTable<Req> = {
	register: arbRecordMsg("register", {name}),
	append: arbRecordMsg("append", {stream: name, kind}),
	exit: arbRecordMsg("exit", {name}),
	claim: arbRecordMsg("claim", {name, host}),
};
const arbReq = arbMsg(reqTable);

const ghId = fc.integer({min: 1, max: 9999}).map((n) => `github:${n}`);
const agentName = fc.constantFrom("triage", "review", "build", "scout");
const userStamp = fc.record({kind: fc.constant("user" as const), id: ghId});
const agentStamp = fc.record({kind: fc.constant("agent" as const), id: agentName, for: ghId});
const anyStamp: fc.Arbitrary<Stamp> = fc.oneof(userStamp, agentStamp);

/** The arguments a request turns into, for `trustedArgs`. */
const argsOf = (req: Req): [string, unknown[]] => {
	switch (req.type) {
		case "register":
			return ["register", [req.name]];
		case "append":
			return ["append", [req.stream, "any", {kind: req.kind, data: {x: 1}}, null]];
		case "exit":
			return ["exit", [req.name, 1, "normal", "done", null]];
		case "claim":
			return ["claim", [req.name, req.host, 0, 1000]];
	}
};

/** The writer or holder text a stamped result carries, for the request. */
const writerOfResult = (req: Req, value: unknown[]): string => {
	switch (req.type) {
		case "register":
			return String(value[1]);
		case "append":
			return String((value[2] as {writer: unknown}).writer);
		case "exit":
			return String(value[value.length - 1]);
		case "claim":
			return String(value[1]);
	}
};

const OPTS_PURE = {numRuns: 200, seed: 7} as const;
const OPTS_SIGN = {numRuns: 12, seed: 7} as const;

// ---------------------------------------------------------------- the laws

interface Law {
	readonly name: string;
	readonly run: (mod: Mod) => Promise<void>;
}

/**
 * 1. Over the wire, the writer of every stored fact is the door's stamp, and a request that names a
 *    writer or a holder is refused.
 */
const writerIsStamp: Law = {
	name: "the writer of every stored fact is the door's stamp, never the request's",
	run: async (mod) => {
		await fc.assert(
			fc.property(fc.array(arbReq, {maxLength: 8}), anyStamp, (reqs, who) => {
				const want = mod.stampText(who);
				for (const req of reqs) {
					const [method, args] = argsOf(req);
					const r = mod.trustedArgs(method, args, who);
					ensure(r.ok, `${method} refused for a writer it should carry`);
					const got = writerOfResult(req, mustOk(r));
					const expected = req.type === "claim" ? mod.holderOf(req.host, who) : want;
					ensure(got === expected, `${method}: writer ${got} is not the stamp ${expected}`);
				}
			}),
			OPTS_PURE,
		);
		// A request that names its own writer, or sends an extra writer argument, is refused.
		const who: Stamp = {kind: "user", id: "github:7"};
		const named = mod.trustedArgs(
			"append",
			["t/inbox", "any", {kind: "note", writer: "user:github:1", data: {}}, null],
			who,
		);
		ensure(!named.ok && named.status === 400, "an append that names its writer was not refused");
		const old = mod.trustedArgs("register", ["t", "user:github:1"], who);
		ensure(
			!old.ok && old.status === 400,
			"a register with an extra writer argument was not refused",
		);
		const oldCancel = mod.trustedArgs("cancel", ["t", "user:github:1"], who);
		ensure(
			!oldCancel.ok && oldCancel.status === 400,
			"a cancel with an extra writer was not refused",
		);
	},
};

/** 2. An agent's credential can never produce a `user:` writer. */
const agentNeverUser: Law = {
	name: "an agent's credential never makes a user writer",
	run: async (mod) => {
		await fc.assert(
			fc.property(fc.array(arbReq, {maxLength: 8}), agentStamp, (reqs, agent) => {
				ensure(mod.stampText(agent).startsWith("agent:"), "an agent's stamp is not an agent");
				for (const req of reqs) {
					const [method, args] = argsOf(req);
					const got = writerOfResult(req, mustOk(mod.trustedArgs(method, args, agent)));
					ensure(!got.includes("user:"), `${method}: an agent produced a user writer (${got})`);
					if (req.type === "claim")
						ensure(got.includes("@agent:"), `claim holder not an agent: ${got}`);
					else ensure(got.startsWith("agent:"), `${method}: not an agent writer: ${got}`);
				}
			}),
			OPTS_PURE,
		);
		// A stored agent session reads back as an agent, never a person.
		const door = localDoor(mod, "owner", await realDoor.hashOf("fabrika_l_secret"));
		const a = mustOk(await door.addAgent({kind: "user", id: "owner"}, "triage"));
		const who = mustOk(await door.who(a.token));
		ensure(who.kind === "agent", "a stored agent session read back as a person");
	},
};

/**
 * 3. A person-only action is refused from an agent's session (cancel, setLimits, redrive, invite,
 *    remove), and any write under `door/` is refused.
 */
const personOnly: Law = {
	name: "a person-only action and a write under door/ are refused from an agent's session",
	run: async (mod) => {
		const agent: Stamp = {kind: "agent", id: "triage", for: "github:7"};
		const person: Stamp = {kind: "user", id: "github:7"};
		const refuses = (method: string, args: readonly unknown[], who: Stamp) => {
			const r = mod.trustedArgs(method, args, who);
			return !r.ok && r.status === 403;
		};
		const redrive = (who: Stamp): readonly [string, readonly unknown[], Stamp] => [
			"append",
			["t", "any", {kind: "note", data: {}, id: "redrive:3"}, null],
			who,
		];
		ensure(refuses("cancel", ["t"], agent), "an agent's cancel was not refused");
		ensure(refuses("setLimits", ["t", {usd: 1}], agent), "an agent's setLimits was not refused");
		ensure(refuses(...redrive(agent)), "an agent's redrive was not refused");
		ensure(
			refuses("append", [mod.MEMBERS, "any", {kind: "x", data: {}}, null], agent),
			"an agent wrote under door/",
		);
		ensure(refuses("register", ["door/x"], agent), "an agent registered under door/");
		// A person may cancel, set limits and redrive, but may not write under door/ either.
		ensure(mod.trustedArgs("cancel", ["t"], person).ok, "a person's cancel was refused");
		ensure(mod.trustedArgs(...redrive(person)).ok, "a person's redrive was refused");
		ensure(
			refuses("append", [mod.MEMBERS, "any", {kind: "x", data: {}}, null], person),
			"a person wrote under door/",
		);
		ensure(refuses("register", ["door/x"], person), "a person registered under door/");
		// A read of a door stream is allowed for anyone.
		ensure(
			mod.trustedArgs("read", [0, 10, mod.MEMBERS], agent).ok,
			"an agent could not read door/",
		);
		// Invite and remove are refused from an agent's session.
		const W = sharedWorld(mod);
		const inv = await W.door.invite(agent, "bob");
		ensure(!inv.ok && inv.status === 403, "an agent's invite was not refused");
		const rem = W.door.remove(agent, "github:8");
		ensure(!rem.ok && rem.status === 403, "an agent's remove was not refused");
	},
};

/**
 * 4. An agent session ends at the earlier of its grant's end and its person's latest live session.
 *    With no live person session, the agent is refused.
 */
const agentSessionBound: Law = {
	name: "an agent session ends at the earlier of its grant and its person's latest session",
	run: async (mod) => {
		// No live person session: the agent is refused.
		{
			const W = sharedWorld(mod);
			W.people.set("alice", {id: "github:7", keys: [key(0).line]});
			mustOk(await loginWith(W, "alice", key(0)));
			const personUntil = W.clock.t + mod.SESSION_MS;
			W.clock.t = personUntil; // alice's only session has just ended
			const grant = mod.grantText({
				address: addressOf(W, "demo"),
				agent: "triage",
				key: key(1).line,
				for: "alice",
				expires: W.clock.t + 60_000,
			});
			const s = await agentLogin(W, {grant, by: key(0), signer: key(1)});
			ensure(!s.ok && s.status === 403, "an agent was let in with no live person session");
		}
		await fc.assert(
			fc.asyncProperty(fc.integer({min: 1000, max: mod.SESSION_MS * 2}), async (offset) => {
				const W = sharedWorld(mod);
				W.people.set("alice", {id: "github:7", keys: [key(0).line]});
				const start = W.clock.t;
				mustOk(await loginWith(W, "alice", key(0)));
				const personUntil = start + mod.SESSION_MS;
				const grantExp = start + offset;
				const grant = mod.grantText({
					address: addressOf(W, "demo"),
					agent: "triage",
					key: key(1).line,
					for: "alice",
					expires: grantExp,
				});
				const s = mustOk(await agentLogin(W, {grant, by: key(0), signer: key(1)}));
				const want = Math.min(grantExp, personUntil);
				ensure(s.expires === want, `agent session ends at ${s.expires}, want ${want}`);
				W.clock.t = want - 1;
				ensure((await W.door.who(s.token)).ok, "the agent session ended too early");
				W.clock.t = want;
				ensure(!(await W.door.who(s.token)).ok, "the agent session outlived its end");
			}),
			OPTS_SIGN,
		);
	},
};

/** 5. A challenge is used once and ends after 5 minutes. */
const challengeOnce: Law = {
	name: "a challenge is used once and ends after five minutes",
	run: async (mod) => {
		await fc.assert(
			fc.asyncProperty(fc.integer({min: 0, max: mod.CHALLENGE_MS - 1}), async (within) => {
				const W = sharedWorld(mod);
				W.people.set("alice", {id: "github:7", keys: [key(0).line]});
				// Used once: the same challenge a second time is refused.
				const c = W.door.challenge(addressOf(W, "demo"));
				const text = mustOk(c).text;
				const sig = await key(0).sign(text);
				ensure(
					(await W.door.login({name: "alice", challenge: text, signature: sig})).ok,
					"a fresh challenge was refused",
				);
				const twice = await W.door.login({name: "alice", challenge: text, signature: sig});
				ensure(!twice.ok && twice.status === 401, "a challenge was accepted twice");
				// Still good within five minutes.
				const c2 = W.door.challenge(addressOf(W, "demo"));
				const t2 = mustOk(c2).text;
				W.clock.t += within;
				ensure(
					(await W.door.login({name: "alice", challenge: t2, signature: await key(0).sign(t2)})).ok,
					"a challenge in time was refused",
				);
				// Ended after five minutes.
				const c3 = W.door.challenge(addressOf(W, "demo"));
				const t3 = mustOk(c3).text;
				W.clock.t += mod.CHALLENGE_MS;
				const ended = await W.door.login({
					name: "alice",
					challenge: t3,
					signature: await key(0).sign(t3),
				});
				ensure(!ended.ok && ended.status === 401, "an ended challenge was accepted");
			}),
			OPTS_SIGN,
		);
	},
};

/**
 * 6. An invite and a join bind to the keys service's id, so a name that changes hands lets nobody
 *    new in, and the invited person joins under a new name.
 */
const bindToId: Law = {
	name: "an invite and a join bind to the keys service's id, so a renamed name lets nobody new in",
	run: async (mod) => {
		await fc.assert(
			fc.asyncProperty(
				fc.integer({min: 100, max: 500}),
				fc.integer({min: 600, max: 999}),
				async (bobId, takerId) => {
					const W = sharedWorld(mod);
					W.people.set("alice", {id: "github:7", keys: [key(0).line]});
					const alice = mustOk(await loginWith(W, "alice", key(0)));
					W.people.set("bob", {id: `github:${bobId}`, keys: [key(1).line]});
					const inv = await W.door.invite(alice.who, "bob");
					ensure(
						inv.ok && eq(inv.value, {id: `github:${bobId}`, name: "bob"}),
						"the invite was refused, or did not answer the service's id and the name",
					);
					// The name "bob" is taken over by someone with a new id; the old id gets a new name.
					W.people.set("bob", {id: `github:${takerId}`, keys: [key(2).line]});
					W.people.set("robert", {id: `github:${bobId}`, keys: [key(1).line]});
					const taker = await loginWith(W, "bob", key(2));
					ensure(!taker.ok && taker.status === 403, "a name that changed hands let a new id in");
					const robert = await loginWith(W, "robert", key(1));
					ensure(robert.ok, "the invited id could not join under a new name");
				},
			),
			OPTS_SIGN,
		);
	},
};

/** 7. Removing a member ends their sessions and their agents' sessions. The last member cannot be removed. */
const removeEndsSessions: Law = {
	name: "removing a member ends their and their agents' sessions, and the last member stays",
	run: async (mod) => {
		const W = sharedWorld(mod);
		W.people.set("alice", {id: "github:7", keys: [key(0).line]});
		const alice = mustOk(await loginWith(W, "alice", key(0)));
		W.people.set("bob", {id: "github:8", keys: [key(1).line]});
		mustOk(await W.door.invite(alice.who, "bob"));
		const bob = mustOk(await loginWith(W, "bob", key(1)));
		const grant = mod.grantText({
			address: addressOf(W, "demo"),
			agent: "triage",
			key: key(2).line,
			for: "bob",
			expires: W.clock.t + 60_000,
		});
		const bobAgent = mustOk(await agentLogin(W, {grant, by: key(1), signer: key(2)}));
		ensure((await W.door.who(bob.token)).ok, "bob's session should be live before removal");
		ensure(
			(await W.door.who(bobAgent.token)).ok,
			"bob's agent session should be live before removal",
		);
		ensure(W.door.remove(alice.who, "github:8").ok, "removing bob was refused");
		ensure(!(await W.door.who(bob.token)).ok, "a removed member's session did not end");
		ensure(!(await W.door.who(bobAgent.token)).ok, "a removed member's agent session did not end");
		const last = W.door.remove(alice.who, "github:7");
		ensure(!last.ok && last.status === 403, "the last member was removed");
	},
};

/** 8. No credential gives 401 everywhere; a ledger with no door gives 403. */
const noCredential: Law = {
	name: "no credential is 401 on a configured door, and a door with no config is 403",
	run: async (mod) => {
		await fc.assert(
			fc.asyncProperty(fc.string(), async (garbage) => {
				const W = sharedWorld(mod);
				const g1 = await W.door.who(null);
				const g2 = await W.door.who("");
				ensure(!g1.ok && g1.status === 401, "a shared door did not answer 401 to no credential");
				ensure(
					!g2.ok && g2.status === 401,
					"a shared door did not answer 401 to an empty credential",
				);
				const local = localDoor(mod, "owner", await realDoor.hashOf("secret"));
				const l1 = await local.who(null);
				ensure(!l1.ok && l1.status === 401, "a local door did not answer 401 to no credential");
				const closed = closedDoor(mod);
				const c1 = await closed.who(null);
				const c2 = await closed.who(garbage);
				ensure(!c1.ok && c1.status === 403, "a closed door did not answer 403 to no credential");
				ensure(!c2.ok && c2.status === 403, "a closed door did not answer 403 to a credential");
			}),
			{numRuns: 30, seed: 7},
		);
	},
};

/**
 * 9a. The door half of a person's keys: any key the keys service lists for a member signs in, and a
 *     key it no longer lists fails at the next login. A session the key already opened lives on
 *     until its own end.
 */
const listedKeys: Law = {
	name: "any listed key signs in, and a key no longer listed fails at the next login",
	run: async (mod) => {
		await fc.assert(
			fc.asyncProperty(
				fc.integer({min: 2, max: 4}).chain((n) => fc.tuple(fc.constant(n), fc.nat({max: n - 1}))),
				async ([n, gone]) => {
					const W = sharedWorld(mod);
					const keys = Array.from({length: n}, (_, i) => key(i));
					W.people.set("alice", {id: "github:7", keys: keys.map((k) => k.line)});
					// Any key listed signs in.
					for (const [i, k] of keys.entries())
						ensure((await loginWith(W, "alice", k)).ok, `listed key ${i} of ${n} was refused`);
					const opened = mustOk(await loginWith(W, "alice", key(gone)));
					// One key is taken off the list: the next login with it fails, the rest still work.
					W.people.set("alice", {
						id: "github:7",
						keys: keys.filter((_, i) => i !== gone).map((k) => k.line),
					});
					const after = await loginWith(W, "alice", key(gone));
					ensure(!after.ok && after.status === 401, "a key no longer listed still signed in");
					for (const [i, k] of keys.entries())
						if (i !== gone)
							ensure((await loginWith(W, "alice", k)).ok, `a still listed key ${i} was refused`);
					// The session it already opened lives on, until its own end.
					W.clock.t = opened.expires - 1;
					ensure((await W.door.who(opened.token)).ok, "an open session ended with its key");
					W.clock.t = opened.expires;
					ensure(!(await W.door.who(opened.token)).ok, "an open session outlived its end");
				},
			),
			{numRuns: 8, seed: 7},
		);
	},
};

/** A fake api.github.com for `layerGitHub`: logins, their numeric ids and keys, and what was asked. */
const fakeGitHub = () => {
	const users = new Map<string, {id: number; keys: string[]}>();
	const fetch = async (input: string | URL | Request): Promise<Response> => {
		const url = new URL(input instanceof Request ? input.url : input);
		const m = /^\/users\/([^/]+)(\/keys)?$/.exec(url.pathname);
		const login = m?.[1] === undefined ? "" : decodeURIComponent(m[1]);
		const u = users.get(login);
		if (url.host !== "api.github.com" || u === undefined)
			return Response.json({message: "Not Found"}, {status: 404});
		return m?.[2] === undefined
			? Response.json({id: u.id, login})
			: Response.json(u.keys.map((key, i) => ({id: i + 1, key})));
	};
	return {users, fetch};
};

/**
 * 9b. The GitHub half: `layerGitHub` keeps an answer at most its cache time. Past it, a key taken
 *     off on GitHub is gone from the answer. Time moves by Effect's TestClock.
 */
const githubCache: Law = {
	name: "GitHub's answer is kept at most the cache time",
	run: async (mod) => {
		await fc.assert(
			fc.asyncProperty(
				fc.option(fc.integer({min: 1, max: 10 * 60_000}), {nil: undefined}),
				fc.integer({min: 0, max: 3 * 60_000}),
				async (cacheMs, extra) => {
					const gh = fakeGitHub();
					gh.users.set("alice", {id: 7, keys: ["ssh-ed25519 AAAA1", "ssh-ed25519 AAAA2"]});
					const ttl = cacheMs ?? mod.KEYS_CACHE_MS;
					const layer = mod
						.layerGitHub(cacheMs === undefined ? {} : {cacheMs})
						.pipe(
							Layer.provide(FetchHttpClient.layer),
							Layer.provide(Layer.succeed(FetchHttpClient.Fetch, gh.fetch as typeof fetch)),
						);
					const of = (name: string) => mod.Keys.use((k) => k.of(name));
					const got = await Effect.runPromise(
						Effect.gen(function* () {
							const first = yield* of("alice");
							gh.users.set("alice", {id: 7, keys: ["ssh-ed25519 AAAA2"]});
							yield* TestClock.adjust(ttl + extra);
							return {first, later: yield* of("alice")};
						}).pipe(Effect.provide(layer), Effect.provide(TestClock.layer())),
					);
					ensure(
						eq(got.first, {id: "github:7", keys: ["ssh-ed25519 AAAA1", "ssh-ed25519 AAAA2"]}),
						`GitHub's first answer was ${JSON.stringify(got.first)}`,
					);
					ensure(
						eq(got.later, {id: "github:7", keys: ["ssh-ed25519 AAAA2"]}),
						`a key taken off on GitHub was still listed ${ttl + extra} ms later, past the cache of ${ttl}`,
					);
				},
			),
			{numRuns: 20, seed: 7},
		);
	},
};

/** 10. A grant for one object opens no other object. */
const grantOneObject: Law = {
	name: "a grant for one object opens no other object",
	run: async (mod) => {
		await fc.assert(
			fc.asyncProperty(fc.constantFrom("other", "acme", "person:1"), async (otherObject) => {
				const W = sharedWorld(mod);
				W.people.set("alice", {id: "github:7", keys: [key(0).line]});
				mustOk(await loginWith(W, "alice", key(0)));
				const forOther = mod.grantText({
					address: addressOf(W, otherObject),
					agent: "triage",
					key: key(1).line,
					for: "alice",
					expires: W.clock.t + 60_000,
				});
				const away = await agentLogin(W, {
					object: "demo",
					grant: forOther,
					by: key(0),
					signer: key(1),
				});
				ensure(!away.ok && away.status === 401, "a grant for another object opened this one");
				const forThis = mod.grantText({
					address: addressOf(W, "demo"),
					agent: "triage",
					key: key(1).line,
					for: "alice",
					expires: W.clock.t + 60_000,
				});
				ensure(
					(await agentLogin(W, {object: "demo", grant: forThis, by: key(0), signer: key(1)})).ok,
					"a grant for this object was refused",
				);
			}),
			OPTS_SIGN,
		);
	},
};

/** 11. Old `agent:<id>` writer rows still read; `agent:x for:` with an empty person reads as no writer. */
const writerReads: Law = {
	name: "old agent rows still read, and an agent with an empty person is no writer",
	run: async (mod) => {
		const token = fc
			.string({minLength: 1, maxLength: 12})
			.map((s) => s.replace(/\s/g, "x"))
			.filter((s) => s.length > 0 && !s.includes(" "));
		await fc.assert(
			fc.property(token, token, (id, person) => {
				ensure(eq(mod.writerOf(`user:${id}`), {kind: "user", id}), `user:${id} did not read`);
				ensure(
					eq(mod.writerOf(`agent:${id}`), {kind: "agent", id}),
					`old agent:${id} did not read`,
				);
				ensure(
					eq(mod.writerOf(`agent:${id} for:${person}`), {kind: "agent", id, for: person}),
					`agent:${id} for:${person} did not read`,
				);
				ensure(
					mod.writerOf(`agent:${id} for:`) === null,
					`agent:${id} for: (empty) read as a writer`,
				);
				ensure(
					eq(mod.writerOf(mod.writerText({kind: "user", id})), {kind: "user", id}),
					"a user did not round-trip",
				);
				ensure(
					eq(mod.writerOf(mod.writerText({kind: "agent", id, for: person})), {
						kind: "agent",
						id,
						for: person,
					}),
					"an agent did not round-trip",
				);
			}),
			OPTS_PURE,
		);
	},
};

/**
 * 12. An agent's session never stores a person-only fact (`answered`), in any stream, by `append`
 *     (what `send` is on the wire). A person's identical append lands, stamped as that person.
 */
const personKinds: Law = {
	name: "an agent's session never stores a person's answer, and a person's identical one lands as them",
	run: async (mod) => {
		// The input the first door (5c2a411) let through.
		const first = mod.trustedArgs(
			"append",
			["pipeline/ticket/x/facts", "any", {kind: "answered", data: {}}, null],
			{kind: "agent", id: "triage", for: "github:7"},
		);
		ensure(!first.ok && first.status === 403, "an agent's answered in a lane's facts was let in");
		const owner = fc.constantFrom("pipeline/ticket/x", "pipeline/plan/o/r#7", "t", "a:1/b");
		const id = fc.constantFrom(null, "answered:x", "a1", "plan:o/r#7@1");
		const data = fc.oneof(
			fc.constant({}),
			fc.record({type: fc.constant("answered"), answer: fc.constantFrom("approve", "no")}),
			fc.dictionary(fc.string({maxLength: 6}), fc.integer()),
		);
		const where = fc.constantFrom("facts", "inbox", "dead", "x/y");
		const fence = fc.option(fc.nat({max: 1000}), {nil: null});
		await fc.assert(
			fc.property(owner, where, fence, id, data, agentStamp, (name, tail, f, i, d, agent) => {
				const event = i === null ? {kind: "answered", data: d} : {kind: "answered", data: d, id: i};
				// In any stream, under any fence: refused.
				const anywhere = mod.trustedArgs("append", [`${name}/${tail}`, "any", event, f], agent);
				ensure(
					!anywhere.ok && anywhere.status === 403,
					`an agent's answered was let in at ${name}/${tail}`,
				);
				// In the one stream that takes an unfenced append, the ledger keeps nothing of the
				// agent's, and the person's identical append lands as them.
				const {db} = openDb(":memory:");
				rules.migrate(db);
				const person: Stamp = {kind: "user", id: agent.for};
				dispatch(
					db,
					rules.RULES,
					0,
					"register",
					mustOk(mod.trustedArgs("register", [name], person)),
				);
				const inbox = `${name}/inbox`;
				const a = mod.trustedArgs("append", [inbox, "any", event, null], agent);
				if (a.ok) dispatch(db, rules.RULES, 0, "append", a.value);
				ensure(
					rules.readStream(db, inbox).length === 0,
					`an agent's answered was stored in ${inbox}`,
				);
				const p = mustOk(mod.trustedArgs("append", [inbox, "any", event, null], person));
				const res = dispatch(db, rules.RULES, 0, "append", p) as {ok: boolean};
				ensure(res.ok, `a person's answered did not land in ${inbox}`);
				const rows = rules.readStream(db, inbox);
				ensure(
					rows.length === 1 &&
						rows[0]?.kind === "answered" &&
						rows[0]?.writer === `user:${agent.for}`,
					`a person's answered was not stored as them: ${JSON.stringify(rows)}`,
				);
			}),
			OPTS_PURE,
		);
	},
};

/** 13. The keys service's id ends up in every writer, so an id with an "@" in it is a 502. */
const idChecked: Law = {
	name: "an id from the keys service with an @ in it is a 502, and lets nobody in",
	run: async (mod) => {
		const part = fc.stringMatching(/^[a-z0-9:]{1,8}$/);
		await fc.assert(
			fc.asyncProperty(part, part, async (a, b) => {
				const W = sharedWorld(mod);
				W.people.set("alice", {id: "github:7", keys: [key(0).line]});
				const alice = mustOk(await loginWith(W, "alice", key(0)));
				W.people.set("eve", {id: `${a}@${b}`, keys: [key(1).line]});
				const inv = await W.door.invite(alice.who, "eve");
				ensure(!inv.ok && inv.status === 502, `an invite took the id ${a}@${b}`);
				const before = sessionCount(W);
				const eve = await loginWith(W, "eve", key(1));
				ensure(!eve.ok && eve.status === 502, `a login took the id ${a}@${b}`);
				ensure(sessionCount(W) === before, "a login with an @ id opened a session");
			}),
			OPTS_SIGN,
		);
	},
};

/** 14. When the keys service cannot be asked: a 502, and no session opened, no invite kept. */
const keysUnreachable: Law = {
	name: "an unreachable keys service is a 502, with no session opened",
	run: async (mod) => {
		const W = sharedWorld(mod);
		W.people.set("alice", {id: "github:7", keys: [key(0).line]});
		W.people.set("bob", {id: "github:8", keys: [key(1).line]});
		const alice = mustOk(await loginWith(W, "alice", key(0)));
		const before = sessionCount(W);
		const facts = rules.readStream(W.db, mod.MEMBERS).length;
		W.state.down = true;
		const login = await loginWith(W, "alice", key(0));
		ensure(!login.ok && login.status === 502, "a login with the keys service down was not 502");
		const grant = mod.grantText({
			address: addressOf(W, "demo"),
			agent: "triage",
			key: key(2).line,
			for: "alice",
			expires: W.clock.t + 60_000,
		});
		const agent = await agentLogin(W, {grant, by: key(0), signer: key(2)});
		ensure(!agent.ok && agent.status === 502, "an agent login with the keys down was not 502");
		const inv = await W.door.invite(alice.who, "bob");
		ensure(!inv.ok && inv.status === 502, "an invite with the keys service down was not 502");
		ensure(sessionCount(W) === before, "a session was opened with the keys service down");
		ensure(
			rules.readStream(W.db, mod.MEMBERS).length === facts,
			"a member fact was written with the keys service down",
		);
		// Back up: the same login works.
		W.state.down = false;
		ensure((await loginWith(W, "alice", key(0))).ok, "a login failed once the keys were back");
	},
};

const LAWS: readonly Law[] = [
	writerIsStamp,
	agentNeverUser,
	personOnly,
	agentSessionBound,
	challengeOnce,
	bindToId,
	removeEndsSessions,
	noCredential,
	listedKeys,
	githubCache,
	grantOneObject,
	writerReads,
	personKinds,
	idChecked,
	keysUnreachable,
];

// ---------------------------------------------------------------- planted mistakes

/** The names of the laws a module breaks. The real module breaks none. */
const broken = async (mod: Mod): Promise<readonly string[]> => {
	const out: string[] = [];
	for (const law of LAWS) {
		try {
			await law.run(mod);
		} catch {
			out.push(law.name);
		}
	}
	return out;
};

/** Each plant edits a copy of one file. None touches the real code. */
const PLANTS: Record<string, () => Promise<Mod>> = {
	// The door stamps a fixed writer instead of the credential's.
	fixedWriter: () =>
		plant("door", "letIn([...args, stampText(who)])", 'letIn([...args, "user:owner"])'),
	// An agent is allowed to cancel.
	agentCancels: () =>
		plant(
			"door",
			"cancel: {arity: 1, person: true, build: withWriter},",
			"cancel: {arity: 1, build: withWriter},",
		),
	// The door/ guard is dropped, so anyone may write under door/.
	writesUnderDoor: () =>
		plant(
			"door",
			'if (!shape.read && args.some((a) => typeof a === "string" && isDoorStream(a)))',
			"if (false)",
		),
	// An agent is allowed to invite.
	agentInvites: () =>
		plant("door", 'if (by.kind !== "user") return refuse(403, "only a person invites");', ""),
	// An agent session takes its grant's end, ignoring the person's session.
	longAgent: () => plant("door", "Math.min(g.expires, live)", "g.expires"),
	// A spent challenge is not deleted, so it works again.
	challengeReused: () =>
		plant("door", 'this.#db.all("DELETE FROM door_challenges WHERE nonce = ?", nonce);', ""),
	// A join binds to the name, not the id.
	bindsToLogin: () =>
		plant(
			"door",
			'else if (m.invited.has(id)) this.#fact(me, "joined", {id, name});',
			'else if (m.invited.has(id) || [...m.invited.values()].includes(name)) this.#fact(me, "joined", {id, name});',
		),
	// The last member can be removed.
	removesLast: () =>
		plant(
			"door",
			'if (m.members.has(id) && m.members.size === 1) return refuse(403, "the last member stays");',
			'if (false) return refuse(403, "the last member stays");',
		),
	// A closed door answers 401 instead of 403.
	closedIs401: () =>
		plant(
			"door",
			'if (c.kind === "closed") return refuse(403, "this ledger has no door");',
			'if (c.kind === "closed") return refuse(401, "this ledger has no door");',
		),
	// No credential answers 403 instead of 401.
	noCredIs403: () =>
		plant(
			"door",
			'if (token === null || token === "") return refuse(401, "no credential");',
			'if (token === null || token === "") return refuse(403, "no credential");',
		),
	// The door checks a login against the first listed key only.
	pinsFirstKey: () =>
		plant(
			"door",
			"(await verify(signature, text, NAMESPACE, asked.value.keys)) === null",
			"(await verify(signature, text, NAMESPACE, asked.value.keys.slice(0, 1))) === null",
		),
	// GitHub's answer is kept forever, so a key taken off on GitHub keeps working.
	cacheNeverExpires: () =>
		plant(
			"keys-github",
			"timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.millis(ms) : Duration.zero),",
			"timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero),",
		),
	// A grant is accepted for any object.
	grantAnyObject: () =>
		plant(
			"door",
			'if (g.address !== address) return refuse(401, "the grant is for another ledger");',
			"",
		),
	// Old `agent:<id>` rows no longer read.
	noOldAgent: () =>
		plant(
			"writer",
			"export const Writer = Schema.Union([User, Agent, AgentBefore]);",
			"export const Writer = Schema.Union([User, Agent]);",
		),
	// An agent with an empty person reads as a writer.
	emptyPersonReads: () =>
		plant(
			"writer",
			'return Option.getOrNull(decodeAgent({kind, id, for: rest.slice("for:".length)}));',
			'return Option.getOrNull(decode({kind, id, for: rest.slice("for:".length)}));',
		),
	// The person-only kinds guard is gone: an agent's `answered` lands.
	agentAnswers: () =>
		plant("door", 'if (who.kind !== "user" && isPersonKind(e.kind))', "if (false)"),
	// The keys service's id is taken as it comes, "@" and all.
	anyIdTaken: () => plant("door", "s === null || isPersonId(s.id)", "true"),
	// An unreachable keys service reads as nobody by that name.
	unreachableIsNobody: () =>
		plant(
			"door",
			"Effect.succeed(refuse(502, `could not ask for the keys of",
			"Effect.succeed(letIn(null) || refuse(502, `could not ask for the keys of",
		),
};

describe("the door's laws", () => {
	it.each(LAWS.map((law) => [law.name, law] as const))("%s", async (_, law) => {
		await law.run(real);
	});

	it("each law is seen to fail on a planted mistake", async () => {
		const caught: Record<string, readonly string[]> = {};
		for (const [plantName, make] of Object.entries(PLANTS)) {
			caught[plantName] = await broken(await make());
		}
		expect(caught).toEqual({
			fixedWriter: [writerIsStamp.name, agentNeverUser.name],
			agentCancels: [personOnly.name],
			writesUnderDoor: [personOnly.name],
			agentInvites: [personOnly.name],
			longAgent: [agentSessionBound.name],
			challengeReused: [challengeOnce.name],
			bindsToLogin: [bindToId.name],
			removesLast: [removeEndsSessions.name],
			closedIs401: [noCredential.name],
			noCredIs403: [noCredential.name],
			pinsFirstKey: [listedKeys.name],
			cacheNeverExpires: [githubCache.name],
			grantAnyObject: [grantOneObject.name],
			noOldAgent: [writerReads.name],
			emptyPersonReads: [writerReads.name],
			agentAnswers: [personKinds.name],
			anyIdTaken: [idChecked.name],
			unreachableIsNobody: [keysUnreachable.name],
		});
		// Every law is caught by at least one plant.
		const all = new Set(Object.values(caught).flat());
		expect(LAWS.filter((law) => !all.has(law.name)).map((law) => law.name)).toEqual([]);
	}, 120_000);
});
