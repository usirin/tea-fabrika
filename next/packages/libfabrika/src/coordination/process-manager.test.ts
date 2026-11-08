// p21's start half (the coordination suite; P9's plan restates it for P6's `append`), for
// `coordination/process-manager.ts`: a process's start records which build it ran, once per build,
// and `CoordinationLayer` gives the Mailbox and the ProcessManager over one Ledger. Written before
// the module (Tier 1, P9, ticket 236). In `next/`, a program's start is a process; "run" is an agent
// run only.
//
// The shape these tests hold the module to, from the plan's "The shape":
// - `ProcessManager.start(pid, {program, hash}, from)` appends one `{_tag: "started", body:
//   {program, hash}}` line to the stream `<pid>`, under the id `hash`, with `from`'s fields, and
//   answers P6's `Appended` as it is. The same build started again with the same `by`, `for` and
//   `cause` gets the first placing back (P6's resend); started again by another input it is
//   `{_tag: "refused", why: "id_reused"}`. Either way there is one line per build.
// - `CoordinationLayer: Layer<Mailbox | ProcessManager, never, Ledger>`. No Layer fails at build.
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {afterAll, describe, expect, it} from "@effect/vitest";
import {Effect, Layer, Stream} from "effect";
import {Doorbell, Ledger, LedgerError} from "../data/ledger.ts";
import type {Sql} from "../data/referee.ts";
import {nodeSql} from "../data/sqlite.ts";
import {type From, Mailbox} from "./mailbox.ts";
import {CoordinationLayer, ProcessManager} from "./process-manager.ts";

const READER = "gateway:t1";
// The one place an input id's text form lives here; P6's `CauseText` reads `in-<8 hex>-<n>` today.
const CAUSE = "in-3f9a0c21-41";
const LATER = "in-3f9a0c21-42";
const P = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const SENT = "2026-11-07T21:10:01.204Z";
const NOTES = {program: "notes", hash: "sha256-7c1d073e"} as const;

// Every ledger is a fresh node:sqlite file in one temp folder, removed after.
const folder = mkdtempSync(join(tmpdir(), "p9-processes-"));
const opened: Array<DatabaseSync> = [];
let files = 0;
const fresh = (): Sql => {
	const db = new DatabaseSync(join(folder, `ledger-${++files}.db`));
	opened.push(db);
	return nodeSql(db);
};
afterAll(() => {
	for (const db of opened.splice(0)) if (db.isOpen) db.close();
	rmSync(folder, {recursive: true, force: true});
});

const quiet = Layer.succeed(Doorbell, {ring: () => Effect.void});
const onSql = (sql: Sql) => Ledger.sql(sql, {reader: READER}).pipe(Layer.provide(quiet));
const processes = () => ProcessManager.layer.pipe(Layer.provideMerge(onSql(fresh())));

const from = (over: Partial<From> = {}): From => ({
	by: "SHA256:brain",
	for: P,
	sentAt: SENT,
	seen: 0,
	cause: CAUSE,
	build: "b-7c1d073",
	...over,
});
const start = (
	pid: string,
	code: {readonly program: string; readonly hash: string},
	over: Partial<From> = {},
) => ProcessManager.use((manager) => manager.start(pid, code, from(over)));
const lines = (stream: string) => Ledger.use((ledger) => Stream.runCollect(ledger.read(stream, 0)));

