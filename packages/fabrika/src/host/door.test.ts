import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterAll, beforeEach, describe, expect, it} from "vitest";
import {
	CHALLENGE_MS,
	challengeText,
	configOf,
	Door,
	type DoorConfig,
	type GitHub,
	grantText,
	hashOf,
	holderOf,
	hostOf,
	KEYS_CACHE_MS,
	MEMBERS,
	NAMESPACE,
	SESSION_MS,
	type Stamp,
	trustedArgs,
} from "./door.ts";
import * as rules from "./rules.ts";
import {readStream} from "./rules.ts";
import {openDb} from "./sqlite-driver.ts";
import {keyLineOf, sign} from "./sshsig.ts";

// The door on node:sqlite, the same file workerd runs: a fake GitHub, keys made here, a clock the
// test turns. Nothing leaves this process.

const ADDRESS = "https://ledger.test/demo";
const dir = mkdtempSync(join(tmpdir(), "door-"));
afterAll(() => rmSync(dir, {recursive: true, force: true}));

type Key = {readonly line: string; readonly sign: (text: string) => Promise<string>};
const newKey = async (namespace = NAMESPACE): Promise<Key> => {
	const pair = (await crypto.subtle.generateKey({name: "Ed25519"}, true, [
		"sign",
		"verify",
	])) as CryptoKeyPair;
	const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
	return {line: keyLineOf(raw), sign: (text) => sign(text, namespace, pair.privateKey, raw)};
};

/** GitHub as far as the door asks: logins, their numeric ids, and the keys each one lists. */
const fakeGitHub = () => {
	const users = new Map<string, {id: number; keys: string[]}>();
	const github: GitHub = {
		user: async (login) => {
			const u = users.get(login);
			return u === undefined ? null : {id: u.id, login};
		},
		keys: async (login) => users.get(login)?.keys ?? [],
	};
	return {users, github};
};

let n = 0;
const setup = (config: DoorConfig) => {
	const {db} = openDb(join(dir, `door-${n++}.sqlite`));
	rules.migrate(db);
	const clock = {t: 1_000_000};
	const gh = fakeGitHub();
	const door = new Door(db, config, gh.github, {now: () => clock.t});
	return {db, door, clock, ...gh};
};

/** A GitHub door; its keys asked of GitHub on every login unless `keysCacheMs` says otherwise. */
const github = (founder: number, o: {keysCacheMs?: number} = {}): DoorConfig => ({
	kind: "github",
	founder,
	origin: null,
	sessionMs: SESSION_MS,
	keysCacheMs: o.keysCacheMs ?? 0,
});

/** A person's login on `door`: its challenge, signed with `key`. */
const loginWith = async (door: Door, login: string, key: Key) => {
	const c = door.challenge(ADDRESS);
	if (!c.ok) throw new Error(c.why);
	return door.login({login, challenge: c.value.text, signature: await key.sign(c.value.text)});
};

describe("what a request may say", () => {
	const person: Stamp = {kind: "user", id: "github:7"};
	const agent: Stamp = {kind: "agent", id: "triage", for: "github:7"};

	it("never says its writer: an append that names one is refused", () => {
		const r = trustedArgs(
			"append",
			["t/1", "any", {kind: "note", writer: "user:github:7", data: {}}, null],
			agent,
		);
		expect(r).toMatchObject({ok: false, status: 400});
	});

	it("gets the door's stamp as its writer, a person's or an agent's", () => {
		const event = {kind: "note", data: {x: 1}};
		expect(trustedArgs("append", ["t/1", "any", event, null], agent)).toEqual({
			ok: true,
			value: [
				"t/1",
				"any",
				{kind: "note", data: {x: 1}, id: null, writer: "agent:triage for:github:7"},
				null,
			],
		});
		expect(trustedArgs("register", ["t"], person)).toEqual({
			ok: true,
			value: ["t", "user:github:7"],
		});
	});

	it("refuses an old client that still sends a writer, by its count of arguments", () => {
		expect(trustedArgs("register", ["t", "user:owner"], agent)).toMatchObject({status: 400});
		expect(trustedArgs("cancel", ["t", "user:owner"], person)).toMatchObject({status: 400});
	});

	it.each([
		["cancel", ["t"]],
		["setLimits", ["t", {usd: 1}]],
	])("lets only a person %s", (method, args) => {
		expect(trustedArgs(method, args, agent)).toMatchObject({ok: false, status: 403});
		expect(trustedArgs(method, args, person)).toMatchObject({ok: true});
	});

	it("lets only a person send a dead letter back", () => {
		const event = {kind: "note", data: {}, id: "redrive:t/dead:3"};
		expect(trustedArgs("append", ["t", "any", event, null], agent)).toMatchObject({status: 403});
		expect(trustedArgs("append", ["t", "any", event, null], person)).toMatchObject({ok: true});
	});

	it("never writes under the door's own name, and still reads it", () => {
		expect(
			trustedArgs("append", [MEMBERS, "any", {kind: "joined", data: {id: 9}}, null], person),
		).toMatchObject({status: 403});
		expect(trustedArgs("register", ["door/x"], person)).toMatchObject({status: 403});
		expect(trustedArgs("read", [0, 10, MEMBERS], agent)).toMatchObject({ok: true});
	});

	it("makes a claim's holder from the host's tag and the stamp", () => {
		expect(trustedArgs("claim", ["t", "host-a@1", 0, 1000], agent)).toEqual({
			ok: true,
			value: ["t", "host-a@1@agent:triage for:github:7", 0, 1000],
		});
		expect(trustedArgs("claim", ["t", "host a", 0, 1000], agent)).toMatchObject({status: 400});
	});

	it.each(["constructor", "__proto__", "toString", "fetch", "doorStep", "alarm"])(
		"knows no method %s",
		(method) => {
			expect(trustedArgs(method, [], person)).toMatchObject({ok: false, status: 404});
		},
	);
});

