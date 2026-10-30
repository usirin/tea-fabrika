import {createHash} from "node:crypto";
import {mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import {
	byOf,
	hashLines,
	keyFileText,
	keyLineOf,
	Ledger,
	type Moved,
	memoryStorage,
	offer,
	type Row,
	Rows,
	start,
	viewOf,
	writerFor,
} from "@kampus/fabrika";
import {doorOf, layerHttp} from "@kampus/fabrika/http";
import {layerSqliteSync} from "@kampus/fabrika/sqlite";
import {startTwin} from "@kampus/ledger-server/twin";
import {
	Author,
	type Do,
	fold,
	pullRequestsOf,
	ROOT,
	readRow,
	type Shown,
	tracker,
} from "@tea-fabrika/tracker";
import {
	Context,
	Effect,
	Exit,
	FileSystem,
	Layer,
	Option,
	Path,
	Schema,
	Scope,
	Stream,
} from "effect";
import {ChildProcess} from "effect/process";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {attach} from "../attach.ts";
import {
	CONNECTION_FILE,
	connect,
	connectAndRestart,
	hostLedger,
	invite,
	loginWith,
	members,
} from "./connection.ts";
import {move, readLaptop} from "./move.ts";
import {pathsOf} from "./socket.ts";

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
/** The path of every call the Worker made to the fake GitHub: a login asks `/user/<id>` once. */
const calls: string[] = [];
const fakeGitHub = async (req: Request): Promise<Response> => {
	const url = new URL(req.url);
	calls.push(url.pathname);
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
/** The twin's own URL: each ledger on it is one more name after it. */
let base = "";
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
	for (const name of ["alice", "bob", "carol", "dave"])
		mkdirSync(join(root, name), {recursive: true});
	await keyFor("alice", 7);
	await keyFor("bob", 8);
	await keyFor("carol", 9);
	await keyFor("dave", 10);
	const twin = await Effect.runPromise(
		startTwin({
			config: {name: "acme-ledger", founder: "github:7"},
			persist: false,
			github: fakeGitHub,
			cacheMs: 0,
		}).pipe(Scope.provide(twinScope)),
	);
	base = twin.url;
	address = `${twin.url}/acme`;
});

afterAll(async () => {
	await Effect.runPromise(Scope.close(twinScope, Exit.void));
	rmSync(root, {recursive: true, force: true});
});

const run = <A, E>(e: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Scope.Scope>) =>
	Effect.runPromise(e.pipe(Effect.scoped, Effect.provide(platform)));

/** The tracker on a home's ledger, as its host runs it: as the person the door let in. */
const trackerAt = (home: string, id: string) => trackerOn(hostLedger(home), id);

