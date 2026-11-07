// p68 and p92 (docs/plan/tier-1-detail.md, "Properties"; P6's plan writes them out), for
// `data/log.ts` and the referee's first step: every entry has every field, a writer can leave none
// out and set none of the referee's, and an entry keeps its `cause` as text. Written before the
// modules (Tier 1, P6, ticket 233).
//
// The shape these tests hold the modules to:
// - `Line` is what a writer hands in: `by`, `for`, `sentAt`, `seen`, `cause`, `build`, `_tag` and
//   `body`, every key required. `Entry` is a line plus `id`, `stream`, `pos`, `rev` and `arrivedAt`.
// - `Referee.append(stream, id, line: unknown)` decodes the line with excess keys refused. A missing
//   key, a wrong type, an empty `by`, `for`, `build` or `_tag`, or a key `Line` does not have is
//   `{_tag: "refused", why: "bad_line"}`; a `cause` that is not a `CauseText` is `bad_cause`.
//   Either way nothing is written.
// - `InputId` is a type only: nothing `./data` exports gives one.
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {afterAll, describe, expect, expectTypeOf, it} from "@effect/vitest";
import {Effect, Layer, Schema, Stream} from "effect";
import * as fc from "fast-check";
import * as data from "./index.ts";
import {Doorbell, Ledger} from "./ledger.ts";
import {CauseText, type Entry, type InputId, type Line} from "./log.ts";
import {Referee, type Sql} from "./referee.ts";
import {nodeSql} from "./sqlite.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const READER = "gateway:t1";

// The one place the input id's text form lives. Every cause below, good or bad, is built from it,
// so a new form (for example a TypeID) is a change to these two lines.
const CAUSE = /^in-[0-9a-f]{8}-[1-9][0-9]*$/;
const causes = (count: number): ReadonlyArray<string> =>
	fc.sample(fc.stringMatching(CAUSE), {seed: SEED, numRuns: count});
const [goodCause = "", otherCause = ""] = causes(2);

/** Texts one slip away from a good cause: none of them may pass. */
const badCauses = (good: string): ReadonlyArray<string> => [
	"",
	good.toUpperCase(),
	`${good} `,
	` ${good}`,
	`x${good}`,
	`${good}\n`,
	good.slice(0, 4) + good.slice(5),
	good.replace(/-/g, "_"),
];

// Every ledger is a fresh node:sqlite file in one temp folder, removed after.
const folder = mkdtempSync(join(tmpdir(), "p6-log-"));
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
const onReferee = (sql: Sql) => Referee.layer(sql).pipe(Layer.provide(quiet));
const onLedger = (sql: Sql) => Ledger.sql(sql, {reader: READER}).pipe(Layer.provide(quiet));

const full: Line = {
	by: "SHA256:writer-a",
	for: "owner",
	sentAt: "2026-11-07T21:10:01.204Z",
	seen: 0,
	cause: null,
	build: "b-7c1d073",
	_tag: "saved",
	body: {note: "n-7f3a", base: 3},
};
/** The same line as plain JSON, the way it comes in across an object call. */
const json = (): Record<string, unknown> => JSON.parse(JSON.stringify(full));
const without = (key: string): Record<string, unknown> =>
	Object.fromEntries(Object.entries(json()).filter(([k]) => k !== key));

const KEYS = ["by", "for", "sentAt", "seen", "cause", "build", "_tag", "body"] as const;
const ENTRY_KEYS = [...KEYS, "id", "stream", "pos", "rev", "arrivedAt"].sort();

const refused = (why: string) => ({_tag: "refused", why});

/** Hands each line to the referee in turn, then answers what each got and what the stream holds. */
const handIn = (lines: ReadonlyArray<unknown>) =>
	Effect.gen(function* () {
		const referee = yield* Referee;
		const answers = yield* Effect.forEach(
			lines,
			(line, i) => referee.append("notes:1", `w-${i + 1}`, line),
			{concurrency: 1},
		);
		const entries = yield* referee.read("notes:1", 0, READER);
		return {answers, entries};
	});

