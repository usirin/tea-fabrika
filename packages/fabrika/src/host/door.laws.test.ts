import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {arbMsg, arbRecordMsg, type MsgArbitraryTable} from "@demlik/tea/pbt";
import {Effect, Exit, Layer, Logger, ManagedRuntime, Redacted} from "effect";
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
// runs of logins, invites, joins, removes, renames, appends, grants, challenges and clock moves,
// against the real Door on node:sqlite, the same file workerd runs. A fake keys service that keeps
// every question it is put, and a clock the test turns. GitHub's own answer (`layerGitHub`) runs
// over a fake fetch and Effect's TestClock. Real GitHub, the network and Cloudflare are never
// touched.
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
	Pick<typeof realGitHub, "layerGitHub" | "KEYS_CACHE_MS" | "TOKEN_REFUSED">;

const real: Mod = {...realDoor, ...realWriter, ...realKeys, ...realGitHub};

const madeDirs: string[] = [];
const runtimes: ManagedRuntime.ManagedRuntime<Keys, never>[] = [];
afterAll(async () => {
	for (const rt of runtimes) await rt.dispose();
	for (const d of madeDirs) rmSync(d, {recursive: true, force: true});
});

type File = "door" | "writer" | "keys" | "keys-github";
const FILES: readonly string[] = ["door", "rules", "sshsig", "writer", "keys", "keys-github"];

/**
 * A copy of the door's files with one mistake, imported from its own folder. The real code stays as
 * it is. A mistake is one edit, or a few in the same file (`more`) when one mistake spans lines.
 */
