import {type Cause, Duration, Effect, Layer, Queue, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {HostJobs, type JobTable, openJobs} from "../../host/host-jobs.ts";
import {ear} from "../../program/ear.ts";
import {listed} from "../../program/listed.ts";
import {start, tell} from "../../program/program.ts";
import {memoryStorage} from "../../program/storage.ts";
import {forAgent, Programs, programList} from "../../shell/programs.ts";
import {type Printed, type Ready, tsh} from "../../shell/shell.ts";
import {SMALL} from "../../shell/small.ts";
import {SummonManager, type Summoned, type TurnNews} from "../../shell/summon.ts";
import {turnProgram} from "./turn.ts";

// The summon tryout, PR 1 (ticket 237), today's version: `summon`, `dismiss`, `agents` and
// `@name` in tsh, with the `turn` program as the job a said line becomes. The agent behind it is
// an in-memory double of `SummonManager` (shell/summon.ts): it keeps names, records every call,
// and plays each turn's news as the test pushes it, so no harness starts here. manager.test.ts
// runs the real manager on the fake ACP agent.
//
//   tsh$ summon fake fake-large high as scout    summon({agent: "fake", settings: [...], name: "scout", by})
//   tsh$ @scout why does post print #7 twice?   one `turn` job: turn("scout", "why does ...", null)
//   ^C                                           the job stops (130), cancel("scout"), scout stays
//
// Laws S-2, S-5 (tsh's side), S-7 (tsh's side) and S-8 of the plan.

const PERSON = "user:owner";
const AGENT = "agent:claude for:owner";

type Service = typeof SummonManager.Service;

/** One turn the double was asked for, and the news it sends, pushed by the test. */
interface Asked {
	readonly name: string;
	readonly prompt: string;
	readonly room: string | null;
	readonly news: Queue.Queue<TurnNews, Cause.Done>;
}

const summonedAs = (name: string, by: string): Summoned => ({
	name,
	agent: "fake",
	model: {typed: "fake-large", resolved: "fake-large"},
	effort: {typed: "high", set: "high"},
	folder: "/repo",
	since: 0,
	by,
	state: "idle",
	cost: null,
});

const RESULT: TurnNews = {_tag: "result", stop: "end_turn", ms: 5, cost: null};

/**
 * A `SummonManager` in memory. `auto`: each turn says `told`, a reply and `result` at once.
 * Otherwise the test pushes each turn's news on its queue. `run`: the kept run `identify` names
 * behind any told turn; left out, the double has no `identify`, as a host without kept jobs.
 */
const double = (names: readonly string[] = ["scout"], run?: string) => {
	const agents = new Map(names.map((n) => [n, summonedAs(n, PERSON)]));
	const calls = {
		summons: [] as unknown[],
		dismisses: [] as string[],
		turns: [] as Asked[],
		cancels: [] as string[],
		/** The turn each cancel said it owns, in the order of `cancels`. */
		mines: [] as unknown[],
		answers: [] as unknown[],
	};
	const state = {auto: false};
	const service: Service = {
		summon: (a) =>
			Effect.sync(() => {
				calls.summons.push(a);
				const s = summonedAs(a.name, a.by);
				agents.set(a.name, s);
				return s;
			}),
		dismiss: (name) =>
			Effect.sync(() => {
				calls.dismisses.push(name);
				agents.delete(name);
				return {cut: null};
			}),
		list: Effect.sync(() => [...agents.values()]),
		turn: (name, prompt, room) =>
			Stream.unwrap(
				Effect.gen(function* () {
					const news = yield* Queue.unbounded<TurnNews, Cause.Done>();
					calls.turns.push({name, prompt, room, news});

					if (state.auto) {
						const n = calls.turns.length;
						Queue.offerUnsafe(news, {_tag: "told", turn: n});
						Queue.offerUnsafe(news, {_tag: "said", text: `reply ${n}`});
						Queue.offerUnsafe(news, RESULT);
					}

					return Stream.fromQueue(news).pipe(Stream.takeUntil((n) => n._tag === "result"));
				}),
			),
		...(run === undefined ? {} : {identify: () => Effect.succeed({run})}),
		cancel: (name, mine) =>
			Effect.sync(() => {
				calls.cancels.push(name);
				calls.mines.push(mine);

				for (const t of calls.turns) {
					if (t.name === name) {
						Queue.offerUnsafe(t.news, {_tag: "result", stop: "cancelled", ms: 1, cost: null});
					}
				}
			}),
		// `by`: who answered, which the plan's ask_answered line records. Taken as a rest so the
		// double fits the manager's signature before and after it gains the person.
		answer: (name, ask, allow, ...rest: readonly unknown[]) =>
			Effect.sync(() => {
				calls.answers.push({name, ask, allow, by: rest[0]});
			}),
	};
	return {service, calls, state, agents};
};

type Double = ReturnType<typeof double>;

/** Wait until `check` holds, five seconds at most. */
const until = (what: string, check: () => boolean) =>
	Effect.gen(function* () {
		for (let i = 0; i < 500; i += 1) {
			if (check()) {
				return;
			}

			yield* Effect.sleep(Duration.millis(10));
		}

		return yield* Effect.die(`waited five seconds for ${what}`);
	});

/** A tsh in tile t1, writing as `by`, with the `turn` program listed on the double. */
const tshOn = (d: Double, by: string = PERSON) =>
	Effect.gen(function* () {
		const storage = memoryStorage();
		const jobs = yield* openJobs(storage);
		const printed = ear<Printed>();
		const ready = ear<Ready>();
		const tables = ear<unknown>();
		const status = ear<unknown>();
		const asked = ear<{n: number; text: string | null}>();
		const services = Layer.succeed(SummonManager, d.service);
		const list = programList([...SMALL, listed(turnProgram, services)]);
		const started = yield* start(
			tsh,
			{show: "short"},
			{
				printed: printed.hear,
				ready: ready.hear,
				table: tables.hear,
				status: status.hear,
				asked: asked.hear,
			},
			{id: "tsh:summon", storage},
		).pipe(
			Effect.provideService(HostJobs, {...jobs, owner: "t1", by}),
			Effect.provideService(Programs, by === AGENT ? forAgent(list) : list),
			Effect.provideService(SummonManager, d.service),
		);

		if (started.kind !== "running") {
			return yield* Effect.die("tsh did not start");
		}

		let told = 0;
		/** Type a line; its `ready` comes later, from `done`. */
		const type = (text: string) =>
			Effect.gen(function* () {
				expect(yield* tell(started.run, "line", text)).toBe("queued");
				told += 1;
				return told;
			});
		/** The status of the `n`th line, once the prompt is back. */
		const done = (n: number) => Effect.map(ready.upTo(n), (all) => all[n - 1]?.status);
		/** A line, typed and waited on: its status and what it printed on err and on out. */
		const line = (text: string) =>
			Effect.gen(function* () {
				const from = printed.values.length;
				const n = yield* type(text);
				const status = yield* done(n);
				const said = printed.values.slice(from);
				return {
					status,
					err: said.filter((p) => p.to === "err").map((p) => p.text),
					out: said.filter((p) => p.to === "out").map((p) => p.text),
				};
			});
		return {
			run: started.run,
			table: jobs.table as JobTable,
			printed,
			ready,
			tables,
			status,
			asked,
			type,
			done,
			line,
		};
	});

const texts = (printed: readonly Printed[]) => printed.map((p) => p.text);

describe("summon, dismiss and agents, in tsh", () => {
	it("explains extra summon settings and never calls the manager", async () => {
		const d = double([]);
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* (yield* tshOn(d)).line("summon fake fake-large high low as scout");
			}).pipe(Effect.scoped),
		);
		expect(seen).toMatchObject({
			status: 2,
			err: [
				"tsh: summon takes at most two settings, a model then an effort, not fake-large high low",
			],
		});
		expect(d.calls.summons).toEqual([]);
	});

	it("agents explains how to start when no agent is summoned", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const t = yield* tshOn(double([]));
				return {line: yield* t.line("agents"), tables: t.tables.values};
			}).pipe(Effect.scoped),
		);
		expect(seen.line).toEqual({
			status: 0,
			err: [],
			out: ["No agent is summoned. summon <agent> as <name> starts one."],
		});
		expect(seen.tables).toEqual([]);
	});

	it("separates the model and effort in the summon answer", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* (yield* tshOn(double([]))).line("summon fake fake-large high as scout");
			}).pipe(Effect.scoped),
		);
		expect(seen.out.join("\n")).toContain("fake fake-large · high");
	});

	it("bare @ lists both names when more than one agent is summoned", async () => {
		const d = double(["scout", "researcher"]);
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* (yield* tshOn(d)).line("@ hello");
			}).pipe(Effect.scoped),
		);
		expect(seen.status).toBe(2);
		expect(seen.err.join("\n")).toContain("there are 2: @scout @researcher");
		expect(d.calls.turns).toEqual([]);
	});
	it("summon hands the manager the agent, its setting words in order, the name and the person", async () => {
		const d = double([]);
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const t = yield* tshOn(d);
				return yield* t.line("summon fake fake-large high as scout");
			}).pipe(Effect.scoped),
		);
		expect(seen.status).toBe(0);
		expect(d.calls.summons).toEqual([
			{agent: "fake", settings: ["fake-large", "high"], name: "scout", by: PERSON},
		]);
		// S5: say where it runs.
		expect([...seen.out, ...seen.err].join("\n")).toContain("on this Mac");
	});

	it("refuses `on <place>` in words, and asks the manager nothing", async () => {
		const d = double([]);
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const t = yield* tshOn(d);
				return yield* t.line("summon fake as scout on cloud");
			}).pipe(Effect.scoped),
		);
		expect(seen.status).not.toBe(0);
		expect(seen.err.join("\n")).toContain("this Mac");
		expect(d.calls.summons).toEqual([]);
	});

	it("dismiss asks the manager to dismiss the name, and says so", async () => {
		const d = double(["scout"]);
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const t = yield* tshOn(d);
				return yield* t.line("dismiss scout");
			}).pipe(Effect.scoped),
		);
		expect(seen.status).toBe(0);
		expect(d.calls.dismisses).toEqual(["scout"]);
		expect([...seen.out, ...seen.err].join("\n")).toContain("dismissed");
	});

	it("agents lists each summoned name with its state", async () => {
		const d = double(["scout"]);
		const shown = await Effect.runPromise(
			Effect.gen(function* () {
				const t = yield* tshOn(d);
				const seen = yield* t.line("agents");
				expect(seen.status).toBe(0);
				return JSON.stringify([seen.out, t.tables.values]);
			}).pipe(Effect.scoped),
		);
		expect(shown).toContain("scout");
		expect(shown).toContain("idle");
	});

	it("@ to a name nobody summoned is refused, and starts no turn", async () => {
		const d = double(["scout"]);
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const t = yield* tshOn(d);
				const nobody = yield* t.line("@nobody hi");
				const upper = yield* t.line("@Scout hi");
				const typo = yield* t.line("@scuot hi");
				return {nobody, upper, typo, jobs: t.table.getState().jobs.length};
			}).pipe(Effect.scoped),
		);

		for (const refused of [seen.nobody, seen.upper, seen.typo]) {
			expect(refused.status).not.toBe(0);
		}

		expect(seen.nobody.err.join("\n")).toContain("nobody");
		expect(seen.nobody.err.join("\n")).toContain("no agent named nobody");
		// Upper case is refused with the lower-case name as its did-you-mean, never folded (S3).
		expect(seen.upper.err.join("\n")).toContain("Did you mean scout");
		expect(seen.typo.err.join("\n")).toContain("Did you mean scout");
		expect(d.calls.turns).toEqual([]);
		expect(seen.jobs).toBe(0);
	});
});

