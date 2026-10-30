import {run} from "@demlik/tea/effect";
import {Agent, memoryStorage} from "@kampus/fabrika";
import type {DraftRun} from "@kampus/fabrika/agents/claude";
import {
	fakeMakers,
	type Maker,
	programRunner,
	typedAgentProgram,
} from "@kampus/fabrika/agents/program";
import {Effect} from "effect";
import {describe, expect, it} from "vitest";
import {SortReply} from "./stages/sort/answer.ts";
import {
	type RunSub,
	type readContext,
	type readTicket,
	sort,
	type writeOne,
} from "./stages/sort/machine.ts";
import type {Settings, SortContext, SortTicket} from "./stages/sort/services.ts";

// One stage end to end with the agent as a program (experiment 169): the real sort machine,
// unchanged, its `sort_run` Sub answered by a child run of `claude` or `codex`, on the fake
// makers. The stage hears the same three Msgs it hears from `agentRunner` today, so nothing in it
// changes; only the line that makes its runner does.

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

/** The first answer names a ticket the stage never listed; the Check sends it back, the second is right. */
const answerFor = (n: number) => ({
	sort: {answer: "duplicate", of: n === 1 ? 40 : 4, why: "Same bug."},
});

const drive = (maker: Maker) =>
	Effect.gen(function* () {
		let turns = 0;
		const fakes = fakeMakers(() => {
			turns += 1;
			return {
				tool: {id: `t${turns}`, title: "Read"},
				said: "Looked at #4.",
				answer: answerFor(turns),
			};
		});
		const agents = Agent.makeAgents({
			adapters: fakes,
			sessions: Agent.memorySessions(),
			reaper: Agent.noReaper,
		});
		const storage = memoryStorage();
		const children: string[] = [];
		const runner = programRunner({
			name: "sort",
			program: typedAgentProgram(maker, SortReply, `${maker}-sort`),
			agents,
			flagsOf: (r: DraftRun) => ({
				folder: "/work/copy",
				session: r.session.id,
				model: SETTINGS.model,
				effort: SETTINGS.effort,
				system: undefined,
				usd: undefined,
				tools: undefined,
				seconds: undefined,
			}),
			keepingOf: (r: DraftRun) => {
				children.push(r.id);
				return {id: `child:${r.id}`, storage};
			},
		});
		const wrote: string[] = [];
		const handle = yield* run(sort, {
			ctx: undefined,
			interpret: {
				sort_ticket: (_: ReturnType<typeof readTicket>) => Effect.succeed(TICKET),
				sort_context: (_: ReturnType<typeof readContext>) => Effect.succeed(CONTEXT),
				sort_write: (cmd: ReturnType<typeof writeOne>) =>
					Effect.sync(() => {
						wrote.push(cmd.write.op);
						return null;
					}),
			},
			subscribe: {sort_run: (sub: RunSub) => runner(sub.deps.run)},
			terminal: (s) => s.phase === "over",
		});
		const runtime = yield* handle.ready;
		yield* runtime.dispatch({
			type: "start",
			ask: {ticket: URL, tries: 2},
			settings: SETTINGS,
			key: "sort:12",
		});
		const end = yield* runtime.done();
		return {end, wrote, children, fakes};
	}).pipe(Effect.scoped);

describe("a stage that starts the agent program as a child run", () => {
	for (const maker of ["claude", "codex"] as const)
		it(`sort on ${maker}: the typed answer comes back as the Draft's Msg, through two child runs`, async () => {
			const {end, wrote, children, fakes} = await Effect.runPromise(drive(maker));
			expect(end).toMatchObject({
				phase: "over",
				outcome: {kind: "done", closed: "duplicate"},
				report: {answer: {answer: "duplicate", of: 4}, tries: 2},
			});
			expect(wrote).toEqual(["comment", "label", "close"]);
			// One child run per Draft run, each its own program run; the second carries the session on.
			expect(children).toEqual(["sort:12/1", "sort:12/2"]);
			const seen = fakes[maker].seen.started;
			expect(seen.map((t) => t.session)).toEqual([seen[0]?.session, seen[0]?.session]);
			expect(seen.map((t) => t.resume)).toEqual([null, "fake-own-1"]);
		});
});
