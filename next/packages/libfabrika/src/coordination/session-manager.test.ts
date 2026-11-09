// Question 16: the saved input owns signing rules. Internal record/delivered/end are used by the
// door and P33; only signer crosses the trusted runner RPC. SignRequest supplies its stable id.
// Plants: last sender wins; any process borrows a parent; person comment can approve; a Map
// forgets spends; receipt saved after spending; a cached receipt survives revocation.
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {afterAll, describe, expect, it} from "@effect/vitest";
import {Brand, Effect, Result, Schema} from "effect";
import * as fc from "fast-check";
import {type InputId} from "../data/log.ts";
import {type Sql} from "../data/referee.ts";
import {nodeSql} from "../data/sqlite.ts";
import * as C from "./index.ts";
import {signalId} from "./process.ts";

const OTHER_PROCESS = "process_01m6v5270hetdrt4r8h9vvjwjt";
const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const PROCESS = "process_01m6v5270hetdrt4r8h9vvjwjs";
const SPAN = "00f067aa0ba902b7";
const START = "process_01m6v5270hetdrt4r8h9vvjwjr";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const sample = {
	PROCESS,
	OTHER_PROCESS,
	PERSON,
	START,
	TRACE,
	SPAN,
	key: "SHA256:person-window",
	agentKey: "SHA256:agent",
	id: "write-a",
	kinds: ["saved", "commented"],
};
const processId = fc.stringMatching(/^process_[0-7][0-9a-hjkmnp-tv-z]{25}$/);
const sessionArb = fc
	.record({
		PROCESS: processId,
		OTHER_PROCESS: processId,
		START: processId,
		PERSON: fc.stringMatching(/^person_[0-7][0-9a-hjkmnp-tv-z]{25}$/),
		TRACE: fc.stringMatching(/^[1-9a-f][0-9a-f]{31}$/),
		SPAN: fc.stringMatching(/^[1-9a-f][0-9a-f]{15}$/),
		key: fc.string({minLength: 1, maxLength: 40}).map((key) => `SHA256:person-${key}`),
		agentKey: fc.string({minLength: 1, maxLength: 40}).map((key) => `SHA256:agent-${key}`),
		id: fc.stringMatching(/^write-[a-z0-9]{1,20}$/),
		kinds: fc.uniqueArray(
			fc.string({minLength: 1, maxLength: 30}).filter((kind) => kind !== "answered"),
			{minLength: 2, maxLength: 2},
		),
	})
	.filter((value) => value.PROCESS !== value.OTHER_PROCESS);

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
const setup = ({
	PROCESS,
	OTHER_PROCESS,
	PERSON,
	START,
	TRACE,
	SPAN,
	key,
	agentKey,
	id,
	kinds,
}: typeof sample) => {
	const parent = inputId(`in-${START}-1`);
	const policy = {
		input: (name: string) => name === "approve",
		fact: (name: string) => name === "answered",
	};
	const writer = (as: "person" | "agent") =>
		C.Writer.cases[as].make({
			key: as === "person" ? key : agentKey,
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
		writeId: string = id,
		kind: string = "answered",
		process = PROCESS,
		p: string = parent,
	) =>
		C.SessionManager.use((s) => s.signer(p, process, kind)).pipe(
			Effect.provideService(C.SignRequest, {id: writeId}),
		);
	return {
		PROCESS,
		OTHER_PROCESS,
		START,
		TRACE,
		SPAN,
		parent,
		writer,
		saved,
		signer,
		authority,
		kinds,
	};
};
const {parent, saved, signer, authority} = setup(sample);
const authorityProperty = (
	name: string,
	law: (context: ReturnType<typeof setup>) => Effect.Effect<void, unknown>,
) =>
	it(name, async () => {
		await fc.assert(
			fc.asyncProperty(sessionArb, (value) => Effect.runPromise(law(setup(value)))),
			{seed: 119120, numRuns: 20, examples: [[sample]]},
		);
	});
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
	it("question 16: a session without a complete parent span is not a valid receipt", () => {
		fc.assert(
			fc.property(sessionArb, (value) => {
				const {writer, parent, TRACE, SPAN} = setup(value);
				const session = {
					by: writer("person"),
					parent,
					traceId: TRACE,
					span: {traceId: TRACE, spanId: SPAN},
				};
				expect(Schema.decodeUnknownSync(C.Session)(session)).toEqual(session);
				for (const span of [{}, {traceId: TRACE}, {spanId: SPAN}])
					expect(Schema.is(C.Session)({...session, span})).toBe(false);
			}),
			{seed: 119120, examples: [[sample]]},
		);
	});
	authorityProperty(
		"question 16: interleaved writers keep the direct parent's identity and span",
		({saved, parent, signer, writer, authority, PROCESS, START, TRACE, SPAN}) =>
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
		authorityProperty(
			`question 16: ${why} is distinct and changes no saved rows`,
			({saved, parent, signer, authority, PROCESS}) =>
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
	authorityProperty(
		"question 16: a parent delivered to one process is refused to another",
		({saved, parent, signer, authority, PROCESS, OTHER_PROCESS}) =>
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
	authorityProperty(
		"question 16: an agent on a person-only input still cannot approve",
		({saved, parent, signer, authority, PROCESS}) =>
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
	authorityProperty(
		"question 16: different allowed kinds can spend the same parent independently",
		({saved, parent, signer, writer, authority, PROCESS, kinds}) =>
			Effect.gen(function* () {
				const {sql} = database();
				yield* Effect.gen(function* () {
					const s = yield* C.SessionManager;
					yield* s.record(saved());
					yield* s.delivered(parent, PROCESS);
					expect((yield* signer("a", kinds[0]!)).by).toEqual(writer("person"));
					expect((yield* signer("b", kinds[1]!)).by).toEqual(writer("person"));
				}).pipe(Effect.provide(authority(sql)));
			}),
	);
	authorityProperty(
		"retry/wake: a lost answer returns the identical receipt after reopening SQLite",
		({saved, parent, signer, authority, PROCESS}) =>
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
	authorityProperty(
		"atomic receipt: a storage failure rolls back both spend and receipt",
		({saved, parent, signer, authority, PROCESS}) =>
			Effect.gen(function* () {
				const {sql, db} = database();
				const failure = commitFault(sql);
				yield* Effect.gen(function* () {
					const s = yield* C.SessionManager;
					yield* s.record(saved());
					yield* s.delivered(parent, PROCESS);
					const before = snapshot(db);
					failure.arm();
					expect((yield* Effect.flip(signer()))._tag).toBe("LedgerError");
					expect(snapshot(db)).toBe(before);
					const retry = yield* signer();
					expect(retry.parent).toBe(parent);
					expect(yield* Effect.flip(signer("other-write"))).toMatchObject({why: "spent"});
				}).pipe(Effect.provide(authority(failure.sql)));
			}),
	);
	authorityProperty(
		"exit/wake: an ended process cannot revive through layer rebuild or an old receipt",
		({saved, parent, signer, authority, PROCESS}) =>
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
	authorityProperty(
		"revocation: even the same write id must recheck live membership",
		({saved, parent, signer, authority, PROCESS}) =>
			Effect.gen(function* () {
				const {sql} = database();
				let live = true;
				yield* Effect.gen(function* () {
					const s = yield* C.SessionManager;
					yield* s.record(saved());
					yield* s.delivered(parent, PROCESS);
					yield* signer();
					live = false;
					expect(Result.isFailure(yield* Effect.result(signer()))).toBe(true);
					expect((yield* Effect.flip(signer()))._tag).toBe("NotGranted");
				}).pipe(Effect.provide(authority(sql, () => live)));
			}),
	);
	authorityProperty(
		"traceId cannot choose a writer or authorize a missing parent",
		({saved, parent, signer, authority, PROCESS, START}) =>
			Effect.gen(function* () {
				const {sql} = database();
				yield* Effect.gen(function* () {
					const s = yield* C.SessionManager;
					yield* s.record(saved());
					yield* s.delivered(parent, PROCESS);
					expect(
						yield* Effect.flip(signer("a", "saved", PROCESS, `in-${START}-999`)),
					).toMatchObject({
						why: "not_delivered",
					});
				}).pipe(Effect.provide(authority(sql)));
			}),
	);
});

// P33 review round 3, rule 2: an id in the signal id space is the brain's alone, so the signer
// refuses it, signs nothing, saves no receipt and leaves the parent free for a real write.
describe("P33, the signer refuses every id in the signal id space", () => {
	const toW = C.Recipient.cases.process.make({process: OTHER_PROCESS});
	const ids = [
		signalId(toW, "watch:1", 1),
		signalId(C.Recipient.cases.client.make({client: "window-a", session: START}), "w", 3),
		JSON.stringify(["DOWN"]),
		' [ "DOWN" , 1 ]',
		'["DOWN", not json',
	];
	const refusedThenFree = (id: string) =>
		Effect.gen(function* () {
			const {sql, db} = database();
			yield* Effect.gen(function* () {
				const s = yield* C.SessionManager;
				yield* s.record(saved());
				yield* s.delivered(parent, PROCESS);
				const before = snapshot(db);
				expect(Result.isFailure(yield* Effect.result(signer(id)))).toBe(true);
				expect(yield* Effect.flip(signer(id))).toMatchObject({_tag: "SigningRefused"});
				expect(snapshot(db)).toBe(before);
				expect((yield* signer("write-after")).parent).toBe(parent);
			}).pipe(Effect.provide(authority(sql)));
		});
	it("for any id the signal id space holds, the signer answers SigningRefused", async () => {
		const id = fc.oneof(
			fc
				.array(fc.jsonValue({maxDepth: 2}), {maxLength: 4})
				.map((rest) => JSON.stringify(["DOWN", ...rest])),
			fc
				.tuple(
					fc.constantFrom("", " ", "\n", "\t"),
					fc.array(fc.jsonValue({maxDepth: 1}), {maxLength: 3}),
				)
				.map(([space, rest]) => `[${space}${JSON.stringify(["DOWN", ...rest]).slice(1)}`),
			fc.string({maxLength: 20}).map((tail) => `["DOWN"${tail}`),
		);
		await fc.assert(
			fc.asyncProperty(
				id.filter((value) => C.inSignalSpace(value)),
				(value) => {
					expect(C.inSignalSpace(value)).toBe(true);
					return Effect.runPromise(refusedThenFree(value));
				},
			),
			{seed: 119120, numRuns: 25, examples: ids.map((id): [string] => [id])},
		);
	});
});