describe("S-2: a said line is one job in the foreground", () => {
	it("@scout a | b & begins one turn job, not in the background, the prompt held until its result", async () => {
		const d = double(["scout"]);
		const line = "@scout a | b &";
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const t = yield* tshOn(d);
				const n = yield* t.type(line);
				yield* until("the turn", () => d.calls.turns.length === 1);
				yield* until("its job", () => t.table.getState().jobs.length === 1);
				const during = t.table.getState().jobs;
				const held = t.ready.values.length;
				const [asked] = d.calls.turns;

				if (asked === undefined) {
					return yield* Effect.die("no turn");
				}

				Queue.offerUnsafe(asked.news, {_tag: "told", turn: 1});
				Queue.offerUnsafe(asked.news, {_tag: "said", text: "ok"});
				Queue.offerUnsafe(asked.news, RESULT);
				const status = yield* t.done(n);
				yield* until("the job to leave the table", () => t.table.getState().jobs.length === 0);
				return {during, held, status};
			}).pipe(Effect.scoped),
		);
		expect(seen.held).toBe(0);
		expect(seen.status).toBe(0);
		expect(seen.during).toHaveLength(1);
		const [job] = seen.during;
		expect(job).toMatchObject({text: line, background: false, by: PERSON, owner: "t1"});
		expect(job?.stages).toHaveLength(1);
		expect(job?.stages[0]).toMatchObject({program: "turn", flags: {to: "scout"}});
		expect(d.calls.turns.map((t) => [t.name, t.prompt, t.room])).toEqual([
			["scout", "a | b &", null],
		]);
	});
});

