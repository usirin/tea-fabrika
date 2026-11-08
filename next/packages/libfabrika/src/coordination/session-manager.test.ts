// Question 16: the saved input owns signing rules. Internal record/delivered/end are used by the
// door and P33; only signer crosses the trusted runner RPC. SignRequest supplies its stable id.
// Plants: last sender wins; any process borrows a parent; person comment can approve; a Map
// forgets spends; receipt saved after spending; a cached receipt survives revocation.
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {afterAll, describe, expect, it} from "@effect/vitest";
import {Brand, Effect} from "effect";
import {type InputId} from "../data/log.ts";
import {type Sql} from "../data/referee.ts";
import {nodeSql} from "../data/sqlite.ts";
import * as C from "./index.ts";

const OTHER_PROCESS = "process_01m6v5270hetdrt4r8h9vvjwjt";
const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const PROCESS = "process_01m6v5270hetdrt4r8h9vvjwjs";
const SPAN = "00f067aa0ba902b7";
const START = "process_01m6v5270hetdrt4r8h9vvjwjr";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

const folder = mkdtempSync(join(tmpdir(), "p10-session-"));
const opened: Array<DatabaseSync> = [];
let count = 0;
const database = (file = join(folder, `${++count}.db`)) => {
	const db = new DatabaseSync(file);
	opened.push(db);
	return {db, sql: nodeSql(db), file};
};
afterAll(() => {
	for (const db of opened) if (db.isOpen) db.close();
	rmSync(folder, {recursive: true, force: true});
});
const inputId = Brand.nominal<InputId>(); // Test plays the trusted door, never a public decoder.
const parent = inputId(`in-${START}-1`);
const policy = {
	input: (name: string) => name === "approve",
	fact: (name: string) => name === "answered",
};
const writer = (as: "person" | "agent") =>
	C.Writer.cases[as].make({
		key: as === "person" ? "SHA256:person-window" : "SHA256:agent",
		for: PERSON,
	});
const saved = (as: "person" | "agent" = "person", personOnly: boolean = true) => ({
	id: parent,
	by: writer(as),
	client: as,
	process: PROCESS,
	name: personOnly ? "approve" : "comment",
	personOnly,
	digest: "SHA256:payload",
	traceId: TRACE,
	span: {traceId: TRACE, spanId: SPAN},
	arrivedAt: 100,
});
const authority = (sql: Sql, live: () => boolean = () => true) =>
	C.SessionManager.layer(
		sql,
		(key: string) =>
			live()
				? Effect.succeed(writer(key === "agent" ? "agent" : "person"))
				: Effect.fail(new C.NotGranted({})),
		policy,
	);
const signer = (
	id: string = "write-a",
	kind: string = "answered",
	process = PROCESS,
	p: string = parent,
) =>
	C.SessionManager.use((s) => s.signer(p, process, kind)).pipe(
		Effect.provideService(C.SignRequest, {id}),
	);
const snapshot = (db: DatabaseSync) =>
	JSON.stringify(
		db
			.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
			.all()
			.map(({name}) => [
				name,
				db
					.prepare(`SELECT * FROM "${String(name)}"`)
					.all()
					.map((row) => JSON.stringify(row))
					.sort(),
			]),
	);

// A synchronous Sql fault after the writes, before commit. nodeSql must roll it all back.
const commitFault = (inner: Sql) => {
	let armed = false;
	const sql: Sql = {
		...inner,
		transaction: (step) =>
			inner.transaction(() => {
				const answer = step();
				if (armed) {
					armed = false;
					throw new Error("SQLITE_FULL");
				}
				return answer;
			}),
	};
	return {
		sql,
		arm: () => {
			armed = true;
		},
	};
};