/** The tracker on `ledger`, writing as its `Author`. */
const trackerOn = <E>(
	ledger: Layer.Layer<Ledger | Author, E, FileSystem.FileSystem | Path.Path>,
	id: string,
) =>
	Effect.gen(function* () {
		const services = yield* Layer.build(Layer.merge(ledger, pullRequestsOf([])));
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

				yield* a.say({kind: "query", ticket: 1});
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

// ---------------------------------------------------------------- moving a laptop's tickets
//
//   alice's laptop ledger: two tickets, filed, commented on and closed by user:owner and agent:x
//   she moves it to a new ledger on the server (`fabrika move`); her home now uses it
//   bob is invited after, and sees every old ticket, by alice and her agent, at the old times
//   the window closed behind the seal: no more imports, by her or by bob

/** The tickets rows fold to, less where each row sits: `pos` is each ledger's own. */
const foldedOf = (rows: readonly Row[]) => {
	const entries = rows.flatMap((r) => {
		const x = readRow(r);
		return x.kind === "entry" ? [x.entry] : [];
	});
	const f = fold([], entries);
	return {
		tickets: f.tickets.map((t) => ({
			...t,
			timeline: t.timeline.map(({pos: _, whose: __, ...e}) => e),
		})),
		problems: f.problems,
	};
};

const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** A person's session on `ledger`, and that ledger's door. */
const doorAs = (ledger: string, login: string) =>
	Effect.gen(function* () {
		const s = yield* loginWith({url: base, ledger, login, key: person(login).key});
		return {token: s.token, door: doorOf({url: base, ledger})};
	});

const ONE: Moved = {
	from: 1,
	stream: "tracker/ticket/1",
	rev: 1,
	kind: "registered",
	at: 5,
	data: "{}",
	id: null,
	by: {kind: "founder"},
};

describe("moving alice's laptop ledger to the server, then bob", () => {
	it("bob sees every old ticket, with its writers mapped and its times kept", async () => {
		const laptop = join(root, "alice", "laptop");
		mkdirSync(laptop, {recursive: true});
		const file = join(laptop, "ledger.sqlite");
		await run(
			Effect.gen(function* () {
				const me = yield* trackerAt(laptop, "tracker:owner");
				yield* me.until((s) => s.ready);
				yield* me.say({kind: "file", title: "Login fails", body: "On main."});
				yield* me.say({kind: "file", title: "Slow build", body: ""});
				yield* me.say({kind: "comment", ticket: 1, body: "Seen on main."});
				yield* me.say({kind: "close", ticket: 2});
				yield* me.say({kind: "query", ticket: 2});
				yield* me.until((s) => timelineOf(s).length === 2);
			}).pipe(Effect.scoped),
		);
		await run(
			Effect.gen(function* () {
				const agent = yield* trackerOn(
					Layer.merge(
						layerSqliteSync({path: file, tickMs: 1000}),
						Layer.succeed(Author, {kind: "agent", id: "x"}),
					),
					"tracker:x",
				);
				yield* agent.until((s) => s.ready);
				yield* agent.say({kind: "comment", ticket: 1, body: "Fixed in the next build."});
				yield* agent.say({kind: "close", ticket: 1});
				yield* agent.say({kind: "query", ticket: 1});
				yield* agent.until((s) => timelineOf(s).length === 4);
			}).pipe(Effect.scoped),
		);
		const old = await run(readLaptop(file));
		const before = sha(file);
		const sideFiles = readdirSync(laptop).sort();

		const done = await run(
			move({
				home: laptop,
				from: file,
				to: `${base}/moved`,
				login: "alice",
				key: person("alice").key,
			}),
		);
		expect(done.progress).toMatchObject({count: old.length, state: {kind: "open", by: "seal"}});
		expect(done.plan.writers).toEqual([
			{from: "user:owner", to: "user:github:7", events: 6},
			{from: "agent:x", to: "agent:x for:github:7", events: 2},
		]);
		// The laptop's file is the archive, as it was; the home now uses the server.
		expect(sha(file)).toBe(before);
		expect(readdirSync(laptop).sort()).toEqual([...sideFiles, CONNECTION_FILE].sort());

		expect(await run(invite(laptop, "bob"))).toEqual({id: "github:8", name: "bob"});
		const bobs = join(root, "bob", "moved");
		await run(connect(bobs, {address: `${base}/moved`, login: "bob", key: person("bob").key}));
		const seen = await run(
			Effect.gen(function* () {
				const b = yield* trackerAt(bobs, "tracker:bob");
				yield* b.say({kind: "query", ticket: 1});
				return timelineOf(yield* b.until((s) => timelineOf(s).length === 4));
			}).pipe(Effect.scoped),
		);
		expect(seen).toEqual([
			[{kind: "user", id: "github:7"}, "filed"],
			[{kind: "user", id: "github:7"}, "commented"],
			[{kind: "agent", id: "x", for: "github:7"}, "commented"],
			[{kind: "agent", id: "x", for: "github:7"}, "closed"],
		]);
		const moved = await run(
			Effect.gen(function* () {
				const services = yield* Layer.build(hostLedger(bobs));
				return yield* Effect.gen(function* () {
					return yield* (yield* Ledger).read(0, 10_000, ROOT);
				}).pipe(Effect.provideContext(services));
			}),
		);
		const mapped = Schema.decodeUnknownSync(Rows)(old).map((r) => {
			const by = byOf(r.writer, "github:7");
			return by === null ? r : {...r, writer: writerFor(by, "github:7")};
		});
		expect(moved.map((r) => r.at)).toEqual(mapped.map((r) => r.at));
		expect(foldedOf(moved)).toEqual(foldedOf(mapped));
		expect(foldedOf(moved).tickets.map((t) => [t.title, t.state])).toEqual([
			["Login fails", "closed"],
			["Slow build", "closed"],
		]);

		// The seal and the invite closed the window, for the founder and for bob.
		const refusals = await run(
			Effect.gen(function* () {
				const a = yield* doorAs("moved", "alice");
				const b = yield* doorAs("moved", "bob");
				return [
					yield* a.door.importChunk(a.token, [{...ONE, from: 999}]).pipe(Effect.flip),
					yield* b.door.importChunk(b.token, [{...ONE, from: 999}]).pipe(Effect.flip),
				];
			}),
		);
		expect(refusals).toMatchObject([
			{_tag: "DoorRefused", status: 409},
			{_tag: "DoorRefused", status: 403},
		]);
	});

	it("refuses an import after an invite, after an ordinary write, and a seal with the wrong hash", async () => {
		const answers = await run(
			Effect.gen(function* () {
				const invited = yield* doorAs("m-invite", "alice");
				yield* invited.door.invite(invited.token, "bob");
				const afterInvite = yield* invited.door.importChunk(invited.token, [ONE]).pipe(Effect.flip);

				const wrote = yield* doorAs("m-write", "alice");
				yield* Effect.gen(function* () {
					return yield* (yield* Ledger).register("host/h1", "");
				}).pipe(Effect.provide(layerHttp({url: base, ledger: "m-write", token: wrote.token})));
				const afterWrite = yield* wrote.door.importChunk(wrote.token, [ONE]).pipe(Effect.flip);

				const sealing = yield* doorAs("m-seal", "alice");
				const imported = yield* sealing.door.importChunk(sealing.token, [ONE]);
				const wrong = yield* sealing.door
					.seal(sealing.token, {count: 1, hash: "0".repeat(64)})
					.pipe(Effect.flip);
				const still = yield* sealing.door.moveProgress(sealing.token);
				const right = yield* sealing.door.seal(sealing.token, {
					count: 1,
					hash: yield* Effect.tryPromise(() => hashLines([{...ONE, writer: "user:github:7"}])),
				});
				return {afterInvite, afterWrite, imported, wrong, still, right};
			}),
		);
		expect(answers.afterInvite).toMatchObject({status: 409});
		expect(answers.afterInvite.why).toContain("invite");
		expect(answers.afterWrite).toMatchObject({status: 409});
		expect(answers.afterWrite.why).toContain("write");
		expect(answers.imported.state).toEqual({kind: "importing"});
		expect(answers.wrong).toMatchObject({status: 409});
		expect(answers.still.state).toEqual({kind: "importing"});
		expect(answers.right.state).toMatchObject({kind: "open", by: "seal"});
	});
});

// ---------------------------------------------------------------- a host's session
//
//   dave's host runs on a ledger alice made; alice takes him off, which ends his sessions as
//   their end would (the door answers both with the same 401), and invites him again
//   his host's doorbell, then a call, each meet the 401 and log in once; the host goes on
//   alice takes him off for good: every call fails with the door's 401, and nothing loops
//
// The timer that renews before the end is in packages/fabrika/src/host/http.test.ts, under a
// TestClock: the twin's door keeps time by its own clock, and a session there is a minute at least.

describe("a host's session on the server", () => {
	const ledger = "sessions";
	const daveHome = () => join(root, "dave", ledger);
	const logins = () => calls.filter((p) => p === "/user/10").length;
	/** Alice takes dave off her ledger: his sessions end at once. */
	const takeOff = Effect.gen(function* () {
		const a = yield* doorAs(ledger, "alice");
		yield* a.door.remove(a.token, "github:10");
		return a;
	});
	/** The `Ledger` of dave's host, as it runs: built once, for the whole test. */
	const davesLedger = Effect.suspend(() =>
		Effect.map(Layer.build(hostLedger(daveHome())), (c) => Context.get(c, Ledger)),
	);

	it("a session the door ended is renewed by one login, for the doorbell and for a call", async () => {
		const aliceHome = join(root, "alice", ledger);
		const at = `${base}/${ledger}`;
		await run(connect(aliceHome, {address: at, login: "alice", key: person("alice").key}));
		await run(invite(aliceHome, "dave"));
		await run(connect(daveHome(), {address: at, login: "dave", key: person("dave").key}));
		const seen = await run(
			Effect.gen(function* () {
				const l = yield* davesLedger;
				yield* l.register("notes/1", "");

				const a = yield* takeOff;
				yield* a.door.invite(a.token, "dave");
				const before = logins();
				// The doorbell's socket is refused; the door's `who` says 401; one login, then it rings.
				yield* l.watch("notes/1").pipe(
					Stream.runHead,
					Effect.timeoutOrElse({
						duration: "10 seconds",
						orElse: () => Effect.die("the doorbell never rang"),
					}),
				);
				const bell = logins() - before;

				const b = yield* takeOff;
				yield* b.door.invite(b.token, "dave");
				const again = logins();
				const wrote = yield* l.register("notes/2", "");
				return {bell, call: logins() - again, created: wrote.created};
			}).pipe(Effect.scoped),
		);
		expect(seen).toEqual({bell: 1, call: 1, created: true});
	});

	it("a person taken off for good: every call fails with the door's why", async () => {
		const seen = await run(
			Effect.gen(function* () {
				const l = yield* davesLedger;
				yield* l.read(0, 1, "notes/");
				yield* takeOff;
				return [
					yield* Effect.flip(l.read(0, 100, "notes/")),
					yield* Effect.flip(l.read(0, 100, "notes/")),
				];
			}).pipe(Effect.scoped),
		);
		// The refusal is kept, so the second call fails the same and logs in no more (http.test.ts).
		for (const e of seen) {
			expect(e).toMatchObject({_tag: "LedgerUnreachable", method: "read"});
			expect(e.message).toContain("the door gave no new session (401)");
		}
	});
});

// ---------------------------------------------------------------- connecting while the app runs
//
//   a host runs on alice's fresh home, on its own ledger.sqlite, and an app is attached to it
//   `fabrika connect` (`connectAndRestart`): the connection is kept, and that host is stopped
//   the app's link ends; its next try (reconnect.ts) finds no host and starts one
//   that host logs in at the server as it starts: it uses the new ledger, with no restart by hand

describe("connecting while the app runs", () => {
	const spawner = NodeChildProcessSpawner.layer.pipe(
		Layer.provideMerge(Layer.mergeAll(platform, pullRequestsOf([]))),
	);
	/** A host process on `home`, as the app starts one (host/stop.test.ts). Killed with the scope. */
	const hostProcess = (home: string) =>
		Effect.gen(function* () {
			const main = yield* (yield* Path.Path).fromFileUrl(new URL("./main.ts", import.meta.url));
			return yield* ChildProcess.make(process.execPath, [main], {
				env: {FABRIKA_HOME: home},
				extendEnv: true,
				stdin: "ignore",
				stdout: "ignore",
				stderr: "ignore",
				forceKillAfter: "3 seconds",
			});
		});
	/** The pid in the home's pid file, or "" when there is none. */
	const pidIn = (file: string) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			return (yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""))).trim();
		});

	it("the running host is stopped, and the app's next try starts one on the new ledger", async () => {
		const home = join(root, "alice", "live");
		mkdirSync(home, {recursive: true});
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const paths = yield* pathsOf(home);
				const started: number[] = [];
				const start = Effect.gen(function* () {
					const host = yield* hostProcess(home);
					started.push(host.pid);
					return host.exitCode;
				});
				const before = yield* attach({home, deliver: () => {}, start});
				const old = yield* pidIn(paths.pid);
				const logins = () => calls.filter((p) => p === "/user/7").length;
				const connected = yield* connectAndRestart(home, {
					address: `${base}/live`,
					login: "alice",
					key: person("alice").key,
				});
				const atConnect = logins();
				const ended = yield* before.wire.ended.pipe(Effect.timeout("5 seconds"));
				// What the reconnect machine's next try does: attach, which starts a host when none answers.
				const after = yield* attach({home, deliver: () => {}, start});
				return {
					connected,
					ended: typeof ended,
					pids: [old, yield* pidIn(paths.pid)],
					started: started.map(String),
					found: after.found,
					hostLogins: logins() - atConnect,
				};
			}).pipe(Effect.scoped, Effect.provide(spawner)),
		);
		expect(seen.connected).toEqual({who: {kind: "user", id: "github:7"}, host: "stopped"});
		expect(seen.ended).toBe("string");
		expect(seen.started).toHaveLength(2);
		expect(seen.pids).toEqual(seen.started);
		expect(seen.found).toEqual({kind: "up"});
		// The new host logged in at the server as it started: it reads the new ledger.json.
		expect(seen.hostLogins).toBe(1);
	});

	it("with no host running, nothing is stopped: the app uses it when it starts", async () => {
		const home = join(root, "alice", "idle");
		const connected = await run(
			connectAndRestart(home, {address: `${base}/idle`, login: "alice", key: person("alice").key}),
		);
		expect(connected).toEqual({who: {kind: "user", id: "github:7"}, host: "none"});
	});
});