describe("S-5, tsh's side: Ctrl-C cancels the turn, not the agent", () => {
	// Plan: Ctrl-C stops this job's turn; `told` identifies which turn it owns.
	it("T237-3: stopping a job before its turn begins leaves another job's active turn alone", async () => {
		const d = double();
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const told = ear<unknown>();
				const result = ear<{stop: string}>();
				const first = yield* start(
					turnProgram,
					{to: "scout"},
					{
						told: told.hear,
						result: result.hear,
					},
					{id: "turn:t1", storage: memoryStorage()},
				);
				const queued = yield* start(
					turnProgram,
					{to: "scout"},
					{},
					{
						id: "turn:t2",
						storage: memoryStorage(),
					},
				);

				if (first.kind !== "running" || queued.kind !== "running") {
					return yield* Effect.die("turn did not start");
				}

				yield* tell(first.run, "prompt", "first tile's turn");
				first.close("prompt");
				yield* until("the first turn", () => d.calls.turns.length === 1);
				Queue.offerUnsafe(d.calls.turns[0]!.news, {_tag: "told", turn: 1});
				yield* told.upTo(1);
				yield* tell(queued.run, "prompt", "second tile's turn");
				queued.close("prompt");
				yield* until("the second job waiting for told", () => d.calls.turns.length === 2);
				// Only the first job has received a turn number. The second is still queued.
				yield* queued.stop;
				const cancels = [...d.calls.cancels];
				Queue.offerUnsafe(d.calls.turns[0]!.news, RESULT);
				yield* first.run.ended;
				return {cancels, result: result.values};
			}).pipe(Effect.provideService(SummonManager, d.service), Effect.scoped),
		);
		expect(seen.cancels).toEqual([]);
		expect(seen.result).toMatchObject([{stop: "end_turn"}]);
	});

	it("stops the turn job with 130, cancels scout's turn, dismisses nothing, and the next @scout runs", async () => {
		const d = double(["scout"]);
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const t = yield* tshOn(d);
				const n = yield* t.type("@scout slowly read everything");
				yield* until("the turn", () => d.calls.turns.length === 1);
				const [asked] = d.calls.turns;

				if (asked === undefined) {
					return yield* Effect.die("no turn");
				}

				Queue.offerUnsafe(asked.news, {_tag: "told", turn: 1});
				Queue.offerUnsafe(asked.news, {_tag: "status", text: "reading · 1 tool · 1s"});
				yield* until("the turn job", () => t.table.getState().jobs.length === 1);
				expect(yield* tell(t.run, "signal", "interrupt")).toBe("queued");
				const status = yield* t.done(n);
				const said = texts(t.printed.values);
				d.state.auto = true;
				const next = yield* t.line("@scout and now?");
				const agents = yield* t.line("agents");
				return {status, said, next, agents: JSON.stringify([agents.out, t.tables.values])};
			}).pipe(Effect.scoped),
		);
		expect(seen.status).toBe(130);
		expect(d.calls.cancels).toEqual(["scout"]);
		expect(d.calls.dismisses).toEqual([]);
		expect(seen.said.join("\n")).toContain("scout: turn cancelled");
		expect(seen.next.status).toBe(0);
		expect(d.calls.turns.map((t) => t.prompt)).toEqual(["slowly read everything", "and now?"]);
		expect(seen.agents).toContain("scout");
	});
});

