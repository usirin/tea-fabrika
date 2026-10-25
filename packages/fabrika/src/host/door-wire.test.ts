import {Effect, Exit, Redacted} from "effect";
import {Miniflare} from "miniflare";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {type DoorRefused, doorOf, layerHttp} from "./http.ts";
import {Ledger, streams} from "./ledger.ts";
import {grant, layerSignerKey} from "./signer.ts";
import {keyLineOf} from "./sshsig.ts";
import {ledgerOptions} from "./worker-options.ts";

// The door in workerd, under Miniflare, over HTTP as a host reaches it. GitHub is a fake: the
// Worker's own calls to api.github.com come here (`outboundService`). Keys are made in the test.

const pairOf = async () =>
	(await crypto.subtle.generateKey({name: "Ed25519"}, true, ["sign", "verify"])) as CryptoKeyPair;
const lineOf = async (p: CryptoKeyPair) =>
	keyLineOf(new Uint8Array(await crypto.subtle.exportKey("raw", p.publicKey)));

const users = new Map<string, {id: number; keys: string[]}>();
const fakeGitHub = async (req: Request): Promise<Response> => {
	const url = new URL(req.url);
	if (url.host !== "api.github.com") return new Response("not here", {status: 502});
	const m = /^\/users\/([^/]+)(\/keys)?$/.exec(url.pathname);
	const u = m?.[1] === undefined ? undefined : users.get(decodeURIComponent(m[1]));
	if (u === undefined) return Response.json({message: "Not Found"}, {status: 404});
	return m?.[2] === undefined
		? Response.json({id: u.id, login: m?.[1]})
		: Response.json(u.keys.map((key, i) => ({id: i + 1, key})));
};

const LEDGER = "demo";
let mf: Miniflare;
let url = "";
let alice: CryptoKeyPair;
let bob: CryptoKeyPair;
let triage: CryptoKeyPair;
beforeAll(async () => {
	[alice, bob, triage] = await Promise.all([pairOf(), pairOf(), pairOf()]);
	users.set("alice", {id: 7, keys: [await lineOf(alice)]});
	users.set("bob", {id: 8, keys: [await lineOf(bob)]});
	mf = new Miniflare(
		ledgerOptions({
			persist: false,
			direct: 0,
			door: {kind: "github", founder: 7, github: fakeGitHub},
		}),
	);
	await mf.ready;
	url = (await mf.unsafeGetDirectURL()).origin;
});
afterAll(async () => {
	await mf.dispose();
});

const door = () => doorOf({url, ledger: LEDGER});
const run = <A, E>(e: Effect.Effect<A, E>) => Effect.runPromise(e);
const asLedger = <A, E>(token: Redacted.Redacted<string>, e: Effect.Effect<A, E, Ledger>) =>
	Effect.runPromiseExit(
		e.pipe(Effect.provide(layerHttp({url, ledger: LEDGER, token})), Effect.scoped),
	);
