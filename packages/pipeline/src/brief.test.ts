import {createDraft} from "@kampus/fabrika/agents/claude";
import {Schema} from "effect";
import {describe, expect, it} from "vitest";
import {z} from "zod";
import {type BriefOf, defineBrief} from "./brief.ts";
import {createRefineLoop} from "./combos.ts";

// Two example roles, with small schemas made here. The real ticket and plan
// schemas belong to the stages that use them.

const Ticket = Schema.Struct({id: Schema.String, title: Schema.String});
const Plan = Schema.Struct({steps: Schema.Array(Schema.String)});
const Find = Schema.Struct({path: Schema.String, why: Schema.String});

/** A writer gets a full brief: the ticket, the plan, and what an earlier agent found. */
const writer = defineBrief({
	role: "writer",
	schema: Schema.Struct({ticket: Ticket, plan: Plan, found: Schema.Array(Find)}),
	render: (b) =>
		[
			`# ${b.ticket.id}: ${b.ticket.title}`,
			"",
			"## Plan",
			...b.plan.steps.map((s, i) => `${i + 1}. ${s}`),
			"",
			"## Found before you",
			...b.found.map((f) => `- \`${f.path}\`: ${f.why}`),
		].join("\n"),
});

/** A reviewer gets a thin brief: the diff, the criteria and the plan. No chat, no builder notes. */
const reviewer = defineBrief({
	role: "reviewer",
	schema: Schema.Struct({diff: Schema.String, criteria: Schema.Array(Schema.String), plan: Plan}),
	render: (b) =>
		[
			"## Criteria",
			...b.criteria.map((c) => `- ${c}`),
			"",
			"## Plan",
			...b.plan.steps.map((s) => `- ${s}`),
			"",
			"## Diff",
			"```diff",
			b.diff,
			"```",
		].join("\n"),
});

const thin = {
	diff: "+ const a = 1;",
	criteria: ["a is one"],
	plan: {steps: ["set a"]},
};

describe("brief: one typed view per role", () => {
	it("renders a role's brief as its agent's first message", () => {
		const brief = writer.fill({
			ticket: {id: "demo-1", title: "Add a"},
			plan: {steps: ["set a", "test a"]},
			found: [{path: "src/a.ts", why: "where a lives"}],
		});

		expect(writer.role).toBe("writer");
		expect(writer.render(brief)).toBe(
			[
				"# demo-1: Add a",
				"",
				"## Plan",
				"1. set a",
				"2. test a",
				"",
				"## Found before you",
				"- `src/a.ts`: where a lives",
			].join("\n"),
		);
	});

	it("a reviewer brief has no field for chat, so a chat field does not compile and throws", () => {
		expect(reviewer.fill(thin)).toEqual(thin);
		expect(() =>
			// @ts-expect-error: the reviewer's brief has no field for chat
			reviewer.fill({...thin, chat: "the builder said it is fine"}),
		).toThrow(/chat/);
	});

	it("a wider value is refused too, not only a literal", () => {
		const fromTheBuilder = {...thin, notes: "skip the tests"};
		// @ts-expect-error: `notes` has no slot in the reviewer's brief
		expect(() => reviewer.fill(fromTheBuilder)).toThrow(/notes/);
	});

	it("an extra field deep inside is refused at run time", () => {
		const plan = {steps: ["set a"], chat: "said in the chat"};
		expect(() => reviewer.fill({...thin, plan})).toThrow(/chat/);
	});

	it("feeds `createRefineLoop`'s brief, with no casts", () => {
		const loop = createRefineLoop({
			draft: createDraft({name: "review", output: z.object({ok: z.boolean()})}),
			check: (_out: {ok: boolean}, _brief: BriefOf<typeof reviewer>) => [],
			prompt: reviewer.prompt,
			agent: "reviewer",
			folder: null,
		});

		const first = loop.start("k", reviewer.fill(thin), 2);
		expect(loop.runOf(first)?.prompt).toBe(reviewer.render(thin));
		expect(reviewer.prompt(thin, "line 1 is long")).toBe("line 1 is long");
	});
});