describe("S-7, tsh's side: the reply prints once, whole, under the name", () => {
	it("prints the said text in one line with scout's name; the status goes to status, never printed", async () => {
		const d = double(["scout"]);
		const reply = "It formats the number in two places: once in post, once in its line.";
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const t = yield* tshOn(d);
				const n = yield* t.type("@scout why does post print #7 twice?");
				yield* until("the turn", () => d.calls.turns.length === 1);
				const [asked] = d.calls.turns;

				if (asked === undefined) {
					return yield* Effect.die("no turn");
				}

				Queue.offerUnsafe(asked.news, {_tag: "told", turn: 3});
				Queue.offerUnsafe(asked.news, {
					_tag: "status",
					text: "reading programs/tracker/post · 2 tools · 14s",
				});
				Queue.offerUnsafe(asked.news, {_tag: "said", text: reply});
				Queue.offerUnsafe(asked.news, RESULT);
				const status = yield* t.done(n);
				return {status, said: texts(t.printed.values), statuses: JSON.stringify(t.status.values)};
			}).pipe(Effect.scoped),
		);
		expect(seen.status).toBe(0);
		const replies = seen.said.filter((s) => s.includes("It formats"));
		expect(replies).toHaveLength(1);
		expect(replies[0]).toContain(reply);
		expect(replies[0]).toContain("scout");
		expect(seen.statuses).toContain("reading programs/tracker/post");
		expect(seen.said.some((s) => s.includes("reading programs/tracker/post"))).toBe(false);
		expect(d.calls.turns.map((t) => t.prompt)).toEqual(["why does post print #7 twice?"]);
	});
});

