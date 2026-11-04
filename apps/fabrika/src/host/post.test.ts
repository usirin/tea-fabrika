import {mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import {keyFileText, keyLineOf, memoryStorage, offer, start, viewOf} from "@kampus/fabrika-old";
import {startTwin} from "@kampus/ledger-server/twin";
import {pullRequestsOf, type Shown, tracker} from "@tea-fabrika/tracker";
import {Effect, Exit, type FileSystem, Layer, Option, type Path, Scope, Stream} from "effect";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {connect, hostLedger, invite} from "./connection.ts";
import {AGENT_KEY, type Post, post} from "./post.ts";

// An agent posts to the tracker for its person, on a ledger server's twin (as shared.test.ts):
// alice founds it and invites bob; bob's agent `triage` files a ticket and comments on it. The
// ledger says each write is agent:triage, for bob, whatever the agent says it is.

const users = new Map<string, {id: number; keys: string[]}>();
const fakeGitHub = async (req: Request): Promise<Response> => {
	const url = new URL(req.url);
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

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
let root = "";
let address = "";
const twinScope = Effect.runSync(Scope.make());
const person = (name: string) => ({home: join(root, name, "home"), key: join(root, name, "key")});

const keyFor = async (login: string, id: number) => {
	const pair = (await crypto.subtle.generateKey({name: "Ed25519"}, true, [
		"sign",
		"verify",
	])) as CryptoKeyPair;
	writeFileSync(person(login).key, await keyFileText(pair, `${login}@laptop`), {mode: 0o600});
	const line = keyLineOf(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
	users.set(login, {id, keys: [line]});
};

beforeAll(async () => {
	root = mkdtempSync(join(tmpdir(), "fabrika-post-"));
	for (const name of ["alice", "bob"]) mkdirSync(join(root, name, "home"), {recursive: true});
	await keyFor("alice", 7);
	await keyFor("bob", 8);
	const twin = await Effect.runPromise(
		startTwin({
			config: {name: "acme-ledger", founder: "github:7"},
			persist: false,
			github: fakeGitHub,
			cacheMs: 0,
		}).pipe(Scope.provide(twinScope)),
	);
	address = `${twin.url}/acme`;
});

afterAll(async () => {
	await Effect.runPromise(Scope.close(twinScope, Exit.void));
	rmSync(root, {recursive: true, force: true});
});

const run = <A, E>(e: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Scope.Scope>) =>
	Effect.runPromise(e.pipe(Effect.scoped, Effect.provide(platform)));

/** Ticket `n`'s entries as alice's host reads them, oldest first. */
const entriesAt = (home: string, n: number) =>
	Effect.gen(function* () {
		const services = yield* Layer.build(Layer.merge(hostLedger(home), pullRequestsOf([])));
		const started = yield* start(tracker, {}, {}, {id: "read", storage: memoryStorage()}).pipe(
			Effect.provideContext(services),
		);
		if (started.kind !== "running") return yield* Effect.die("the tracker did not start");
		const view = viewOf(tracker);
		if (view === undefined) return yield* Effect.die("the tracker has no view");
		yield* offer(started.run, "query", {ticket: n});
		const shown = yield* started.run.machines.tickets.changes.pipe(
			Stream.filter((s) => s !== null),
			Stream.map((s) => view.of(s) as Shown),
			Stream.filter((s) => s.page.kind === "ticket" && s.page.opened !== null),
			Stream.runHead,
			Effect.map(Option.getOrThrow),
		);
		yield* offer(started.run, "quit", null);
		return shown.page.kind === "ticket" ? (shown.page.opened?.ticket.timeline ?? []) : [];
	});

/** Ticket `n`'s timeline as alice's host reads it: who wrote each fact, and its type. */
const timelineAt = (home: string, n: number) =>
	run(entriesAt(home, n).pipe(Effect.map((es) => es.map((e) => [e.by, e.fact.type]))));

describe("an agent posts for its person", () => {
	it("as agent:<name> for that person, with a key made once and kept", async () => {
		const alice = person("alice");
		const bob = person("bob");
		await run(connect(alice.home, {address, login: "alice", key: alice.key}));
		await run(invite(alice.home, "bob"));
		await run(connect(bob.home, {address, login: "bob", key: bob.key}));

		const filed = await run(
			post(bob.home, "triage", [{type: "file", value: {title: "A bug", body: "It breaks."}}]),
		);
		expect(filed).toEqual(["#1 open c0 A bug"]);
		const key = join(bob.home, AGENT_KEY);
		expect(statSync(key).mode & 0o777).toBe(0o600);
		const made = readFileSync(key, "utf8");

		const commented = await run(
			post(bob.home, "triage", [{type: "comment", value: {ticket: 1, body: "Seen it."}}]),
		);
		expect(commented).toEqual(["#1 open c1 A bug"]);
		expect(readFileSync(key, "utf8")).toBe(made);

		const agent = {kind: "agent", id: "triage", for: "github:8"};
		expect(await timelineAt(alice.home, 1)).toEqual([
			[agent, "filed"],
			[agent, "commented"],
		]);
	});

	it("refuses a name that is no agent's, and a home with no server, before any key is made", async () => {
		const bad = await run(post(person("bob").home, "Not An Agent", []).pipe(Effect.flip));
		expect(bad).toMatchObject({_tag: "ConnectFailed"});
		const lone = join(root, "lone");
		mkdirSync(lone);
		const none = await run(post(lone, "triage", []).pipe(Effect.flip));
		expect(none).toMatchObject({_tag: "ConnectFailed", why: expect.stringContaining("connect")});
		expect(() => statSync(join(lone, AGENT_KEY))).toThrow();
	});
});

// Ticket 196: `fabrika post file --from '<json>'` files through `post`, so `post` is the door a
// bad `from` must not get past. Runs after the tests above: bob is connected, and #1 is filed.
// PR 352 and its mutation step are ticket 188's.
describe("an agent's filing says where it came from", () => {
	const from = {
		_tag: "pr",
		url: "https://github.com/usirin/tea-fabrika/pull/352",
		step: "mutation",
	} as const;

	// p3, the good side
	it("puts its `from` on the ledger as written", () =>
		run(
			Effect.gen(function* () {
				const lines = yield* post(person("bob").home, "triage", [
					{type: "file", value: {title: "Mutation runner", body: "It links.", from}},
				]);
				expect(lines).toHaveLength(2);
				const [filed] = yield* entriesAt(person("alice").home, 2);
				expect(filed?.fact).toStrictEqual({
					type: "filed",
					title: "Mutation runner",
					body: "It links.",
					from,
				});
			}),
		));

	// p3
	it("is refused with a `from` that does not fit, with why, and nothing is filed", () =>
		run(
			Effect.gen(function* () {
				// Read from text, as the CLI's `--from` is: the types cannot see what is in it.
				const writes: ReadonlyArray<Post> = JSON.parse(
					JSON.stringify([
						{
							type: "file",
							value: {
								title: "Bad from",
								body: "",
								from: {_tag: "pr", url: "https://github.com/usirin/tea-fabrika/issues/352"},
							},
						},
					]),
				);
				const answer = yield* post(person("bob").home, "triage", writes).pipe(
					Effect.match({
						onFailure: (e) => e,
						onSuccess: (lines) => ({_tag: "posted", lines}),
					}),
				);
				expect(answer).toMatchObject({_tag: "PostFailed", why: expect.stringMatching(/from/)});
				const after = yield* post(person("bob").home, "triage", []);
				expect(after.map((line) => line.slice(0, 2))).toEqual(["#1", "#2"]);
			}),
		));
});