describe("P10 saved signing authority", () => {
	it.effect("question 16: interleaved writers keep the direct parent's identity and span", () =>
		Effect.gen(function* () {
			const {sql} = database();
			yield* Effect.gen(function* () {
				const s = yield* C.SessionManager;
				yield* s.record(saved());
				yield* s.delivered(parent, PROCESS);
				const agent = {...saved("agent"), id: inputId(`in-${START}-2`)};
				yield* s.record(agent);
				yield* s.delivered(agent.id, PROCESS);
				const session = yield* signer();
				expect(session).toEqual({
					by: writer("person"),
					parent,
					traceId: TRACE,
					span: {traceId: TRACE, spanId: SPAN},
				});
				const agentSession = yield* signer("agent-write", "saved", PROCESS, agent.id);
				expect(agentSession.by).toEqual(writer("agent"));
				expect(agentSession.traceId).toBe(session.traceId);
			}).pipe(Effect.provide(authority(sql)));
		}),
	);
	for (const why of ["not_delivered", "spent", "person_only", "ended"] as const)
		it.effect(`question 16: ${why} is distinct and changes no saved rows`, () =>
			Effect.gen(function* () {
				const {sql, db} = database();
				yield* Effect.gen(function* () {
					const s = yield* C.SessionManager;
					yield* s.record(saved("person", why !== "person_only"));
					if (why !== "not_delivered") yield* s.delivered(parent, PROCESS);
					if (why === "spent") yield* signer();
					if (why === "ended") yield* s.end(PROCESS);
					const before = snapshot(db);
					const error = yield* Effect.flip(signer("write-b"));
					expect(error).toMatchObject({_tag: "SigningRefused", why});
					expect(snapshot(db)).toBe(before);
				}).pipe(Effect.provide(authority(sql)));
			}),
		);
	it.effect("question 16: a parent delivered to one process is refused to another", () =>
		Effect.gen(function* () {
			const {sql} = database();
			yield* Effect.gen(function* () {
				const s = yield* C.SessionManager;
				yield* s.record(saved());
				yield* s.delivered(parent, PROCESS);
				expect(yield* Effect.flip(signer("write-a", "answered", OTHER_PROCESS))).toMatchObject({
					why: "not_delivered",
				});
			}).pipe(Effect.provide(authority(sql)));
		}),
	);
	it.effect("question 16: an agent on a person-only input still cannot approve", () =>
		Effect.gen(function* () {
			const {sql} = database();
			yield* Effect.gen(function* () {
				const s = yield* C.SessionManager;
				yield* s.record(saved("agent", true));
				yield* s.delivered(parent, PROCESS);
				expect(yield* Effect.flip(signer())).toMatchObject({why: "person_only"});
			}).pipe(Effect.provide(authority(sql)));
		}),
	);
	it.effect("question 16: different allowed kinds can spend the same parent independently", () =>
		Effect.gen(function* () {
			const {sql} = database();
			yield* Effect.gen(function* () {
				const s = yield* C.SessionManager;
				yield* s.record(saved());
				yield* s.delivered(parent, PROCESS);
				expect((yield* signer("a", "saved")).by).toEqual(writer("person"));
				expect((yield* signer("b", "commented")).by).toEqual(writer("person"));
			}).pipe(Effect.provide(authority(sql)));
		}),
	);
	it.effect("retry/wake: a lost answer returns the identical receipt after reopening SQLite", () =>
		Effect.gen(function* () {
			const first = database();
			const session = yield* Effect.gen(function* () {
				const s = yield* C.SessionManager;
				yield* s.record(saved());
				yield* s.delivered(parent, PROCESS);
				return yield* signer();
			}).pipe(Effect.provide(authority(first.sql)));
			first.db.close();
			const reopened = database(first.file);
			yield* Effect.gen(function* () {
				expect(yield* signer()).toEqual(session);
				expect(yield* Effect.flip(signer("other-write"))).toMatchObject({why: "spent"});
			}).pipe(Effect.provide(authority(reopened.sql)));
		}),
	);
	it.effect("atomic receipt: a storage failure rolls back both spend and receipt", () =>
		Effect.gen(function* () {
			const {sql} = database();
			const failure = commitFault(sql);
			yield* Effect.gen(function* () {
				const s = yield* C.SessionManager;
				yield* s.record(saved());
				yield* s.delivered(parent, PROCESS);
				failure.arm();
				expect((yield* Effect.flip(signer()))._tag).toBe("LedgerError");
				const retry = yield* signer();
				expect(retry.parent).toBe(parent);
				expect(yield* Effect.flip(signer("other-write"))).toMatchObject({why: "spent"});
			}).pipe(Effect.provide(authority(failure.sql)));
		}),
	);
	it.effect(
		"exit/wake: an ended process cannot revive through layer rebuild or an old receipt",
		() =>
			Effect.gen(function* () {
				const first = database();
				yield* Effect.gen(function* () {
					const s = yield* C.SessionManager;
					yield* s.record(saved());
					yield* s.delivered(parent, PROCESS);
					yield* signer();
					yield* s.end(PROCESS);
				}).pipe(Effect.provide(authority(first.sql)));
				first.db.close();
				const reopened = database(first.file);
				expect(
					yield* Effect.flip(signer()).pipe(Effect.provide(authority(reopened.sql))),
				).toMatchObject({why: "ended"});
			}),
	);
	it.effect("revocation: even the same write id must recheck live membership", () =>
		Effect.gen(function* () {
			const {sql} = database();
			let live = true;
			yield* Effect.gen(function* () {
				const s = yield* C.SessionManager;
				yield* s.record(saved());
				yield* s.delivered(parent, PROCESS);
				yield* signer();
				live = false;
				expect((yield* Effect.flip(signer()))._tag).toBe("NotGranted");
			}).pipe(Effect.provide(authority(sql, () => live)));
		}),
	);
	it.effect("traceId cannot choose a writer or authorize a missing parent", () =>
		Effect.gen(function* () {
			const {sql} = database();
			yield* Effect.gen(function* () {
				const s = yield* C.SessionManager;
				yield* s.record(saved());
				yield* s.delivered(parent, PROCESS);
				expect(yield* Effect.flip(signer("a", "saved", PROCESS, `in-${START}-999`))).toMatchObject({
					why: "not_delivered",
				});
			}).pipe(Effect.provide(authority(sql)));
		}),
	);
});