describe("the ask: allow? [y/N] holds the prompt", () => {
	// Plan: "each edit asks" and the ask row in "One press traced". Two asks must both be answerable.
	it("T237-6: answering one of two asks leaves the other answerable", async () => {
		const d = double();
		await Effect.runPromise(
			Effect.gen(function* () {
				const t = yield* tshOn(d);
				const n = yield* t.type("@scout edit two files");
				yield* until("the turn", () => d.calls.turns.length === 1);
				const turn = d.calls.turns[0]!;
				Queue.offerUnsafe(turn.news, {_tag: "told", turn: 1});
				Queue.offerUnsafe(turn.news, {_tag: "ask", ask: "edit-a", title: "Write a.txt"});
				yield* t.asked.upTo(1);
				Queue.offerUnsafe(turn.news, {_tag: "ask", ask: "edit-b", title: "Write b.txt"});
				// A following status proves the second ask was consumed, even if the UI queues it.
				Queue.offerUnsafe(turn.news, {_tag: "status", text: "waiting on two edits"});
				yield* until("both asks consumed", () => t.status.values.length > 0);
				const first = t.asked.values.at(-1)?.text?.includes("a.txt") ? "edit-a" : "edit-b";
				const other = first === "edit-a" ? "edit-b" : "edit-a";
				const title = other === "edit-a" ? "Write a.txt" : "Write b.txt";
				const job = t.table.getState().jobs[0]!;
				const before = t.asked.values.length;
				yield* tell(t.run, "answer", {n: job.n, allow: true});
				yield* until("the answer shown", () => t.asked.values.length > before);
				yield* until(
					"the other ask shown",
					() => t.asked.values.at(-1)?.text?.includes(title) === true,
				).pipe(Effect.timeoutOption("250 millis"));
				expect(t.asked.values.at(-1)?.text ?? "").toContain(title);
				expect(t.ready.values).toEqual([]);
				yield* tell(t.run, "answer", {n: job.n, allow: false});
				yield* until("both answers", () => d.calls.answers.length === 2);
				expect(d.calls.answers).toEqual([
					{name: "scout", ask: first, allow: true, by: PERSON},
					{name: "scout", ask: other, allow: false, by: PERSON},
				]);
				Queue.offerUnsafe(turn.news, RESULT);
				expect(yield* t.done(n)).toBe(0);
			}).pipe(Effect.scoped),
		);
	});

	it.each([
		{by: "person", allow: false, asked: true},
		{by: "agent", allow: true, asked: true},
		{by: "agent", allow: false, asked: true},
		{by: "agent", allow: false, asked: false},
	])(
		"keeps the ask id and title when $by answers allow=$allow after asked=$asked",
		async ({by, allow, asked}) => {
			const d = double();
			const asks = await Effect.runPromise(
				Effect.gen(function* () {
					const seen = ear<unknown>();
					const started = yield* start(
						turnProgram,
						{to: "scout"},
						{ask: seen.hear},
						{
							id: "turn:answer-title",
							storage: memoryStorage(),
						},
					).pipe(Effect.provideService(SummonManager, d.service));

					if (started.kind !== "running") {
						return yield* Effect.die("turn did not start");
					}

					yield* tell(started.run, "prompt", "write it");
					yield* until("the turn", () => d.calls.turns.length === 1);
					const turn = d.calls.turns[0];

					if (turn === undefined) {
						return yield* Effect.die("no turn");
					}

					Queue.offerUnsafe(turn.news, {_tag: "told", turn: 1});

					if (asked) {
						Queue.offerUnsafe(turn.news, {_tag: "ask", ask: "edit-1", title: "Write written.txt"});
						yield* seen.upTo(1);
					}

					if (by === "person") {
						yield* tell(started.run, "allow", {ask: "edit-1", allow, by: PERSON});
					} else {
						Queue.offerUnsafe(turn.news, {_tag: "answered", ask: "edit-1", allow});
					}

					yield* seen.upTo(asked ? 2 : 1);
					Queue.offerUnsafe(turn.news, RESULT);
					yield* started.run.ended;
					return seen.values;
				}).pipe(Effect.scoped),
			);
			expect(asks).toEqual([
				...(asked
					? [{name: "scout", ask: "edit-1", title: "Write written.txt", answer: "waiting"}]
					: []),
				{
					name: "scout",
					ask: "edit-1",
					title: asked ? "Write written.txt" : "",
					answer: allow ? "allowed" : "refused",
				},
			]);
		},
	);

	it("shows the agent's ask with its name and title, and the turn ends once it is over", async () => {
		const d = double(["scout"]);
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const t = yield* tshOn(d);
				const n = yield* t.type("@scout write it");
				yield* until("the turn", () => d.calls.turns.length === 1);
				const [asked] = d.calls.turns;

				if (asked === undefined) {
					return yield* Effect.die("no turn");
				}

				Queue.offerUnsafe(asked.news, {_tag: "told", turn: 1});
				Queue.offerUnsafe(asked.news, {_tag: "ask", ask: "t1.w", title: "Write written.txt"});
				const shown = () => JSON.stringify([texts(t.printed.values), t.asked.values]);
				yield* until("the ask shown", () => shown().includes("allow? [y/N]"));
				const held = t.ready.values.length;
				Queue.offerUnsafe(asked.news, {_tag: "said", text: "wrote written.txt"});
				Queue.offerUnsafe(asked.news, RESULT);
				const status = yield* t.done(n);
				return {held, status, shown: shown()};
			}).pipe(Effect.scoped),
		);
		expect(seen.held).toBe(0);
		expect(seen.status).toBe(0);
		expect(seen.shown).toContain("scout asks: Write written.txt");
		expect(seen.shown).toContain("allow? [y/N]");
	});
});

