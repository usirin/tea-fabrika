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
 * Otherwise the test pushes each turn's news on its queue.
 */
const double = (names: readonly string[] = ["scout"]) => {
	const agents = new Map(names.map((n) => [n, summonedAs(n, PERSON)]));
	const calls = {
		summons: [] as unknown[],
		dismisses: [] as string[],
		turns: [] as Asked[],
		cancels: [] as string[],
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
		cancel: (name) =>
			Effect.sync(() => {
				calls.cancels.push(name);
				for (const t of calls.turns)
					if (t.name === name)
						Queue.offerUnsafe(t.news, {_tag: "result", stop: "cancelled", ms: 1, cost: null});
			}),
		answer: (name, ask, allow) =>
			Effect.sync(() => {
				calls.answers.push({name, ask, allow});
			}),
	};
	return {service, calls, state, agents};
};

type Double = ReturnType<typeof double>;

/** Wait until `check` holds, five seconds at most. */
const until = (what: string, check: () => boolean) =>
	Effect.gen(function* () {
		for (let i = 0; i < 500; i += 1) {
			if (check()) return;
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
		const asked = ear<unknown>();
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
			Effect.provideService(Programs, list),
			Effect.provideService(SummonManager, d.service),
		);
		if (started.kind !== "running") return yield* Effect.die("tsh did not start");
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
		for (const refused of [seen.nobody, seen.upper, seen.typo]) expect(refused.status).not.toBe(0);
		expect(seen.nobody.err.join("\n")).toContain("nobody");
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
				if (asked === undefined) return yield* Effect.die("no turn");
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
	it("stops the turn job with 130, cancels scout's turn, dismisses nothing, and the next @scout runs", async () => {
		const d = double(["scout"]);
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const t = yield* tshOn(d);
				const n = yield* t.type("@scout slowly read everything");
				yield* until("the turn", () => d.calls.turns.length === 1);
				const [asked] = d.calls.turns;
				if (asked === undefined) return yield* Effect.die("no turn");
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
				if (asked === undefined) return yield* Effect.die("no turn");
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
	it("shows the agent's ask with its name and title, and the turn ends once it is over", async () => {
		const d = double(["scout"]);
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const t = yield* tshOn(d);
				const n = yield* t.type("@scout write it");
				yield* until("the turn", () => d.calls.turns.length === 1);
				const [asked] = d.calls.turns;
				if (asked === undefined) return yield* Effect.die("no turn");
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
		expect(Object.keys(theirs?.program.inputs ?? {})).toContain("prompt");
	});
});
