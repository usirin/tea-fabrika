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
	| "UNAVAILABLE"
	| "NOT_PROVEN"
> &
	Pick<typeof realWriter, "writerOf" | "writerText"> &
	Pick<typeof realKeys, "Keys" | "KeysUnreachable" | "layerNobody"> &
	Pick<
		typeof realGitHub,
		| "layerGitHub"
		| "KEYS_CACHE_MS"
		| "KEYS_FAIL_MS"
		| "LIMIT_WAIT_MS"
		| "limitWait"
		| "TOKEN_REFUSED"
	>;

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
	/** The keys service is unreachable for these ids only (`byId`). */
	downFor: Set<string>;
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
	/** What the door's runtime logged: the server's log. */
	readonly logs: string[];
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
	w: Pick<World, "people" | "state" | "asks" | "logs">,
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
			const down = w.state.down || (q === "byId" && w.state.downFor.has(arg));
			const found = down ? undefined : find();
			const got = found === undefined ? null : answer(...found);
			w.asks.push({
				q,
				arg,
				inInvite: w.state.inInvite,
				known: q === "byId" && knownNow(arg),
				lied: got !== null && found !== undefined && got.id !== found[1].id,
			});
			return down
				? Effect.fail(new mod.KeysUnreachable({why: `down for the law, at ${q} ${arg}`}))
				: Effect.succeed(got);
		});
	return runtimeOf(
		Layer.mergeAll(
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
			// The server's log, kept for the laws, and kept off the test's own output.
			Logger.layer([Logger.make((l) => w.logs.push(String(l.message)))]),
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
		state: {down: false, downFor: new Set(), lie: null, inInvite: false} as KeysState,
		asks: [] as Ask[],
		logs: [] as string[],
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

type Answer = {ok: true} | {ok: false; status: number; why: string};
/** The one answer for a keys service that failed: exactly `{status: 502, why: UNAVAILABLE}`. */
const unavailable = (mod: Mod, r: Answer): boolean =>
	!r.ok && eq({status: r.status, why: r.why}, {status: 502, why: mod.UNAVAILABLE});

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
 * `state.refusal`, while set, is the answer to every request: a status and its headers.
 */
const fakeGitHub = (o: {refuse?: "token" | "all"} = {}) => {
	const users = new Map<string, {id: number; keys: string[]}>();
	const asked: {path: string; auth: string | null}[] = [];
	const state = {refusal: null as {status: number; headers: Record<string, string>} | null};
	const notFound = () => Response.json({message: "Not Found"}, {status: 404});
	const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const req = input instanceof Request ? input : new Request(input, init);
		const url = new URL(req.url);
		const auth = req.headers.get("authorization");
		asked.push({path: url.pathname, auth});
		if (state.refusal !== null)
			return new Response("refused", {
				status: state.refusal.status,
				headers: state.refusal.headers,
			});
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
	return {users, asked, state, fetch};
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

/**
 * 13. The keys service's id ends up in every writer, so an id with an "@" in it is the one 502,
 *     `UNAVAILABLE`.
 */
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
				ensure(unavailable(mod, inv), `an invite took the id ${a}@${b}: ${JSON.stringify(inv)}`);
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

/**
 * 14. When the keys service cannot be asked: the one 502, `UNAVAILABLE`, and no session opened, no
 *     invite kept.
 */
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
		ensure(unavailable(mod, login), "a login with the keys service down was not UNAVAILABLE");
		const grant = mod.grantText({
			address: addressOf(W, "demo"),
			agent: "triage",
			key: key(2).line,
			for: "alice",
			expires: W.clock.t + 60_000,
		});
		const agent = await agentLogin(W, {grant, by: key(0), signer: key(2)});
		ensure(unavailable(mod, agent), "an agent login with the keys down was not UNAVAILABLE");
		const inv = await W.door.invite(alice.who, "bob");
		ensure(unavailable(mod, inv), "an invite with the keys service down was not UNAVAILABLE");
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
 * 20. When the keys service answers a login with another id than the one asked about, the login is
 *     the one 502, `UNAVAILABLE`, every time, and opens no session and writes no member fact.
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
					ensure(
						unavailable(mod, r),
						`${n} on another id's answer was not UNAVAILABLE: ${JSON.stringify(r)}`,
					);
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

// ---------------------------------------------------------------- round 3: one 502, several ids

/**
 * Generated people for law 22: names `m<n>-z` and ids `<service>:<n>q`, so no name or id is a
 * part of another. Person 0 founds the ledger.
 */
const arbFolk = fc
	.uniqueArray(fc.nat({max: 9999}), {minLength: 2, maxLength: 5})
	.chain((ns) =>
		fc.tuple(
			fc.constant(ns),
			fc.array(fc.constantFrom("github", "gl", "kc"), {minLength: ns.length, maxLength: ns.length}),
		),
	)
	.map(([ns, services]) =>
		ns.map((n, i) => ({name: `m${n}-z`, id: `${services[i]}:${n * 7 + 13}q`, key: i})),
	);

/** One step of law 22's runs. `as` picks a typed name: a person's, in some case, or a stranger's. */
type Step =
	| {readonly type: "login"; readonly as: number; readonly upper: boolean; readonly key: number}
	| {readonly type: "agent"; readonly as: number; readonly upper: boolean; readonly key: number}
	| {readonly type: "invite"; readonly by: number; readonly as: number}
	| {readonly type: "remove"; readonly by: number; readonly who: number}
	| {readonly type: "rename"; readonly who: number; readonly to: number}
	| {readonly type: "down"; readonly ids: readonly boolean[]; readonly all: boolean}
	| {readonly type: "lie"; readonly on: boolean};

const arbStep: fc.Arbitrary<Step> = fc.oneof(
	fc.record({
		type: fc.constant("login" as const),
		as: fc.nat({max: 7}),
		upper: fc.boolean(),
		key: fc.nat({max: 6}),
	}),
	fc.record({
		type: fc.constant("agent" as const),
		as: fc.nat({max: 7}),
		upper: fc.boolean(),
		key: fc.nat({max: 6}),
	}),
	fc.record({type: fc.constant("invite" as const), by: fc.nat({max: 4}), as: fc.nat({max: 7})}),
	fc.record({type: fc.constant("remove" as const), by: fc.nat({max: 4}), who: fc.nat({max: 9})}),
	fc.record({type: fc.constant("rename" as const), who: fc.nat({max: 4}), to: fc.nat({max: 99})}),
	fc.record({
		type: fc.constant("down" as const),
		ids: fc.array(fc.boolean(), {minLength: 5, maxLength: 5}),
		all: fc.boolean(),
	}),
	fc.record({type: fc.constant("lie" as const), on: fc.boolean()}),
);

/**
 * 22. No refusal names anyone. Every 502 is exactly `UNAVAILABLE`, and what went wrong is in the
 *     server's log. No refusal holds a person's id, a name anyone goes or went by (but the name the
 *     request itself typed), or a keys service's path. Over random runs on generated people, with
 *     the keys service down for some ids or for all, or answering with another id.
 */
const refusalsNameNobody: Law = {
	name: "no refusal names anyone: a 502 is exactly UNAVAILABLE, and no refusal holds an id, another's name or a path",
	run: async (mod) => {
		const stranger = fc.integer({min: 10_000, max: 19_999}).map((n) => `m${n}-z`);
		await fc.assert(
			fc.asyncProperty(
				arbFolk,
				fc.array(stranger, {minLength: 3, maxLength: 3}),
				fc.array(arbStep, {maxLength: 10}),
				async (folk, strangers, steps) => {
					const founder = folk[0];
					if (founder === undefined) return;
					const W = sharedWorld(mod, {founder: founder.id});
					for (const p of folk) W.people.set(p.name, {id: p.id, keys: [key(p.key).line]});
					const ids = new Set(folk.flatMap((p) => [p.id, `${p.id}9`]));
					const names = new Set([...folk.map((p) => p.name), ...strangers]);
					const typed = (as: number, upper: boolean) => {
						const n = at([...folk.map((p) => p.name), ...strangers], as);
						return upper ? n.toUpperCase() : n;
					};
					const seen: {typed: string; status: number; why: string; logged: boolean}[] = [];
					const keep = (t: string, r: Answer, logsBefore: number) => {
						if (!r.ok) seen.push({...r, typed: t, logged: W.logs.length > logsBefore});
					};
					await loginOp(W, founder.name, founder.key);
					for (const s of steps) {
						const m = W.door.members();
						const members = [...m.members.keys()];
						const logs = W.logs.length;
						if (s.type === "login" || s.type === "agent") {
							const t = typed(s.as, s.upper);
							const k = s.key === 6 ? NOBODY_KEY : s.key;
							keep(t, s.type === "login" ? await loginOp(W, t, k) : await agentOp(W, t, k), logs);
						} else if (s.type === "invite") {
							if (members.length === 0) continue;
							const t = typed(s.as, false);
							keep(t, await invite(W, {kind: "user", id: at(members, s.by)}, t), logs);
						} else if (s.type === "remove") {
							const off = [...members, ...m.invited.keys()];
							if (members.length > 0)
								keep(
									"",
									W.door.remove({kind: "user", id: at(members, s.by)}, at(off, s.who)),
									logs,
								);
						} else if (s.type === "rename") {
							const p = at(folk, s.who);
							const now = [...W.people].find(([, q]) => q.id === p.id);
							const to = `r${s.to}-y`;
							if (now === undefined || W.people.has(to)) continue;
							W.people.delete(now[0]);
							W.people.set(to, now[1]);
							names.add(to);
						} else if (s.type === "down") {
							W.state.down = s.all;
							W.state.downFor = new Set(folk.filter((_, i) => s.ids[i]).map((p) => p.id));
						} else {
							W.state.lie = s.on ? (id) => `${id}9` : null;
						}
					}
					for (const r of seen) {
						const shown = `${JSON.stringify(r)} (ids ${[...ids]}, names ${[...names]})`;
						if (r.status === 502)
							ensure(
								r.why === mod.UNAVAILABLE && r.logged,
								`a 502 was not UNAVAILABLE, logged: ${shown}`,
							);
						const text =
							r.typed === ""
								? r.why.toLowerCase()
								: r.why.toLowerCase().split(r.typed.toLowerCase()).join("");
						ensure(
							![...ids].some((id) => text.includes(id.toLowerCase())),
							`a refusal names an id: ${shown}`,
						);
						ensure(
							![...names].some((n) => text.includes(n.toLowerCase())),
							`a refusal names someone the request did not type: ${shown}`,
						);
						ensure(!/\/users?\b|api\.github/.test(text), `a refusal names a path: ${shown}`);
					}
				},
			),
			{numRuns: 25, seed: 7},
		);
	},
};

/** What the keys service says about one of several people this ledger knows by one name. */
type Says = "proves" | "other-key" | "nobody" | "down" | "lies";
const SAYS: readonly Says[] = ["proves", "other-key", "nobody", "down", "lies"];

/**
 * The model of a login by a name several people here go by: in when any of them is proven by the
 * signature, whatever the others say; else `UNAVAILABLE` when a question about one failed (down, or
 * an answer with another id); else `NOT_PROVEN`.
 */
const provenModel = (says: readonly Says[]): "in" | "unavailable" | "not-proven" =>
	says.includes("proves")
		? "in"
		: says.some((s) => s === "down" || s === "lies")
			? "unavailable"
			: "not-proven";

/**
 * 23. A login by a name several people here go by (members and open invites, in any case) answers as
 *     the model says, for every mix of what the keys service says of each: proven wins over any
 *     failure, a failure with no proof is `UNAVAILABLE`, and neither is `NOT_PROVEN`.
 */
const provenAsModel: Law = {
	name: "a login by a name several people go by answers as the model: proven wins, else a failure is UNAVAILABLE, else NOT_PROVEN",
	run: async (mod) => {
		const SIGNER = 1;
		const OTHER = 2;
		const arbCase = fc.array(
			fc.record({
				says: fc.constantFrom(...SAYS),
				member: fc.boolean(),
				as: fc.constantFrom("bob", "Bob", "BOB"),
			}),
			{minLength: 1, maxLength: 5},
		);
		await fc.assert(
			fc.asyncProperty(arbCase, fc.constantFrom("bob", "Bob", "bOB"), async (cands, typedName) => {
				const W = sharedWorld(mod, {founder: "github:1"});
				W.people.set("alice", {id: "github:1", keys: [key(0).line]});
				mustOk(await loginOp(W, "alice", 0));
				const liars = new Set<string>();
				for (const [i, c] of cands.entries()) {
					const id = `github:${100 + i}`;
					const fact = (kind: string) =>
						rules.writeUnguarded(W.db, W.clock.t, mod.MEMBERS, "any", {
							kind,
							writer: "user:github:1",
							data: {id, name: c.as},
						});
					fact("invited");
					if (c.member) fact("joined");
					if (c.says === "down") W.state.downFor.add(id);
					if (c.says === "lies") liars.add(id);
					if (c.says !== "nobody")
						W.people.set(`p${i}`, {
							id,
							keys: [key(c.says === "other-key" ? OTHER : SIGNER).line],
						});
				}
				W.state.lie = (id) => (liars.has(id) ? `${id}9` : id);
				const sessions = sessionCount(W);
				const r = await loginOp(W, typedName, SIGNER);
				const want = provenModel(cands.map((c) => c.says));
				const provers = cands.flatMap((c, i) => (c.says === "proves" ? [`github:${100 + i}`] : []));
				const shown = `${JSON.stringify(cands)} answered ${JSON.stringify(r)}, the model says ${want}`;
				if (want === "in")
					ensure(
						r.ok && provers.includes(r.value.who.kind === "user" ? r.value.who.id : ""),
						shown,
					);
				else {
					ensure(
						want === "unavailable"
							? unavailable(mod, r)
							: !r.ok && eq({status: r.status, why: r.why}, {status: 401, why: mod.NOT_PROVEN}),
						shown,
					);
					ensure(sessionCount(W) === sessions, `a session was opened: ${shown}`);
				}
			}),
			{numRuns: 60, seed: 7},
		);
	},
};

// ---------------------------------------------------------------- round 3: GitHub's limit and memory

/** One question to `Keys`: by id, or by name. */
type Q = {readonly q: "byId" | "of"; readonly arg: string};
const GH_PEOPLE = [
	["alice", 7],
	["bob", 8],
	["carol", 9],
] as const;
const arbQ: fc.Arbitrary<Q> = fc.constantFrom(
	...GH_PEOPLE.map(([, n]): Q => ({q: "byId", arg: `github:${n}`})),
	...GH_PEOPLE.map(([login]): Q => ({q: "of", arg: login})),
);
/** A fake GitHub with alice, bob and carol, one key each. */
const ghPeople = () => {
	const gh = fakeGitHub();
	for (const [login, n] of GH_PEOPLE) gh.users.set(login, {id: n, keys: [`ssh-ed25519 AAAA${n}`]});
	return gh;
};
/** Where Effect's TestClock starts in these laws: a whole second, in 2027. */
const T0 = 1_800_000_000_000;
/** A question's answer as text: its keys, or the tag it failed with. */
const answerOf = (mod: Mod, x: Q) =>
	mod.Keys.use((k) => (x.q === "byId" ? k.byId(x.arg) : k.of(x.arg))).pipe(
		Effect.match({
			onFailure: (e): string => e._tag,
			onSuccess: (s): string => `keys ${JSON.stringify(s?.keys ?? null)}`,
		}),
	);
/** `body` on a fresh `layerGitHub` over `gh`, with Effect's TestClock at `T0`. */
const onTestClock = (
	mod: Mod,
	gh: ReturnType<typeof fakeGitHub>,
	o: Parameters<Mod["layerGitHub"]>[0],
	body: Effect.Effect<void, never, Keys>,
) =>
	Effect.runPromise(
		Effect.gen(function* () {
			yield* TestClock.setTime(T0);
			yield* body;
		}).pipe(Effect.provide(githubLayer(mod, gh, o)), Effect.provide(TestClock.layer())),
	);

/** A refusal that says the limit is spent for `secs`, in one of the three ways GitHub says it. */
const arbLimit = fc.record({
	status: fc.constantFrom(403, 429),
	how: fc.constantFrom("after" as const, "date" as const, "reset" as const),
	secs: fc.integer({min: 1, max: 3600}),
});
type Limit = typeof arbLimit extends fc.Arbitrary<infer T> ? T : never;
const limitHeaders = (l: Limit): Record<string, string> =>
	l.how === "after"
		? {"retry-after": String(l.secs)}
		: l.how === "date"
			? {"retry-after": new Date(T0 + l.secs * 1000).toUTCString()}
			: {"x-ratelimit-remaining": "0", "x-ratelimit-reset": String(T0 / 1000 + l.secs)};

/**
 * 24. After GitHub says the limit is spent, no call goes out until the time it names, for any id or
 *     any name, and every question in between fails as unreachable. At that time calls go out again.
 */
const limitSilence: Law = {
	name: "while GitHub's limit is spent no call goes out, for any id or name, and at its end calls go out again",
	run: async (mod) => {
		const later = fc.array(fc.tuple(fc.nat({max: 999_999_999}), arbQ), {maxLength: 6});
		await fc.assert(
			fc.asyncProperty(arbLimit, arbQ, later, arbQ, async (lim, first, asks, last) => {
				const gh = ghPeople();
				const wait = lim.secs * 1000;
				const times = asks.map(([x, q]) => [x % wait, q] as const).sort((a, b) => a[0] - b[0]);
				await onTestClock(
					mod,
					gh,
					{cacheMs: 0, failMs: 0},
					Effect.gen(function* () {
						gh.state.refusal = {status: lim.status, headers: limitHeaders(lim)};
						ensure(
							(yield* answerOf(mod, first)) === "KeysUnreachable",
							"the refusal was not a failure",
						);
						gh.state.refusal = null;
						const sent = gh.asked.length;
						for (const [t, q] of times) {
							yield* TestClock.setTime(T0 + t);
							const a = yield* answerOf(mod, q);
							ensure(
								a === "KeysUnreachable" && gh.asked.length === sent,
								`${q.q} ${q.arg} at ${t} ms of a ${wait} ms wait answered ${a}, with ${gh.asked.length - sent} calls out`,
							);
						}
						yield* TestClock.setTime(T0 + wait);
						const a = yield* answerOf(mod, last);
						ensure(
							a.startsWith("keys") && gh.asked.length > sent,
							`at the end of a ${wait} ms wait ${last.q} ${last.arg} answered ${a}`,
						);
					}),
				);
			}),
			{numRuns: 60, seed: 7},
		);
	},
};

/** A header value as anyone may send it: odd numbers, far dates, nothing, or any text. */
const arbHeader = fc.oneof(
	fc.integer({min: -1e12, max: 1e13}).map(String),
	fc.constantFrom(
		"9999999999",
		"99999999999",
		"4102444800",
		"-1",
		"-5",
		"1.5",
		"1e9",
		"0x10",
		"2099",
		"Fri, 31 Dec 9999 23:59:59 GMT",
		"+275760-09-13T00:00:00Z",
		" 60 ",
		"",
		"soon",
	),
	fc.integer({min: 1, max: 10 * 365 * 24 * 3600}).map((s) => new Date(T0 + s * 1000).toUTCString()),
	fc.stringMatching(/^[ -~]{0,16}$/),
);
const arbForged = fc
	.record(
		{
			"retry-after": arbHeader,
			"x-ratelimit-remaining": fc.constantFrom("0", " 0", "00", "-0", "1", ""),
			"x-ratelimit-reset": arbHeader,
		},
		{requiredKeys: []},
	)
	.map(
		(h) =>
			Object.fromEntries(Object.entries(h).filter(([, v]) => v !== undefined)) as Record<
				string,
				string
			>,
	);

/**
 * 25. GitHub's wait is never over an hour, whatever the headers say: forged far resets, far dates,
 *     negative numbers, text. `limitWait` gives null or 0 to `LIMIT_WAIT_MS`, and an hour after any
 *     refusal a question goes out again.
 */
const limitCapped: Law = {
	name: "GitHub's wait is never over an hour, whatever the headers say",
	run: async (mod) => {
		await fc.assert(
			fc.asyncProperty(
				fc.constantFrom(403, 429),
				arbForged,
				arbQ,
				arbQ,
				async (status, headers, first, last) => {
					const w = mod.limitWait(status, headers, T0);
					ensure(
						w === null || (w >= 0 && w <= mod.LIMIT_WAIT_MS),
						`limitWait gave ${w} for ${JSON.stringify(headers)}`,
					);
					const gh = ghPeople();
					await onTestClock(
						mod,
						gh,
						{cacheMs: 0, failMs: 0},
						Effect.gen(function* () {
							gh.state.refusal = {status, headers};
							yield* answerOf(mod, first);
							gh.state.refusal = null;
							const sent = gh.asked.length;
							yield* TestClock.setTime(T0 + mod.LIMIT_WAIT_MS);
							const a = yield* answerOf(mod, last);
							ensure(
								a.startsWith("keys") && gh.asked.length > sent,
								`an hour after ${status} ${JSON.stringify(headers)}, ${last.q} ${last.arg} answered ${a}`,
							);
						}),
					);
				},
			),
			{numRuns: 80, seed: 7},
		);
	},
};

/**
 * 26. An answer is served from memory for exactly `cacheMs` and a failure for exactly `failMs`: the
 *     last ms before, nothing goes out and the old answer comes back; at that ms, GitHub is asked.
 *     0 keeps nothing. Over generated times, both questions, and both outcomes.
 */
const keptExactly: Law = {
	name: "an answer is kept exactly cacheMs and a failure exactly failMs, and 0 keeps nothing",
	run: async (mod) => {
		const ms = fc.oneof(fc.constant(0), fc.integer({min: 1, max: 10 * 60_000}));
		await fc.assert(
			fc.asyncProperty(ms, ms, arbQ, fc.boolean(), async (cacheMs, failMs, q, fails) => {
				const gh = ghPeople();
				const ttl = fails ? failMs : cacheMs;
				await onTestClock(
					mod,
					gh,
					{cacheMs, failMs},
					Effect.gen(function* () {
						if (fails) gh.state.refusal = {status: 503, headers: {}};
						const was = yield* answerOf(mod, q);
						ensure(
							fails ? was === "KeysUnreachable" : was.startsWith("keys"),
							`the first answer was ${was}`,
						);
						// GitHub changes its answer: it is up again, and every key is new.
						gh.state.refusal = null;
						for (const [login, n] of GH_PEOPLE)
							gh.users.set(login, {id: n, keys: [`ssh-ed25519 BBBB${n}`]});
						const sent = gh.asked.length;
						const shown = `${q.q} ${q.arg}, cacheMs ${cacheMs}, failMs ${failMs}, ${fails ? "a failure" : "an answer"}`;
						if (ttl > 0) {
							yield* TestClock.setTime(T0 + ttl - 1);
							const kept = yield* answerOf(mod, q);
							ensure(kept === was && gh.asked.length === sent, `not kept to its last ms: ${shown}`);
						}
						yield* TestClock.setTime(T0 + ttl);
						const fresh = yield* answerOf(mod, q);
						ensure(
							fresh.includes("BBBB") && gh.asked.length > sent,
							`kept past its time: ${shown}, answered ${fresh}`,
						);
					}),
				);
			}),
			{numRuns: 60, seed: 7},
		);
	},
};

/**
 * 27. At the wait's end every question goes out again, even one asked during it: the wait's own
 *     refusal is kept no time, whatever `failMs` is. Found as a bug on 00e02fa (the refusal was kept
 *     `failMs`, so that question stayed failed past the wait, and past an hour); fixed in 366c50b.
 *     A question asked at any ms of the wait answers at the wait's last ms + 1, never later.
 */
const waitEndsForAll: Law = {
	name: "at the end of GitHub's wait every question goes out again, even one asked during it",
	run: async (mod) => {
		await fc.assert(
			fc.asyncProperty(
				arbLimit,
				fc.integer({min: 1, max: 60_000}),
				fc.oneof(fc.constant(1), fc.integer({min: 1, max: 999_999_999})),
				arbQ,
				arbQ,
				async (lim, failMs, back, first, during) => {
					// The first question's refusal is GitHub's own, kept `failMs`: that one may stay failed.
					if (eq(first, during)) return;
					const gh = ghPeople();
					const wait = lim.secs * 1000;
					// Asked `back` ms before the end, at the latest 1 ms before it.
					const at = wait - 1 - ((back - 1) % wait);
					await onTestClock(
						mod,
						gh,
						{cacheMs: 0, failMs},
						Effect.gen(function* () {
							gh.state.refusal = {status: lim.status, headers: limitHeaders(lim)};
							yield* answerOf(mod, first);
							gh.state.refusal = null;
							yield* TestClock.setTime(T0 + at);
							const was = yield* answerOf(mod, during);
							ensure(was === "KeysUnreachable", `asked during the wait, answered ${was}`);
							yield* TestClock.setTime(T0 + wait);
							const sent = gh.asked.length;
							const a = yield* answerOf(mod, during);
							ensure(
								a.startsWith("keys") && gh.asked.length > sent,
								`${during.q} ${during.arg}, asked at ${at} ms of a ${wait} ms wait, answered ${a} at its end (failMs ${failMs})`,
							);
						}),
					);
				},
			),
			{numRuns: 40, seed: 7},
		);
	},
};

// ---------------------------------------------------------------- round 4: GitHub's headers, read strictly

/** One hour in ms: the longest wait, written here and not read from the code under test. */
const HOUR = 60 * 60_000;
/** How long a wait until `at` is, from `T0`: never below 0, never over an hour. */
const waitUntil = (at: number) => Math.min(Math.max(at - T0, 0), HOUR);
/** Seconds as text, to the wait they name, in BigInt so a number of any length is exact. */
const waitOfSecs = (s: string) => {
	const ms = BigInt(s) * 1000n;
	return ms >= BigInt(HOUR) ? HOUR : Number(ms);
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAYS_LONG = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
] as const;
const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
] as const;
const two = (n: number) => String(n).padStart(2, "0");

/** The three forms of an HTTP-date, RFC 9110 section 5.6.7. */
type DateForm = "imf" | "rfc850" | "asctime";
/**
 * `t` (ms since 1970, a whole second, a year of four digits) as an HTTP-date in `form`, written here
 * by hand and not by `Date`'s own printer:
 * `Sun, 06 Nov 1994 08:49:37 GMT`, `Sunday, 06-Nov-94 08:49:37 GMT`, `Sun Nov  6 08:49:37 1994`.
 */
const httpDateText = (t: number, form: DateForm): string => {
	const d = new Date(t);
	const day = d.getUTCDate();
	const mon = MONTHS[d.getUTCMonth()];
	const year = d.getUTCFullYear();
	const time = `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}`;
	switch (form) {
		case "imf":
			return `${WEEKDAYS[d.getUTCDay()]}, ${two(day)} ${mon} ${year} ${time} GMT`;
		case "rfc850":
			return `${WEEKDAYS_LONG[d.getUTCDay()]}, ${two(day)}-${mon}-${two(year % 100)} ${time} GMT`;
		case "asctime":
			return `${WEEKDAYS[d.getUTCDay()]} ${mon} ${String(day).padStart(2, " ")} ${time} ${year}`;
	}
};
const arbForm = fc.constantFrom<DateForm>("imf", "rfc850", "asctime");
/** Forty years in seconds: inside it a two-digit year is never in doubt. */
const FORTY_YEARS = 40 * 365 * 24 * 3600;

/**
 * The machine's time zone, as an input of the laws that read a date: Cloudflare runs in UTC, a
 * laptop's Miniflare in the laptop's zone. A date read as local time is right only in UTC. Twelve
 * hours behind it, a date just past reads as still ahead; fourteen hours ahead, a date just ahead
 * reads as already past. Each run sets its zone, so a law gives the same answer on any machine.
 * These are IANA's fixed offsets, whose sign is the other way round: `Etc/GMT+12` is UTC-12.
 */
const arbZone = fc.constantFrom("UTC", "Etc/GMT+12", "Etc/GMT-14");
/** Runs a law whose runs set the zone, then puts back the zone the machine had. */
const keepingZone = async (law: () => Promise<void>): Promise<void> => {
	const was = process.env.TZ;
	try {
		await law();
	} finally {
		if (was === undefined) Reflect.deleteProperty(process.env, "TZ");
		else process.env.TZ = was;
	}
};

/** A spent-limit refusal's other headers: a reset now or later, or none, any remaining. */
const arbOthers = fc
	.record(
		{
			"x-ratelimit-remaining": fc.constantFrom("0", "1"),
			"x-ratelimit-reset": fc.integer({min: 0, max: 7200}).map((s) => String(T0 / 1000 + s)),
		},
		{requiredKeys: []},
	)
	.map((h) => h as Record<string, string>);

/** A date's parts, any of which a bent date below may break. */
const arbParts = fc.record({
	wd: fc.nat({max: 6}),
	day: fc.integer({min: 1, max: 28}),
	mon: fc.nat({max: 11}),
	year: fc.integer({min: 1970, max: 2100}),
	h: fc.nat({max: 23}),
	m: fc.nat({max: 59}),
	s: fc.nat({max: 59}),
});
type Parts = typeof arbParts extends fc.Arbitrary<infer T> ? T : never;
/** Ways to bend a date so it is no HTTP-date: a piece dropped, moved, spelled wrong or out of range. */
const BENDS: readonly ((p: Parts) => string)[] = [
	// IMF-fixdate with its weekday, its zone, its time, its seconds or its comma dropped.
	(p) => `${two(p.day)} ${MONTHS[p.mon]} ${p.year} ${two(p.h)}:${two(p.m)}:${two(p.s)} GMT`,
	(p) =>
		`${WEEKDAYS[p.wd]}, ${two(p.day)} ${MONTHS[p.mon]} ${p.year} ${two(p.h)}:${two(p.m)}:${two(p.s)}`,
	(p) => `${WEEKDAYS[p.wd]}, ${two(p.day)} ${MONTHS[p.mon]} ${p.year} GMT`,
	(p) => `${WEEKDAYS[p.wd]}, ${two(p.day)} ${MONTHS[p.mon]} ${p.year}`,
	(p) => `${WEEKDAYS[p.wd]}, ${two(p.day)} ${MONTHS[p.mon]} ${p.year} ${two(p.h)}:${two(p.m)} GMT`,
	(p) =>
		`${WEEKDAYS[p.wd]} ${two(p.day)} ${MONTHS[p.mon]} ${p.year} ${two(p.h)}:${two(p.m)}:${two(p.s)} GMT`,
	// Another zone, a lower-case zone or month, a one-digit day, a two-digit year, a long weekday.
	(p) =>
		`${WEEKDAYS[p.wd]}, ${two(p.day)} ${MONTHS[p.mon]} ${p.year} ${two(p.h)}:${two(p.m)}:${two(p.s)} UTC`,
	(p) =>
		`${WEEKDAYS[p.wd]}, ${two(p.day)} ${MONTHS[p.mon]} ${p.year} ${two(p.h)}:${two(p.m)}:${two(p.s)} +0000`,
	(p) =>
		`${WEEKDAYS[p.wd]}, ${two(p.day)} ${MONTHS[p.mon]} ${p.year} ${two(p.h)}:${two(p.m)}:${two(p.s)} gmt`,
	(p) =>
		`${WEEKDAYS[p.wd]}, ${two(p.day)} ${MONTHS[p.mon]?.toLowerCase()} ${p.year} ${two(p.h)}:${two(p.m)}:${two(p.s)} GMT`,
	(p) =>
		`${WEEKDAYS[p.wd]}, ${p.day % 9 || 1} ${MONTHS[p.mon]} ${p.year} ${two(p.h)}:${two(p.m)}:${two(p.s)} GMT`,
	(p) =>
		`${WEEKDAYS[p.wd]}, ${two(p.day)} ${MONTHS[p.mon]} ${two(p.year % 100)} ${two(p.h)}:${two(p.m)}:${two(p.s)} GMT`,
	(p) =>
		`${WEEKDAYS_LONG[p.wd]}, ${two(p.day)} ${MONTHS[p.mon]} ${p.year} ${two(p.h)}:${two(p.m)}:${two(p.s)} GMT`,
	// rfc850-date with a four-digit year or a short weekday; asctime with one space before a
	// one-digit day, or with a zone.
	(p) =>
		`${WEEKDAYS_LONG[p.wd]}, ${two(p.day)}-${MONTHS[p.mon]}-${p.year} ${two(p.h)}:${two(p.m)}:${two(p.s)} GMT`,
	(p) =>
		`${WEEKDAYS[p.wd]}, ${two(p.day)}-${MONTHS[p.mon]}-${two(p.year % 100)} ${two(p.h)}:${two(p.m)}:${two(p.s)} GMT`,
	(p) =>
		`${WEEKDAYS[p.wd]} ${MONTHS[p.mon]} ${p.day % 9 || 1} ${two(p.h)}:${two(p.m)}:${two(p.s)} ${p.year}`,
	(p) =>
		`${WEEKDAYS[p.wd]} ${MONTHS[p.mon]} ${String(p.day).padStart(2, " ")} ${two(p.h)}:${two(p.m)}:${two(p.s)} ${p.year} GMT`,
	// Out of range: day 32, 30 February, hour 24, minute 60, second 61.
	(p) => `${WEEKDAYS[p.wd]}, 32 ${MONTHS[p.mon]} ${p.year} ${two(p.h)}:${two(p.m)}:${two(p.s)} GMT`,
	(p) => `${WEEKDAYS[p.wd]}, 30 Feb ${p.year} ${two(p.h)}:${two(p.m)}:${two(p.s)} GMT`,
	(p) =>
		`${WEEKDAYS[p.wd]}, ${two(p.day)} ${MONTHS[p.mon]} ${p.year} 24:${two(p.m)}:${two(p.s)} GMT`,
	(p) =>
		`${WEEKDAYS[p.wd]}, ${two(p.day)} ${MONTHS[p.mon]} ${p.year} ${two(p.h)}:60:${two(p.s)} GMT`,
	(p) =>
		`${WEEKDAYS[p.wd]}, ${two(p.day)} ${MONTHS[p.mon]} ${p.year} ${two(p.h)}:${two(p.m)}:61 GMT`,
];

const digits = fc.stringMatching(/^[0-9]{1,6}$/);
/**
 * A header value that is neither digits only nor an HTTP-date: decimals, negatives, signs, spaces
 * inside, other spellings of numbers, huge numbers that are not digits only, words, ISO dates, and
 * HTTP-dates bent out of shape. Spaces at either end are not here: a header's value comes trimmed.
 */
const arbJunk: fc.Arbitrary<string> = fc.oneof(
	// Decimals.
	fc.tuple(digits, digits).map(([a, b]) => `${a}.${b}`),
	digits.map((a) => `${a}.`),
	digits.map((a) => `.${a}`),
	// Negatives and signs.
	fc.tuple(fc.constantFrom("-", "+", "--", "+-"), digits).map(([s, a]) => s + a),
	// Spaces and tabs inside.
	fc.tuple(digits, fc.constantFrom(" ", "\t", "  ", " \t "), digits).map(([a, s, b]) => a + s + b),
	// Other spellings of a number, and digits that are not ASCII.
	fc.constantFrom(
		"1e9",
		"1E3",
		"0x10",
		"0b1",
		"0o7",
		"1_000",
		"1,000",
		"Infinity",
		"-Infinity",
		"NaN",
		"٣٠",
		"１２",
		"60s",
		"60 seconds",
		"2027-",
	),
	// Huge numbers, not digits only.
	fc.integer({min: 11, max: 400}).map((n) => `1e${n}`),
	fc.integer({min: 11, max: 400}).map((n) => `${"9".repeat(n)}.5`),
	fc.integer({min: 11, max: 400}).map((n) => `-${"9".repeat(n)}`),
	// Words.
	fc.constantFrom("soon", "never", "now", "later", "tomorrow", "GMT", "Sun", "Nov", "null"),
	fc.stringMatching(/^[A-Za-z][A-Za-z ,:-]{0,15}[A-Za-z]$/),
	// ISO dates, whole and partial.
	fc
		.integer({min: -FORTY_YEARS, max: FORTY_YEARS})
		.chain((s) =>
			fc.constantFrom(
				new Date(T0 + s * 1000).toISOString(),
				new Date(T0 + s * 1000).toISOString().slice(0, 10),
				new Date(T0 + s * 1000).toISOString().slice(0, 19),
				new Date(T0 + s * 1000).toISOString().replace("T", " "),
			),
		),
	// HTTP-dates bent out of shape.
	fc
		.tuple(arbParts, fc.nat({max: BENDS.length - 1}))
		.map(([p, i]) => (BENDS[i] ?? BENDS[0])?.(p) ?? ""),
);

/** A wait as text, for a message. */
const shownWait = (w: number | null) => (w === null ? "none" : `${w} ms`);

/**
 * 28. A `retry-after` or `x-ratelimit-reset` that is neither digits only nor an HTTP-date acts
 *     exactly like no header at all: `limitWait` gives what it gives without it, whatever else the
 *     refusal says, and through the Layer, after a refusal with only that header, the next question
 *     goes out at once.
 */
const junkIsNoHeader: Law = {
	name: "a retry-after or x-ratelimit-reset in any other shape acts exactly like no header",
	run: async (mod) => {
		await fc.assert(
			fc.asyncProperty(
				fc.constantFrom(403, 429),
				fc.constantFrom("retry-after" as const, "x-ratelimit-reset" as const),
				arbJunk,
				arbOthers,
				fc.option(arbJunk, {nil: undefined}),
				arbQ,
				arbQ,
				async (status, slot, junk, others, junkAfter, first, next) => {
					// The refusal without the header, and with it.
					const without: Record<string, string> =
						slot === "retry-after"
							? others
							: {
									...(junkAfter === undefined ? {} : {"retry-after": junkAfter}),
									"x-ratelimit-remaining": "0",
								};
					const withIt = {...without, [slot]: junk};
					const a = mod.limitWait(status, withIt, T0);
					const b = mod.limitWait(status, without, T0);
					ensure(
						a === b,
						`${JSON.stringify(withIt)} waits ${shownWait(a)}, and without ${slot} ${shownWait(b)}`,
					);
					// Through the Layer, with only the bad header: no wait.
					const alone =
						slot === "retry-after"
							? {"retry-after": junk}
							: {"x-ratelimit-remaining": "0", "x-ratelimit-reset": junk};
					const gh = ghPeople();
					await onTestClock(
						mod,
						gh,
						{cacheMs: 0, failMs: 0},
						Effect.gen(function* () {
							gh.state.refusal = {status, headers: alone};
							yield* answerOf(mod, first);
							gh.state.refusal = null;
							yield* TestClock.setTime(T0 + 1);
							const sent = gh.asked.length;
							const got = yield* answerOf(mod, next);
							ensure(
								got.startsWith("keys") && gh.asked.length > sent,
								`1 ms after ${status} ${JSON.stringify(alone)}, ${next.q} ${next.arg} answered ${got}`,
							);
						}),
					);
				},
			),
			{numRuns: 200, seed: 7},
		);
	},
};

/** Seconds as digits only: small, large, with leading zeros, longer than any number, "2027". */
const arbSecsText = fc.oneof(
	fc.nat({max: 7200}).map(String),
	fc.nat().map(String),
	fc.tuple(fc.integer({min: 1, max: 4}), fc.nat({max: 7200})).map(([z, n]) => "0".repeat(z) + n),
	fc.integer({min: 11, max: 400}).map((n) => "9".repeat(n)),
	fc.constantFrom("0", "1", "2027", "3599", "3600", "3601", "9999999999", "99999999999"),
);

/**
 * 29. Digits only wait exactly that many seconds, capped at one hour: a `retry-after` of digits from
 *     now, whatever else the refusal says, and an `x-ratelimit-reset` of digits until that second
 *     since 1970 when `x-ratelimit-remaining` is 0 and no `retry-after` reads. "2027" is 2027 s.
 */
const digitsWait: Law = {
	name: "digits only wait exactly that many seconds, capped at one hour",
	run: async (mod) => {
		await fc.assert(
			fc.property(
				fc.constantFrom(403, 429),
				arbSecsText,
				arbOthers,
				arbSecsText,
				fc.option(arbJunk, {nil: undefined}),
				(status, secs, others, reset, junkAfter) => {
					const after = {...others, "retry-after": secs};
					const a = mod.limitWait(status, after, T0);
					ensure(
						a === waitOfSecs(secs),
						`retry-after ${secs} waits ${shownWait(a)}, want ${waitOfSecs(secs)} ms (${JSON.stringify(after)})`,
					);
					// A reset of `reset` seconds after T0, as seconds since 1970.
					const at = (BigInt(T0 / 1000) + BigInt(reset)).toString();
					const r = {
						...(junkAfter === undefined ? {} : {"retry-after": junkAfter}),
						"x-ratelimit-remaining": "0",
						"x-ratelimit-reset": at,
					};
					const b = mod.limitWait(status, r, T0);
					ensure(
						b === waitOfSecs(reset),
						`${JSON.stringify(r)} waits ${shownWait(b)}, want ${waitOfSecs(reset)} ms`,
					);
				},
			),
			{numRuns: 300, seed: 7},
		);
	},
};

/**
 * 30. A `retry-after` that is an HTTP-date, in each of RFC 9110's three forms, waits until that time,
 *     capped at one hour, whatever else the refusal says. Dates from a second to forty years ahead
 *     (and to 9999 for the forms with four-digit years), in any of `arbZone`'s zones.
 */
const datesWait: Law = {
	name: "an HTTP-date in each of its three forms waits until that time, capped at one hour",
	run: async (mod) => {
		const LAST = Math.floor((Date.UTC(9999, 11, 31, 23, 59, 59) - T0) / 1000);
		await keepingZone(async () => {
			await fc.assert(
				fc.property(
					fc.constantFrom(403, 429),
					arbForm,
					fc.oneof(
						fc.integer({min: 1, max: 7200}),
						fc.integer({min: 1, max: FORTY_YEARS}),
						fc.integer({min: 1, max: LAST}),
					),
					arbOthers,
					arbZone,
					(status, form, ahead, others, zone) => {
						process.env.TZ = zone;
						// A two-digit year is in doubt past fifty years; law 32 reads those.
						const secs = form === "rfc850" ? ((ahead - 1) % FORTY_YEARS) + 1 : ahead;
						const at = T0 + secs * 1000;
						const text = httpDateText(at, form);
						const w = mod.limitWait(status, {...others, "retry-after": text}, T0);
						ensure(
							w === waitUntil(at),
							`in ${zone}, retry-after "${text}" waits ${shownWait(w)}, want ${waitUntil(at)} ms`,
						);
					},
				),
				{numRuns: 300, seed: 7},
			);
		});
	},
};

/**
 * 31. A date in the past, or now, means no wait: an HTTP-date in each form and an
 *     `x-ratelimit-reset` at or before now give 0, and through the Layer the next question goes out
 *     at that same ms. In any of `arbZone`'s zones.
 */
const pastNoWait: Law = {
	name: "a date in the past means no wait",
	run: async (mod) => {
		const FIRST = Math.floor((T0 - Date.UTC(1000, 0, 1)) / 1000);
		await keepingZone(async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.constantFrom(403, 429),
					fc.constantFrom("imf" as const, "rfc850" as const, "asctime" as const, "reset" as const),
					fc.oneof(
						fc.constant(0),
						fc.integer({min: 1, max: 7200}),
						fc.integer({min: 1, max: FORTY_YEARS}),
						fc.integer({min: 1, max: FIRST}),
					),
					arbQ,
					arbQ,
					arbZone,
					async (status, form, back, first, next, zone) => {
						process.env.TZ = zone;
						const at = T0 - (form === "rfc850" ? back % FORTY_YEARS : back) * 1000;
						const headers =
							form === "reset"
								? {
										"x-ratelimit-remaining": "0",
										"x-ratelimit-reset": String(Math.max(at / 1000, 0)),
									}
								: {"retry-after": httpDateText(at, form)};
						const w = mod.limitWait(status, headers, T0);
						ensure(
							w === 0,
							`in ${zone}, ${JSON.stringify(headers)} waits ${shownWait(w)}, want 0 ms`,
						);
						const gh = ghPeople();
						await onTestClock(
							mod,
							gh,
							{cacheMs: 0, failMs: 0},
							Effect.gen(function* () {
								gh.state.refusal = {status, headers};
								yield* answerOf(mod, first);
								gh.state.refusal = null;
								const sent = gh.asked.length;
								const got = yield* answerOf(mod, next);
								ensure(
									got.startsWith("keys") && gh.asked.length > sent,
									`in ${zone}, right after ${status} ${JSON.stringify(headers)}, ${next.q} ${next.arg} answered ${got}`,
								);
							}),
						);
					},
				),
				{numRuns: 120, seed: 7},
			);
		});
	},
};

