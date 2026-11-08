import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Ledger, type Row, streams} from "@kampus/fabrika-old";
import {memoryService} from "@kampus/fabrika-old/memory";
import {layerSqliteSync} from "@kampus/fabrika-old/sqlite";
import {blindDraw, sealAsk} from "@kampus/pipeline/tickets/ask";
import {nameOf, readRow, fold} from "@kampus/pipeline/tickets/ticket";
import {Clock, Effect, Layer, Schema} from "effect";
import {afterEach, describe, expect, it} from "vitest";
import {
	AGENT,
	DRAFT,
	FILED,
	HEAD,
	NOW,
	OTHER_HEAD,
	OWNER,
	TOOK,
	policyFor,
	type Sealed,
} from "../../../fixtures/ask-desk/cases.ts";
import {Author, saveCell} from "./ledger.ts";
import {save} from "./machine.ts";
import {Write} from "./ticket.ts";

const seal: (draft: unknown, policy?: {seed: number}) => Effect.Effect<Sealed, unknown> = sealAsk;
const INBOX = streams(nameOf(117)).inbox;
const send = (
	id: string,
	fact: {readonly type: string; readonly [key: string]: unknown},
	writer = "agent:lane for:owner",
) =>
	Effect.gen(function* () {
		return yield* (yield* Ledger).send(INBOX, id, {kind: fact.type, writer, data: fact});
	});
const seed = (draft: unknown = DRAFT) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		yield* ledger.register(nameOf(117), "user:owner");
		yield* send("filed", FILED, "user:owner");
		yield* send("plan/2", {type: "planned", version: 2, tasks: []});
		const ask = yield* seal(draft, policyFor(DRAFT.ask, false, blindDraw));
		yield* send(ask.ask, ask);
		return ask;
	});
const answer = (ask: Sealed, id: string, changes: Record<string, unknown> = {}) =>
	saveCell(
		save({
			id,
			next: 118,
			write: Schema.decodeUnknownSync(Write)({
				kind: "answer",
				ticket: 117,
				ask: ask.ask,
				answer: {_tag: "rec"},
				saw: ask.saw,
				via: {_tag: "window", took: TOOK},
				...changes,
			}),
		}),
	);
const rows = Effect.gen(function* () {
	return yield* (yield* Ledger).readStream(INBOX);
});
const answers = (all: readonly Row[]) => all.filter((row) => row.kind === "answered");
const scratch: string[] = [];
afterEach(() => {
	for (const path of scratch.splice(0)) rmSync(path, {recursive: true, force: true});
});
const run = <A, E>(effect: Effect.Effect<A, E, Ledger | Author>, disk = false) => {
	const dir = disk ? mkdtempSync(join(tmpdir(), "ad-")) : null;
	if (dir !== null) scratch.push(dir);
	const layer =
		dir === null
			? Layer.succeed(Ledger, memoryService())
			: layerSqliteSync({path: join(dir, "ledger.db")});
	return Effect.runPromise(
		effect.pipe(Effect.provideService(Author, OWNER), Effect.provide(layer), Effect.scoped),
	);
};