describe("S-8: only a person summons, dismisses or talks", () => {
	// The plan's person-only rule applies to the listed `turn` spelling too.
	it("T237-2: an agent cannot start paid work by spelling turn directly", async () => {
		const d = double();
		d.state.auto = true;
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* (yield* tshOn(d, AGENT)).line('turn --to scout prompt="do paid work"');
			}).pipe(Effect.scoped),
		);
		expect(d.calls.turns).toEqual([]);
		expect(seen.status).not.toBe(0);
		expect(seen.err.join("\n")).not.toBe("");
	});

	it("from an agent's tsh, summon, dismiss and @ are refused, and the manager is asked nothing", async () => {
		const d = double(["scout"]);
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const t = yield* tshOn(d, AGENT);
				const summon = yield* t.line("summon fake as helper");
				const dismiss = yield* t.line("dismiss scout");
				const at = yield* t.line("@scout hi");
				return {summon, dismiss, at, jobs: t.table.getState().jobs.length};
			}).pipe(Effect.scoped),
		);

		for (const refused of [seen.summon, seen.dismiss, seen.at]) {
			expect(refused.status).not.toBe(0);
			expect(refused.err.length).toBeGreaterThan(0);
		}

		expect(seen.dismiss.err.join("\n")).toContain("only a person dismisses an agent");
		expect(d.calls.summons).toEqual([]);
		expect(d.calls.dismisses).toEqual([]);
		expect(d.calls.turns).toEqual([]);
		expect(seen.jobs).toBe(0);
		expect([...d.agents.keys()]).toEqual(["scout"]);
	});

	it("tsh's answer and turn's allow are inputs only a person tells, so forAgent lists neither", () => {
		const d = double();
		const entry = listed(turnProgram, Layer.succeed(SummonManager, d.service));
		expect(tsh.inputs.answer.personOnly).toBe(true);
		expect(turnProgram.inputs.allow.personOnly).toBe(true);
		expect(Object.keys(entry.program.inputs)).toContain("allow");
		const theirs = forAgent(programList([entry])).get("turn");
		expect(theirs).toBeDefined();
		expect(Object.keys(theirs?.program.inputs ?? {})).not.toContain("allow");
	});
});

