import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterAll, describe, expect, it} from "vitest";
import {MEMBERS, type Stamp} from "./door.ts";
import {
	byOf,
	hashLines,
	importChunk,
	linesOf,
	type Moved,
	migrateMove,
	moveProgress,
	moveStateOf,
	planOf,
	sealMove,
} from "./move.ts";
import * as L from "./rules.ts";
import {openDb} from "./sqlite-driver.ts";

// The import window on node:sqlite, the same file workerd runs. A ledger here is founded by
// github:7, as a shared door's first login writes it; the stamps are what the door would say.

const dir = mkdtempSync(join(tmpdir(), "move-"));
afterAll(() => rmSync(dir, {recursive: true, force: true}));

const FOUNDER = "github:7";
const alice: Stamp = {kind: "user", id: FOUNDER};
const bob: Stamp = {kind: "user", id: "github:8"};
const alicesAgent: Stamp = {kind: "agent", id: "triage", for: FOUNDER};

let n = 0;
/** A ledger as a shared door leaves it at the founder's first login: one `founded`. */
const fresh = () => {
	const {db} = openDb(join(dir, `l${n++}.sqlite`));
	migrateMove(db);
	L.writeUnguarded(db, 1, MEMBERS, "any", {
		kind: "founded",
		writer: `user:${FOUNDER}`,
		data: {id: FOUNDER, name: "alice"},
	});
	return db;
};

/** A laptop's rows: ticket 1 filed and commented on by the owner, closed by an agent. */
const laptop = () => {
	const {db} = openDb(join(dir, `laptop${n++}.sqlite`));
	L.register(db, 100, "host/h1", "h1"); // a host's own name: never moved
	L.register(db, 101, "tracker/ticket/1", "user:owner");
	const inbox = "tracker/ticket/1/inbox";
	L.append(db, 102, inbox, "any", {
		kind: "filed",
		writer: "user:owner",
		data: {type: "filed", title: "Login fails", body: ""},
		id: "w1",
	});
	L.append(db, 103, inbox, "any", {
		kind: "commented",
		writer: "agent:x",
		data: {type: "commented", body: "Seen it."},
		id: "w2",
	});
	L.append(db, 104, inbox, "any", {
		kind: "closed",
		writer: "user:owner",
		data: {type: "closed"},
		id: "w3",
	});
	return L.read(db, 0, 1000, "tracker/ticket");
};

const plan = () => planOf(laptop(), FOUNDER);
const hashOf = (p: ReturnType<typeof plan>) => hashLines(linesOf(p));
const moved = (db: L.Db) => L.read(db, 0, 1000, "tracker");

describe("the writers a move maps", () => {
	it("maps the owner and the founder's agents, and nobody else", () => {
		expect(byOf("user:owner", FOUNDER)).toEqual({kind: "founder"});
		expect(byOf("user:github:7", FOUNDER)).toEqual({kind: "founder"});
		expect(byOf("agent:x", FOUNDER)).toEqual({kind: "agent", id: "x"});
		expect(byOf("agent:x for:github:7", FOUNDER)).toEqual({kind: "agent", id: "x"});
		for (const w of ["user:github:8", "agent:x for:github:8", "ledger", "h1@user:owner", "DOWN"])
			expect(byOf(w, FOUNDER)).toBeNull();
	});

	it("plans the tracker's rows with every writer mapped, and names what it cannot map", () => {
		const p = plan();
		expect(p.streams).toBe(2);
		expect(p.events.map((e) => e.kind)).toEqual(["registered", "filed", "commented", "closed"]);
		expect(p.writers).toEqual([
			{from: "user:owner", to: "user:github:7", events: 3},
			{from: "agent:x", to: "agent:x for:github:7", events: 1},
		]);
		const odd = planOf([...laptop(), {...laptop()[1], writer: "user:github:8"}], FOUNDER);
		expect(odd.unmappable).toEqual(["user:github:8"]);
	});
});

