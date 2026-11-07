// p96, `write` tells the truth (P9's plan writes it out; the lead commit adds it to
// docs/plan/tier-1-detail.md, "Properties"), for `coordination/client-manager.ts`: its answer is what
// the fold does with the fact, `founded` is written once by the first call, and two Macs typing one
// sheet at once never both hear "you are in". Written before the module (Tier 1, P9, ticket 236).
//
// The shape these tests hold the module to, from the plan's "The shape" and flag 6:
// - `ClientManager.layer(founder & {person})` over a `Ledger`. Building it writes nothing. The first
//   call on an empty `door/members` writes `founded` under the fixed id `founded`, once.
// - `members` folds `door/members` with `foldMembers`.
// - `write(fact, from)` folds, refuses what the fold's rule refuses (`{_tag: "refused", why}`,
//   nothing written), else appends under the fact's own id with `seen` the folded head, folds on to
//   the new rev, and answers `{_tag: "applied", rev}` or `{_tag: "ignored", rev, why}`. A refusal by
//   the ledger itself (`id_reused`) is `refused` with the ledger's why.
// - Whys: `not_member` (a key nobody let in), `not_allowed` (a window or agent key signing),
//   `used` (a spent sheet), `replaced` (a sheet a newer one ended), `revoked` (a key that was let in
//   and then removed). The last two are this test's reading of flag 6's list.
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {afterAll, describe, expect, it} from "@effect/vitest";
import {Effect, Layer, References, Stream} from "effect";
import * as fc from "fast-check";
import {Doorbell, Ledger, LedgerError} from "../data/ledger.ts";
import type {Sql} from "../data/referee.ts";
import {nodeSql} from "../data/sqlite.ts";
import {ClientManager} from "./client-manager.ts";
import type {From} from "./mailbox.ts";
import {foldMembers, type MemberFact, type Members} from "./members.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const READER = "gateway:t1";
const MEMBERS = "door/members";
// The one place an input id's text form lives here; P6's `CauseText` reads `in-<8 hex>-<n>` today.
const CAUSE = "in-3f9a0c21-41";

const P = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const NAME = "home";
const TO = "ledger:home";
const SENT = "2026-11-07T21:10:01.204Z";
const FOUNDER = {name: NAME, keys: ["pA"], window: "wA", person: P} as const;
const FOUNDED: MemberFact = {_tag: "founded", id: P, name: NAME, keys: ["pA"], window: "wA"};

// Every ledger is a fresh node:sqlite file in one temp folder, removed after.
const folder = mkdtempSync(join(tmpdir(), "p9-clients-"));
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
/** A ClientManager and the Ledger beneath it, so a test can read what was written. */
const clientsOn = (ledger: Layer.Layer<Ledger>) =>
	ClientManager.layer(FOUNDER).pipe(Layer.provideMerge(ledger));

const from = (over: Partial<From> = {}): From => ({
	by: "SHA256:door",
	for: P,
	sentAt: SENT,
	seen: 0,
	cause: CAUSE,
	build: "b-7c1d073",
	...over,
});
const entries = Ledger.use((ledger) => Stream.runCollect(ledger.read(MEMBERS, 0)));
const write = (fact: MemberFact, over: Partial<From> = {}) =>
	ClientManager.use((clients) => clients.write(fact, from(over)));
const members = ClientManager.use((clients) => clients.members);

// ---- Facts. Signatures are not checked here, so `signed` is opaque text naming its signer ----

const SAW = {
	code: "4417",
	label: "Firefox",
	where: "Istanbul",
	how: "compare",
	check: "touch",
	has: [],
} as const;
const TOOK = {label: "Mac A", where: "Istanbul", how: "panel", check: "touch"} as const;
const addSaw = (how: "sheet" | "recovery" | "device", old: "lost" | "kept" | null = null) => ({
	how,
	check: "touch" as const,
	where: "Istanbul",
	has: [],
	typed: how === "sheet",
	kept: how === "sheet" ? ("print" as const) : null,
	old,
});
const signed = (signer: string) => ({
	text: `signed by ${signer}`,
	armored: "-----SSHSIG-----",
	signer,
});
let made = 0;
const nextId = (prefix: string): string => `${prefix}_${String(++made).padStart(26, "0")}`;