async function plant(
	file: File,
	from: string,
	to: string,
	more: readonly (readonly [string, string])[] = [],
): Promise<Mod> {
	const dir = mkdtempSync(join(import.meta.dirname, ".door-laws-plant-"));
	madeDirs.push(dir);
	for (const f of FILES) {
		let text = readFileSync(join(import.meta.dirname, `${f}.ts`), "utf8");
		if (f === file) {
			for (const [a, b] of [[from, to] as const, ...more]) {
				const count = text.split(a).length - 1;
				if (count !== 1) throw new Error(`plant edit on ${f}: "${a}" found ${count} times, want 1`);
				text = text.replace(a, () => b);
			}
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

/** One question the fake keys service was put, and what the ledger knew when it was put. */
type Ask = {
	readonly q: "of" | "byId";
	readonly arg: string;
	/** Put while the law was inside `Door.invite`. */
	readonly inInvite: boolean;
	/** `byId` only: the id was a member's, an open invite's, or the founder's before founding. */
	readonly known: boolean;
	/** The answer gave another id than the person's own. */
	readonly lied: boolean;
};

type KeysState = {
	/** The keys service is unreachable. */
	down: boolean;
	/** Each answer gives this id instead of the person's own; null: the true one. */
	lie: ((id: string) => string) | null;
	/** The law is inside `Door.invite` (see `invite` below). */
	inInvite: boolean;
};

type World = {
	readonly door: InstanceType<Mod["Door"]>;
	readonly db: ReturnType<typeof openDb>["db"];
	/** Who goes by each name now, as the fake keys service answers: their id and their keys. */
	readonly people: Map<string, {id: string; keys: string[]}>;
	readonly state: KeysState;
	/** Every question the keys service was put, in order. */
	readonly asks: Ask[];
	readonly clock: {t: number};
	readonly founder: string;
	readonly mod: Mod;
};

/** A runtime over `layer`, disposed after the laws. */
const runtimeOf = (layer: Layer.Layer<Keys>): ManagedRuntime.ManagedRuntime<Keys, never> => {
	const rt = ManagedRuntime.make(layer);
	runtimes.push(rt);
	return rt;
};

/**
 * The keys service as far as the door asks: `people`, read at each question, or unreachable. Each
 * question goes in `asks`, with whether the ledger knew the id (`known`, read from the door's own
 * members at that moment).
 */
const fakeKeys = (
	mod: Mod,
	w: Pick<World, "people" | "state" | "asks">,
	knownNow: (id: string) => boolean,
) => {
	const answer = (name: string, p: {id: string; keys: string[]}): Signers => ({
		id: w.state.lie === null ? p.id : w.state.lie(p.id),
		name,
		keys: [...p.keys],
	});
	const ask = (
		q: Ask["q"],
		arg: string,
		find: () => readonly [string, {id: string; keys: string[]}] | undefined,
	): Effect.Effect<Signers | null, KeysUnreachable> =>
		Effect.suspend(() => {
			const found = w.state.down ? undefined : find();
			const got = found === undefined ? null : answer(...found);
			w.asks.push({
				q,
				arg,
				inInvite: w.state.inInvite,
				known: q === "byId" && knownNow(arg),
				lied: got !== null && found !== undefined && got.id !== found[1].id,
			});
			return w.state.down
				? Effect.fail(new mod.KeysUnreachable({why: "down for the law"}))
				: Effect.succeed(got);
		});
	return runtimeOf(
		Layer.succeed(
			mod.Keys,
			mod.Keys.of({
				byId: (id) => ask("byId", id, () => [...w.people].find(([, p]) => p.id === id)),
				of: (name) =>
					ask("of", name, () => {
						const p = w.people.get(name);
						return p === undefined ? undefined : [name, p];
					}),
			}),
		),
	);
};

const sharedWorld = (mod: Mod, o: {founder?: string; sessionMs?: number} = {}): World => {
	const {db} = openDb(":memory:");
	rules.migrate(db);
	const clock = {t: 1_000_000};
	const founder = o.founder ?? "github:7";
	const w = {
		people: new Map<string, {id: string; keys: string[]}>(),
		state: {down: false, lie: null, inInvite: false} as KeysState,
		asks: [] as Ask[],
	};
	const config: DoorConfig = {
		kind: "shared",
		founder,
		origin: null,
		sessionMs: o.sessionMs ?? mod.SESSION_MS,
	};
	const ref: {door: InstanceType<Mod["Door"]> | null} = {door: null};
	const knownNow = (id: string): boolean => {
		const m = ref.door?.members();
		return (
			m !== undefined && (m.members.has(id) || m.invited.has(id) || (!m.founded && id === founder))
		);
	};
	const door = new mod.Door(db, config, fakeKeys(mod, w, knownNow), {now: () => clock.t});
	ref.door = door;
	return {door, db, ...w, clock, founder, mod};
};

/** `Door.invite`, with the fake keys service told it is inside an invite. */
const invite = async (W: World, by: Stamp, name: string) => {
	W.state.inInvite = true;
	try {
		return await W.door.invite(by, name);
	} finally {
		W.state.inInvite = false;
	}
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
 * 6. An invite and a join bind to the keys service's id, so a name that changes hands at the keys
 *    service lets nobody new in: the new holder of the name, signing with their own listed key, is
 *    a 401 and becomes no member. (What the renamed person gets is law 19.)
 */
const bindToId: Law = {
	name: "an invite and a join bind to the keys service's id, so a renamed name lets nobody new in",
	run: async (mod) => {
		await fc.assert(
			fc.asyncProperty(
				fc.integer({min: 100, max: 500}),
				fc.integer({min: 600, max: 999}),
				fc.boolean(),
				async (bobId, takerId, joined) => {
					const W = sharedWorld(mod);
					W.people.set("alice", {id: "github:7", keys: [key(0).line]});
					const alice = mustOk(await loginWith(W, "alice", key(0)));
					W.people.set("bob", {id: `github:${bobId}`, keys: [key(1).line]});
					const inv = await W.door.invite(alice.who, "bob");
					ensure(
						inv.ok && eq(inv.value, {id: `github:${bobId}`, name: "bob"}),
						"the invite was refused, or did not answer the service's id and the name",
					);
					if (joined) mustOk(await loginWith(W, "bob", key(1)));
					// The name "bob" is taken over by someone with a new id; the old id gets a new name.
					W.people.set("bob", {id: `github:${takerId}`, keys: [key(2).line]});
					W.people.set("robert", {id: `github:${bobId}`, keys: [key(1).line]});
					const before = sessionCount(W);
					const taker = await loginWith(W, "bob", key(2));
					ensure(!taker.ok && taker.status === 401, "a name that changed hands let a new id in");
					ensure(sessionCount(W) === before, "a name that changed hands opened a session");
					const m = W.door.members();
					ensure(
						!m.members.has(`github:${takerId}`) && !m.invited.has(`github:${takerId}`),
						"a name that changed hands made its new holder a member",
					);
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

/**
 * A fake api.github.com for `layerGitHub`: logins, their numeric ids and keys, and every request it
 * got, with its `authorization` header. `refuse` answers 401: to a request with a token, or to all.
 */
const fakeGitHub = (o: {refuse?: "token" | "all"} = {}) => {
	const users = new Map<string, {id: number; keys: string[]}>();
	const asked: {path: string; auth: string | null}[] = [];
	const notFound = () => Response.json({message: "Not Found"}, {status: 404});
	const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const req = input instanceof Request ? input : new Request(input, init);
		const url = new URL(req.url);
		const auth = req.headers.get("authorization");
		asked.push({path: url.pathname, auth});
		if (o.refuse === "all" || (o.refuse === "token" && auth !== null))
			return Response.json({message: "Bad credentials"}, {status: 401});
		if (url.host !== "api.github.com") return notFound();
		const byId = /^\/user\/([0-9]+)$/.exec(url.pathname)?.[1];
		if (byId !== undefined) {
			const hit = [...users].find(([, u]) => u.id === Number(byId));
			return hit === undefined ? notFound() : Response.json({id: hit[1].id, login: hit[0]});
		}
		const m = /^\/users\/([^/]+)(\/keys)?$/.exec(url.pathname);
		const login = m?.[1] === undefined ? "" : decodeURIComponent(m[1]);
		const u = users.get(login);
		if (u === undefined) return notFound();
		return m?.[2] === undefined
			? Response.json({id: u.id, login})
			: Response.json(u.keys.map((key, i) => ({id: i + 1, key})));
	};
	return {users, asked, fetch};
};

/** `layerGitHub` over a fake GitHub's fetch. */
const githubLayer = (
	mod: Mod,
	gh: ReturnType<typeof fakeGitHub>,
	o: Parameters<Mod["layerGitHub"]>[0],
) =>
	mod
		.layerGitHub(o)
		.pipe(
			Layer.provide(FetchHttpClient.layer),
			Layer.provide(Layer.succeed(FetchHttpClient.Fetch, gh.fetch as typeof fetch)),
		);

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
					const layer = githubLayer(mod, gh, cacheMs === undefined ? {} : {cacheMs});
					// Both questions: by name (an invite) and by id (a login).
					const of = mod.Keys.use((k) => k.of("alice"));
					const byId = mod.Keys.use((k) => k.byId("github:7"));
					const got = await Effect.runPromise(
						Effect.gen(function* () {
							const first = [yield* of, yield* byId];
							gh.users.set("alice", {id: 7, keys: ["ssh-ed25519 AAAA2"]});
							yield* TestClock.adjust(ttl + extra);
							return {first, later: [yield* of, yield* byId]};
						}).pipe(Effect.provide(layer), Effect.provide(TestClock.layer())),
					);
					const alice = (keys: string[]) => ({id: "github:7", name: "alice", keys});
					const both = ["ssh-ed25519 AAAA1", "ssh-ed25519 AAAA2"];
					ensure(
						eq(got.first, [alice(both), alice(both)]),
						`GitHub's first answers were ${JSON.stringify(got.first)}`,
					);
					ensure(
						eq(got.later, [alice(["ssh-ed25519 AAAA2"]), alice(["ssh-ed25519 AAAA2"])]),
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
				// The invite was refused, so the ledger does not know eve: a 401, and nobody is asked.
				const eve = await loginWith(W, "eve", key(1));
				ensure(!eve.ok && eve.status === 401, `a login took the id ${a}@${b}`);
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

// ---------------------------------------------------------------- random ledgers

/**
 * Four people at the fake keys service, each with one key of the pool. Key 4 is listed for nobody,
 * key 5 is the agents' own, key 11 is never used to sign up anyone.
 */
const PEOPLE = [
	{id: "github:7", name: "alice", key: 0},
	{id: "github:8", name: "bob", key: 1},
	{id: "github:9", name: "carol", key: 2},
	{id: "github:10", name: "dave", key: 3},
] as const;
/** The names a random run types: the people's, other cases of them, and names nobody has yet. */
const NAMES = ["alice", "bob", "carol", "dave", "Bob", "ALICE", "robert", "zed"] as const;
const AGENT_KEY = 5;
const NOBODY_KEY = 11;

const at = <T>(xs: readonly T[], i: number): T => {
	const x = xs[i % xs.length];
	if (x === undefined) throw new Error(`nothing at ${i}`);
	return x;
};

/** One step of a random run on a ledger whose founder is alice (`github:7`). */
type Op =
	/** Someone types a name and signs with a key of the pool (4: a key listed for nobody). */
	| {readonly type: "login"; readonly as: number; readonly key: number}
	/** A person signs in by the name they had at first, with their own key. */
	| {readonly type: "self"; readonly who: number}
	/** An agent logs in with a grant for a name, signed with a key of the pool. */
	| {readonly type: "agent"; readonly as: number; readonly key: number}
	/** A member invites a name. */
	| {readonly type: "invite"; readonly by: number; readonly name: number}
	/** A member takes a member or an invite off. */
	| {readonly type: "remove"; readonly by: number; readonly who: number}
	/** A person is renamed at the keys service, to a name nobody has there. */
	| {readonly type: "rename"; readonly who: number; readonly to: number};

const nameIx = fc.nat({max: NAMES.length - 1});
const personIx = fc.nat({max: PEOPLE.length - 1});
const arbOp: fc.Arbitrary<Op> = fc.oneof(
	fc.record({type: fc.constant("login" as const), as: nameIx, key: fc.nat({max: 4})}),
	fc.record({type: fc.constant("self" as const), who: personIx}),
	fc.record({type: fc.constant("agent" as const), as: nameIx, key: fc.nat({max: 4})}),
	fc.record({type: fc.constant("invite" as const), by: fc.nat({max: 3}), name: nameIx}),
	fc.record({type: fc.constant("remove" as const), by: fc.nat({max: 3}), who: fc.nat({max: 7})}),
	fc.record({type: fc.constant("rename" as const), who: personIx, to: nameIx}),
);
/** alice's first login: it founds the ledger. */
const FOUND: Op = {type: "self", who: 0};
/** A random run, from a ledger not yet founded. */
const arbRun = fc.array(arbOp, {maxLength: 8});
/** A random run that founds the ledger first. */
const arbFounded = arbRun.map((ops) => [FOUND, ...ops]);

/** A shared ledger whose founder is alice, with the four people at the keys service. */
const peopleWorld = (mod: Mod): World => {
	const W = sharedWorld(mod, {founder: "github:7"});
	for (const p of PEOPLE) W.people.set(p.name, {id: p.id, keys: [key(p.key).line]});
	return W;
};

const grantFor = (W: World, name: string) =>
	W.mod.grantText({
		address: addressOf(W, "demo"),
		agent: "triage",
		key: key(AGENT_KEY).line,
		for: name,
		expires: W.clock.t + 60_000,
	});

const loginOp = (W: World, name: string, k: number) => loginWith(W, name, key(k));
const agentOp = (W: World, name: string, k: number) =>
	agentLogin(W, {grant: grantFor(W, name), by: key(k), signer: key(AGENT_KEY)});

/** Run one step. A step that needs a member does nothing on a ledger with none. */
const runOp = async (W: World, op: Op): Promise<void> => {
	const m = W.door.members();
	const members = [...m.members.keys()];
	switch (op.type) {
		case "login":
			await loginOp(W, at(NAMES, op.as), op.key);
			return;
		case "self": {
			const p = at(PEOPLE, op.who);
			await loginOp(W, p.name, p.key);
			return;
		}
		case "agent":
			await agentOp(W, at(NAMES, op.as), op.key);
			return;
		case "invite":
			if (members.length > 0)
				await invite(W, {kind: "user", id: at(members, op.by)}, at(NAMES, op.name));
			return;
		case "remove": {
			const off = [...members, ...m.invited.keys()];
			if (members.length > 0)
				W.door.remove({kind: "user", id: at(members, op.by)}, at(off, op.who));
			return;
		}
		case "rename": {
			const p = at(PEOPLE, op.who);
			const to = at(NAMES, op.to);
			const now = [...W.people].find(([, q]) => q.id === p.id);
			if (now === undefined || W.people.has(to)) return;
			W.people.delete(now[0]);
			W.people.set(to, now[1]);
			return;
		}
	}
};

const runOps = async (W: World, ops: readonly Op[]): Promise<void> => {
	for (const op of ops) await runOp(W, op);
};

/** Does the ledger know someone by `name`, in any case: a member or an open invite. */
const knowsName = (W: World, name: string): boolean => {
	const m = W.door.members();
	const n = name.toLowerCase();
	return [...m.members.values(), ...m.invited.values()].some((was) => was.toLowerCase() === n);
};

const OPTS_RUN = {numRuns: 15, seed: 7} as const;

/**
 * 15. Once the ledger is founded, a login, a person's or an agent's, for a name the ledger does not
 *     know (no member or open invite goes by it, in any case) asks the keys service nothing, not
 *     `of` and not `byId`, and is a 401.
 */
const strangersAskNothing: Law = {
	name: "once founded, a login for a name the ledger does not know asks the keys service nothing",
	run: async (mod) => {
		const typed = fc.oneof(fc.constantFrom(...NAMES), fc.stringMatching(/^[A-Za-z0-9-]{1,12}$/));
		await fc.assert(
			fc.asyncProperty(arbFounded, typed, fc.nat({max: 4}), async (ops, name, k) => {
				const W = peopleWorld(mod);
				await runOps(W, ops);
				if (knowsName(W, name)) return;
				const asked = W.asks.length;
				const before = sessionCount(W);
				const person = await loginOp(W, name, k);
				const agent = await agentOp(W, name, k);
				ensure(
					W.asks.length === asked,
					`a login for ${name}, whom the ledger does not know, asked ${JSON.stringify(W.asks.slice(asked))}`,
				);
				ensure(!person.ok && person.status === 401, `a login for ${name} was not a 401`);
				ensure(!agent.ok && agent.status === 401, `an agent login for ${name} was not a 401`);
				ensure(sessionCount(W) === before, `a login for ${name} opened a session`);
			}),
			OPTS_RUN,
		);
	},
};

/**
 * 16. Every failed login with a well-formed name and signature gives the same answer: a name the
 *     ledger does not know, a key not listed for the person it knows by that name, a founder's name
 *     the keys service no longer gives, a removed member. So a refusal does not tell who is a member.
 */
const oneRefusal: Law = {
	name: "every failed login with a well-formed name and signature gives the same status and why",
	run: async (mod) => {
		const tries = fc.array(fc.tuple(fc.constantFrom(...NAMES, "x-1", "Carol"), fc.nat({max: 4})), {
			maxLength: 6,
		});
		await fc.assert(
			fc.asyncProperty(arbRun, tries, async (ops, more) => {
				const W = peopleWorld(mod);
				await runOps(W, ops);
				// Every name with a key listed for nobody, then random names and keys.
				const all: (readonly [string, number])[] = [
					...NAMES.map((n) => [n, NOBODY_KEY] as const),
					...more,
				];
				const answers = new Set<string>();
				for (const [n, k] of all) {
					const r = await loginOp(W, n, k);
					if (!r.ok) answers.add(JSON.stringify({status: r.status, why: r.why}));
				}
				ensure(answers.size === 1, `failed logins gave different answers: ${[...answers]}`);
			}),
			OPTS_RUN,
		);
	},
};

/** 17. Only `invite` ever asks the keys service by name (`Keys.of`): no login, no agent login. */
const onlyInviteAsksByName: Law = {
	name: "only an invite ever asks the keys service by name",
	run: async (mod) => {
		await fc.assert(
			fc.asyncProperty(arbRun, async (ops) => {
				const W = peopleWorld(mod);
				await runOps(W, ops);
				const outside = W.asks.filter((a) => a.q === "of" && !a.inInvite);
				ensure(outside.length === 0, `asked by name outside an invite: ${JSON.stringify(outside)}`);
			}),
			OPTS_RUN,
		);
	},
};

/**
 * 18. A login asks the keys service by id (`Keys.byId`) only about an id the ledger knows at that
 *     moment: a member, an open invite, or the founder before the ledger is founded. One fixed run
 *     takes the founder off first, as random runs rarely do.
 */
const byIdOnlyKnown: Law = {
	name: "a login asks by id only about a member, an open invite, or the founder before founding",
	run: async (mod) => {
		const check = (W: World) => {
			const strange = W.asks.filter((a) => a.q === "byId" && !a.known);
			ensure(strange.length === 0, `asked by id about strangers: ${JSON.stringify(strange)}`);
		};
		// alice founds and invites bob, bob joins and takes alice off, then signs in again, with his
		// own key and with a key listed for nobody.
		const founderOff: Op[] = [
			FOUND,
			{type: "invite", by: 0, name: 1},
			{type: "self", who: 1},
			{type: "remove", by: 1, who: 0},
			{type: "self", who: 1},
			{type: "login", as: 1, key: 4},
		];
		const W = peopleWorld(mod);
		await runOps(W, founderOff);
		ensure(!W.door.members().members.has("github:7"), "the fixed run did not take alice off");
		check(W);
		await fc.assert(
			fc.asyncProperty(arbRun, async (ops) => {
				const R = peopleWorld(mod);
				await runOps(R, ops);
				check(R);
			}),
			OPTS_RUN,
		);
	},
};

/**
 * 19. A rename at the keys service never changes the result for the name the ledger knows: the
 *     same login (a person's or an agent's, by that name in any case, with any key) answers the same
 *     whether the person was renamed there or not, and whether their old name went to someone else.
 */
const renameKeepsResult: Law = {
	name: "a rename at the keys service never changes the result for the name the ledger knows",
	run: async (mod) => {
		await fc.assert(
			fc.asyncProperty(
				fc.boolean(),
				fc.constantFrom("robert", "bobby", "r-2"),
				fc.boolean(),
				fc.constantFrom("bob", "Bob", "BOB"),
				fc.nat({max: 4}),
				fc.boolean(),
				async (joined, renamedTo, takenOver, typed, k, asAgent) => {
					const once = async (renamed: boolean) => {
						const W = peopleWorld(mod);
						const alice = mustOk(await loginOp(W, "alice", 0));
						mustOk(await invite(W, alice.who, "bob"));
						if (joined) mustOk(await loginOp(W, "bob", 1));
						if (renamed) {
							W.people.delete("bob");
							W.people.set(renamedTo, {id: "github:8", keys: [key(1).line]});
							if (takenOver) W.people.set("bob", {id: "github:600", keys: [key(4).line]});
						}
						const r = asAgent ? await agentOp(W, typed, k) : await loginOp(W, typed, k);
						return r.ok
							? {ok: true, who: r.value.who, expires: r.value.expires}
							: {ok: false, status: r.status, why: r.why};
					};
					const plain = await once(false);
					const renamed = await once(true);
					ensure(
						eq(plain, renamed),
						`a rename changed ${typed}'s result: ${JSON.stringify(plain)} became ${JSON.stringify(renamed)}`,
					);
				},
			),
			OPTS_SIGN,
		);
	},
};

/**
 * 20. When the keys service answers a login with another id than the one asked about, the login is a
 *     502, every time, and opens no session and writes no member fact.
 */
const otherIdIs502: Law = {
	name: "an answer with another id than the one asked is always a 502, never a session",
	run: async (mod) => {
		const other = fc.constantFrom("github:8", "github:7", "github:9999", "x@y", "");
		const tries = fc.array(fc.tuple(fc.constantFrom(...NAMES), fc.nat({max: 4}), fc.boolean()), {
			maxLength: 4,
		});
		await fc.assert(
			fc.asyncProperty(arbRun, other, tries, async (ops, lie, more) => {
				const W = peopleWorld(mod);
				await runOps(W, ops);
				W.state.lie = (id) => (id === lie ? `${lie}0` : lie);
				// Each person by their first name and own key, then random names, keys, and agents.
				const all = [
					...PEOPLE.map((p) => [p.name, p.key, false] as const),
					...PEOPLE.map((p) => [p.name, p.key, true] as const),
					...more,
				];
				for (const [n, k, asAgent] of all) {
					const asked = W.asks.length;
					const sessions = sessionCount(W);
					const facts = rules.readStream(W.db, mod.MEMBERS).length;
					const r = asAgent ? await agentOp(W, n, k) : await loginOp(W, n, k);
					if (!W.asks.slice(asked).some((a) => a.lied)) continue;
					ensure(!r.ok && r.status === 502, `${n} was let in on another id's answer`);
					ensure(sessionCount(W) === sessions, `${n} opened a session on another id's answer`);
					ensure(
						rules.readStream(W.db, mod.MEMBERS).length === facts,
						`${n} wrote a member fact on another id's answer`,
					);
				}
			}),
			OPTS_RUN,
		);
	},
};

/**
 * 21. `layerGitHub`, over a fake fetch: a request GitHub answers 401 while it carries the token is
 *     asked exactly once more, without it, with one `TOKEN_REFUSED` in the log. A 401 without a token
 *     is not asked again. The token goes out only as `Bearer <token>`, and never into an error.
 */
const tokenRetry: Law = {
	name: "a 401 with a token is asked once more without it, and a 401 without a token is not",
	run: async (mod) => {
		const token = "law-token-not-a-secret";
		await fc.assert(
			fc.asyncProperty(
				fc.boolean(),
				fc.constantFrom("token" as const, "all" as const),
				fc.constantFrom("of" as const, "byId" as const),
				async (withToken, refuse, q) => {
					const gh = fakeGitHub({refuse});
					gh.users.set("alice", {id: 7, keys: ["ssh-ed25519 AAAA1"]});
					const logs: string[] = [];
					const layer = githubLayer(
						mod,
						gh,
						withToken ? {cacheMs: 0, token: Redacted.make(token)} : {cacheMs: 0},
					);
					const exit = await Effect.runPromiseExit(
						mod.Keys.use((k) => (q === "of" ? k.of("alice") : k.byId("github:7"))).pipe(
							Effect.provide(layer),
							Effect.provide(Logger.layer([Logger.make((l) => logs.push(String(l.message)))])),
						),
					);
					// Refused only with a token: GitHub never sees one without it, and answers.
					const wantOk = refuse === "token";
					ensure(
						Exit.isSuccess(exit) === wantOk,
						`${q} ended ${Exit.isSuccess(exit) ? "well" : "badly"}`,
					);
					const paths = [...new Set(gh.asked.map((a) => a.path))];
					ensure(paths.length > 0, "GitHub was not asked");
					const bearer = `Bearer ${token}`;
					let retried = 0;
					for (const path of paths) {
						const auths = gh.asked.filter((a) => a.path === path).map((a) => a.auth);
						const shown = `${path} was asked with ${JSON.stringify(auths)}`;
						if (!withToken) {
							ensure(eq(auths, [null]), shown);
							continue;
						}
						// `of` asks two paths together, and the first to fail stops the other: that one may
						// end before its second ask. A question that ends well asked each path twice.
						ensure(eq(auths, [bearer, null]) || (!wantOk && eq(auths, [bearer])), shown);
						if (auths.length === 2) retried++;
					}
					const warned = logs.filter((l) => l === mod.TOKEN_REFUSED).length;
					ensure(
						withToken ? warned >= retried && warned <= paths.length : warned === 0,
						`the log said ${JSON.stringify(logs)} for ${retried} asks again`,
					);
					if (Exit.isFailure(exit))
						ensure(
							!JSON.stringify(exit.cause).includes(token) && !logs.some((l) => l.includes(token)),
							"the token went into an error or the log",
						);
				},
			),
			{numRuns: 12, seed: 7},
		);
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
	strangersAskNothing,
	oneRefusal,
	onlyInviteAsksByName,
	byIdOnlyKnown,
	renameKeepsResult,
	otherIdIs502,
	tokenRetry,
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
	// A login goes by the name: it asks who has the name now, takes that id, and joins whoever an
	// invite's name matches.
	bindsToLogin: () =>
		plant(
			"door",
			"(k) => k.byId(id),\n\t\t\t\t(s) => s.id === id,",
			"(k) => k.of(name),\n\t\t\t\t() => true,",
			[
				["return letIn({id, name: as});", "return letIn({id: s.id, name: as});"],
				[
					'else if (m.invited.has(id)) this.#fact(me, "joined", {id, name});',
					'else if (m.invited.has(id) || [...m.invited.values()].includes(name)) this.#fact(me, "joined", {id, name});',
				],
			],
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
			"(await verify(signature, text, NAMESPACE, s.keys)) !== null",
			"(await verify(signature, text, NAMESPACE, s.keys.slice(0, 1))) !== null",
		),
	// GitHub's answer is kept forever, so a key taken off on GitHub keeps working.
	cacheNeverExpires: () =>
		plant(
			"keys-github",
			"Exit.isSuccess(exit) ? Duration.millis(ms) : Duration.zero,",
			"Exit.isSuccess(exit) ? Duration.infinity : Duration.zero,",
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
	anyIdTaken: () =>
		plant("door", "s === null || (isPersonId(s.id) && ok(s))", "s === null || ok(s)"),
	// An unreachable keys service reads as nobody by that name.
	unreachableIsNobody: () =>
		plant(
			"door",
			"Effect.succeed(refuse(502, `could not ask for the keys of",
			"Effect.succeed(letIn(null) || refuse(502, `could not ask for the keys of",
		),
	// Every member and open invite is asked about at each login, whatever name was typed.
	asksEveryone: () =>
		plant(
			"door",
			"const ids = [...known.map((k) => k.id), ...(founder === null ? [] : [founder])];",
			"const ids = [...m.members.keys(), ...m.invited.keys(), ...(founder === null ? [] : [founder])];",
		),
	// A name nobody here goes by gets its own refusal, which tells who is a member.
	saysNobody: () =>
		plant(
			"door",
			"\t\t}\n\t\treturn refuse(401, NOT_PROVEN);",
			'\t\t}\n\t\treturn refuse(401, known.length === 0 ? "nobody here goes by that name" : NOT_PROVEN);',
		),
	// A login that is proven asks once more, by name, for the name the person goes by now.
	refreshesByName: () =>
		plant(
			"door",
			"if ((await verify(signature, text, NAMESPACE, s.keys)) !== null) return letIn({id, name: as});",
			"if ((await verify(signature, text, NAMESPACE, s.keys)) !== null) {\n\t\t\t\tawait this.#ask(as, (k) => k.of(as), () => true);\n\t\t\t\treturn letIn({id, name: as});\n\t\t\t}",
		),
	// The founder is asked about at every login by a known name, even after being taken off.
	asksFounderAlways: () =>
		plant(
			"door",
			'const founder = c.kind === "shared" && !m.founded ? c.founder : null;',
			'const founder = c.kind === "shared" && (!m.founded || known.length > 0) ? c.founder : null;',
		),
	// The typed name is held to the name the keys service gives now, not the one the ledger knows.
	goesByNewName: () =>
		plant(
			"door",
			"const as = known.find((k) => k.id === id)?.name ?? s.name;",
			"const as = s.name;",
		),
	// The keys service's answer is taken for the id asked about, whatever id it gives.
	takesOtherId: () => plant("door", "(s) => s.id === id,", "() => true,"),
	// A token GitHub refuses is never asked without.
	noRetry: () =>
		plant("keys-github", "if (res.status === 401 && o.token !== undefined) {", "if (false) {"),
	// A 401 is asked again even when no token was sent.
	retriesWithoutToken: () =>
		plant(
			"keys-github",
			"if (res.status === 401 && o.token !== undefined) {",
			"if (res.status === 401) {",
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
			bindsToLogin: [bindToId.name, onlyInviteAsksByName.name, otherIdIs502.name],
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
			asksEveryone: [strangersAskNothing.name],
			saysNobody: [oneRefusal.name],
			refreshesByName: [onlyInviteAsksByName.name],
			asksFounderAlways: [byIdOnlyKnown.name],
			goesByNewName: [renameKeepsResult.name],
			takesOtherId: [otherIdIs502.name],
			noRetry: [tokenRetry.name],
			retriesWithoutToken: [tokenRetry.name],
		});
		// Every law is caught by at least one plant.
		const all = new Set(Object.values(caught).flat());
		expect(LAWS.filter((law) => !all.has(law.name)).map((law) => law.name)).toEqual([]);
	}, 120_000);
});
