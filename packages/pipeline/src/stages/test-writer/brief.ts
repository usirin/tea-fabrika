import {Schema} from "effect";
import {type BriefOf, defineBrief} from "../../brief.ts";
import {Id} from "../../entity.ts";
import {Lived} from "../mutation/mutant.ts";

// What the test writer is handed (docs/direction/the-test-writer.md): the
// plan's Properties, the commit they are tested on, pointers to code, and the
// files it may add. A writer gets a full brief (docs/direction/new-combos.md,
// "Brief"), so it has the plan's words and an earlier agent's finds, but no
// field for the builder or the chat.

/**
 * A Property's id, `p<n>` (docs/direction/the-plan-stage.md, decision 5).
 * Kept here until the criteria book counts Properties; then it moves to
 * `src/ids.ts` beside `c<n>`.
 */
export const PropertyId = Id("PropertyId", /^p[1-9][0-9]*$/);
export type PropertyId = typeof PropertyId.Type;

/**
 * A Property, in the plan stage note's shape, with what the writer needs.
 * `tool` is only `"test"`: how a `"tla"` Property is checked waits on
 * experiment 139, so this stage is never handed one.
 */
export const Property = Schema.Struct({
	id: PropertyId,
	when: Schema.String,
	result: Schema.String,
	/** What goes wrong if it breaks. */
	why: Schema.String,
	/** `new`: its test must fail on the base. `existing`: its test must pass there. */
	behavior: Schema.Literals(["new", "existing"]),
	tool: Schema.Literal("test"),
	/** The file and top-level name it checks. Empty for a `new` one: that code does not exist yet. */
	code: Schema.Array(Schema.Struct({file: Schema.String, name: Schema.String})),
});
export type Property = typeof Property.Type;

/** A place in the code worth reading, and why, from the plan or an earlier agent. */
export const Pointer = Schema.Struct({at: Schema.String, why: Schema.String});
export type Pointer = typeof Pointer.Type;

export const writer = defineBrief({
	role: "test_writer",
	schema: Schema.Struct({
		ticket: Schema.String,
		plan: Schema.Struct({version: Schema.Finite, summary: Schema.String}),
		/** The plan's base commit: the tests are written against it and run on it. */
		base: Schema.String,
		properties: Schema.Array(Property),
		pointers: Schema.Array(Pointer),
		/** The patterns a new file must match: `[test_writer] includes`, copied when the run was filed. */
		includes: Schema.Array(Schema.String),
		/** Files at the base that `includes` covers. They exist, so they are never written. */
		taken: Schema.Array(Schema.String),
	}),
	render: (b) =>
		[
			`# Tests for ${b.ticket}, plan version ${b.plan.version}`,
			"",
			b.plan.summary,
			"",
			`Write one test for each Property below, against commit ${b.base}.`,
			"A `new` Property's test must fail on that commit: the feature is not there yet.",
			"An `existing` Property's test must pass on it: that part already works.",
			"If no test can check a Property, say so for it, and why.",
			"",
			"## Properties",
			...b.properties.flatMap((p) => [
				`- ${p.id} (${p.behavior}): when ${p.when}, ${p.result}.`,
				`  Why it matters: ${p.why}`,
				...p.code.map((c) => `  Checks \`${c.name}\` in \`${c.file}\``),
			]),
			"",
			"## Where to look",
			...(b.pointers.length === 0
				? ["Nothing was pointed at. Read the code yourself."]
				: b.pointers.map((p) => `- \`${p.at}\`: ${p.why}`)),
			"",
			"## What you may write",
			"Only new files, and only where one of these patterns matches:",
			...b.includes.map((i) => `- \`${i}\``),
			"Never change a file that exists, product code or test.",
			...(b.taken.length === 0
				? []
				: ["These exist already, so they are never written:", ...b.taken.map((t) => `- \`${t}\``)]),
		].join("\n"),
});

export type WriterBrief = BriefOf<typeof writer>;

/**
 * The writer's second job: the mutants the mutation step let live, each to
 * answer with a test, `cannot` or `noise` (docs/direction/the-test-writer.md).
 */
export const mutantsWriter = defineBrief({
	role: "test_writer",
	schema: Schema.Struct({
		ticket: Schema.String,
		/** The build's head: the mutants were made on it, and the new tests run on it. */
		head: Schema.String,
		lived: Schema.Array(Lived),
		includes: Schema.Array(Schema.String),
		/** Files at the head that `includes` covers. They exist, so they are never written. */
		taken: Schema.Array(Schema.String),
	}),
	render: (b) =>
		[
			`# Mutants that lived on ${b.ticket}, at commit ${b.head}`,
			"",
			"Mutation testing made small changes to the code. No test of the repository failed with",
			"these in, so a real bug of the same kind would pass too. Answer each one:",
			"- `test`: write a test that passes on the code as it is and fails with the mutant in.",
			"- `cannot`: it changes nothing a test can see. Say why; the owner is asked.",
			"- `noise`: a test could tell it apart, but would only lock a detail. Say why; the owner rates it.",
			"Never put a mutant into the code, even to try it.",
			"",
			"## Mutants",
			...b.lived.map(
				(m) => `- ${m.mutant} (${m.mutator}): \`${m.original}\` made \`${m.replacement}\``,
			),
			"",
			"## What you may write",
			"Only new files, and only where one of these patterns matches:",
			...b.includes.map((i) => `- \`${i}\``),
			"Never change a file that exists, product code or test.",
			...(b.taken.length === 0
				? []
				: ["These exist already, so they are never written:", ...b.taken.map((t) => `- \`${t}\``)]),
		].join("\n"),
});

export type MutantsBrief = BriefOf<typeof mutantsWriter>;
