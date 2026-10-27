import {createHash} from "node:crypto";
import {mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeSocketServer from "@effect/platform-node/NodeSocketServer";
import {
	type Db,
	importChunk,
	MEMBERS,
	migrateMove,
	moveProgress,
	type Progress,
	read,
	register,
	append as rulesAppend,
	sealMove,
	writeUnguarded,
} from "@kampus/fabrika";
import {openDb} from "@kampus/fabrika/sqlite";
import {Effect, type FileSystem, Layer, Option, type Path, type Scope} from "effect";
import {afterAll, describe, expect, it} from "vitest";
import {CONNECTION_FILE} from "./connection.ts";
import {copyInto, dryRun, LinkDropped, MoveStopped, MoveTarget, move, readLaptop} from "./move.ts";
import {pathsOf} from "./socket.ts";

// The laptop's side of the move, against the server's own window (`importChunk`, `sealMove`) on
// node:sqlite in this process: the same code the Durable Object runs, with no network. The move
// over the twin, and two people after it, is shared.test.ts.

const root = mkdtempSync(join(tmpdir(), "move-"));
afterAll(() => rmSync(root, {recursive: true, force: true}));
let n = 0;
const fresh = (name: string) => {
	const dir = join(root, `${name}${n++}`);
	mkdirSync(dir, {recursive: true});
	return dir;
};

const FOUNDER = "github:7";
const alice = {kind: "user", id: FOUNDER} as const;

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
const run = <A, E>(e: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Scope.Scope>) =>
	Effect.runPromise(e.pipe(Effect.scoped, Effect.provide(platform)));

/** A laptop's file: 3 tickets, by the owner and an agent, among a host's own rows. */
const laptopFile = (home: string, extra?: (db: Db) => void) => {
	const file = join(home, "ledger.sqlite");
	const {db, close} = openDb(file);
	register(db, 10, "host/h1", "h1");
	let t = 20;
	for (const k of [1, 2, 3]) {
		const inbox = `tracker/ticket/${k}/inbox`;
		register(db, t++, `tracker/ticket/${k}`, "user:owner");
		rulesAppend(db, t++, inbox, "any", {
			kind: "filed",
			writer: "user:owner",
			data: {type: "filed", title: `Ticket ${k}`, body: ""},
			id: `f${k}`,
		});
		rulesAppend(db, t++, "host/h1/inbox", "any", {kind: "note", writer: "h1", data: {}});
		rulesAppend(db, t++, inbox, "any", {
			kind: "commented",
			writer: "agent:x",
			data: {type: "commented", body: `Looked at ${k}.`},
			id: `c${k}`,
		});
		rulesAppend(db, t++, inbox, "any", {
			kind: "closed",
			writer: "user:owner",
			data: {type: "closed"},
			id: `x${k}`,
		});
	}
	extra?.(db);
	close();
	return file;
};

/** The server's side, here: a founded ledger, and the founder's calls on its window. */
const server = () => {
	const {db} = openDb(join(root, `server${n++}.sqlite`));
	migrateMove(db);
	writeUnguarded(db, 1, MEMBERS, "any", {
		kind: "founded",
		writer: `user:${FOUNDER}`,
		data: {id: FOUNDER, name: "alice"},
	});
	return db;
};

const answer = <T>(
	r: {ok: true; value: {progress: T}} | {ok: false; status: number; why: string},
) => (r.ok ? Effect.succeed(r.value.progress) : Effect.fail(new MoveStopped({why: r.why})));

/** A target on `db`. `drop`: after this many chunks land, every answer is lost, as a dead link. */
const target = (db: Db, o: {drop?: number} = {}) => {
	let landed = 0;
	return Layer.succeed(
		MoveTarget,
		MoveTarget.of({
			founder: FOUNDER,
			progress: Effect.sync(() => moveProgress(db)),
			send: (events) =>
				Effect.suspend((): Effect.Effect<Progress, MoveStopped | LinkDropped> => {
					if (o.drop !== undefined && landed >= o.drop)
						return Effect.fail(new LinkDropped({why: "the wifi went"}));
					landed++;
					return answer(importChunk(db, FOUNDER, alice, {events}));
				}),
			seal: (seal) =>
				Effect.tryPromise({
					try: () => sealMove(db, FOUNDER, alice, seal, 1000),
					catch: (e) => new MoveStopped({why: String(e)}),
				}).pipe(Effect.flatMap(answer)),
		}),
	);
};

const rowsOf = (db: Db) =>
	read(db, 0, 10_000, "tracker").map((r) => [
		r.stream,
		r.rev,
		r.writer,
		r.kind,
		r.at,
		r.data,
		r.id,
	]);
const fileHash = (dir: string) =>
	createHash("sha256")
		.update(readdirSync(dir).sort().join("\n"))
		.update(readFileSync(join(dir, "ledger.sqlite")))
		.digest("hex");

describe("fabrika move, on the laptop's side", () => {
	it("copies every ticket row, with writers mapped and times kept, and nothing of the host", async () => {
		const file = laptopFile(fresh("home"));
		const db = server();
		const done = await run(
			Effect.flatMap(readLaptop(file), (rows) => copyInto(rows, {chunk: 4})).pipe(
				Effect.provide(target(db)),
			),
		);
		expect(done.progress).toMatchObject({count: 12, state: {kind: "open", by: "seal"}});
		const rows = rowsOf(db);
		expect(rows).toHaveLength(12);
		expect(rows.some((r) => String(r[0]).startsWith("host/"))).toBe(false);
		expect(rows.slice(0, 5)).toEqual([
			["tracker/ticket/1", 1, "user:github:7", "registered", 20, "{}", null],
			[
				"tracker/ticket/1/inbox",
				1,
				"user:github:7",
				"filed",
				21,
				'{"type":"filed","title":"Ticket 1","body":""}',
				"f1",
			],
			[
				"tracker/ticket/1/inbox",
				2,
				"agent:x for:github:7",
				"commented",
				23,
				'{"type":"commented","body":"Looked at 1."}',
				"c1",
			],
			["tracker/ticket/1/inbox", 3, "user:github:7", "closed", 24, '{"type":"closed"}', "x1"],
			["tracker/ticket/2", 1, "user:github:7", "registered", 25, "{}", null],
		]);
	});

	it("goes on after a dropped link, and ends as a clean copy does", async () => {
		const home = fresh("home");
		const file = laptopFile(home);
		const clean = server();
		const dropped = server();
		const rows = await run(readLaptop(file));
		await run(copyInto(rows, {chunk: 2}).pipe(Effect.provide(target(clean))));
		const cut = await run(
			copyInto(rows, {chunk: 2, pauseMs: 1}).pipe(
				Effect.provide(target(dropped, {drop: 3})),
				Effect.flip,
			),
		);
		expect(cut).toMatchObject({_tag: "LinkDropped"});
		expect(moveProgress(dropped)).toMatchObject({state: {kind: "importing"}, count: 6});
		// The answer to the last chunk was lost too: that chunk is sent again, and lands once.
		const resent = importChunk(dropped, FOUNDER, alice, {
			events: (await run(readLaptop(file))).slice(4, 6).map((r) => ({
				from: Number(r.pos),
				stream: String(r.stream),
				rev: Number(r.rev),
				kind: String(r.kind),
				at: Number(r.at),
				data: String(r.data),
				id: r.id === null ? null : String(r.id),
				by: r.writer === "agent:x" ? {kind: "agent", id: "x"} : {kind: "founder"},
			})),
		});
		expect(resent.ok && resent.value.progress.count).toBe(6);
		await run(copyInto(rows, {chunk: 2}).pipe(Effect.provide(target(dropped))));
		expect(rowsOf(dropped)).toEqual(rowsOf(clean));
		expect(read(dropped, 0, 10_000).map((r) => r.pos)).toEqual(
			read(clean, 0, 10_000).map((r) => r.pos),
		);
	});

	it("stops on a writer it cannot map, by name, and sends nothing", async () => {
		const file = laptopFile(fresh("home"), (db) =>
			rulesAppend(db, 90, "tracker/ticket/1/inbox", "any", {
				kind: "commented",
				writer: "user:github:8",
				data: {type: "commented", body: "Not alice."},
			}),
		);
		const db = server();
		const stopped = await run(
			Effect.flatMap(readLaptop(file), (rows) => copyInto(rows)).pipe(
				Effect.provide(target(db)),
				Effect.flip,
			),
		);
		expect(stopped).toMatchObject({_tag: "MoveStopped"});
		expect(String((stopped as MoveStopped).why)).toContain("user:github:8");
		expect(moveProgress(db)).toMatchObject({state: {kind: "fresh"}, count: 0});
	});

	it("refuses while the home's host runs, by its socket or its start lock", async () => {
		const home = fresh("h");
		const file = laptopFile(home);
		const to = "http://127.0.0.1:9/acme";
		const o = {home, from: file, to, login: "alice", key: join(home, "no-key")};
		const paths = await run(pathsOf(home));
		mkdirSync(paths.dir, {recursive: true});
		const bySocket = await run(
			Effect.gen(function* () {
				yield* NodeSocketServer.make({path: paths.sock});
				return yield* move(o).pipe(Effect.flip);
			}),
		);
		expect(bySocket).toMatchObject({_tag: "MoveStopped"});
		expect(String((bySocket as MoveStopped).why)).toContain("a host answers");
		rmSync(paths.sock, {force: true});
		writeFileSync(paths.lock, `${process.pid}\n`);
		const byLock = await run(move(o).pipe(Effect.flip));
		expect(String((byLock as MoveStopped).why)).toContain(`a host is starting, pid ${process.pid}`);
	});

	it("stops on a file whose -wal still holds writes: its rows are not all in the file", async () => {
		const home = fresh("home");
		const file = laptopFile(home);
		writeFileSync(`${file}-wal`, "not folded in yet");
		const stopped = await run(dryRun({home, from: file, founder: FOUNDER}).pipe(Effect.flip));
		expect(String((stopped as MoveStopped).why)).toContain("-wal holds writes");
	});

	it("a dry run prints the plan and the move's hash, and writes nothing anywhere", async () => {
		const home = fresh("home");
		const file = laptopFile(home);
		const before = fileHash(home);
		const r = await run(dryRun({home, from: file, founder: FOUNDER}));
		expect(r.plan.events).toHaveLength(12);
		expect(r.plan.streams).toBe(6);
		expect(r.plan.writers).toEqual([
			{from: "user:owner", to: "user:github:7", events: 9},
			{from: "agent:x", to: "agent:x for:github:7", events: 3},
		]);
		expect(Option.isNone(r.running)).toBe(true);
		expect(fileHash(home)).toBe(before);
		expect(readdirSync(home)).not.toContain(CONNECTION_FILE);
		// The hash the dry run printed is the one the seal checks.
		const db = server();
		const done = await run(
			Effect.flatMap(readLaptop(file), (rows) => copyInto(rows)).pipe(Effect.provide(target(db))),
		);
		expect(done.hash).toBe(r.hash);
		expect(fileHash(home)).toBe(before);
	});
});