describe("ask desk P4: fresh answers, not title-and-body approvals", () => {
	it.each(["hash", "withdrawn", "plan", "pick", "expired"])(
		"replay also rejects %s",
		async (fault) => {
			await run(
				Effect.gen(function* () {
					const now = yield* Clock.currentTimeMillis;
					const ask = yield* seed(fault === "expired" ? {...DRAFT, until: now - 1} : DRAFT);
					if (fault === "withdrawn")
						yield* send("withdraw/replay", {type: "withdrawn", ask: ask.ask, why: "changed"});
					if (fault === "plan")
						yield* send("plan/replay", {type: "planned", version: 3, tasks: []});
					yield* send(
						"raw-answer",
						{
							type: "answered",
							format: 1,
							ask: ask.ask,
							answer:
								fault === "pick"
									? {_tag: "against", pick: "merge", note: "Wrong pick"}
									: {_tag: "rec"},
							saw: fault === "hash" ? `sha256:${"0".repeat(64)}` : ask.saw,
							via: {_tag: "window", took: TOOK},
						},
						"user:owner",
					);
					const entries = (yield* rows).flatMap((row) => {
						const read = readRow(row);
						return read.kind === "entry" ? [read.entry] : [];
					});
					const folded = fold([], entries);
					expect(folded.problems).not.toEqual([]);
					expect(folded.tickets[0]?.timeline.filter((e) => e.fact.type === "answered")).toEqual([]);
				}),
			);
		},
	);
	it.each([
		["wrong display hash", "hash"],
		["withdrawn ask", "withdrawn"],
		["changed plan with unchanged ticket text", "plan"],
		["expired ask", "expired"],
		["unknown ask", "unknown"],
		["unoffered pick", "pick"],
	])("refuses %s and records no answer", async (_label, fault) => {
		await run(
			Effect.gen(function* () {
				const now = yield* Clock.currentTimeMillis;
				const ask = yield* seed(fault === "expired" ? {...DRAFT, until: now - 1} : DRAFT);
				if (fault === "withdrawn")
					yield* send("withdraw/1", {type: "withdrawn", ask: ask.ask, why: "changed"});
				if (fault === "plan") yield* send("plan/3", {type: "planned", version: 3, tasks: []});
				const changes =
					fault === "hash"
						? {saw: `sha256:${"0".repeat(64)}`}
						: fault === "unknown"
							? {ask: "missing-ask"}
							: fault === "pick"
								? {answer: {_tag: "against", pick: "merge", note: "Wrong pick"}}
								: {};
				const result = yield* Effect.exit(answer(ask, "click", changes));
				expect(result).toMatchObject({_tag: "Failure"});
				expect(answers(yield* rows)).toEqual([]);
			}),
		);
	});
	it("refuses a new head even when the ticket text and offered picks have not changed", async () => {
		await run(
			Effect.gen(function* () {
				const evidence = {
					_tag: "change",
					head: HEAD,
					diff: "diff --git a/file b/file\n+one",
					checks: [],
					review: {head: HEAD, met: 1, of: 1, findings: []},
					rules: [{path: "AGENTS.md", text: "Keep the tests"}],
				};
				const ask = yield* seed({...DRAFT, for: "merge", step: "merge", evidence});
				yield* send("push/new", {
					type: "pushed",
					head: OTHER_HEAD,
					commits: [{sha: OTHER_HEAD, title: "Changed after display"}],
				});
				expect(yield* Effect.exit(answer(ask, "key"))).toMatchObject({_tag: "Failure"});
				expect(answers(yield* rows)).toEqual([]);
			}),
		);
	});
	it("rechecks after a stale append, including a withdrawal that wins that race", async () => {
		await run(
			Effect.gen(function* () {
				const ask = yield* seed();
				const ledger = yield* Ledger;
				let raced = false;
				// Only the outside race is injected. The real ledger creates the Stale failure.
				const competing: typeof ledger = {
					...ledger,
					append: (...args) =>
						Effect.gen(function* () {
							if (args[0] === INBOX && !raced) {
								raced = true;
								yield* ledger.send(INBOX, "withdraw/race", {
									kind: "withdrawn",
									writer: "agent:lane for:owner",
									data: {type: "withdrawn", ask: ask.ask, why: "changed"},
								});
							}
							return yield* ledger.append(...args);
						}),
				};
				expect(
					yield* Effect.exit(answer(ask, "raced").pipe(Effect.provideService(Ledger, competing))),
				).toMatchObject({_tag: "Failure"});
				expect(raced).toBe(true);
				expect(answers(yield* rows)).toEqual([]);
			}),
		);
	});
	it("silence, even after expiry and a far-future writer clock, writes no answer", async () => {
		await run(
			Effect.gen(function* () {
				const now = yield* Clock.currentTimeMillis;
				const ask = yield* seed({...DRAFT, until: now - 1});
				expect(
					yield* Effect.exit(
						answer(ask, "late", {via: {_tag: "window", took: {...TOOK, said: NOW - 99_000_000}}}),
					),
				).toMatchObject({_tag: "Failure"});
				expect(answers(yield* rows)).toEqual([]);
			}),
		);
	});
});

describe.each([false, true])("ask desk P5: concurrent answers, SQLite=%s", (disk) => {
	it("records one answer under answer/<ask>; retries return the first result", async () => {
		await run(
			Effect.gen(function* () {
				const ask = yield* seed();
				const results = yield* Effect.all(
					[
						answer(ask, "ticket-click"),
						answer(ask, "tracker-key", {
							answer: {_tag: "against", pick: "no", note: "Need a new plan"},
						}),
					],
					{concurrency: 2},
				);
				const recorded = answers(yield* rows);
				expect(recorded).toHaveLength(1);
				expect(recorded[0]?.id).toBe(`answer/${ask.ask}`);
				expect(results[0]).toEqual(results[1]);
				expect(yield* answer(ask, "retry")).toEqual(results[0]);
				expect(answers(yield* rows)).toHaveLength(1);
			}),
			disk,
		);
	});
});

describe("ask desk P6: a person alone answers", () => {
	it.each([undefined, true, false])(
		"refuses an agent through the shared save, needed=%s",
		async (needed) => {
			await run(
				Effect.gen(function* () {
					const ask = yield* seed();
					const tried = answer(ask, "agent", needed === undefined ? {} : {needed}).pipe(
						Effect.provideService(Author, AGENT),
					);
					expect(yield* Effect.exit(tried)).toMatchObject({_tag: "Failure"});
					expect(answers(yield* rows)).toEqual([]);
				}),
			);
		},
	);
	it("also rejects a forged agent answer during replay", async () => {
		await run(
			Effect.gen(function* () {
				const ask = yield* seed();
				yield* send("forged", {
					type: "answered",
					format: 1,
					ask: ask.ask,
					answer: {_tag: "rec"},
					saw: ask.saw,
					needed: false,
					via: {_tag: "window", took: TOOK},
				});
				const entries = (yield* rows).flatMap((row) => {
					const read = readRow(row);
					return read.kind === "entry" ? [read.entry] : [];
				});
				const folded = fold([], entries);
				expect(folded.problems).toHaveLength(1);
				expect(folded.tickets[0]?.timeline.some((e) => e.fact.type === "answered")).toBe(false);
			}),
		);
	});
});

describe("ask desk P17: the real save keeps needed", () => {
	it.each([undefined, true, false])("stores needed=%s exactly as chosen", async (needed) => {
		await run(
			Effect.gen(function* () {
				const ask = yield* seed();
				yield* answer(ask, "person", needed === undefined ? {} : {needed});
				const recorded = answers(yield* rows)[0];
				expect(recorded).toBeDefined();
				const fact: Record<string, unknown> = JSON.parse(recorded?.data ?? "null");
				expect(fact.needed).toBe(needed);
				expect(Object.hasOwn(fact, "needed")).toBe(needed !== undefined);
				expect(fact.via).toEqual({_tag: "window", took: TOOK});
			}),
		);
	});
});
