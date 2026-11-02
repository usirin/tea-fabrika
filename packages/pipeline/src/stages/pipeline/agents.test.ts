import type {Agent} from "@kampus/fabrika-old";
import {jsonSchema, reader} from "@kampus/fabrika-old/agents/claude";
import {strictOk} from "@kampus/fabrika-old/agents/codex";
import {Deferred, Effect, Fiber, Layer, Option, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {criterionId} from "../../ids.ts";
import {Builder, Built} from "../build/form.ts";
import {ExamWritten} from "../exam/machine.ts";
import {PlanDraft} from "../plan/plan.ts";
import {Form} from "../review/sheet.ts";
import {SortReply} from "../sort/answer.ts";
import {Answered} from "../test-writer/mutants.ts";
import {Written} from "../test-writer/written.ts";
import {type Held, LaneAgents, laneBuilder, laneNow, LaneNow} from "./agents.ts";

// Today's version. A schema that strict mode would refuse is not handed to Codex at all, and the agent
// is only asked in words. So each answer a lane's agent gives has to pass, or its step gets no
// `--output-schema`.

describe("the answer schema of every step that runs an agent", () => {
	const SCHEMAS = [
		["triage", jsonSchema(SortReply)],
		["plan", jsonSchema(PlanDraft)],
		["exam", jsonSchema(ExamWritten)],
		["test writer", jsonSchema(Written)],
		["mutants", jsonSchema(Answered)],
		["build", jsonSchema(Built)],
		["review", jsonSchema(Form)],
	] as const;

	it("passes strict mode, so every step gets --output-schema", () => {
		const refused = SCHEMAS.filter(([, schema]) => !strictOk(schema)).map(([step]) => step);
		expect(refused).toEqual([]);
	});
});

// A step's `started` is written once, when its agent's session opens. A last message that does not
// fit gets one more try on the same session, and that try opens it again: still one `started`.

/** The builder's answer, as JSON says it: what the turn's schema reads. */
const BUILT = {
	summary: "Names are read in one form.",
	deviations: [],
	ran: [{command: "pnpm test", passed: true}],
	left: [],
	disputed: null,
	gaps: null,
};

/** A run that answers in words the first time, and with the answer on the try after. */
const misfitThenAnswer = () => {
	let runs = 0;
	return <A>(turn: Agent.Turn<A>): Stream.Stream<Agent.Heard<A>> => {
		runs += 1;
		const fits = runs > 1;
		return Stream.make<readonly Agent.Heard<A>[]>(
			{_tag: "started", session: turn.session},
			{_tag: "said", text: fits ? JSON.stringify(BUILT) : "I built it."},
			{
				_tag: "ended",
				stop: "end_turn",
				answer: fits ? Option.getOrNull(reader(turn.answer)(BUILT)) : null,
				tokens: {input: 120, cached: 0, output: 30},
				counted: "turn",
				usd: null,
				requests: 1,
			},
		);
	};
};

describe("a step's started", () => {
	it("is written once when a misfit's second try opens the session again", async () => {
		const starts: (string | null)[] = [];
		const held: Held = {
			run: misfitThenAnswer(),
			knows: () => Effect.succeed(null),
			own: (session) => Effect.succeed(`thread-of-${session}`),
		};
		const agents = Layer.succeed(LaneAgents, {agents: Effect.succeed(held)});
		const drafted = await Effect.runPromise(
			Effect.gen(function* () {
				const now = yield* LaneNow;
				yield* now.set({
					picked: {harness: "codex", model: "gpt-5.5", effort: "low", usd: 0},
					brief: {name: "build", hash: "0", slots: [], body: "Build it."},
					slots: {},
					folder: "/nowhere",
					access: "write",
				});
				yield* now.start.set((session) => Effect.sync(() => void starts.push(session)));
				const builder = yield* Builder;
				const built = yield* builder.build(
					{
						ticket: "t-1",
						number: 1,
						title: "Read names in one form",
						body: "",
						criteria: [
							{
								id: criterionId("c1"),
								version: 1,
								text: "Lower case.",
								checked: false,
								evidence: null,
							},
						],
						round: 1,
						open: [],
						rules: [],
						tree: "/nowhere",
						branch: "fabrika/1",
						session: "s-build-1",
					},
					{model: "gpt-5.5", effort: "low", budget: 0},
				);
				// The step's own write at its end finds it written, and writes nothing.
				yield* now.start.write(null);
				return built;
			}).pipe(Effect.provide(laneBuilder.pipe(Layer.provideMerge(laneNow), Layer.provide(agents)))),
		);
		expect(drafted.answer).toBe("built");
		expect(starts).toEqual(["thread-of-s-build-1"]);
	});

	it("leaves the next step's writer in place when the last step's write lands after it was set", async () => {
		const starts: string[] = [];
		await Effect.runPromise(
			Effect.gen(function* () {
				const now = yield* LaneNow;
				const landing = yield* Deferred.make<void>();
				yield* now.start.set(() =>
					Deferred.await(landing).pipe(
						Effect.andThen(Effect.sync(() => void starts.push("first"))),
					),
				);
				const late = yield* Effect.forkChild(now.start.write("s-1"));
				yield* Effect.yieldNow;
				yield* now.start.set(() => Effect.sync(() => void starts.push("next")));
				yield* Deferred.succeed(landing, undefined);
				yield* Fiber.join(late);
				yield* now.start.write("s-2");
			}).pipe(Effect.provide(laneNow)),
		);
		expect(starts).toEqual(["first", "next"]);
	});
});
