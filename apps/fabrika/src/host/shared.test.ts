import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import {keyFileText, keyLineOf, memoryStorage, offer, start, viewOf} from "@kampus/fabrika";
import {startTwin} from "@kampus/ledger-server/twin";
import {type Do, pullRequestsOf, type Shown, tracker} from "@tea-fabrika/tracker";
import {Effect, Exit, FileSystem, Layer, Option, type Path, Scope, Stream} from "effect";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {CONNECTION_FILE, connect, hostLedger, invite, members} from "./connection.ts";

// Two people on one laptop, sharing one ledger server: its twin, in Miniflare, from the same
// Worker and bindings a deploy uses (packages/ledger-server). Each person has their own app home
// and their own SSH key file. GitHub is a fake that lists each person's key for their login; no
// call leaves the laptop.
//
//   alice makes the ledger (its founder), connects, and invites bob by his login
//   bob connects: he gets in at his first login
//   alice files a ticket in the tracker; bob sees it and comments; alice sees his comment, as his
//   carol, who nobody invited, is refused, and her home is left as it was

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

/** A fresh Ed25519 key, written as `ssh-keygen` writes one, and listed by the fake GitHub. */
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
	root = mkdtempSync(join(tmpdir(), "fabrika-two-"));
	for (const name of ["alice", "bob", "carol"]) mkdirSync(join(root, name), {recursive: true});
	await keyFor("alice", 7);
	await keyFor("bob", 8);
	await keyFor("carol", 9);
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

/** The tracker on a home's ledger, as its host runs it: as the person the door let in. */
const trackerAt = (home: string, id: string) =>
	Effect.gen(function* () {
		const services = yield* Layer.build(Layer.merge(hostLedger(home), pullRequestsOf([])));
		const started = yield* start(tracker, {}, {}, {id, storage: memoryStorage()}).pipe(
			Effect.provideContext(services),
		);
		if (started.kind !== "running") return yield* Effect.die("the tracker did not start");
		const {run: r} = started;
		const view = viewOf(tracker);
		if (view === undefined) return yield* Effect.die("the tracker has no view");
		const say = (d: Do): Effect.Effect<unknown> => offer(r, "do", d);
		const until = (ok: (shown: Shown) => boolean) =>
			r.machines.tickets.changes.pipe(
				Stream.filter((s) => s !== null),
				Stream.map((s) => view.of(s) as Shown),
				Stream.filter(ok),
				Stream.runHead,
				Effect.map(Option.getOrThrow),
				Effect.timeoutOrElse({
					duration: "10 seconds",
					orElse: () => Effect.die(`${id} waited and saw nothing`),
				}),
			);
		return {say, until};
	});

const timelineOf = (shown: Shown) =>
	shown.page.kind === "ticket"
		? (shown.page.opened?.ticket.timeline.map((e) => [e.by, e.fact.type]) ?? [])
		: [];

describe("two people on one ledger server", () => {
	it("the founder connects and invites; the invited one joins; a stranger is refused", async () => {
		const alice = person("alice");
		const bob = person("bob");
		const carol = person("carol");

		// Bob tries before anyone invited him: refused, and nothing is kept in his home.
		const early = await run(
			connect(bob.home, {address, login: "bob", key: bob.key}).pipe(Effect.flip),
		);
		expect(early._tag).toBe("DoorRefused");

		expect(await run(connect(alice.home, {address, login: "alice", key: alice.key}))).toEqual({
			kind: "user",
			id: "github:7",
		});
		expect(await run(invite(alice.home, "bob"))).toEqual({id: "github:8", name: "bob"});
		expect(await run(connect(bob.home, {address, login: "bob", key: bob.key}))).toEqual({
			kind: "user",
			id: "github:8",
		});
		expect(await run(members(alice.home))).toEqual({
			members: [
				{id: "github:7", name: "alice"},
				{id: "github:8", name: "bob"},
			],
			invited: [],
		});

		// Carol has a key GitHub lists, but nobody invited her.
		const refused = await run(
			connect(carol.home, {address, login: "carol", key: carol.key}).pipe(Effect.flip),
		);
		expect(refused).toMatchObject({_tag: "DoorRefused", status: 401});
		// Bob's key does not sign for alice either.
		const wrongKey = await run(
			connect(carol.home, {address, login: "alice", key: bob.key}).pipe(Effect.flip),
		);
		expect(wrongKey).toMatchObject({_tag: "DoorRefused", status: 401});
		const kept = await run(
			Effect.gen(function* () {
				return yield* (yield* FileSystem.FileSystem).exists(join(carol.home, CONNECTION_FILE));
			}),
		);
		expect(kept).toBe(false);
	});

	it("a ticket alice files, bob sees and comments on, and alice sees his comment as his", async () => {
		const seen = await run(
			Effect.gen(function* () {
				const a = yield* trackerAt(person("alice").home, "tracker:alice");
				const b = yield* trackerAt(person("bob").home, "tracker:bob");
				yield* a.until((s) => s.ready);
				yield* a.say({kind: "file", title: "Login fails", body: "On main."});

				// Bob's tracker sees it on its own poll.
				yield* b.until(
					(s) => s.page.kind === "list" && s.page.tickets.some((t) => t.title === "Login fails"),
				);
				yield* b.say({kind: "comment", ticket: 1, body: "Seen it too."});

				yield* a.say({kind: "open", ticket: 1});
				const shown = yield* a.until((s) => timelineOf(s).length === 2);
				return timelineOf(shown);
			}).pipe(Effect.scoped),
		);
		expect(seen).toEqual([
			[{kind: "user", id: "github:7"}, "filed"],
			[{kind: "user", id: "github:8"}, "commented"],
		]);
	});
});
