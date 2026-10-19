import {Schema} from "effect";
import {describe, expect, it} from "vitest";
import {criterionId} from "../../criteria/book.ts";
import {enqueue, merge} from "./machine.ts";
import {
	type Checks,
	type Criterion,
	type Met,
	type Proof,
	Ready,
	ReadyToMerge,
	type Row,
	readyToMerge,
} from "./ready.ts";

// "Ready to merge" as a value that only `ReadyToMerge.of(proof)` can make:
// one passing row per criterion the ledger holds now, at its current version,
// at the head, and the checks green at that head.

const C1 = criterionId("c1");
const C2 = criterionId("c2");
const CRITERIA: readonly [Criterion, ...Criterion[]] = [
	{id: C1, version: 1, text: "every window opens"},
	// Said again once since the plan: only a verdict on version 2 counts.
	{id: C2, version: 2, text: "the door locks, from inside too"},
];
const versionOf = (id: string) => CRITERIA.find((c) => c.id === id)?.version ?? 1;
const pass = (id = C1, head = "A", version = versionOf(id)): Row => ({
	id,
	version,
	head,
	grade: "pass",
	proof: `the review at ${head}`,
});
const fail = (id = C1, head = "A"): Row => ({...pass(id, head), grade: "fail"});
const green: Checks = {head: "A", state: "green"};
const proof = (patch: Partial<Proof> = {}): Proof => ({
	pr: "P",
	head: "A",
	criteria: CRITERIA,
	verdicts: [pass(C1), pass(C2)],
	checks: green,
	...patch,
});
const whys = (p: Proof): readonly string[] => {
	const r = readyToMerge(p);
	return "ready" in r ? [] : r.refused.map((x) => x.why);
};

describe("ReadyToMerge cannot be made by hand", () => {
	it("is refused as a literal, a boolean, a bare head, a failing row and an empty list", () => {
		// @ts-expect-error a literal lacks the brand
		const literal: ReadyToMerge = {pr: "P", head: "A", criteria: CRITERIA, rows: [pass()]};
		// @ts-expect-error a yes is not a proof
		const yes: ReadyToMerge = true;
		// @ts-expect-error there is no constructor: only `ReadyToMerge.of` checks the rows
		const made = () => new ReadyToMerge(proof());
		// @ts-expect-error a failing row is not a met one
		const failing: Met = fail();
		// @ts-expect-error a ticket with no criteria has nothing to prove
		const none: Proof = {pr: "P", head: "A", criteria: [], verdicts: [], checks: green};
		// @ts-expect-error a row names its criterion by id, never by its place in a list
		const byPlace: Row = {n: 1, version: 1, head: "A", grade: "pass", proof: "p"};
		expect([literal, yes, made, failing, none, byPlace].length).toBe(6);
	});

	it("is the only thing the enqueue and merge Cmds take: no pull request and head on their own", () => {
		// @ts-expect-error the queue takes the proof, not a pull request and a head
		const bare = enqueue({pr: "P", head: "A", intent: "i"});
		// @ts-expect-error a proof's shape, written out, is not a proof
		const shaped = merge({ready: {pr: "P", head: "A"}, intent: "i"});
		const r = readyToMerge(proof());
		if (!("ready" in r)) throw new Error("not ready");
		const queued = enqueue({ready: r.ready, intent: "i"});
		expect([bare, shaped].length).toBe(2);
		expect(queued.ready.head).toBe("A");
	});
});

