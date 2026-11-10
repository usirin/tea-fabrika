import {
	Cause,
	Deferred,
	Duration,
	Effect,
	Exit,
	Fiber,
	Logger,
	Option,
	type Scope,
	Stream,
} from "effect";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {ear} from "../../program/ear.ts";
import {type Ended, MailboxFull} from "../../program/program.ts";
import {memoryStorage} from "../../program/storage.ts";
import {SummonManager, type TurnNews} from "../../shell/summon.ts";
import {EMPTY, type Transcript} from "../acp/transcript.ts";
import {SummonedNow, summonManager} from "./manager.ts";
import {turnProgram} from "./turn.ts";

type Outputs = {
	said: (text: string) => void;
	opened: (o: {models: string[]; efforts: string[]; model: string}) => void;
	told: (t: {turn: number}) => void;
	result: (r: {turn: number; stop: string; cost: null; input: null; output: null}) => void;
	ask: (a: {ask: string; title: string; answer: string}) => void;
};

type Agent = {
	flags: Record<string, unknown>;
	outputs: Outputs;
	turn: number;
	snapshot: Transcript | null;
	cancelled: number;
	/** A cancel the agent never answers with a result, as a harness on its way down. */
	hush: boolean;
	/** A prompt fails as a full mailbox would. */
	full: boolean;
	/** A prompt is queued, but its told waits for the test. */
	hold: boolean;
	end: Deferred.Deferred<Ended<unknown>>;
};

const rig = vi.hoisted(() => ({agents: [] as Agent[]}));

// ACP's program boundary, with its outputs controlled by the test. No process or model starts.
vi.mock("../../program/program.ts", async (original) => ({
	...(await original<typeof import("../../program/program.ts")>()),
	start: (_: unknown, flags: Record<string, unknown>, outputs: Outputs) =>
		Effect.sync(() => {
			const agent: Agent = {
				flags,
				outputs,
				turn: 0,
				snapshot: EMPTY,
				cancelled: 0,
				hush: false,
				full: false,
				hold: false,
				end: Deferred.makeUnsafe<Ended<unknown>>(),
			};
			rig.agents.push(agent);
			let model = "fake-small";
			let effort: string | null = null;
			let settings: ((s: {model: string; effort: string | null}) => void) | undefined;
			outputs.opened({models: ["fake-small", "fake-large"], efforts: ["low", "high"], model});
			return {
				kind: "running",
				run: {
					ended: Deferred.await(agent.end),
					machines: {transcript: {state: () => agent.snapshot}},
					listen: (_name: string, heard: typeof settings) => {
						settings = heard;
						return () => {
							settings = undefined;
						};
					},
					tell: (name: string, value: string) =>
						name === "prompt" && agent.full
							? Effect.fail(new MailboxFull({input: name, capacity: 1}))
							: Effect.sync(() => {
									if (name === "model" || name === "effort") {
										if (name === "model") {
											model = value;
										} else {
											effort = value;
										}

										settings?.({model, effort});
									}

									if (name === "prompt") {
										agent.turn += 1;

										if (!agent.hold) {
											outputs.told({turn: agent.turn});
										}
									}

									if (name === "cancel") {
										agent.cancelled += 1;

										if (!agent.hush) {
											outputs.result({
												turn: agent.turn,
												stop: "cancelled",
												cost: null,
												input: null,
												output: null,
											});
										}
									}

									return "queued";
								}),
				},
			};
		}),
}));

const PERSON = "user:owner";

const hosted = <A, E>(body: Effect.Effect<A, E, SummonManager | SummonedNow | Scope.Scope>) =>
	Effect.runPromise(
		body.pipe(
			Effect.scoped,
			Effect.provide(summonManager({storage: memoryStorage(), folder: "/repo"})),
		),
	);

const summon = (agent = "fake", settings: readonly string[] = []) =>
	Effect.gen(function* () {
		return yield* (yield* SummonManager).summon({agent, settings, name: "scout", by: PERSON});
	});

const current = () => {
	const agent = rig.agents[0];

	if (agent === undefined) {
		throw new Error("no ACP run");
	}

	return agent;
};

