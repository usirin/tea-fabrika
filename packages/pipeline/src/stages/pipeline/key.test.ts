import {Effect} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {Inputs, keyOf} from "./key.ts";
import {STEPS} from "./machine.ts";

// Self-fix PR 5, P7: a step's input key. Today's version. The risk is an input left out of the key:
// then a stale answer looks fresh. So every input has a test that changing it changes the key, and a
// new input joins that test by being a field of `Inputs`, not by someone adding a case.

const text = fc.string({minLength: 1, maxLength: 12});
const maybe = <A>(arb: fc.Arbitrary<A>) => fc.option(arb, {nil: null});

/** Any inputs. Its keys are checked against `Inputs`' own below, so a new field cannot be missed. */
const inputs: fc.Arbitrary<Inputs> = fc.record({
	step: fc.constantFrom(...STEPS),
	ticket: text,
	plan: maybe(fc.integer({min: 1, max: 9})),
	base: maybe(text),
	exam: maybe(text),
	head: maybe(text),
	brief: maybe(text),
	harness: maybe(text),
	model: maybe(text),
	effort: maybe(text),
	settings: maybe(text),
	// Self-fix PR 11b: the head of the exam's pull request and of the lane's own.
	examHead: maybe(text),
	prHead: maybe(text),
});

/** One field of `inputs`, changed to another value of its own kind. */
const changed = (was: Inputs, field: keyof Inputs): Inputs => {
	const value = was[field];
	if (field === "step") {
		const at = STEPS.indexOf(was.step);
		return {...was, step: STEPS[(at + 1) % STEPS.length] ?? "triage"};
	}
	if (typeof value === "number") return {...was, [field]: value + 1};
	if (typeof value === "string") return {...was, [field]: `${value}-changed`};
	return {...was, [field]: field === "plan" ? 1 : "set"};
};

const isField = (name: string): name is keyof Inputs => name in Inputs.fields;

const key = (of: Inputs) => Effect.runPromise(keyOf(of));

describe("a step's input key", () => {
	it("the arbitrary covers every field of the inputs", () => {
		const one = fc.sample(inputs, {numRuns: 1, seed: 119120})[0];
		expect(Object.keys(one ?? {}).sort()).toEqual(Object.keys(Inputs.fields).sort());
	});

	it("the same inputs give the same key, spelled as a hash", async () => {
		await fc.assert(
			fc.asyncProperty(inputs, async (of) => {
				const first = await key(of);
				expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
				expect(await key({...of})).toBe(first);
			}),
			{numRuns: 100, seed: 119120},
		);
	});

	it("changing any one input field changes the key", async () => {
		const fields = Object.keys(Inputs.fields).filter(isField);
		await fc.assert(
			fc.asyncProperty(inputs, fc.constantFrom(...fields), async (of, field) => {
				expect(await key(changed(of, field)), `changing ${field}`).not.toBe(await key(of));
			}),
			{numRuns: 200, seed: 119120},
		);
	});

	it("a null input and a text input that reads `null` give different keys", async () => {
		const of: Inputs = {
			step: "build",
			ticket: "sha256:1",
			plan: 1,
			base: null,
			exam: "5d38d582",
			head: "315df8e6",
			brief: "build#7e02",
			harness: "codex",
			model: "gpt-6-astra",
			effort: "high",
			settings: null,
			examHead: null,
			prHead: null,
		};
		expect(await key({...of, base: "null"})).not.toBe(await key(of));
	});

	// Self-fix PR 11b (docs/plan/pipeline-self-fix.md, PR 11, the record holes). Experiment 193: ticket
	// 117's two `exam_merge` runs shared one key, though the exam's pull request had a new head.
	describe("the pull requests' heads", () => {
		const examMerge: Inputs = {
			step: "exam_merge",
			ticket: "sha256:1",
			plan: 1,
			base: "5d38d582",
			exam: null,
			head: "315df8e6",
			brief: null,
			harness: null,
			model: null,
			effort: null,
			settings: "sha256:2",
			examHead: "39041df",
			prHead: null,
		};

		it("two `exam_merge` runs at different exam heads get different keys", async () => {
			expect(await key({...examMerge, examHead: "27bec63"})).not.toBe(await key(examMerge));
		});

		it("two `merge` runs at different heads of the lane's pull request get different keys", async () => {
			const merge: Inputs = {...examMerge, step: "merge", examHead: null, prHead: "a1b2c3d"};
			expect(await key({...merge, prHead: "e4f5a6b"})).not.toBe(await key(merge));
		});
	});
});