describe("p92, every entry has every field: the type", () => {
	it("a Line with any one key left out does not compile", () => {
		const {by: _by, ...noBy} = full;
		const {for: _for, ...noFor} = full;
		const {sentAt: _sentAt, ...noSentAt} = full;
		const {seen: _seen, ...noSeen} = full;
		const {cause: _cause, ...noCause} = full;
		const {build: _build, ...noBuild} = full;
		const {_tag: _t, ...noTag} = full;
		const {body: _body, ...noBody} = full;
		// @ts-expect-error `by` is required
		const a: Line = noBy;
		// @ts-expect-error `for` is required
		const b: Line = noFor;
		// @ts-expect-error `sentAt` is required
		const c: Line = noSentAt;
		// @ts-expect-error `seen` is required
		const d: Line = noSeen;
		// @ts-expect-error `cause` is required, even though its value may be null
		const e: Line = noCause;
		// @ts-expect-error `build` is required
		const f: Line = noBuild;
		// @ts-expect-error `_tag` is required
		const g: Line = noTag;
		// @ts-expect-error `body` is required
		const h: Line = noBody;
		expect([a, b, c, d, e, f, g, h].map((line) => Object.keys(line).length)).toEqual(
			KEYS.map(() => KEYS.length - 1),
		);
	});

	it("a Line may not name what the referee sets", () => {
		// @ts-expect-error `arrivedAt` is the referee's
		const a: Line = {...full, arrivedAt: 5};
		// @ts-expect-error `rev` is the referee's
		const b: Line = {...full, rev: 5};
		// @ts-expect-error `pos` is the referee's
		const c: Line = {...full, pos: 5};
		expect([a, b, c].length).toBe(3);
	});

	it("an entry's cause is text or null, and nothing ./data exports gives an InputId", () => {
		expectTypeOf<(typeof Entry.Type)["cause"]>().toEqualTypeOf<string | null>();
		expectTypeOf<Line["cause"]>().toEqualTypeOf<string | null>();
		expectTypeOf<typeof CauseText.Type>().toEqualTypeOf<string>();
		// Each export, as a function's answer or a schema's decoded type: none of them is an InputId.
		type Gives<T> = T extends (...args: never) => infer R
			? R
			: T extends {readonly Type: infer A}
				? A
				: never;
		type MakesInputId = {
			[K in keyof typeof data]: [Extract<Gives<(typeof data)[K]>, InputId>] extends [never]
				? never
				: K;
		}[keyof typeof data];
		expectTypeOf<MakesInputId>().toEqualTypeOf<never>();
		expect(Object.keys(data).length).toBeGreaterThan(0);
	});
});

describe("p92, every entry has every field: at the referee", () => {
	it.effect.each(KEYS)("a line missing `%s` is refused bad_line, and nothing is written", (key) =>
		Effect.gen(function* () {
			const {answers, entries} = yield* handIn([without(key), json()]);
			expect(answers).toEqual([refused("bad_line"), {_tag: "placed", rev: 1, pos: 1}]);
			expect(entries.map((entry) => entry.id)).toEqual(["w-2"]);
		}).pipe(Effect.provide(onReferee(fresh()))),
	);

	it.effect.each(["by", "for", "build", "_tag"])(
		"a line with an empty `%s` is refused bad_line",
		(key) =>
			Effect.gen(function* () {
				const {answers, entries} = yield* handIn([{...json(), [key]: ""}]);
				expect(answers).toEqual([refused("bad_line")]);
				expect(entries).toEqual([]);
			}).pipe(Effect.provide(onReferee(fresh()))),
	);

	it.effect.each(["arrivedAt", "rev", "pos", "id", "stream", "color"])(
		"a line that names `%s` is refused bad_line: a writer sets nothing the referee sets",
		(key) =>
			Effect.gen(function* () {
				const {answers, entries} = yield* handIn([{...json(), [key]: 7}, json()]);
				expect(answers).toEqual([refused("bad_line"), {_tag: "placed", rev: 1, pos: 1}]);
				expect(entries.map((entry) => [entry.id, entry.rev, entry.pos])).toEqual([["w-2", 1, 1]]);
			}).pipe(Effect.provide(onReferee(fresh()))),
	);

	it.effect("a line with a wrong type is refused bad_line", () =>
		Effect.gen(function* () {
			const wrong = [
				{...json(), seen: "0"},
				{...json(), seen: -1},
				{...json(), seen: 0.5},
				{...json(), by: 7},
				{...json(), sentAt: 1762549801311},
				{...json(), _tag: null},
				null,
				"a line",
				[json()],
			];
			const {answers, entries} = yield* handIn(wrong);
			expect(answers).toEqual(wrong.map(() => refused("bad_line")));
			expect(entries).toEqual([]);
		}).pipe(Effect.provide(onReferee(fresh()))),
	);

	it.effect(
		"every entry read back has all its fields, and rev, pos and arrivedAt are the referee's",
		() =>
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				yield* ledger.append("notes:1", "w-1", full);
				yield* ledger.append("notes:2", "w-2", {...full, cause: goodCause});
				yield* ledger.append("notes:1", "w-3", {...full, seen: 2});
				const entries = yield* Stream.runCollect(ledger.read("notes:1", 0));
				expect(entries.map((entry) => Object.keys(entry).sort())).toEqual([ENTRY_KEYS, ENTRY_KEYS]);
				expect(entries.map((entry) => [entry.id, entry.stream, entry.rev, entry.pos])).toEqual([
					["w-1", "notes:1", 1, 1],
					["w-3", "notes:1", 3, 2],
				]);
				expect(entries.map((entry) => typeof entry.arrivedAt)).toEqual(["number", "number"]);
				expect(entries[1]).toMatchObject({...full, seen: 2});
			}).pipe(Effect.provide(onLedger(fresh()))),
	);

	it.effect(
		"a line whose row would pass 2,000,000 bytes is refused too_big, as workerd would",
		() =>
			Effect.gen(function* () {
				const big = "x".repeat(2_000_001);
				const near = "x".repeat(1_900_000);
				const {answers, entries} = yield* handIn([
					{...json(), body: {note: big}},
					{...json(), body: {note: near}},
				]);
				expect(answers).toEqual([refused("too_big"), {_tag: "placed", rev: 1, pos: 1}]);
				expect(entries.map((entry) => entry.id)).toEqual(["w-2"]);
			}).pipe(Effect.provide(onReferee(fresh()))),
	);

	it.effect("sentAt never decides: any text the writer sent is placed and read back as sent", () =>
		Effect.gen(function* () {
			const sent = ["", "yesterday, around nine", "2099-01-01T00:00:00Z", "1970-01-01T00:00:00Z"];
			const {answers, entries} = yield* handIn(sent.map((sentAt) => ({...json(), sentAt})));
			expect(answers.map((answer) => answer._tag)).toEqual(sent.map(() => "placed"));
			expect(entries.map((entry) => entry.sentAt)).toEqual(sent);
		}).pipe(Effect.provide(onReferee(fresh()))),
	);
});

