import {Agent, request} from "node:http";
import {Effect, Exit, Redacted} from "effect";
import {Miniflare} from "miniflare";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {type DoorRefused, doorOf, layerHttp} from "./http.ts";
import {Ledger, streams} from "./ledger.ts";
import {grant, layerSignerKey} from "./signer.ts";
import {keyLineOf} from "./sshsig.ts";
import {ledgerOptions} from "./worker-options.ts";

// The door in workerd, under Miniflare, over HTTP as a host reaches it, asking GitHub's `Keys`
// Layer (`keys-github.ts`). GitHub is a fake: the Worker's own calls to api.github.com come here
// (`outboundService`). Keys are made in the test.

const pairOf = async () =>
	(await crypto.subtle.generateKey({name: "Ed25519"}, true, ["sign", "verify"])) as CryptoKeyPair;
const lineOf = async (p: CryptoKeyPair) =>
	keyLineOf(new Uint8Array(await crypto.subtle.exportKey("raw", p.publicKey)));

const users = new Map<string, {id: number; keys: string[]}>();
/** Every call the Worker made to the fake GitHub: its path, and its `authorization` header. */
const calls: {path: string; auth: string | null}[] = [];
const fakeGitHub = async (req: Request): Promise<Response> => {
	const url = new URL(req.url);
	calls.push({path: url.pathname, auth: req.headers.get("authorization")});
	if (url.host !== "api.github.com") return new Response("not here", {status: 502});
	const byId = /^\/user\/([0-9]+)$/.exec(url.pathname);
	if (byId !== null) {
		const found = [...users].find(([, u]) => u.id === Number(byId[1]));
		return found === undefined
			? Response.json({message: "Not Found"}, {status: 404})
			: Response.json({id: found[1].id, login: found[0]});
	}
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
		await ledgerOptions({
			persist: false,
			direct: 0,
			// No cache: each login here is seen at the fake GitHub.
			door: {
				kind: "shared",
				founder: "github:7",
				keys: {kind: "github", cacheMs: 0, failMs: 0, api: fakeGitHub},
			},
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
		// By the id in config, with no token: no authorization header.
		expect(calls).toEqual([
			{path: "/user/7", auth: null},
			{path: "/users/alice/keys", auth: null},
		]);
	});

	it("asks GitHub nothing about a name it does not know, and refuses it as a wrong key", async () => {
		calls.length = 0;
		const carol = await pairOf();
		users.set("carol", {id: 9, keys: [await lineOf(carol)]});
		const login = (name: string, key: CryptoKeyPair) =>
			Effect.runPromise(
				door()
					.login(name)
					.pipe(
						Effect.provide(layerSignerKey(key)),
						Effect.map(() => "let in"),
						Effect.catchTag("DoorRefused", (x) => Effect.succeed(`${x.status} ${x.why}`)),
					),
			);
		const unknown = await login("carol", carol);
		expect(calls).toEqual([]);
		const wrongKey = await login("alice", carol);
		expect(unknown).toBe(wrongKey);
		expect(unknown.startsWith("401 ")).toBe(true);
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
		).toBe(401);
		const invited = await run(door().invite(Redacted.make(person), "bob"));
		expect(invited).toEqual({id: "github:8", name: "bob"});
		const s = await run(
			door()
				.login("bob")
				.pipe(Effect.provide(layerSignerKey(bob))),
		);
		expect(s.who).toEqual({kind: "user", id: "github:8"});
		const m = await run(door().members(Redacted.make(person)));
		expect(m.members.map((x) => x.id).sort()).toEqual(["github:7", "github:8"]);
	});

	it("lets a member in after a rename on GitHub, by the name this ledger knows", async () => {
		const was = users.get("bob");
		if (was === undefined) throw new Error("bob is set up above");
		users.delete("bob");
		users.set("robert", was);
		calls.length = 0;
		try {
			const s = await run(
				door()
					.login("bob")
					.pipe(Effect.provide(layerSignerKey(bob))),
			);
			expect(s.who).toEqual({kind: "user", id: "github:8"});
			expect(calls.map((c) => c.path)).toEqual(["/user/8", "/users/robert/keys"]);
		} finally {
			users.delete("robert");
			users.set("bob", was);
		}
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

/**
 * POSTs on one kept-alive connection, in turn: each call's status (0: the connection broke), and
 * whether it went on the connection the one before it opened. Node's own `http`, held to one socket.
 */
const onOneConnection = async (calls: {path: string; body: string; token?: string}[]) => {
	const agent = new Agent({keepAlive: true, maxSockets: 1});
	try {
		const answers: {status: number; reused: boolean}[] = [];
		for (const c of calls)
			answers.push(
				await new Promise((resolve) => {
					const req = request(
						`${url}${c.path}`,
						{
							method: "POST",
							agent,
							headers: {
								"content-type": "application/json",
								...(c.token === undefined ? {} : {authorization: `Bearer ${c.token}`}),
							},
						},
						(res) => {
							res.resume();
							res.on("end", () => resolve({status: res.statusCode ?? 0, reused: req.reusedSocket}));
						},
					);
					req.on("error", () => resolve({status: 0, reused: req.reusedSocket}));
					req.end(c.body);
				}),
			);
		return answers;
	} finally {
		agent.destroy();
	}
};

describe("a refusal on a kept-alive connection", () => {
	it("leaves the connection good for the next call, at each early refusal", async () => {
		// A body big enough that workerd has not read it all by the time it answers.
		const big = JSON.stringify([0, 10, "x".repeat(256 * 1024)]);
		const refusals = [
			{path: "/", body: big},
			{path: `/${LEDGER}/read`, body: big},
			{path: `/${LEDGER}/read`, body: big, token: "fabrika_p_guess"},
			{path: `/${LEDGER}/tail`, body: big, token: person},
			{path: `/${LEDGER}/door/nothing`, body: big, token: person},
		];
		for (const refusal of refusals) {
			const [first, next] = await onOneConnection([
				refusal,
				{path: `/${LEDGER}/read`, body: JSON.stringify([0, 1, null]), token: person},
			]);
			expect(first?.status, refusal.path).toBeGreaterThanOrEqual(400);
			expect(next, refusal.path).toEqual({status: 200, reused: true});
		}
	});
});

describe("two objects on one server", () => {
	it("keep their own members, sessions and grants", async () => {
		const other = doorOf({url, ledger: "other"});
		// bob is a member of demo, not of other.
		expect(await statusOf(other.login("bob").pipe(Effect.provide(layerSignerKey(bob))))).toBe(401);
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

describe("a GitHub token", () => {
	it("reaches the Worker as a binding and goes to GitHub as a bearer header", async () => {
		const token = "github_pat_fake_for_the_test";
		const withToken = new Miniflare(
			await ledgerOptions({
				persist: false,
				direct: 0,
				door: {
					kind: "shared",
					founder: "github:7",
					keys: {kind: "github", cacheMs: 0, token: Redacted.make(token), api: fakeGitHub},
				},
			}),
		);
		try {
			await withToken.ready;
			const base = (await withToken.unsafeGetDirectURL()).origin;
			calls.length = 0;
			const s = await run(
				doorOf({url: base, ledger: "t"})
					.login("alice")
					.pipe(Effect.provide(layerSignerKey(alice))),
			);
			expect(s.who).toEqual({kind: "user", id: "github:7"});
			expect(calls.map((c) => c.auth)).toEqual([`Bearer ${token}`, `Bearer ${token}`]);
		} finally {
			await withToken.dispose();
		}
	});
});

describe("a ledger with no door", () => {
	it("refuses every request, with or without a credential", async () => {
		const closed = new Miniflare(await ledgerOptions({persist: false, direct: 0}));
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
			await ledgerOptions({
				persist: false,
				direct: 0,
				door: {kind: "local", person: "owner", secret},
			}),
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