describe("p21, a process's start", () => {
	it.effect(
		"writes one started line on the pid's stream, under the build hash, with the writer's fields",
		() =>
			Effect.gen(function* () {
				expect(yield* start("notes:1", NOTES)).toEqual({_tag: "placed", rev: 1, pos: 1});
				const [line, ...rest] = yield* lines("notes:1");
				expect(rest).toEqual([]);
				expect(line).toMatchObject({
					id: NOTES.hash,
					stream: "notes:1",
					_tag: "started",
					body: {program: "notes", hash: NOTES.hash},
					by: "SHA256:brain",
					for: P,
					sentAt: SENT,
					cause: CAUSE,
					build: "b-7c1d073",
				});
			}).pipe(Effect.provide(processes())),
	);

	it.effect("plant, a new id on each start: the same build twice is one line", () =>
		Effect.gen(function* () {
			const first = yield* start("notes:1", NOTES);
			expect(yield* start("notes:1", NOTES, {sentAt: "later"})).toEqual(first);
			expect(yield* start("notes:1", NOTES, {cause: LATER})).toEqual({
				_tag: "refused",
				why: "id_reused",
			});
			expect(yield* start("notes:1", NOTES, {cause: null})).toEqual({
				_tag: "refused",
				why: "id_reused",
			});
			expect((yield* lines("notes:1")).map((l) => l.id)).toEqual([NOTES.hash]);
		}).pipe(Effect.provide(processes())),
	);

	it.effect("a new build is a new line, and each pid is its own stream", () =>
		Effect.gen(function* () {
			yield* start("notes:1", NOTES);
			expect(
				yield* start("notes:1", {program: "notes", hash: "sha256-9e2b4410"}, {seen: 1}),
			).toEqual({
				_tag: "placed",
				rev: 2,
				pos: 2,
			});
			expect(yield* start("notes:2", NOTES, {seen: 2})).toEqual({_tag: "placed", rev: 3, pos: 1});
			expect((yield* lines("notes:1")).map((l) => l.body)).toEqual([
				{program: "notes", hash: NOTES.hash},
				{program: "notes", hash: "sha256-9e2b4410"},
			]);
			expect((yield* lines("notes:2")).length).toBe(1);
		}).pipe(Effect.provide(processes())),
	);

	it.effect("passes the ledger's refusals up as they are", () =>
		Effect.gen(function* () {
			expect(yield* start("notes:1", NOTES, {seen: 5})).toEqual({
				_tag: "refused",
				why: "seen_ahead",
			});
			expect(yield* lines("notes:1")).toEqual([]);
		}).pipe(Effect.provide(processes())),
	);
});

describe("p21, CoordinationLayer", () => {
	it.effect("gives the Mailbox and the ProcessManager over one Ledger", () =>
		Effect.gen(function* () {
			const mailbox = yield* Mailbox;
			const manager = yield* ProcessManager;
			expect(yield* manager.start("notes:1", NOTES, from())).toEqual({
				_tag: "placed",
				rev: 1,
				pos: 1,
			});
			expect(yield* mailbox.send("notes:1", "letter_a", {type: "save"}, from({seen: 1}))).toEqual({
				_tag: "placed",
				rev: 2,
				pos: 1,
			});
			const letters = yield* Stream.runCollect(mailbox.receive("notes:1", 0));
			expect(letters.map((l) => l.id)).toEqual(["letter_a"]);
		}).pipe(Effect.provide(CoordinationLayer.pipe(Layer.provide(onSql(fresh()))))),
	);

	it.effect(
		"no Layer fails at build: over a Ledger that always fails, each call fails instead",
		() => {
			const broken = Layer.succeed(Ledger, {
				append: () => Effect.fail(new LedgerError({why: "storage"})),
				read: () => Stream.fail(new LedgerError({why: "storage"})),
				wait: () => Effect.fail(new LedgerError({why: "storage"})),
			});
			return Effect.gen(function* () {
				const manager = yield* ProcessManager;
				const mailbox = yield* Mailbox;
				expect((yield* Effect.flip(manager.start("notes:1", NOTES, from()))).why).toBe("storage");
				expect((yield* Effect.flip(mailbox.send("notes:1", "letter_a", 1, from()))).why).toBe(
					"storage",
				);
			}).pipe(Effect.provide(CoordinationLayer.pipe(Layer.provide(broken))));
		},
	);

	it.effect("ProcessManager.layer alone builds over a failing Ledger too", () => {
		const broken = Layer.succeed(Ledger, {
			append: () => Effect.fail(new LedgerError({why: "unreachable"})),
			read: () => Stream.fail(new LedgerError({why: "unreachable"})),
			wait: () => Effect.fail(new LedgerError({why: "unreachable"})),
		});
		return Effect.gen(function* () {
			expect((yield* Effect.flip(start("notes:1", NOTES))).why).toBe("unreachable");
		}).pipe(Effect.provide(ProcessManager.layer.pipe(Layer.provide(broken))));
	});
});