describe("p68, an entry keeps its cause", () => {
	it("CauseText takes the input id's text form and nothing one slip away", () => {
		const is = Schema.is(CauseText);
		expect(causes(50).every(is)).toBe(true);
		expect(badCauses(goodCause).filter(is)).toEqual([]);
	});

	it.effect("a cause, or null for an own write, is read back the same", () =>
		Effect.gen(function* () {
			const ledger = yield* Ledger;
			yield* ledger.append("notes:1", "w-1", {...full, cause: goodCause});
			yield* ledger.append("notes:1", "w-2", {...full, cause: null});
			yield* ledger.append("notes:1", "w-3", {...full, cause: otherCause});
			const entries = yield* Stream.runCollect(ledger.read("notes:1", 0));
			expect(entries.map((entry) => entry.cause)).toEqual([goodCause, null, otherCause]);
		}).pipe(Effect.provide(onLedger(fresh()))),
	);

	it.effect(
		"a cause one slip away from the form is refused bad_cause, and nothing is written",
		() =>
			Effect.gen(function* () {
				const bad = badCauses(goodCause);
				const {answers, entries} = yield* handIn([
					...bad.map((cause) => ({...json(), cause})),
					{...json(), cause: goodCause},
				]);
				expect(answers).toEqual([
					...bad.map(() => refused("bad_cause")),
					{_tag: "placed", rev: 1, pos: 1},
				]);
				expect(entries.map((entry) => entry.cause)).toEqual([goodCause]);
			}).pipe(Effect.provide(onReferee(fresh()))),
	);

	it("for any text, the referee places it as a cause exactly when it has the form (fast-check)", async () => {
		const text = fc.oneof(fc.stringMatching(CAUSE), fc.string(), fc.string({unit: "binary"}));
		await fc.assert(
			fc.asyncProperty(fc.array(text, {minLength: 1, maxLength: 8}), (texts) =>
				Effect.runPromise(
					Effect.gen(function* () {
						const {answers, entries} = yield* handIn(texts.map((cause) => ({...json(), cause})));
						expect(answers.map((answer) => answer._tag === "placed")).toEqual(
							texts.map((cause) => CAUSE.test(cause)),
						);
						expect(answers.filter((answer) => answer._tag === "refused")).toEqual(
							texts.filter((cause) => !CAUSE.test(cause)).map(() => refused("bad_cause")),
						);
						expect(entries.map((entry) => entry.cause)).toEqual(
							texts.filter((cause) => CAUSE.test(cause)),
						);
					}).pipe(Effect.provide(onReferee(fresh()))),
				),
			),
			{seed: SEED, numRuns: 40},
		);
	});
});