const granted = (
	signer: string,
	key: string,
	over: {readonly as?: "window" | "agent"; readonly id?: string} = {},
): MemberFact => ({
	_tag: "granted",
	grant: {
		id: over.id ?? nextId("grant"),
		key,
		for: P,
		to: TO,
		as: over.as ?? "window",
		saw: SAW,
		sentAt: SENT,
	},
	signed: signed(signer),
});
const revoked = (signer: string, key: string): MemberFact => ({
	_tag: "revoked",
	revoke: {id: nextId("revoke"), key, for: P, to: TO, saw: TOOK, sentAt: SENT},
	signed: signed(signer),
});
const addedDevice = (
	signer: string,
	key: string,
	window: string,
	over: {readonly drops?: ReadonlyArray<string>; readonly old?: "lost" | "kept"} = {},
): MemberFact => ({
	_tag: "added",
	add: {
		id: nextId("add"),
		for: P,
		to: TO,
		adds: {_tag: "person", key, window},
		drops: [...(over.drops ?? [])],
		saw: addSaw(over.old === undefined ? "device" : "recovery", over.old ?? null),
		sentAt: SENT,
	},
	signed: signed(signer),
});
const addedSheet = (signer: string, key: string): MemberFact => ({
	_tag: "added",
	add: {
		id: nextId("add"),
		for: P,
		to: TO,
		adds: {_tag: "recovery", key, v: 1},
		drops: [],
		saw: addSaw("sheet"),
		sentAt: SENT,
	},
	signed: signed(signer),
});
const denied = (key: string, by: string): MemberFact => ({
	_tag: "denied",
	id: nextId("deny"),
	key,
	saw: SAW,
	by,
});
/** The id a fact is appended under: its own, and `founded` for the founding. */
const factId = (fact: MemberFact): string => {
	switch (fact._tag) {
		case "founded":
			return "founded";
		case "granted":
			return fact.grant.id;
		case "revoked":
			return fact.revoke.id;
		case "added":
			return fact.add.id;
		case "denied":
			return fact.id;
	}
};

const view = (m: Members) => ({
	person: m.person,
	name: m.name,
	keys: [...m.keys.entries()]
		.map(([key, k]) => ({key, rank: k.rank, live: k.live, under: k.under}))
		.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
	spent: [...m.spent].sort(),
});

/**
 * A Ledger that, on the append of `id`, first runs `before`: another Mac's whole write, landing
 * between this write's first check and its append. The race, made certain.
 */
const racing = (
	sql: Sql,
	hook: {readonly id: string; before: Effect.Effect<void, LedgerError> | null},
) =>
	Layer.effect(
		Ledger,
		Effect.gen(function* () {
			const real = yield* Ledger;
			return {
				read: real.read,
				wait: real.wait,
				append: (stream: string, id: string, line: Parameters<typeof real.append>[2]) =>
					Effect.suspend(() => {
						const before = id === hook.id ? hook.before : null;
						if (before === null) return real.append(stream, id, line);
						hook.before = null;
						return Effect.andThen(before, real.append(stream, id, line));
					}),
			};
		}),
	).pipe(Layer.provide(onSql(sql)));

describe("p96, founded is written once, by the first call", () => {
	it.effect(
		"building the Layer writes nothing; the first call writes founded under its fixed id",
		() =>
			Effect.gen(function* () {
				expect(yield* entries).toEqual([]);
				const m = yield* members;
				expect(view(m)).toEqual(view(foldMembers([FOUNDED])));
				const written = yield* entries;
				expect(written.map((e) => [e.id, e._tag, e.rev])).toEqual([["founded", "founded", 1]]);
				yield* members;
				expect((yield* entries).length).toBe(1);
			}).pipe(Effect.provide(clientsOn(onSql(fresh())))),
	);

	it.effect(
		"plant, founded written at Layer build: a Ledger that always fails still builds",
		() => {
			const broken = Layer.succeed(Ledger, {
				append: () => Effect.fail(new LedgerError({why: "storage"})),
				read: () => Stream.fail(new LedgerError({why: "storage"})),
				wait: () => Effect.fail(new LedgerError({why: "storage"})),
			});
			return Effect.gen(function* () {
				const failed = yield* Effect.flip(members);
				expect(failed).toBeInstanceOf(LedgerError);
				expect(failed.why).toBe("storage");
				const refused = yield* Effect.flip(write(granted("pA", "t1")));
				expect(refused.why).toBe("storage");
			}).pipe(Effect.provide(ClientManager.layer(FOUNDER).pipe(Layer.provide(broken))));
		},
	);

	it.live("two first calls at once, and two ClientManagers on one ledger, leave one founded", () =>
		Effect.gen(function* () {
			const sql = fresh();
			const one = clientsOn(onSql(sql));
			const two = ClientManager.layer(FOUNDER).pipe(Layer.provide(onSql(sql)));
			yield* Effect.all(
				[
					members.pipe(Effect.provide(one)),
					members.pipe(Effect.provide(two)),
					write(granted("pA", "t1")).pipe(Effect.provide(two)),
					members.pipe(Effect.provide(one)),
				],
				{concurrency: "unbounded"},
			).pipe(Effect.provideService(References.MaxOpsBeforeYield, 3));
			const written = yield* entries.pipe(Effect.provide(onSql(sql)));
			expect(written.filter((e) => e._tag === "founded").map((e) => e.id)).toEqual(["founded"]);
		}),
	);
});