describe("a holder", () => {
	it("gives back the host's tag it was made from", () => {
		const s: Stamp = {kind: "agent", id: "triage", for: "github:7"};
		expect(hostOf(holderOf("L12", s))).toBe("L12");
		expect(hostOf(holderOf("host-a@17", {kind: "user", id: "owner"}))).toBe("host-a@17");
		// Written past no door: as it was.
		expect(hostOf("L12")).toBe("L12");
		expect(hostOf("host-a@17")).toBe("host-a@17");
	});
});

describe("the door's config", () => {
	it.each([
		["nothing", {}],
		["a door it does not know", {DOOR: "open"}],
		["a local door with no hash", {DOOR: "local", LOCAL_PERSON: "owner"}],
		[
			"a local person with an @",
			{DOOR: "local", LOCAL_PERSON: "a@b", LOCAL_SECRET_HASH: "0".repeat(64)},
		],
		["a GitHub door with no founder", {DOOR: "github"}],
		["a founder that is no id", {DOOR: "github", FOUNDER: "alice"}],
		["a session length that is no number", {DOOR: "github", FOUNDER: "7", SESSION_MS: "4h"}],
		["a session under a minute", {DOOR: "github", FOUNDER: "7", SESSION_MS: "1000"}],
		["a cache time that is no number", {DOOR: "github", FOUNDER: "7", KEYS_CACHE_MS: "-1"}],
		// An origin is the server's, never one object's address: no path after it.
		["an origin with a path", {DOOR: "github", FOUNDER: "7", ORIGIN: "https://ledger.test/demo"}],
	])("is closed for %s", (_, env) => {
		expect(configOf(env)).toEqual({kind: "closed"});
	});

	it("keeps sessions short and GitHub's keys briefly, unless told otherwise", () => {
		expect(configOf({DOOR: "github", FOUNDER: "7"})).toEqual({
			kind: "github",
			founder: 7,
			origin: null,
			sessionMs: 4 * 3_600_000,
			keysCacheMs: 5 * 60_000,
		});
		expect(configOf({DOOR: "github", FOUNDER: "7", ORIGIN: "https://ledger.test"})).toMatchObject({
			origin: "https://ledger.test",
		});
		expect(
			configOf({DOOR: "github", FOUNDER: "7", SESSION_MS: "3600000", KEYS_CACHE_MS: "0"}),
		).toMatchObject({sessionMs: 3_600_000, keysCacheMs: 0});
	});

	it("is closed to every credential when closed", async () => {
		const {door} = setup({kind: "closed"});
		expect(await door.who("anything")).toMatchObject({ok: false, status: 403});
		expect(await door.who(null)).toMatchObject({ok: false, status: 403});
	});
});