const turning = Effect.gen(function* () {
	const manager = yield* SummonManager;
	const news: TurnNews[] = [];
	const fiber = yield* manager.turn("scout", "hello", null).pipe(
		Stream.runForEach((n) => Effect.sync(() => news.push(n))),
		Effect.forkChild,
	);

	while (!news.some((n) => n._tag === "told")) {
		yield* Effect.sleep(Duration.millis(5));
	}

	return {news, fiber};
});

const finish = () =>
	current().outputs.result({
		turn: current().turn,
		stop: "end_turn",
		cost: null,
		input: null,
		output: null,
	});

beforeEach(() => {
	rig.agents.length = 0;
});

describe("the manager reads ACP's state", () => {
	it("cancel leaves an idle session alone", async () => {
		const seen = await hosted(
			Effect.gen(function* () {
				yield* summon();
				const manager = yield* SummonManager;
				yield* manager.cancel("scout");
				return {cancelled: current().cancelled, states: (yield* manager.list).map((a) => a.state)};
			}),
		);
		expect(seen).toEqual({cancelled: 0, states: ["idle"]});
	});

	it("an accepted prompt whose harness exits before told sends no cancel to that dead harness", async () => {
		const seen = await hosted(
			Effect.gen(function* () {
				yield* summon();
				current().hold = true;
				const manager = yield* SummonManager;
				const fiber = yield* manager
					.turn("scout", "hello", null)
					.pipe(Stream.runDrain, Effect.forkChild);

				while (current().turn === 0) {
					yield* Effect.sleep("5 millis");
				}

				Deferred.doneUnsafe(
					current().end,
					Exit.succeed({
						kind: "failed",
						cause: Cause.fail(new Error("fake harness exited before told")),
						unread: {},
					}),
				);
				const ended = yield* Fiber.await(fiber).pipe(Effect.timeout("2 seconds"));
				return {ended, cancelled: current().cancelled};
			}),
		);
		expect(Exit.isFailure(seen.ended)).toBe(true);
		expect(seen.cancelled).toBe(0);
	});

	it.each(["allowed", "refused"] as const)(
		"forwards an ACP ask answered %s by its id",
		async (answer) => {
			const news = await hosted(
				Effect.gen(function* () {
					yield* summon();
					const t = yield* turning;
					current().outputs.ask({ask: "edit-a", title: "Write a.txt", answer: "waiting"});
					current().outputs.ask({ask: "edit-a", title: "Write a.txt", answer});
					finish();
					yield* Fiber.join(t.fiber);
					return t.news.filter((n) => n._tag === "ask" || n._tag === "answered");
				}),
			);
			expect(news).toEqual([
				{_tag: "ask", ask: "edit-a", title: "Write a.txt"},
				{_tag: "answered", ask: "edit-a", allow: answer === "allowed"},
			]);
		},
	);

	// Review 2, finding 6, today's version. The ACP mailbox took a prompt, but its told
	// acknowledgement has not arrived. Ctrl-C must still send session/cancel to that run.
	it("T237-R2-6: Ctrl-C after prompt acceptance and before told cancels the unseen ACP turn", async () => {
		const program = await vi.importActual<typeof import("../../program/program.ts")>(
			"../../program/program.ts",
		);
		const seen = await hosted(
			Effect.gen(function* () {
				yield* summon();
				current().hold = true;
				const told = ear<unknown>();
				const result = ear<unknown>();
				const job = yield* program.start(
					turnProgram,
					{to: "scout"},
					{told: told.hear, result: result.hear},
					{id: "turn:accepted-before-told", storage: memoryStorage()},
				);

				if (job.kind !== "running") {
					return yield* Effect.die("turn did not start");
				}

				yield* program.tell(job.run, "prompt", "slowly read the repo");
				yield* Effect.gen(function* () {
					while (current().turn === 0) {
						yield* Effect.sleep("5 millis");
					}
				}).pipe(Effect.timeout("2 seconds"));
				expect(current().turn).toBe(1);
				expect(told.values).toEqual([]);
				yield* job.stop;
				return {cancelled: current().cancelled, result: result.values};
			}),
		);
		expect.soft(seen.cancelled, "ACP accepted the prompt but received no cancellation").toBe(1);
		expect(seen.result).toContainEqual(expect.objectContaining({name: "scout", stop: "cancelled"}));
	});

	// Plan: a down agent reports why; the foreground turn ends and gives the prompt back.
	it("T237-5: a harness exit fails its active turn stream instead of waiting forever", async () => {
		const seen = await hosted(
			Effect.gen(function* () {
				const manager = yield* SummonManager;
				yield* summon();
				const t = yield* turning;
				Deferred.doneUnsafe(
					current().end,
					Exit.succeed({
						kind: "failed",
						cause: Cause.fail(new Error("fake harness exited")),
						unread: {},
					}),
				);
				const down = yield* SummonedNow;
				yield* down.changes.pipe(
					Stream.filter((agents) => agents.some((a) => a.state === "down")),
					Stream.take(1),
					Stream.runDrain,
				);
				const ended = yield* Fiber.await(t.fiber).pipe(Effect.timeoutOption("250 millis"));
				return {list: yield* manager.list, ended};
			}),
		);
		expect(seen.list.map((a) => [a.name, a.state])).toEqual([["scout", "down"]]);
		expect(Option.isSome(seen.ended), "the harness is down, but its turn still waits").toBe(true);
		const ended = Option.getOrThrow(seen.ended);
		expect(Exit.isFailure(ended)).toBe(true);
		expect(Exit.isFailure(ended) ? Cause.pretty(ended.cause) : "").toContain("fake harness exited");
	});

	it("T237-5: a cancel waiting on its turn's end stops waiting when the harness goes down", async () => {
		const seen = await hosted(
			Effect.gen(function* () {
				const manager = yield* SummonManager;
				yield* summon();
				yield* turning;
				current().hush = true;
				const cancelling = yield* manager.cancel("scout").pipe(Effect.forkChild);

				while (current().cancelled === 0) {
					yield* Effect.sleep(Duration.millis(5));
				}

				Deferred.doneUnsafe(
					current().end,
					Exit.succeed({
						kind: "failed",
						cause: Cause.fail(new Error("fake harness exited")),
						unread: {},
					}),
				);
				// Well under the 10 seconds a cancel waits for a result that never comes.
				const cancelled = yield* Fiber.await(cancelling).pipe(Effect.timeoutOption("2 seconds"));
				const next = yield* manager.turn("scout", "again", null).pipe(Stream.runDrain, Effect.flip);
				return {cancelled, next};
			}),
		);
		expect(Option.isSome(seen.cancelled), "the cancel still waits on a harness that is gone").toBe(
			true,
		);
		expect(seen.next.why).toContain("scout is down: ");
	});

	it("a prompt the agent's mailbox has no room for is refused as taking nothing", async () => {
		const seen = await hosted(
			Effect.gen(function* () {
				const manager = yield* SummonManager;
				yield* summon();
				current().full = true;
				return yield* manager.turn("scout", "hello", null).pipe(Stream.runDrain, Effect.flip);
			}),
		);
		expect(seen.why).toBe("scout took nothing: full");
	});

	it("news the agent says before this turn is told is not this turn's", async () => {
		const seen = await hosted(
			Effect.gen(function* () {
				const manager = yield* SummonManager;
				yield* summon();
				current().hold = true;
				const news: TurnNews[] = [];
				const fiber = yield* manager.turn("scout", "hello", null).pipe(
					Stream.runForEach((n) => Effect.sync(() => news.push(n))),
					Effect.forkChild,
				);

				while (current().turn === 0) {
					yield* Effect.sleep(Duration.millis(5));
				}

				current().outputs.said("the last turn's tail");
				current().outputs.told({turn: current().turn});
				current().outputs.said("this turn's reply");
				finish();
				yield* Fiber.join(fiber);
				return news.filter((n) => n._tag !== "status");
			}),
		);
		expect(seen.map((n) => n._tag)).toEqual(["told", "said", "result"]);
		expect(seen[1]).toEqual({_tag: "said", text: "this turn's reply"});
	});

	it("refuses an invalid second setting with the offered efforts", async () => {
		const refused = await hosted(Effect.result(summon("fake", ["fake-large", "ultra"])));
		expect(refused._tag).toBe("Failure");

		if (refused._tag === "Failure") {
			expect(refused.failure.why).toBe(
				"ultra is not an effort fake offers. fake's models: fake-small, fake-large; efforts: low, high",
			);
		}
	});

	it("starts codex read-only in the person's repository", async () => {
		await hosted(summon("codex"));
		expect(current().flags).toMatchObject({mode: "read-only", folder: "/repo", permissions: "ask"});
	});

	it("publishes summoned names and offers for the window and completion", async () => {
		const seen = await hosted(
			Effect.gen(function* () {
				const now = yield* SummonedNow;
				yield* summon();
				return {
					agents: yield* now.changes.pipe(Stream.take(1), Stream.runCollect),
					talk: yield* now.talk.pipe(Stream.take(1), Stream.runCollect),
				};
			}),
		);
		expect(seen.agents[0]?.map((a) => [a.name, a.state])).toEqual([["scout", "idle"]]);
		expect(seen.talk[0]).toMatchObject({
			names: ["scout"],
			offers: {fake: ["fake-small", "fake-large", "low", "high"]},
		});
	});

	it("shows only this turn's pending tool and separates status words", async () => {
		const statuses = await hosted(
			Effect.gen(function* () {
				yield* summon();
				const t = yield* turning;
				current().snapshot = {
					...EMPTY,
					tools: [
						{id: "old", name: "Read", title: "Old tool", status: "pending", turn: 0},
						{id: "new", name: "Read", title: "Read a.txt", status: "pending", turn: 1},
					],
				};
				yield* Effect.sleep(Duration.millis(600));
				finish();
				yield* Fiber.join(t.fiber);
				return t.news.filter((n) => n._tag === "status").map((n) => n.text);
			}),
		);
		expect(statuses).toEqual(["Read a.txt · 1 tool · 0s"]);
	});

	it("shows thinking without tools and sends changed status once", async () => {
		const statuses = await hosted(
			Effect.gen(function* () {
				yield* summon();
				const t = yield* turning;
				yield* Effect.sleep(Duration.millis(1700));
				finish();
				yield* Fiber.join(t.fiber);
				return t.news.filter((n) => n._tag === "status").map((n) => n.text);
			}),
		);
		expect(statuses).toEqual(["thinking · 0s", "thinking · 1s"]);
	});

	it("cancels a turn while it is waiting for permission", async () => {
		const seen = await hosted(
			Effect.gen(function* () {
				const manager = yield* SummonManager;
				yield* summon();
				const t = yield* turning;
				current().outputs.ask({ask: "edit", title: "Write a.txt", answer: "waiting"});
				yield* manager.cancel("scout");
				// End the consumer even if a broken cancel sent nothing.
				finish();
				yield* Fiber.join(t.fiber);
				return {cancelled: current().cancelled, news: t.news};
			}),
		);
		expect(seen.cancelled).toBe(1);
		expect(seen.news.at(-1)).toMatchObject({_tag: "result", stop: "cancelled"});
	});

	it("logs an idle dismiss with no cut turn", async () => {
		const lines: string[] = [];
		await hosted(
			Effect.gen(function* () {
				yield* summon();
				yield* (yield* SummonManager).dismiss("scout", PERSON);
			}).pipe(
				Effect.provide(
					Logger.layer([
						Logger.make((o) => {
							lines.push(Logger.formatSimple.log(o));
						}),
					]),
				),
			),
		);
		const line = lines.find((l) => l.includes("message=dismissed"));
		expect(line).toMatch(/cut=(?:""|)(?:\s|$)/);
	});

	it("leaves unreported tokens and cost out of the turn log", async () => {
		const lines: string[] = [];
		await hosted(
			Effect.gen(function* () {
				yield* summon();
				const t = yield* turning;
				finish();
				yield* Fiber.join(t.fiber);
			}).pipe(
				Effect.provide(
					Logger.layer([
						Logger.make((o) => {
							lines.push(Logger.formatSimple.log(o));
						}),
					]),
				),
			),
		);
		const line = lines.find((l) => l.includes("message=turn_ended"));
		expect(line).toBeDefined();
		expect(line).not.toMatch(/\b(input|output|cost)=/);
	});
});