describe("p96, the traced history from the plan", () => {
	it.effect("each write answers what the fold does with it, and a refusal writes nothing", () =>
		Effect.gen(function* () {
			const t2 = granted("pB", "t2");
			const sheet = addedSheet("pB", "r1");
			const steps: ReadonlyArray<readonly [MemberFact, unknown]> = [
				[granted("pA", "t1"), {_tag: "applied", rev: 2}],
				[addedDevice("pA", "pB", "wB"), {_tag: "applied", rev: 3}],
				[t2, {_tag: "applied", rev: 4}],
				[sheet, {_tag: "applied", rev: 5}],
				[granted("pA", "g1", {as: "agent"}), {_tag: "applied", rev: 6}],
				[granted("wB", "t3"), {_tag: "refused", why: "not_allowed"}],
				[revoked("g1", "pB"), {_tag: "refused", why: "not_allowed"}],
				[
					addedDevice("r1", "pC", "wC", {drops: ["pA", "wA"], old: "lost"}),
					{_tag: "applied", rev: 7},
				],
				[addedDevice("r1", "pX", "wX", {old: "lost"}), {_tag: "refused", why: "used"}],
				[t2, {_tag: "applied", rev: 4}], // the rev-4 grant resent after the drop: nothing new
			];
			const kept: Array<MemberFact> = [FOUNDED];
			yield* members; // founded first, so each step below counts only its own entry
			for (const [fact, answer] of steps) {
				const before = (yield* entries).length;
				const got = yield* write(fact);
				expect(got, fact._tag).toEqual(answer);
				const after = yield* entries;
				const wrote = got._tag === "applied" && got.rev > before;
				expect(after.length, fact._tag).toBe(before + (wrote ? 1 : 0));
				if (wrote) kept.push(fact);
			}
			const m = yield* members;
			expect(view(m)).toEqual(view(foldMembers(kept)));
			expect([...m.spent]).toEqual(["r1"]);
		}).pipe(Effect.provide(clientsOn(onSql(fresh())))),
	);

	it.effect(
		"an applied fact sits under its own id, with its tag, the writer's fields and seen = the head",
		() =>
			Effect.gen(function* () {
				const grant = granted("pA", "t1");
				yield* write(grant, {seen: 0});
				const sheet = addedSheet("pA", "r1");
				yield* write(sheet, {seen: 0, cause: null, by: "SHA256:door-2"});
				const [founding, first, second] = yield* entries;
				expect(founding?.id).toBe("founded");
				expect(first).toMatchObject({
					id: factId(grant),
					_tag: "granted",
					rev: 2,
					seen: 1,
					by: "SHA256:door",
					for: P,
					sentAt: SENT,
					cause: CAUSE,
					build: "b-7c1d073",
				});
				expect(second).toMatchObject({
					id: factId(sheet),
					_tag: "added",
					rev: 3,
					seen: 2,
					cause: null,
				});
				expect(second?.by).toBe("SHA256:door-2");
			}).pipe(Effect.provide(clientsOn(onSql(fresh())))),
	);
});