// Laws the lead added after the builder's first round (the plan's "What this piece records", its
// Ctrl-C row and S-7). Each is expected to fail on 8398b44f.

describe("S-7, tsh's side: a reply of several lines hangs under its name", () => {
	it("indents each later line of the reply to where its text starts after ✦ scout", async () => {
		const d = double(["scout"]);
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const t = yield* tshOn(d);
				const n = yield* t.type("@scout read a.txt and b.txt");
				yield* until("the turn", () => d.calls.turns.length === 1);
				const [asked] = d.calls.turns;

				if (asked === undefined) {
					return yield* Effect.die("no turn");
				}

				Queue.offerUnsafe(asked.news, {_tag: "told", turn: 1});
				Queue.offerUnsafe(asked.news, {
					_tag: "said",
					text: "The river is Kura.\nThe bridge has 7 arches.",
				});
				Queue.offerUnsafe(asked.news, RESULT);
				yield* t.done(n);
				return texts(t.printed.values).join("\n");
			}).pipe(Effect.scoped),
		);
		const head = "✦ scout  ";
		expect(seen).toContain(
			`${head}The river is Kura.\n${" ".repeat(head.length)}The bridge has 7 arches.`,
		);
	});
});

describe("Ctrl-C on a turn prints one line", () => {
	it("says scout: turn cancelled, and no second [stopped] line for the same job", async () => {
		const d = double(["scout"]);
		const said = await Effect.runPromise(
			Effect.gen(function* () {
				const t = yield* tshOn(d);
				const n = yield* t.type("@scout slowly read everything");
				yield* until("the turn", () => d.calls.turns.length === 1);
				const [asked] = d.calls.turns;

				if (asked === undefined) {
					return yield* Effect.die("no turn");
				}

				Queue.offerUnsafe(asked.news, {_tag: "told", turn: 1});
				yield* until("the turn job", () => t.table.getState().jobs.length === 1);
				const from = t.printed.values.length;
				expect(yield* tell(t.run, "signal", "interrupt")).toBe("queued");
				yield* t.done(n);
				return texts(t.printed.values.slice(from));
			}).pipe(Effect.scoped),
		);
		// The plan's Ctrl-C row and its turn-cancelled shot name this line, and only it.
		expect(said.filter((l) => /cancel|stopped/.test(l))).toEqual(["scout: turn cancelled"]);
	});
});

describe("ask_answered records who answered", () => {
	it("a person's y on tsh's answer reaches the manager with that person as by", async () => {
		const d = double(["scout"]);
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const t = yield* tshOn(d);
				const n = yield* t.type("@scout write it");
				yield* until("the turn", () => d.calls.turns.length === 1);
				const [asked] = d.calls.turns;

				if (asked === undefined) {
					return yield* Effect.die("no turn");
				}

				Queue.offerUnsafe(asked.news, {_tag: "told", turn: 1});
				Queue.offerUnsafe(asked.news, {_tag: "ask", ask: "t1.w", title: "Write written.txt"});
				yield* until("the ask shown", () => t.asked.values.length > 0);
				const job = t.table.getState().jobs[0];

				if (job === undefined) {
					return yield* Effect.die("no job");
				}

				expect(yield* tell(t.run, "answer", {n: job.n, allow: true})).toBe("queued");
				yield* until("the answer", () => d.calls.answers.length === 1);
				Queue.offerUnsafe(asked.news, RESULT);
				yield* t.done(n);
				return {answers: d.calls.answers, errors: t.printed.values.filter((p) => p.to === "err")};
			}).pipe(Effect.scoped),
		);
		expect(seen.answers).toEqual([{name: "scout", ask: "t1.w", allow: true, by: PERSON}]);
		expect(seen.errors).toEqual([]);
	});
});

