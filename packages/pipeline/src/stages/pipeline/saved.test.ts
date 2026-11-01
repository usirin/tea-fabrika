import {jsonSchema, reader} from "@kampus/fabrika-old/agents/claude";
import {Option, Schema} from "effect";
import {describe, expect, it} from "vitest";
import {Built, HeldBuilt} from "../build/form.ts";
import {HeldDraft, PlanDraft} from "../plan/plan.ts";
import {Carry, EMPTY} from "./machine.ts";

// Today's version. An answer's nothing is a required `null` when an agent writes it, and an absent key
// past the read. So what a lane saved before that change still reads, and looks the same as what it
// saves now.

const STORY = {id: "reader", who: "a reader", want: "one form", why: "names match"};
const PLAN = {summary: "One form.", stories: [STORY], tasks: [], pointers: [], questions: []};
const BUILT = {summary: "Done.", deviations: [], ran: [], left: []};

describe("what a lane saved before answers had required nulls", () => {
	it("a plan with its optional keys left out still reads, as itself", () => {
		expect(Schema.decodeUnknownSync(HeldDraft)(PLAN)).toEqual(PLAN);
		expect(Schema.decodeUnknownSync(Carry)({...EMPTY, plan: PLAN}).plan).toEqual(PLAN);
	});

	it("a builder's form with its optional keys left out still reads, as itself", () => {
		expect(Schema.decodeUnknownSync(HeldBuilt)(BUILT)).toEqual(BUILT);
	});

	it("a carry from before `left` was kept still reads", () => {
		const {left: _, ...before} = {...EMPTY, left: []};
		expect(Schema.decodeUnknownSync(Carry)(before).left).toBeUndefined();
	});
});

describe("an agent's answer, as it writes one", () => {
	it("a null is an absent key past the read", () => {
		const written = {
			...PLAN,
			stories: [{...STORY, from: null}],
			goal: null,
			properties: null,
			interface: null,
			exam: null,
			gaps: null,
		};
		expect(reader(PlanDraft)(written)).toEqual(Option.some(PLAN));
		expect(reader(Built)({...BUILT, disputed: null, gaps: ["one"]})).toEqual(
			Option.some({...BUILT, gaps: ["one"]}),
		);
	});

	it("a key left out is asked for by the schema, and still reads if an agent leaves it out", () => {
		expect(jsonSchema(Built)).toMatchObject({
			required: expect.arrayContaining(["disputed", "gaps"]),
		});
		expect(reader(Built)(BUILT)).toEqual(Option.some(BUILT));
	});
});