describe("p96, why a write is refused", () => {
	it.effect("not_member, revoked, replaced and used, each writing nothing", () =>
		Effect.gen(function* () {
			yield* write(addedDevice("pA", "pB", "wB"));
			yield* write(addedSheet("pA", "r1"));
			yield* write(addedSheet("pB", "r2"));
			yield* write(revoked("pB", "pA"));
			yield* write(addedDevice("r2", "pC", "wC", {old: "kept"}));
			const before = (yield* entries).length;
			expect(yield* write(granted("x1", "t1"))).toEqual({_tag: "refused", why: "not_member"});
			expect(yield* write(granted("pA", "t1"))).toEqual({_tag: "refused", why: "revoked"});
			expect(yield* write(addedDevice("r1", "pD", "wD", {old: "lost"}))).toEqual({
				_tag: "refused",
				why: "replaced",
			});
			expect(yield* write(addedDevice("r2", "pD", "wD", {old: "lost"}))).toEqual({
				_tag: "refused",
				why: "used",
			});
			expect((yield* entries).length).toBe(before);
		}).pipe(Effect.provide(clientsOn(onSql(fresh())))),
	);

	it.effect(
		"the ledger's own refusal passes through: another fact under a used id is id_reused",
		() =>
			Effect.gen(function* () {
				const first = granted("pA", "t1", {id: "grant_01m6v5270hf3c8x2q7w9z4k5aa"});
				expect(yield* write(first)).toEqual({_tag: "applied", rev: 2});
				const other = granted("pA", "t2", {id: "grant_01m6v5270hf3c8x2q7w9z4k5aa"});
				expect(yield* write(other)).toEqual({_tag: "refused", why: "id_reused"});
				expect((yield* entries).length).toBe(2);
				expect((yield* members).keys.has("t2")).toBe(false);
			}).pipe(Effect.provide(clientsOn(onSql(fresh())))),
	);

	it.effect("plant, the check after the append only: a refused fact never reaches the log", () =>
		Effect.gen(function* () {
			yield* members; // founded first, so the count below is only the refused facts
			const before = (yield* entries).length;
			for (const fact of [granted("wA", "t1"), revoked("pA", "pA"), granted("x1", "t1")]) {
				const answer = yield* write(fact);
				expect(answer._tag, fact._tag).toBe("refused");
			}
			expect((yield* entries).length).toBe(before);
			expect(view(yield* members)).toEqual(view(foldMembers([FOUNDED])));
			expect((yield* write(denied("t1", "SHA256:menu")))._tag).not.toBe("ignored");
		}).pipe(Effect.provide(clientsOn(onSql(fresh())))),
	);
});

describe("p96, the stolen sheet race", () => {
	it.effect(
		"plant, write that skips the second fold: the Mac that lost the race hears ignored used",
		() => {
			const sql = fresh();
			const sheet = addedSheet("pA", "r1");
			const macC = addedDevice("r1", "pC", "wC", {drops: ["pA"], old: "lost"});
			const macX = addedDevice("r1", "pX", "wX", {old: "lost"});
			let xAnswer: unknown = null;
			const hook: {readonly id: string; before: Effect.Effect<void, LedgerError> | null} = {
				id: factId(macC),
				before: write(macX).pipe(
					Effect.tap((answer) =>
						Effect.sync(() => {
							xAnswer = answer;
						}),
					),
					Effect.asVoid,
					Effect.provide(ClientManager.layer(FOUNDER).pipe(Layer.provide(onSql(sql)))),
				),
			};
			return Effect.gen(function* () {
				expect(yield* write(sheet)).toEqual({_tag: "applied", rev: 2});
				const answer = yield* write(macC);
				expect(hook.before).toBeNull(); // the other Mac did run in between
				expect(xAnswer).toEqual({_tag: "applied", rev: 3});
				expect(answer).toEqual({_tag: "ignored", rev: 4, why: "used"});
				const m = yield* members;
				expect(m.keys.get("pX")?.live).toBe(true);
				expect(m.keys.get("pC")?.live ?? false).toBe(false);
				expect(m.keys.get("pA")?.live).toBe(true);
				// Both facts are in the log; the fold took only the first.
				expect((yield* entries).map((e) => e.id)).toEqual([
					"founded",
					factId(sheet),
					factId(macX),
					factId(macC),
				]);
			}).pipe(
				Effect.provide(ClientManager.layer(FOUNDER).pipe(Layer.provideMerge(racing(sql, hook)))),
			);
		},
	);

	it.live("two writes of one sheet at once, as fibers: one applied, never two", () =>
		Effect.gen(function* () {
			for (let round = 0; round < 12; round++) {
				const sql = fresh();
				const one = clientsOn(onSql(sql));
				const two = ClientManager.layer(FOUNDER).pipe(Layer.provide(onSql(sql)));
				yield* write(addedSheet("pA", "r1")).pipe(Effect.provide(one));
				const answers = yield* Effect.all(
					[
						write(addedDevice("r1", "pC", "wC", {old: "lost"})).pipe(Effect.provide(one)),
						write(addedDevice("r1", "pX", "wX", {old: "lost"})).pipe(Effect.provide(two)),
					],
					{concurrency: "unbounded"},
				).pipe(Effect.provideService(References.MaxOpsBeforeYield, 3));
				expect(answers.filter((a) => a._tag === "applied").length, `round ${round}`).toBe(1);
				const lost = answers.find((a) => a._tag !== "applied");
				expect(lost?._tag === "ignored" || lost?._tag === "refused", `round ${round}`).toBe(true);
				expect(lost !== undefined && "why" in lost ? lost.why : null).toBe("used");
				const m = yield* members.pipe(Effect.provide(one));
				expect([m.keys.get("pC")?.live, m.keys.get("pX")?.live].filter((l) => l === true)).toEqual([
					true,
				]);
			}
		}),
	);
});

