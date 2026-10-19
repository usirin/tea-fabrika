import {describe, expect, it} from "vitest";
import {
	type Checks,
	type Criterion,
	enqueueOf,
	type Met,
	type Proof,
	ReadyToMerge,
	readyToMerge,
	type Verdict,
} from "./ready.ts";

const CRITERIA: readonly [Criterion, ...Criterion[]] = [
	{n: 1, text: "every window opens"},
	{n: 2, text: "the door locks"},
];
const met = (n: number, head = "A"): Verdict => ({
	n,
	text: CRITERIA[n - 1]?.text ?? "",
	head,
	state: "met",
});
const green: Checks = {head: "A", state: "green"};
const proof = (patch: Partial<Proof> = {}): Proof => ({
	pr: "P",
	head: "A",
	criteria: CRITERIA,
	verdicts: [met(1), met(2)],
	checks: green,
	...patch,
});
const whys = (p: Proof): readonly string[] => {
	const r = readyToMerge(p);
	return "ready" in r ? [] : r.refused.map((x) => x.why);
};

describe("ReadyToMerge cannot be made by hand", () => {
	it("is refused as a literal, a boolean, a bare head, an open row and an empty list", () => {
		// @ts-expect-error a literal lacks the brand
		const literal: ReadyToMerge = {pr: "P", head: "A", rows: [met(1)]};
		// @ts-expect-error a yes is not a proof
		const yes: ReadyToMerge = true;
		// @ts-expect-error the constructor is private: only `ReadyToMerge.of` checks the rows
		const made = () => new ReadyToMerge("P", "A", [met(1)]);
		// @ts-expect-error the queue takes the proof, not a pull request and a head
		enqueueOf({pr: "P", head: "A"});
		// @ts-expect-error an open verdict is not a met row
		const open: Met = {n: 1, text: "every window opens", head: "A", state: "open"};
		// @ts-expect-error a ticket with no criteria has nothing to prove
		const none: Proof = {pr: "P", head: "A", criteria: [], verdicts: [], checks: green};
		expect([literal, yes, made, open, none].length).toBe(5);
	});
});

describe("readyToMerge", () => {
	it("is ready only with a met row per criterion at the head and green checks there", () => {
		const r = readyToMerge(proof());
		expect("ready" in r && enqueueOf(r.ready)).toEqual({pr: "P", head: "A"});
		expect("ready" in r && r.ready.rows.map((row) => `${row.n}@${row.head}`)).toEqual([
			"1@A",
			"2@A",
		]);
	});

	it("names every reason it is not", () => {
		expect(whys(proof({verdicts: [met(1)]}))).toEqual(["no_verdict"]);
		expect(whys(proof({verdicts: [met(1), {...met(2), state: "open"}]}))).toEqual(["not_met"]);
		expect(whys(proof({verdicts: [met(1), {...met(2), state: "unseen"}]}))).toEqual(["not_met"]);
		expect(whys(proof({verdicts: [met(1), met(2, "B")]}))).toEqual(["other_head"]);
		expect(whys(proof({verdicts: [met(1), {...met(2), text: "the door is shut"}]}))).toEqual([
			"other_words",
		]);
		expect(whys(proof({checks: {head: "A", state: "pending"}}))).toEqual(["checks"]);
		expect(whys(proof({checks: {head: "B", state: "green"}}))).toEqual(["checks"]);
		expect(whys(proof({verdicts: [], checks: {head: "A", state: "red"}}))).toEqual([
			"no_verdict",
			"no_verdict",
			"checks",
		]);
	});

	it("takes the latest verdict at the head: a later fail undoes an earlier pass", () => {
		expect(whys(proof({verdicts: [met(1), met(2), {...met(2), state: "open"}]}))).toEqual([
			"not_met",
		]);
		expect(whys(proof({verdicts: [met(1), {...met(2), state: "open"}, met(2)]}))).toEqual([]);
	});

	it("agrees with the rule on every small proof", () => {
		// Every mix of rows for two criteria and every checks read, against the rule in words.
		const rowsFor = (n: number): readonly (Verdict | null)[] => [
			null,
			met(n),
			met(n, "B"),
			{...met(n), state: "open"},
			{...met(n), state: "unseen"},
			{...met(n), text: "reworded"},
		];
		const checks: readonly Checks[] = [
			green,
			{head: "B", state: "green"},
			{head: "A", state: "pending"},
			{head: "A", state: "red"},
		];
		let tried = 0;
		const wrong: string[] = [];
		for (const one of rowsFor(1))
			for (const two of rowsFor(2))
				for (const c of checks) {
					const verdicts = [one, two].filter((v): v is Verdict => v !== null);
					const p = proof({verdicts, checks: c});
					const rule =
						CRITERIA.every((k) =>
							verdicts.some(
								(v) => v.n === k.n && v.text === k.text && v.head === "A" && v.state === "met",
							),
						) &&
						c.head === "A" &&
						c.state === "green";
					tried++;
					if ("ready" in readyToMerge(p) !== rule) wrong.push(JSON.stringify(p));
				}
		expect({tried, wrong}).toEqual({tried: 144, wrong: []});
	});
});