describe("T237-4, the turn's side: a told turn is kept with its run", () => {
	// Plan: "Who holds what" and the turn program's kept {name, run, turn}.
	/** One turn job on the double, told turn 3; `then` runs while that turn is open. */
	const told3 = <A>(
		d: Double,
		then: (run: {stop: Effect.Effect<void>; result: Effect.Effect<unknown>}) => Effect.Effect<A>,
	) =>
		Effect.gen(function* () {
			const told = ear<unknown>();
			const result = ear<unknown>();
			const started = yield* start(
				turnProgram,
				{to: "scout"},
				{told: told.hear, result: result.hear},
				{id: "turn:kept", storage: memoryStorage()},
			);

			if (started.kind !== "running") {
				return yield* Effect.die("turn did not start");
			}

			const kept = () => started.run.machines.turn.state();
			yield* tell(started.run, "prompt", "slowly read a.txt");
			yield* until("the turn", () => d.calls.turns.length === 1);
			const before = kept();
			Queue.offerUnsafe(d.calls.turns[0]!.news, {_tag: "told", turn: 3});
			yield* told.upTo(1);
			const during = kept();
			const got = yield* then({
				stop: started.stop,
				result: started.run.ended.pipe(Effect.andThen(result.upTo(1))),
			});
			return {before, during, got, after: kept()};
		}).pipe(Effect.provideService(SummonManager, d.service), Effect.scoped);

	it("keeps {name, run, turn} once told, and nothing once the turn's result is in", async () => {
		const d = double(["scout"], "run-7");
		const seen = await Effect.runPromise(
			told3(d, (run) =>
				Effect.gen(function* () {
					Queue.offerUnsafe(d.calls.turns[0]!.news, RESULT);
					yield* run.result;
				}),
			),
		);
		expect(seen.before).toEqual({active: null});
		expect(seen.during).toEqual({
			active: {name: "scout", run: "run-7", turn: 3, began: expect.any(Number)},
		});
		expect(seen.after).toEqual({active: null});
	});

	it("a stop cancels the turn it was told, of the run identify named", async () => {
		const d = double(["scout"], "run-7");
		await Effect.runPromise(told3(d, (run) => run.stop));
		expect(d.calls.mines).toEqual([{turn: 3, run: "run-7"}]);
	});

	it("says its status line as waiting, or the name and turn it runs", () => {
		const status = turnProgram.machines.turn.status;
		expect(status({active: null})).toBe("waiting");
		expect(status({active: {name: "scout", run: "run-7", turn: 3, began: 0}})).toBe(
			"scout · turn 3",
		);
	});
});

describe("the ask's prompt line clears when nothing waits", () => {
	/** A tsh turn told 1, with `asks` sent in order, each shown or held behind the first. */
	const asking = (d: Double, asks: readonly {ask: string; title: string}[]) =>
		Effect.gen(function* () {
			const t = yield* tshOn(d);
			const n = yield* t.type("@scout edit it");
			yield* until("the turn", () => d.calls.turns.length === 1);
			const turn = d.calls.turns[0]!;
			Queue.offerUnsafe(turn.news, {_tag: "told", turn: 1});

			for (const a of asks) {
				Queue.offerUnsafe(turn.news, {_tag: "ask", ...a});
			}

			Queue.offerUnsafe(turn.news, {_tag: "status", text: "waiting on an edit"});
			yield* until("the asks consumed", () => t.status.values.length > 0);
			return {t, n, turn};
		});
	const cleared = (t: {asked: {values: readonly {text: string | null}[]}}) =>
		until("the ask cleared", () => t.asked.values.at(-1)?.text === null);

	it("an ask sent twice is shown once: its one answer clears it", async () => {
		const d = double();
		await Effect.runPromise(
			Effect.gen(function* () {
				const edit = {ask: "edit-a", title: "Write a.txt"};
				const {t, n, turn} = yield* asking(d, [edit, edit]);
				expect(t.asked.values.filter((a) => a.text !== null)).toHaveLength(1);
				const job = t.table.getState().jobs[0]!;
				yield* tell(t.run, "answer", {n: job.n, allow: true});
				yield* until("the answer", () => d.calls.answers.length === 1);
				yield* cleared(t);
				Queue.offerUnsafe(turn.news, RESULT);
				expect(yield* t.done(n)).toBe(0);
			}).pipe(Effect.scoped),
		);
		expect(d.calls.answers).toEqual([{name: "scout", ask: "edit-a", allow: true, by: PERSON}]);
	});

	it("a turn that ends with its ask unanswered clears the ask", async () => {
		const d = double();
		const last = await Effect.runPromise(
			Effect.gen(function* () {
				const {t, n, turn} = yield* asking(d, [{ask: "edit-a", title: "Write a.txt"}]);
				expect(t.asked.values.at(-1)?.text ?? "").toContain("Write a.txt");
				Queue.offerUnsafe(turn.news, RESULT);
				expect(yield* t.done(n)).toBe(0);
				yield* cleared(t);
				return t.asked.values.at(-1);
			}).pipe(Effect.scoped),
		);
		expect(last?.text).toBeNull();
	});
});