/**
 * An rfc850-date's two-digit year as RFC 9110 section 5.6.7 reads it: "a timestamp that appears to
 * be more than 50 years in the future" is "the most recent year in the past that had the same last
 * two digits". So the year is the latest one with those digits whose time is at most 50 years after
 * `T0`. Its time as an rfc850-date's text, and its year.
 */
const NOW = new Date(T0);
const THIS_YEAR = NOW.getUTCFullYear();
/** `T0` fifty years on: the line a two-digit year's time may not pass. */
const FIFTY_ON = Date.UTC(
	THIS_YEAR + 50,
	NOW.getUTCMonth(),
	NOW.getUTCDate(),
	NOW.getUTCHours(),
	NOW.getUTCMinutes(),
	NOW.getUTCSeconds(),
);
/** The two digits of the year fifty years on: the one year the line runs through. */
const LINE_YY = (THIS_YEAR + 50) % 100;
const rfc850Of = (yy: number, p: Parts) => {
	let year = THIS_YEAR + 60 - ((THIS_YEAR + 60 - yy) % 100);
	while (Date.UTC(year, p.mon, p.day, p.h, p.m, p.s) > FIFTY_ON) year -= 100;
	const at = Date.UTC(year, p.mon, p.day, p.h, p.m, p.s);
	return {at, year, text: httpDateText(at, "rfc850")};
};
const checkRfc850 = (mod: Mod, yy: number, p: Parts) => {
	const {at, year, text} = rfc850Of(yy, p);
	const w = mod.limitWait(403, {"retry-after": text}, T0);
	ensure(
		w === waitUntil(at),
		`retry-after "${text}" waits ${shownWait(w)}, want ${waitUntil(at)} ms (read as ${year})`,
	);
};

