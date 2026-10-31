import {run} from "@demlik/tea/effect";
import {type DraftMsg, jsonSchema, type Spend} from "@kampus/fabrika/agents/claude";
import {Effect, Schema, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {decoder, MISFIT} from "./decoder.ts";
import {SortReply} from "./stages/sort/answer.ts";
import {
	type RunSub,
	type readContext,
	type readTicket,
	sort,
	type writeOne,
} from "./stages/sort/machine.ts";
import type {Settings, SortContext, SortTicket} from "./stages/sort/services.ts";

// The stage's side of a typed answer from an agent program (experiment 169): the program hands
// on plain JSON, and the stage decodes it with its own Effect schema when it arrives. A misfit is
// a failed Draft, never a value the stage reads as if it fit. The same stage on the real `claude`
// and `codex` programs is in `programs/claude` and `programs/codex` (`sort.test.ts`): a program
// sits above the pipeline, so the pipeline cannot start one.

/** A check JSON Schema cannot say: it is lost on the way to the agent, and kept here. */
const Sorted = Schema.Struct({
	label: Schema.Literals(["bug", "feature"]),
	ticket: Schema.String.check(
		Schema.makeFilter((s: string) => s.startsWith("#") || "a ticket starts with #"),
	),
});

const SPEND: Spend = {costUsd: 0.01, tokens: 100, context: 0, turns: 1, minutes: 0};
const finished = (output: unknown): DraftMsg<"sort", unknown> => ({
	type: "sort_finished",
	key: "k",
	id: "k/1",
	output,
	session: "s",
	spend: SPEND,
});

describe("decoder: the stage's schema, both ways", () => {
	const sorted = decoder(Sorted);

	it("hands the agent the JSON Schema of the stage's own schema", () => {
		expect(sorted.schema).toEqual(jsonSchema(Sorted));
	});

	it("an answer that fits comes out typed", () => {
		expect(sorted.decode(finished({label: "bug", ticket: "#7"}))).toEqual(
			finished({label: "bug", ticket: "#7"}),
		);
	});

	it("a misfit is a failed Draft, with the schema's own words: the lost check holds here", () => {
		for (const output of [{label: "bug", ticket: "7"}, {label: "bogus", ticket: "#7"}, null]) {
			const got = sorted.decode(finished(output));
			expect(got).toMatchObject({type: "sort_failed", key: "k", id: "k/1", spend: SPEND});
			expect(got.type === "sort_failed" && got.error.startsWith(`${MISFIT}: `)).toBe(true);
		}
		const lost = sorted.decode(finished({label: "bug", ticket: "7"}));
		expect(lost.type === "sort_failed" && lost.error).toContain("a ticket starts with #");
	});

	it("a tool Msg and a failed Msg pass as they came", () => {
		const tool: DraftMsg<"sort", unknown> = {type: "sort_tool", key: "k", id: "k/1", tool: "Read"};
		const failed: DraftMsg<"sort", unknown> = {
			type: "sort_failed",
			key: "k",
			id: "k/1",
			error: "broke",
			spend: SPEND,
		};
		expect(sorted.decode(tool)).toBe(tool);
		expect(sorted.decode(failed)).toBe(failed);
	});
});

// ---------------------------------------------------------------- the real sort stage

const URL = "https://github.com/acme/widgets/issues/12";
const SETTINGS: Settings = {model: "haiku", effort: "low", budget: 0.2, note: "A widget library."};
const TICKET: SortTicket = {
	url: URL,
	number: 12,
	state: "open",
	title: "Widgets render twice on resize",
	body: "Resize the window: each widget draws two times.",
};
const CONTEXT: SortContext = {
	earlier: [
		{number: 4, title: "Widgets draw twice when the window resizes", state: "open", reason: null},
	],
	plans: [],
};

/** The sort stage, its Draft answered by `answers` in turn, each decoded on arrival. */
const sortOn = (answers: readonly unknown[]) =>
	Effect.gen(function* () {
		const sortReply = decoder(SortReply);
		let n = 0;
		const handle = yield* run(sort, {
			ctx: undefined,
			interpret: {
				sort_ticket: (_: ReturnType<typeof readTicket>) => Effect.succeed(TICKET),
				sort_context: (_: ReturnType<typeof readContext>) => Effect.succeed(CONTEXT),
				sort_write: (_: ReturnType<typeof writeOne>) => Effect.succeed(null),
			},
			subscribe: {
				sort_run: (sub: RunSub) => {
					const {key, id} = sub.deps.run;
					const msg: DraftMsg<"sort", unknown> = {
						type: "sort_finished",
						key,
						id,
						output: answers[n++],
						session: "s",
						spend: SPEND,
					};
					return Stream.make(msg).pipe(Stream.map((m) => sortReply.decode(m)));
				},
			},
			terminal: (s) => s.phase === "over",
		});
		const runtime = yield* handle.ready;
		yield* runtime.dispatch({
			type: "start",
			ask: {ticket: URL, tries: 2},
			settings: SETTINGS,
			key: "sort:12",
		});
		return yield* runtime.done();
	}).pipe(Effect.scoped);

describe("the sort stage, with its answer decoded on arrival", () => {
	it("a right answer: the stage goes on and ends done", async () => {
		const end = await Effect.runPromise(
			sortOn([{sort: {answer: "duplicate", of: 4, why: "Same bug."}}]),
		);
		expect(end).toMatchObject({phase: "over", outcome: {kind: "done", closed: "duplicate"}});
	});

	it("a misfit: the stage ends stuck on a failed draft, and says why", async () => {
		const end = await Effect.runPromise(
			sortOn([{sort: {answer: "duplicate", of: "four", why: "Same bug."}}]),
		);
		expect(end).toMatchObject({phase: "over", outcome: {kind: "stuck", why: "draft_failed"}});
		const problems = (end as {readonly report?: {readonly problems?: readonly string[]}}).report
			?.problems;
		expect(problems?.[0]).toContain(MISFIT);
	});
});