describe("a local door", () => {
	const SECRET = "fabrika_l_secret";
	let t: ReturnType<typeof setup>;
	beforeEach(async () => {
		t = setup({kind: "local", person: "owner", secretHash: await hashOf(SECRET)});
	});

	it("knows its one person by the secret, and nobody without it", async () => {
		expect(await t.door.who(SECRET)).toEqual({ok: true, value: {kind: "user", id: "owner"}});
		expect(await t.door.who(null)).toMatchObject({ok: false, status: 401});
		expect(await t.door.who("")).toMatchObject({ok: false, status: 401});
		expect(await t.door.who("fabrika_l_guess")).toMatchObject({ok: false, status: 401});
	});

	it("gives its person agent tokens, which are agents for that person and never the person", async () => {
		const a = await t.door.addAgent({kind: "user", id: "owner"}, "triage");
		if (!a.ok) throw new Error(a.why);
		expect(a.value.token.startsWith("fabrika_a_")).toBe(true);
		expect(await t.door.who(a.value.token)).toEqual({
			ok: true,
			value: {kind: "agent", id: "triage", for: "owner"},
		});
		// An agent mints no agent.
		const b = await t.door.addAgent({kind: "agent", id: "triage", for: "owner"}, "other");
		expect(b).toMatchObject({ok: false, status: 403});
	});

	it("keeps a token's hash, never the token", async () => {
		const a = await t.door.addAgent({kind: "user", id: "owner"}, "triage");
		if (!a.ok) throw new Error(a.why);
		const rows = t.db.all("SELECT * FROM door_sessions");
		expect(JSON.stringify(rows)).not.toContain(a.value.token);
		expect(rows[0]?.hash).toBe(await hashOf(a.value.token));
	});

	it("takes no GitHub login", async () => {
		expect(t.door.challenge(ADDRESS)).toMatchObject({ok: false, status: 404});
	});
});

