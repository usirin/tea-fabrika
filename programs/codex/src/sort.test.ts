import {run} from "@demlik/tea/effect";
import {Agent, memoryStorage} from "@kampus/fabrika";
import type {DraftRun} from "@kampus/fabrika/agents/claude";
import {fakeProviders, programRunner} from "@kampus/fabrika/agents/program";
import {decoder, MISFIT} from "@kampus/pipeline/decoder";
import {SortReply} from "@kampus/pipeline/stages/sort/answer";
import {
	type RunSub,
	type readContext,
	type readTicket,
	sort,
	type writeOne,
} from "@kampus/pipeline/stages/sort/machine";
import type {Settings, SortContext, SortTicket} from "@kampus/pipeline/stages/sort/services";
import {Effect, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {codex} from "./index.ts";

// One stage end to end with `codex` as a child run (experiment 169): the real sort machine,
// unchanged, its `sort_run` Sub answered by the program on its fake provider. The stage hands the
// program its JSON Schema on `--schema`, and decodes the plain answer with its own Effect schema
// when it arrives (`decoder`). programs/claude/src/sort.test.ts is the same for `claude`.

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

/** The sort stage on `codex`, the agent answering turn n with `answerFor(n)`. */
const drive = (answerFor: (n: number) => unknown) =>
	Effect.gen(function* () {
		let turns = 0;
		const fake = fakeProviders(() => {
			turns += 1;
			return {
				tool: {id: `t${turns}`, title: "Read"},
				said: "Looked at #4.",
				answer: answerFor(turns),
			};
		}).codex;
		const agents = Agent.makeAgents({
			adapters: {codex: fake},
			sessions: Agent.memorySessions(),
			reaper: Agent.noReaper,
		});
		const storage = memoryStorage();
		const children: string[] = [];
		const sorted = decoder(SortReply);
		const runner = programRunner({
			name: "sort",
			program: codex,
			agents,
			flags: (r: DraftRun) => ({
				folder: "/work/copy",
				session: r.session.id,
				model: SETTINGS.model,
				effort: SETTINGS.effort,
				system: undefined,
				usd: undefined,
				tools: undefined,
				seconds: undefined,
				schema: sorted.schema,
			}),
			keeping: (r: DraftRun) => {
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
			subscribe: {
				sort_run: (sub: RunSub) => runner(sub.deps.run).pipe(Stream.map(sorted.decode)),
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
		const end = yield* runtime.done();
		return {end, wrote, children, fake};
	}).pipe(Effect.scoped);

describe("sort, with codex as a child run", () => {
	it("the decoded answer comes back as the Draft's Msg, through two child runs", async () => {
		// The first answer names a ticket the stage never listed; the Check sends it back.
		const {end, wrote, children, fake} = await Effect.runPromise(
			drive((n) => ({sort: {answer: "duplicate", of: n === 1 ? 40 : 4, why: "Same bug."}})),
		);
		expect(end).toMatchObject({
			phase: "over",
			outcome: {kind: "done", closed: "duplicate"},
			report: {answer: {answer: "duplicate", of: 4}, tries: 2},
		});
		expect(wrote).toEqual(["comment", "label", "close"]);
		// One child run per Draft run, each its own program run; the second carries the session on.
		expect(children).toEqual(["sort:12/1", "sort:12/2"]);
		const seen = fake.seen.started;
		expect(seen.map((t) => t.session)).toEqual([seen[0]?.session, seen[0]?.session]);
		expect(seen.map((t) => t.resume)).toEqual([null, "fake-own-1"]);
	});

	it("a misfit: the stage ends stuck on a failed draft, writes nothing, and says why", async () => {
		const {end, wrote} = await Effect.runPromise(
			drive(() => ({sort: {answer: "duplicate", of: "four", why: "Same bug."}})),
		);
		expect(end).toMatchObject({phase: "over", outcome: {kind: "stuck", why: "draft_failed"}});
		expect(wrote).toEqual([]);
		const problems = (end as {readonly report?: {readonly problems?: readonly string[]}}).report
			?.problems;
		expect(problems?.[0]).toContain(MISFIT);
	});
});