describe("readyToMerge", () => {
	it("is ready only with a passing row per criterion, at its version, at the head, and green checks there", () => {
		const r = readyToMerge(proof());
		if (!("ready" in r)) throw new Error("not ready");
		expect({pr: r.ready.pr, head: r.ready.head}).toEqual({pr: "P", head: "A"});
		expect(r.ready.rows.map((row) => `${row.id} v${row.version}@${row.head}`)).toEqual([
			"c1 v1@A",
			"c2 v2@A",
		]);
	});

	it("names every reason it is not", () => {
		expect(whys(proof({verdicts: [pass(C1)]}))).toEqual(["no_verdict"]);
		expect(whys(proof({verdicts: [pass(C1), fail(C2)]}))).toEqual(["not_met"]);
		// A new head voids every row at the old one.
		expect(whys(proof({verdicts: [pass(C1), pass(C2, "B")]}))).toEqual(["other_head"]);
		// A reworded criterion voids the row on its old words.
		expect(whys(proof({verdicts: [pass(C1), pass(C2, "A", 1)]}))).toEqual(["old_version"]);
		expect(whys(proof({checks: {head: "A", state: "pending"}}))).toEqual(["checks"]);
		expect(whys(proof({checks: {head: "B", state: "green"}}))).toEqual(["checks"]);
		expect(whys(proof({verdicts: [], checks: {head: "A", state: "red"}}))).toEqual([
			"no_verdict",
			"no_verdict",
			"checks",
		]);
	});

	it("says which criterion each reason is about, by id", () => {
		const r = readyToMerge(proof({verdicts: [pass(C1), pass(C2, "A", 1)]}));
		expect("refused" in r && r.refused).toEqual([{why: "old_version", id: "c2", version: 1}]);
	});

	it("takes the latest verdict at the head: a later fail undoes an earlier pass", () => {
		expect(whys(proof({verdicts: [pass(C1), pass(C2), fail(C2)]}))).toEqual(["not_met"]);
		expect(whys(proof({verdicts: [pass(C1), fail(C2), pass(C2)]}))).toEqual([]);
	});

	it("survives being kept: it is plain data, and a kept one is checked again", () => {
		const r = readyToMerge(proof({verdicts: [fail(C1, "B"), pass(C1), pass(C2)]}));
		if (!("ready" in r)) throw new Error("not ready");
		const kept: unknown = JSON.parse(JSON.stringify(r.ready));
		expect(ReadyToMerge.revive(kept)).toEqual(r.ready);
		// What was kept is checked again, not trusted: an edited row is refused.
		const edited = JSON.parse(JSON.stringify(r.ready).replace('"pass"', '"fail"'));
		expect(ReadyToMerge.revive(edited)).toBeNull();
		expect(ReadyToMerge.revive({pr: "P", head: "A"})).toBeNull();
		// A copy moved to another head no longer proves it: its rows are at the old one.
		expect(Schema.is(Ready)({...r.ready, head: "B"})).toBe(false);
		expect(Schema.is(Ready)(r.ready)).toBe(true);
	});

	it("agrees with the rule on every small proof", () => {
		// Every mix of rows for two criteria and every checks read, against the rule in words.
		const rowsFor = (id: typeof C1): readonly (Row | null)[] => [
			null,
			pass(id),
			pass(id, "B"),
			fail(id),
			pass(id, "A", versionOf(id) + 1),
			...(versionOf(id) > 1 ? [pass(id, "A", versionOf(id) - 1)] : []),
		];
		const checks: readonly Checks[] = [
			green,
			{head: "B", state: "green"},
			{head: "A", state: "pending"},
			{head: "A", state: "red"},
		];
		let tried = 0;
		const wrong: string[] = [];
		for (const one of rowsFor(C1))
			for (const two of rowsFor(C2))
				for (const c of checks) {
					const verdicts = [one, two].filter((v): v is Row => v !== null);
					const p = proof({verdicts, checks: c});
					const rule =
						CRITERIA.every((k) =>
							verdicts.some(
								(v) =>
									v.id === k.id && v.version === k.version && v.head === "A" && v.grade === "pass",
							),
						) &&
						c.head === "A" &&
						c.state === "green";
					tried++;
					if ("ready" in readyToMerge(p) !== rule) wrong.push(JSON.stringify(p));
				}
		expect({tried, wrong}).toEqual({tried: 5 * 6 * 4, wrong: []});
	});
});