describe("a GitHub door", () => {
	let t: ReturnType<typeof setup>;
	let alice: Key;
	let bob: Key;
	beforeEach(async () => {
		t = setup(github(7));
		alice = await newKey();
		bob = await newKey();
		t.users.set("alice", {id: 7, keys: [alice.line]});
		t.users.set("bob", {id: 8, keys: [bob.line]});
	});

	it("lets its founder in first, by the id in its config, as a person", async () => {
		const s = await loginWith(t.door, "alice", alice);
		if (!s.ok) throw new Error(s.why);
		expect(s.value.who).toEqual({kind: "user", id: "github:7"});
		expect(await t.door.who(s.value.token)).toEqual({ok: true, value: s.value.who});
		expect([...t.door.members().members]).toEqual([[7, "alice"]]);
	});

	it("does not take the first person who comes as its founder", async () => {
		expect(await loginWith(t.door, "bob", bob)).toMatchObject({ok: false, status: 403});
		expect(t.door.members().founded).toBe(false);
	});

	it("refuses a signature by a key GitHub does not list for the login", async () => {
		expect(await loginWith(t.door, "alice", bob)).toMatchObject({ok: false, status: 401});
	});

	it("refuses a signature under another namespace", async () => {
		const git = await newKey("git");
		t.users.set("alice", {id: 7, keys: [git.line]});
		expect(await loginWith(t.door, "alice", git)).toMatchObject({ok: false, status: 401});
	});

	it("takes each challenge once", async () => {
		const c = t.door.challenge(ADDRESS);
		if (!c.ok) throw new Error(c.why);
		const signature = await alice.sign(c.value.text);
		expect(await t.door.login({login: "alice", challenge: c.value.text, signature})).toMatchObject({
			ok: true,
		});
		expect(await t.door.login({login: "alice", challenge: c.value.text, signature})).toMatchObject({
			ok: false,
			status: 401,
		});
	});

	it("refuses a challenge it did not give out, or one that has ended", async () => {
		const made = challengeText({address: ADDRESS, nonce: "mine", expires: t.clock.t + 1000});
		expect(
			await t.door.login({login: "alice", challenge: made, signature: await alice.sign(made)}),
		).toMatchObject({ok: false, status: 401});

		const c = t.door.challenge(ADDRESS);
		if (!c.ok) throw new Error(c.why);
		t.clock.t += CHALLENGE_MS;
		const signature = await alice.sign(c.value.text);
		expect(await t.door.login({login: "alice", challenge: c.value.text, signature})).toMatchObject({
			ok: false,
			status: 401,
			why: "the challenge has ended",
		});
	});

	it("refuses a challenge whose text was changed after it was given", async () => {
		const c = t.door.challenge(ADDRESS);
		if (!c.ok) throw new Error(c.why);
		const other = c.value.text.replace(ADDRESS, "https://elsewhere.test/demo");
		expect(
			await t.door.login({login: "alice", challenge: other, signature: await alice.sign(other)}),
		).toMatchObject({ok: false, status: 401});
	});

	it("lets in a person a member invited, by GitHub's id, not by the login", async () => {
		const a = await loginWith(t.door, "alice", alice);
		if (!a.ok) throw new Error(a.why);
		expect(await t.door.invite(a.value.who, "bob")).toEqual({
			ok: true,
			value: {id: 8, login: "bob"},
		});
		// bob gives his login away; someone else takes it, with their own key.
		const taker = await newKey();
		t.users.delete("bob");
		t.users.set("bob", {id: 99, keys: [taker.line]});
		t.users.set("robert", {id: 8, keys: [bob.line]});
		expect(await loginWith(t.door, "bob", taker)).toMatchObject({ok: false, status: 403});
		const b = await loginWith(t.door, "robert", bob);
		expect(b).toMatchObject({ok: true, value: {who: {kind: "user", id: "github:8"}}});
	});

	it("lets only a person invite or remove", async () => {
		const agent: Stamp = {kind: "agent", id: "triage", for: "github:7"};
		expect(await t.door.invite(agent, "bob")).toMatchObject({ok: false, status: 403});
		expect(t.door.remove(agent, "github:8")).toMatchObject({ok: false, status: 403});
	});

	it("ends a removed member's sessions, and keeps its last member", async () => {
		const a = await loginWith(t.door, "alice", alice);
		if (!a.ok) throw new Error(a.why);
		await t.door.invite(a.value.who, "bob");
		const b = await loginWith(t.door, "bob", bob);
		if (!b.ok) throw new Error(b.why);
		expect(t.door.remove(a.value.who, "github:8")).toEqual({ok: true, value: {id: "github:8"}});
		expect(await t.door.who(b.value.token)).toMatchObject({ok: false, status: 401});
		expect(await loginWith(t.door, "bob", bob)).toMatchObject({ok: false, status: 403});
		expect(t.door.remove(a.value.who, "github:7")).toMatchObject({ok: false, status: 403});
		const kinds = readStream(t.db, MEMBERS).map((r) => r.kind);
		expect(kinds).toEqual(["founded", "invited", "joined", "removed"]);
	});

	it("ends a person's session after its length: a key GitHub no longer lists opens no new one", async () => {
		const a = await loginWith(t.door, "alice", alice);
		if (!a.ok) throw new Error(a.why);
		t.users.set("alice", {id: 7, keys: []});
		t.clock.t += SESSION_MS;
		expect(await t.door.who(a.value.token)).toMatchObject({ok: false, status: 401});
		expect(await loginWith(t.door, "alice", alice)).toMatchObject({ok: false, status: 401});
	});

	it("lets in any key GitHub lists for the login, read again on each login", async () => {
		const laptop = await newKey();
		t.users.set("alice", {id: 7, keys: [alice.line, laptop.line]});
		expect(await loginWith(t.door, "alice", laptop)).toMatchObject({ok: true});
		expect(await loginWith(t.door, "alice", alice)).toMatchObject({ok: true});
		t.users.set("alice", {id: 7, keys: [alice.line]});
		expect(await loginWith(t.door, "alice", laptop)).toMatchObject({ok: false, status: 401});
	});

	it("asks GitHub once per login in its cache time, and again after", async () => {
		const c = setup(github(7, {keysCacheMs: KEYS_CACHE_MS}));
		c.users.set("alice", {id: 7, keys: [alice.line]});
		let asked = 0;
		const keys = c.github.keys;
		c.github.keys = (login) => {
			asked++;
			return keys(login);
		};
		expect(await loginWith(c.door, "alice", alice)).toMatchObject({ok: true});
		c.users.set("alice", {id: 7, keys: []});
		// Taken off on GitHub, still in the door's copy: one more login, then no more.
		expect(await loginWith(c.door, "alice", alice)).toMatchObject({ok: true});
		expect(asked).toBe(1);
		c.clock.t += KEYS_CACHE_MS;
		expect(await loginWith(c.door, "alice", alice)).toMatchObject({ok: false, status: 401});
		expect(asked).toBe(2);
	});

	it("writes its members' facts with the person who did each as the writer", async () => {
		const a = await loginWith(t.door, "alice", alice);
		if (!a.ok) throw new Error(a.why);
		await t.door.invite(a.value.who, "bob");
		expect(readStream(t.db, MEMBERS).map((r) => r.writer)).toEqual([
			"user:github:7",
			"user:github:7",
		]);
	});

	describe("an agent", () => {
		let triage: Key;
		const grantFor = (o: Partial<{address: string; expires: number; key: string; login: string}>) =>
			grantText({
				address: o.address ?? ADDRESS,
				agent: "triage",
				key: o.key ?? triage.line,
				for: o.login ?? "alice",
				expires: o.expires ?? t.clock.t + 60_000,
			});
		const agentLogin = async (o: {grant: string; by: Key; signer?: Key}) => {
			const c = t.door.challenge(ADDRESS);
			if (!c.ok) throw new Error(c.why);
			return t.door.agentLogin(ADDRESS, {
				grant: o.grant,
				granted: await o.by.sign(o.grant),
				challenge: c.value.text,
				signature: await (o.signer ?? triage).sign(c.value.text),
			});
		};
		beforeEach(async () => {
			triage = await newKey();
			const a = await loginWith(t.door, "alice", alice);
			if (!a.ok) throw new Error(a.why);
		});

		it("comes in on its person's grant as an agent for that person, never as a person", async () => {
			const s = await agentLogin({grant: grantFor({}), by: alice});
			if (!s.ok) throw new Error(s.why);
			expect(s.value.who).toEqual({kind: "agent", id: "triage", for: "github:7"});
			expect(await t.door.who(s.value.token)).toEqual({ok: true, value: s.value.who});
			expect(t.db.all("SELECT kind, agent FROM door_sessions WHERE kind = 'agent'")).toEqual([
				{kind: "agent", agent: "triage"},
			]);
		});

		it("never outlives the session of the person who signed its grant", async () => {
			const personUntil = t.clock.t + SESSION_MS;
			t.clock.t += 1000;
			const long = grantFor({expires: t.clock.t + 7 * 24 * 3_600_000});
			const s = await agentLogin({grant: long, by: alice});
			if (!s.ok) throw new Error(s.why);
			expect(s.value.expires).toBe(personUntil);
			t.clock.t = personUntil;
			expect(await t.door.who(s.value.token)).toMatchObject({ok: false, status: 401});
			// Its person's sessions have all ended: no new agent session until they log in again.
			expect(await agentLogin({grant: long, by: alice})).toMatchObject({ok: false, status: 403});
			expect(await loginWith(t.door, "alice", alice)).toMatchObject({ok: true});
			expect(await agentLogin({grant: long, by: alice})).toMatchObject({ok: true});
		});

		it("cannot be stored as a person's session", () => {
			expect(() =>
				t.db.all(
					"INSERT INTO door_sessions (hash, kind, person, agent, expires_at) VALUES ('h', 'person', 'github:7', 'triage', 1)",
				),
			).toThrow();
		});

		it("is refused on a grant it signed itself", async () => {
			expect(await agentLogin({grant: grantFor({}), by: triage})).toMatchObject({
				ok: false,
				status: 401,
			});
		});

		it("is refused on a grant for another ledger, or one that has ended", async () => {
			const away = grantFor({address: "https://elsewhere.test/demo"});
			expect(await agentLogin({grant: away, by: alice})).toMatchObject({ok: false, status: 401});
			const ended = grantFor({expires: t.clock.t});
			expect(await agentLogin({grant: ended, by: alice})).toMatchObject({ok: false, status: 401});
		});

		it("is refused when the challenge is signed by a key the grant does not name", async () => {
			const other = await newKey();
			expect(await agentLogin({grant: grantFor({}), by: alice, signer: other})).toMatchObject({
				ok: false,
				status: 401,
			});
		});

		it("is refused on a grant from someone who is not a member", async () => {
			expect(await agentLogin({grant: grantFor({login: "bob"}), by: bob})).toMatchObject({
				ok: false,
				status: 403,
			});
		});

		it("loses its session when its person is removed, and ends with its grant", async () => {
			await t.door.invite({kind: "user", id: "github:7"}, "bob");
			const bobIn = await loginWith(t.door, "bob", bob);
			if (!bobIn.ok) throw new Error(bobIn.why);
			const s = await agentLogin({grant: grantFor({login: "bob"}), by: bob});
			if (!s.ok) throw new Error(s.why);
			t.door.remove({kind: "user", id: "github:7"}, "github:8");
			expect(await t.door.who(s.value.token)).toMatchObject({ok: false});

			const short = await agentLogin({grant: grantFor({expires: t.clock.t + 1000}), by: alice});
			if (!short.ok) throw new Error(short.why);
			t.clock.t += 1000;
			expect(await t.door.who(short.value.token)).toMatchObject({ok: false, status: 401});
		});
	});
});