describe("the import window", () => {
	it("is fresh, then importing, then open by the seal, keeping every row as it was", async () => {
		const db = fresh();
		const p = plan();
		expect(moveStateOf(db)).toEqual({kind: "fresh"});
		const res = importChunk(db, FOUNDER, alice, {events: p.events.slice(0, 2)});
		expect(res.ok && res.value.progress.state).toEqual({kind: "importing"});
		importChunk(db, FOUNDER, alice, {events: p.events.slice(2)});
		const sealed = await sealMove(db, FOUNDER, alice, {count: 4, hash: await hashOf(p)}, 200);
		expect(sealed.ok && sealed.value.progress.state.kind).toBe("open");
		expect(moved(db).map((r) => [r.stream, r.rev, r.writer, r.kind, r.at, r.id])).toEqual([
			["tracker/ticket/1", 1, "user:github:7", "registered", 101, null],
			["tracker/ticket/1/inbox", 1, "user:github:7", "filed", 102, "w1"],
			["tracker/ticket/1/inbox", 2, "agent:x for:github:7", "commented", 103, "w2"],
			["tracker/ticket/1/inbox", 3, "user:github:7", "closed", 104, "w3"],
		]);
		// The name is registered here too: the tracker's next ticket is 2, and its inbox takes writes.
		expect(L.register(db, 300, "tracker/ticket/1", "user:github:7")).toMatchObject({
			created: false,
		});
	});

	it("lands a chunk sent again once", () => {
		const db = fresh();
		const {events} = plan();
		importChunk(db, FOUNDER, alice, {events: events.slice(0, 3)});
		const again = importChunk(db, FOUNDER, alice, {events});
		expect(again.ok && again.value.progress).toMatchObject({count: 4, last: events[3]?.from});
		expect(moved(db)).toHaveLength(4);
	});

	it("refuses anyone but the founder, as a person", () => {
		const db = fresh();
		const {events} = plan();
		for (const who of [bob, alicesAgent])
			expect(importChunk(db, FOUNDER, who, {events})).toMatchObject({ok: false, status: 403});
		expect(importChunk(db, null, alice, {events})).toMatchObject({ok: false, status: 404});
		expect(moveStateOf(db)).toEqual({kind: "fresh"});
	});

	it("closes for good at the first invite", () => {
		const db = fresh();
		L.writeUnguarded(db, 2, MEMBERS, "any", {
			kind: "invited",
			writer: `user:${FOUNDER}`,
			data: {id: "github:8", name: "bob"},
		});
		expect(moveStateOf(db)).toEqual({kind: "open", by: "invite", hash: null});
		expect(importChunk(db, FOUNDER, alice, {events: plan().events})).toMatchObject({
			ok: false,
			status: 409,
		});
	});

	it("closes for good at the first ordinary write, in the middle of an import too", () => {
		const db = fresh();
		const {events} = plan();
		importChunk(db, FOUNDER, alice, {events: events.slice(0, 2)});
		L.register(db, 5, "host/h2", `user:${FOUNDER}`);
		expect(moveStateOf(db)).toEqual({kind: "open", by: "write", hash: null});
		expect(importChunk(db, FOUNDER, alice, {events: events.slice(2)})).toMatchObject({
			ok: false,
			status: 409,
		});
	});

	it("refuses an import after the seal; a seal sent again answers as the first", async () => {
		const db = fresh();
		const p = plan();
		importChunk(db, FOUNDER, alice, {events: p.events});
		const seal = {count: 4, hash: await hashOf(p)};
		await sealMove(db, FOUNDER, alice, seal, 200);
		expect(importChunk(db, FOUNDER, alice, {events: p.events})).toMatchObject({status: 409});
		expect(await sealMove(db, FOUNDER, alice, seal, 201)).toMatchObject({ok: true});
		expect(await sealMove(db, FOUNDER, bob, seal, 201)).toMatchObject({ok: false, status: 403});
	});

	it("refuses a seal with the wrong hash or count, and stays importing", async () => {
		const db = fresh();
		const p = plan();
		importChunk(db, FOUNDER, alice, {events: p.events.slice(0, 3)});
		const right = await hashOf(p);
		expect(await sealMove(db, FOUNDER, alice, {count: 4, hash: right}, 200)).toMatchObject({
			ok: false,
			status: 409,
		});
		expect(await sealMove(db, FOUNDER, alice, {count: 3, hash: "0".repeat(64)}, 200)).toMatchObject(
			{
				status: 409,
			},
		);
		expect(moveStateOf(db)).toEqual({kind: "importing"});
		importChunk(db, FOUNDER, alice, {events: p.events});
		expect(await sealMove(db, FOUNDER, alice, {count: 4, hash: right}, 200)).toMatchObject({
			ok: true,
		});
	});

	it("refuses rows the door must not take, and lands none of the chunk", () => {
		const db = fresh();
		const {events} = plan();
		const [reg, filed] = events as [Moved, Moved];
		const bad: [string, Moved][] = [
			["a door stream", {...filed, stream: "door/members"}],
			["an agent's answer", {...filed, kind: "answered", by: {kind: "agent", id: "x"}}],
			["a ledger word", {...filed, kind: "DOWN"}],
			["a rev that skips", {...filed, rev: 5}],
			["data that is not JSON", {...filed, data: "{"}],
			["a stream under no moved name", {...filed, stream: "tracker/other/inbox"}],
		];
		for (const [, e] of bad) {
			expect(importChunk(db, FOUNDER, alice, {events: [reg, e]}).ok).toBe(false);
			expect(moved(db)).toHaveLength(0);
		}
		// A writer the request names is not even read: the wire has no place for one.
		expect(importChunk(db, FOUNDER, alice, {events: [{...reg, writer: "user:github:8"}]}).ok).toBe(
			false,
		);
		expect(moveProgress(db)).toEqual({state: {kind: "fresh"}, last: 0, count: 0});
	});
});