// ---- p96 over any history: the answer is what the fold does, with no race ----

const PERSONS = ["pA", "pB", "pC"] as const;
const WINDOWS = ["wA", "wB", "wC"] as const;
const LEAVES = ["t1", "t2", "g1"] as const;
const SHEETS = ["r1", "r2"] as const;
const ALL: ReadonlyArray<string> = [...PERSONS, ...WINDOWS, ...LEAVES, ...SHEETS, "x1"];
const signer = fc.oneof(
	{weight: 5, arbitrary: fc.constantFrom(...PERSONS)},
	{weight: 2, arbitrary: fc.constantFrom(...SHEETS)},
	{weight: 2, arbitrary: fc.constantFrom(...WINDOWS, ...LEAVES, "x1")},
);
const anyKey = fc.constantFrom(...ALL);
const fact: fc.Arbitrary<() => MemberFact> = fc.oneof(
	{
		weight: 5,
		arbitrary: fc
			.record({by: signer, key: fc.constantFrom(...LEAVES), as: fc.constantFrom("window", "agent")})
			.map((g) => () => granted(g.by, g.key, {as: g.as})),
	},
	{
		weight: 2,
		arbitrary: fc.record({by: signer, key: anyKey}).map((r) => () => revoked(r.by, r.key)),
	},
	{
		weight: 3,
		arbitrary: fc
			.record({
				by: signer,
				pair: fc.integer({min: 0, max: 2}),
				drops: fc.uniqueArray(anyKey, {maxLength: 2}),
				lost: fc.boolean(),
			})
			.map(
				(a) => () =>
					addedDevice(a.by, PERSONS[a.pair] ?? "pA", WINDOWS[a.pair] ?? "wA", {
						drops: a.drops,
						...(a.lost ? {old: "lost" as const} : {}),
					}),
			),
	},
	{
		weight: 2,
		arbitrary: fc
			.record({by: signer, key: fc.constantFrom(...SHEETS)})
			.map((s) => () => addedSheet(s.by, s.key)),
	},
	{
		weight: 1,
		arbitrary: fc.record({key: anyKey, by: signer}).map((d) => () => denied(d.key, d.by)),
	},
	{weight: 1, arbitrary: fc.constant(() => FOUNDED)},
);

describe("p96, write tells the truth over any history", () => {
	it("refused writes nothing and the fold skips it; a fact that changes who belongs is applied", async () => {
		let applied = 0;
		let refused = 0;
		await fc.assert(
			fc.asyncProperty(fc.array(fact, {minLength: 1, maxLength: 20}), (makes) =>
				Effect.runPromise(
					Effect.gen(function* () {
						const kept: Array<MemberFact> = [FOUNDED];
						yield* members;
						for (const make of makes) {
							const next = make();
							const before = yield* entries;
							const head = before.at(-1)?.rev ?? 0;
							const answer = yield* write(next);
							const after = yield* entries;
							const changes =
								JSON.stringify(view(foldMembers([...kept, next]))) !==
								JSON.stringify(view(foldMembers(kept)));
							expect(answer._tag, "no race, so nothing is ignored").not.toBe("ignored");
							if (changes)
								expect(answer, next._tag).toEqual({_tag: "applied", rev: expect.any(Number)});
							if (answer._tag === "refused") {
								refused++;
								expect(after.length, next._tag).toBe(before.length);
								expect(changes, next._tag).toBe(false);
							}
							if (answer._tag === "applied") {
								applied++;
								const placed = after.find((e) => e.rev === answer.rev);
								expect(placed?.id, next._tag).toBe(factId(next));
								if (answer.rev > head) kept.push(next);
							}
						}
						expect(view(yield* members)).toEqual(view(foldMembers(kept)));
					}).pipe(Effect.provide(clientsOn(onSql(fresh())))),
				),
			),
			{seed: SEED, numRuns: 60},
		);
		expect(applied).toBeGreaterThan(60);
		expect(refused).toBeGreaterThan(60);
	});
});