/**
 * 32. An rfc850-date's two-digit year reads by RFC 9110's 50-year rule, for every two digits but
 *     the year the line runs through (law 33): the years next to it and this year drawn more often.
 */
const twoDigitYear: Law = {
	name: "an rfc850-date's two-digit year reads by RFC 9110's 50-year rule",
	run: async (mod) => {
		await fc.assert(
			fc.property(
				fc
					.oneof(
						fc.nat({max: 99}),
						fc.constantFrom(LINE_YY - 1, LINE_YY + 1, THIS_YEAR % 100, (THIS_YEAR - 1) % 100),
					)
					.filter((yy) => yy !== LINE_YY),
				arbParts,
				(yy, p) => checkRfc850(mod, yy, p),
			),
			{numRuns: 300, seed: 7},
		);
	},
};

/**
 * 33. In the year fifty years on, the line runs by the timestamp, not the year. Found as a bug on
 *     366c50b (`httpDate` read the two digits by the year alone, so "Tuesday, 01-Feb-77 00:00:00
 *     GMT", more than 50 years after now (15 Jan 2027), read as 2077 and waited an hour, where
 *     RFC 9110 reads 1977 and no wait); fixed in 687f35d.
 */
const lineYear: Law = {
	name: "in the year fifty years on, a two-digit year past the 50-year line reads as the past",
	run: async (mod) => {
		await fc.assert(
			fc.property(arbParts, (p) => checkRfc850(mod, LINE_YY, p)),
			{numRuns: 300, seed: 7},
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
	refusalsNameNobody,
	provenAsModel,
	limitSilence,
	limitCapped,
	keptExactly,
	waitEndsForAll,
	junkIsNoHeader,
	digitsWait,
	datesWait,
	pastNoWait,
	twoDigitYear,
	lineYear,
];

/**
 * Laws that found a bug in the real code. Each is kept as written and run as a known failure, so the
 * suite stays green and the day the bug is fixed this list turns red: then the law moves to `LAWS`.
 */
const BUGS: readonly (readonly [Law, RegExp])[] = [];

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
			"Duration.millis(Exit.isSuccess(exit) ? ms : failMs),",
			"Exit.isSuccess(exit) ? Duration.infinity : Duration.millis(failMs),",
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
			'Effect.catchTag("KeysUnreachable", (e) => down(e.why)),',
			'Effect.catchTag("KeysUnreachable", () => Effect.succeed(letIn(null))),',
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
			"return failed ?? refuse(401, NOT_PROVEN);",
			'return failed ?? refuse(401, known.length === 0 ? "nobody here goes by that name" : NOT_PROVEN);',
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

	// Round 3.
	// The 502 says who it could not ask about.
	unavailableSaysWho: () =>
		plant(
			"door",
			"Effect.as(refuse(502, UNAVAILABLE)),",
			'Effect.as(refuse(502, UNAVAILABLE + " (" + about + ")")),',
		),
	// The 401 says which ids it asked about.
	notProvenSaysIds: () =>
		plant(
			"door",
			"return failed ?? refuse(401, NOT_PROVEN);",
			'return failed ?? refuse(401, NOT_PROVEN + ": asked " + ids.join(", "));',
		),
	// The first question that fails ends the login: the others are not asked.
	failStopsOthers: () => plant("door", "failed = asked;\n\t\t\t\tcontinue;", "return asked;"),
	// A failed question with no proof reads as not proven.
	failIsNotProven: () =>
		plant("door", "return failed ?? refuse(401, NOT_PROVEN);", "return refuse(401, NOT_PROVEN);"),
	// Only the first person known by the name is asked about.
	firstIdOnly: () =>
		plant(
			"door",
			"for (const id of new Set(ids)) {",
			"for (const id of new Set(ids.slice(0, 1))) {",
		),
	// A spent limit starts no wait.
	limitIgnored: () =>
		plant(
			"keys-github",
			"if (wait !== null) yield* Ref.update(waitUntil, (u) => Math.max(u, now + wait));",
			"",
		),
	// The wait holds back questions by id only: a question by name still goes out.
	limitByIdOnly: () =>
		plant(
			"keys-github",
			"if ((yield* Clock.currentTimeMillis) < until)",
			'if (path.startsWith("/user/") && (yield* Clock.currentTimeMillis) < until)',
		),
	// The wait is as long as the headers say, with no cap.
	limitUncapped: () =>
		plant("keys-github", "Math.min(Math.max(at - now, 0), LIMIT_WAIT_MS)", "Math.max(at - now, 0)"),
	// A failure is kept as long as an answer.
	failKeptAsAnswer: () =>
		plant(
			"keys-github",
			"Duration.millis(Exit.isSuccess(exit) ? ms : failMs),",
			"Duration.millis(ms),",
		),
	// Everything is kept one ms too long.
	keptOneMsLong: () =>
		plant(
			"keys-github",
			"Duration.millis(Exit.isSuccess(exit) ? ms : failMs),",
			"Duration.millis((Exit.isSuccess(exit) ? ms : failMs) + 1),",
		),
	// `failMs: 0` reads as the default: a failure is kept 30 seconds.
	failZeroKept: () =>
		plant(
			"keys-github",
			"Math.max(o.failMs ?? KEYS_FAIL_MS, 0)",
			"Math.max(o.failMs || KEYS_FAIL_MS, 0)",
		),

	// Round 4.
	// The wait's own refusal is kept `failMs`, like GitHub's: the bug 366c50b fixed.
	waitKeptFailMs: () =>
		plant(
			"keys-github",
			'Option.exists(Exit.findErrorOption(exit), (e) => e._tag === "Spent")',
			"false",
		),
	// `retry-after` is read by `Date.parse`, as before 366c50b: "1.5" or "-5" reads as a date.
	looseDate: () =>
		plant(
			"keys-github",
			"(httpDate(after, now) ??",
			'((after !== "" && !Number.isNaN(Date.parse(after)) ? Date.parse(after) : null) ??',
		),
	// `x-ratelimit-reset` is read as any number: "1.5", "-5" or "1e9".
	looseReset: () =>
		plant("keys-github", "/^[0-9]+$/.test(reset)", 'reset !== "" && !Number.isNaN(Number(reset))'),
	// Spaces inside `retry-after` are dropped: "1 0" reads as 10 seconds.
	spacesDropped: () =>
		plant(
			"keys-github",
			'const after = headers["retry-after"]?.trim() ?? "";',
			'const after = (headers["retry-after"]?.trim() ?? "").replace(/^([0-9]+)\\s+([0-9]+)$/, "$1$2");',
		),
	// Delay-seconds of more than ten digits are no number, as before 366c50b.
	tenDigitsOnly: () =>
		plant("keys-github", "/^[0-9]+$/.test(after)", "/^[0-9]{1,10}$/.test(after)"),
	// Delay-seconds read as ms.
	secondsAsMs: () => plant("keys-github", "now + Number(after) * 1000", "now + Number(after)"),
	// A two-digit year is 19xx.
	centuryYear: () =>
		plant(
			"keys-github",
			"const next = thisYear + ((((Number(yy) - thisYear) % 100) + 100) % 100);",
			"const next = 1900 + Number(yy);",
		),
	// The line drawn at sixty years, not fifty.
	sixtyYears: () =>
		plant(
			"keys-github",
			"line.setUTCFullYear(thisYear + 50);",
			"line.setUTCFullYear(thisYear + 60);",
		),
	// An asctime date, which names no zone, is read in the machine's zone, as `Date.parse` reads it.
	asctimeLocal: () =>
		plant(
			"keys-github",
			"return utc(Number(y), mon, Number(d.trim()), Number(h), Number(m), Number(sec));",
			'return new Date(mon + " " + d.trim() + ", " + y + " " + h + ":" + m + ":" + sec).getTime();',
		),
	// asctime dates are not read.
	noAsctime: () =>
		plant("keys-github", "const asc = ASCTIME.exec(s);", 'const asc = ASCTIME.exec("");'),
	// A date in the past waits as long as it is ago.
	pastWaits: () =>
		plant(
			"keys-github",
			"Math.min(Math.max(at - now, 0), LIMIT_WAIT_MS)",
			"Math.min(Math.abs(at - now), LIMIT_WAIT_MS)",
		),
};

describe("the door's laws", () => {
	it.each(LAWS.map((law) => [law.name, law] as const))("%s", async (_, law) => {
		await law.run(real);
	});

	it.each(BUGS.map(([law, how]) => [law.name, law, how] as const))(
		"known bug: %s",
		async (_, law, how) => {
			// fast-check keeps the law's own error as the cause of its own.
			const e = await law.run(real).then(
				() => null,
				(x: unknown) => x,
			);
			expect(e).toBeInstanceOf(Error);
			expect(String((e as Error).cause ?? e)).toMatch(how);
		},
	);

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
			bindsToLogin: [
				bindToId.name,
				onlyInviteAsksByName.name,
				otherIdIs502.name,
				provenAsModel.name,
			],
			removesLast: [removeEndsSessions.name],
			closedIs401: [noCredential.name],
			noCredIs403: [noCredential.name],
			pinsFirstKey: [listedKeys.name],
			cacheNeverExpires: [githubCache.name, keptExactly.name],
			grantAnyObject: [grantOneObject.name],
			noOldAgent: [writerReads.name],
			emptyPersonReads: [writerReads.name],
			agentAnswers: [personKinds.name],
			anyIdTaken: [idChecked.name],
			unreachableIsNobody: [keysUnreachable.name, provenAsModel.name],
			asksEveryone: [strangersAskNothing.name],
			saysNobody: [oneRefusal.name],
			refreshesByName: [onlyInviteAsksByName.name],
			asksFounderAlways: [byIdOnlyKnown.name],
			goesByNewName: [renameKeepsResult.name, provenAsModel.name],
			takesOtherId: [otherIdIs502.name, provenAsModel.name],
			noRetry: [tokenRetry.name],
			retriesWithoutToken: [tokenRetry.name],
			unavailableSaysWho: [
				idChecked.name,
				keysUnreachable.name,
				otherIdIs502.name,
				refusalsNameNobody.name,
				provenAsModel.name,
			],
			notProvenSaysIds: [oneRefusal.name, refusalsNameNobody.name, provenAsModel.name],
			failStopsOthers: [provenAsModel.name],
			failIsNotProven: [keysUnreachable.name, otherIdIs502.name, provenAsModel.name],
			firstIdOnly: [provenAsModel.name],
			limitIgnored: [limitSilence.name, waitEndsForAll.name],
			limitByIdOnly: [limitSilence.name, waitEndsForAll.name],
			limitUncapped: [
				limitCapped.name,
				digitsWait.name,
				datesWait.name,
				twoDigitYear.name,
				lineYear.name,
			],
			failKeptAsAnswer: [keptExactly.name],
			keptOneMsLong: [githubCache.name, keptExactly.name],
			failZeroKept: [limitSilence.name, keptExactly.name, junkIsNoHeader.name, pastNoWait.name],
			waitKeptFailMs: [waitEndsForAll.name],
			looseDate: [
				junkIsNoHeader.name,
				digitsWait.name,
				datesWait.name,
				pastNoWait.name,
				twoDigitYear.name,
				lineYear.name,
			],
			looseReset: [junkIsNoHeader.name],
			spacesDropped: [junkIsNoHeader.name, digitsWait.name],
			tenDigitsOnly: [digitsWait.name],
			secondsAsMs: [limitSilence.name, waitEndsForAll.name, digitsWait.name],
			centuryYear: [datesWait.name, twoDigitYear.name, lineYear.name],
			sixtyYears: [twoDigitYear.name, lineYear.name],
			asctimeLocal: [datesWait.name, pastNoWait.name],
			noAsctime: [datesWait.name, pastNoWait.name],
			pastWaits: [pastNoWait.name, twoDigitYear.name, lineYear.name],
		});
		// Every law is caught by at least one plant.
		const all = new Set(Object.values(caught).flat());
		expect(LAWS.filter((law) => !all.has(law.name)).map((law) => law.name)).toEqual([]);
	}, 240_000);
});