const post = (path: string, body: unknown, token?: string) =>
	fetch(`${url}/${LEDGER}/${path}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...(token === undefined ? {} : {authorization: `Bearer ${token}`}),
		},
		body: JSON.stringify(body),
	});

/** Does the tail's WebSocket open with these subprotocols. Node's own WebSocket. */
const tailOpens = (protocols: string[]) =>
	new Promise<boolean>((resolve) => {
		const ws = new WebSocket(`${url.replace(/^http/, "ws")}/${LEDGER}/tail?stream=t`, protocols);
		ws.onopen = () => {
			ws.close();
			resolve(true);
		};
		ws.onerror = () => resolve(false);
	});

/** The status a door step was refused with; 200 when it was not. */
const statusOf = <A>(e: Effect.Effect<A, DoorRefused>) =>
	Effect.runPromise(
		e.pipe(
			Effect.as(200),
			Effect.catch((x) => Effect.succeed(x.status)),
		),
	);

let person = "";
let agent = "";

describe("the door in workerd", () => {
	it("checks an Ed25519 SSH signature there, and lets the founder in", async () => {
		const s = await run(
			door()
				.login("alice")
				.pipe(Effect.provide(layerSignerKey(alice))),
		);
		expect(s.who).toEqual({kind: "user", id: "github:7"});
		person = Redacted.value(s.token);
		expect(person.startsWith("fabrika_p_")).toBe(true);
	});

	it("reads and writes nothing without a credential", async () => {
		const read = await post("read", [0, 10, null]);
		expect(read.status).toBe(401);
		const write = await post("register", ["t"]);
		expect(write.status).toBe(401);
		expect(await tailOpens(["fabrika"])).toBe(false);
		expect(await tailOpens(["fabrika", "bearer.fabrika_p_guess"])).toBe(false);
		expect(await tailOpens(["fabrika", `bearer.${person}`])).toBe(true);
		const bad = await post("read", [0, 10, null], "fabrika_p_guess");
		expect(bad.status).toBe(401);
	});

	it("writes the writer from the credential, never from the request", async () => {
		const forged = await post(
			"append",
			["t/inbox", "any", {kind: "note", writer: "user:github:1", data: {}}, null],
			person,
		);
		expect(forged.status).toBe(400);
		const old = await post("register", ["t", "user:github:1"], person);
		expect(old.status).toBe(400);

		const exit = await asLedger(
			Redacted.make(person),
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				yield* ledger.register("t", "user:github:1");
				yield* ledger.append("t/inbox", "any", {kind: "note", writer: "user:github:1", data: {}});
				return yield* ledger.readStream("t/inbox");
			}),
		);
		if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
		expect(exit.value.map((r) => r.writer)).toEqual(["user:github:7"]);
	});

	it("lets an agent in on its person's grant, as an agent for that person", async () => {
		const address = `${url}/${LEDGER}`;
		const g = await run(
			grant({
				address,
				agent: "triage",
				key: await lineOf(triage),
				for: "alice",
				expires: Date.now() + 60_000,
			}).pipe(Effect.provide(layerSignerKey(alice))),
		);
		const s = await run(
			door()
				.agentLogin(g)
				.pipe(Effect.provide(layerSignerKey(triage))),
		);
		expect(s.who).toEqual({kind: "agent", id: "triage", for: "github:7"});
		agent = Redacted.value(s.token);

		const exit = await asLedger(
			s.token,
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				yield* ledger.append("t/inbox", "any", {kind: "note", writer: "user:github:7", data: {}});
				return yield* ledger.readStream("t/inbox");
			}),
		);
		if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
		expect(exit.value.map((r) => r.writer)).toEqual(["user:github:7", "agent:triage for:github:7"]);
	});

	it("refuses an agent a person's calls", async () => {
		expect((await post("cancel", ["t"], agent)).status).toBe(403);
		expect((await post("setLimits", ["t", {usd: 1}], agent)).status).toBe(403);
		expect(await statusOf(door().invite(Redacted.make(agent), "bob"))).toBe(403);
		expect(await statusOf(door().remove(Redacted.make(agent), "github:7"))).toBe(403);
	});

	it("refuses an agent's answer for its person, by append and by send, and takes a person's", async () => {
		const data = {id: "plan:o/r#7@1", answer: {kind: "approve"}};
		const raw = await post("append", ["t/inbox", "any", {kind: "answered", data}, null], agent);
		expect(raw.status).toBe(403);
		expect(await raw.json()).toEqual({
			error: "only a person writes answered: an agent does not answer for its person",
		});

		/** `send`, as a host calls it: the `Ledger` service over HTTP, with `token`'s session. */
		const send = (token: string, id: string, kind: string) =>
			asLedger(
				Redacted.make(token),
				Effect.gen(function* () {
					const ledger = yield* Ledger;
					yield* ledger.send(streams("t").inbox, id, {kind, writer: "x", data});
					return yield* ledger.readStream("t/inbox");
				}),
			);
		const theirs = await send(agent, "answered:a1", "answered");
		expect(Exit.isFailure(theirs) && String(theirs.cause)).toContain("answered 403");
		const mine = await send(person, "answered:p1", "answered");
		if (Exit.isFailure(mine)) throw new Error(String(mine.cause));
		// The agent's own facts still land: here, the ask it puts to the owner.
		const asked = await send(agent, "asked:a1", "ruling_needed");
		if (Exit.isFailure(asked)) throw new Error(String(asked.cause));
		expect(asked.value.slice(-2).map((r) => [r.kind, r.writer])).toEqual([
			["answered", "user:github:7"],
			["ruling_needed", "agent:triage for:github:7"],
		]);
	});

	it("lets in a person a member invited, and nobody else", async () => {
		expect(
			await statusOf(
				door()
					.login("bob")
					.pipe(Effect.provide(layerSignerKey(bob))),
			),
		).toBe(403);
		const invited = await run(door().invite(Redacted.make(person), "bob"));
		expect(invited).toEqual({id: 8, login: "bob"});
		const s = await run(
			door()
				.login("bob")
				.pipe(Effect.provide(layerSignerKey(bob))),
		);
		expect(s.who).toEqual({kind: "user", id: "github:8"});
		const m = await run(door().members(Redacted.make(person)));
		expect(m.members.map((x) => x.id).sort()).toEqual(["github:7", "github:8"]);
	});

	it("takes a claim's host and makes the holder from the credential", async () => {
		const exit = await asLedger(
			Redacted.make(agent),
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				yield* ledger.register("c", "ignored");
				const rev = (yield* ledger.readLast("c", 1))[0]?.rev ?? 0;
				yield* ledger.claim("c", "host-a", rev, 60_000);
				return yield* ledger.lease("c");
			}),
		);
		if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
		expect(exit.value?.holder).toBe("host-a@agent:triage for:github:7");
	});
});

describe("two objects on one server", () => {
	it("keep their own members, sessions and grants", async () => {
		const other = doorOf({url, ledger: "other"});
		// bob is a member of demo, not of other.
		expect(await statusOf(other.login("bob").pipe(Effect.provide(layerSignerKey(bob))))).toBe(403);
		// demo's session opens nothing on other.
		const read = await fetch(`${url}/other/read`, {
			method: "POST",
			headers: {authorization: `Bearer ${person}`},
			body: JSON.stringify([0, 10, null]),
		});
		expect(read.status).toBe(401);
		// A grant for demo lets no agent into other, even with its person a member of both.
		await run(other.login("alice").pipe(Effect.provide(layerSignerKey(alice))));
		const g = await run(
			grant({
				address: `${url}/${LEDGER}`,
				agent: "triage",
				key: await lineOf(triage),
				for: "alice",
				expires: Date.now() + 60_000,
			}).pipe(Effect.provide(layerSignerKey(alice))),
		);
		expect(await statusOf(other.agentLogin(g).pipe(Effect.provide(layerSignerKey(triage))))).toBe(
			401,
		);
	});
});

describe("a ledger with no door", () => {
	it("refuses every request, with or without a credential", async () => {
		const closed = new Miniflare(ledgerOptions({persist: false, direct: 0}));
		try {
			await closed.ready;
			const base = (await closed.unsafeGetDirectURL()).origin;
			for (const auth of [{}, {authorization: "Bearer fabrika_p_anything"}]) {
				const res = await fetch(`${base}/x/read`, {
					method: "POST",
					headers: auth,
					body: JSON.stringify([0, 10, null]),
				});
				expect(res.status).toBe(403);
			}
			const login = await fetch(`${base}/x/door/challenge`, {method: "POST", body: "{}"});
			expect(login.status).toBe(404);
		} finally {
			await closed.dispose();
		}
	});
});

describe("a local door", () => {
	it("knows its one person by the secret, and an agent token as an agent for them", async () => {
		const secret = Redacted.make("fabrika_l_test-secret");
		const local = new Miniflare(
			ledgerOptions({persist: false, direct: 0, door: {kind: "local", person: "owner", secret}}),
		);
		try {
			await local.ready;
			const base = (await local.unsafeGetDirectURL()).origin;
			const d = doorOf({url: base, ledger: "x"});
			expect(await run(d.who(secret))).toEqual({kind: "user", id: "owner"});
			const a = await run(d.addAgent(secret, "triage"));
			expect(await run(d.who(a.token))).toEqual({kind: "agent", id: "triage", for: "owner"});
			expect(await statusOf(d.addAgent(a.token, "other"))).toBe(403);
			const exit = await Effect.runPromiseExit(
				Effect.gen(function* () {
					const ledger = yield* Ledger;
					yield* ledger.register("t", "user:owner");
					yield* ledger.append("t/inbox", "any", {kind: "note", writer: "user:owner", data: {}});
					return yield* ledger.readStream("t/inbox");
				}).pipe(Effect.provide(layerHttp({url: base, ledger: "x", token: a.token})), Effect.scoped),
			);
			if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
			expect(exit.value.map((r) => r.writer)).toEqual(["agent:triage for:owner"]);
		} finally {
			await local.dispose();
		}
	});
});
