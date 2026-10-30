import {layer as nodeFileSystem} from "@effect/platform-node/NodeFileSystem";
import {
	Ledger,
	memoryStorage,
	openJobs,
	runTraceId,
	Shell,
	type Storage,
	streams,
	Traces,
} from "@kampus/fabrika";
import {memoryService} from "@kampus/fabrika/memory";
import {fileStorage} from "@kampus/fabrika/storage/node";
import {type CodeFact, nameOf} from "@kampus/pipeline/tickets/ticket";
import {Tickets, ticketsOnLedger} from "@kampus/pipeline/tickets/tickets";
import {memoryTraces} from "@tea-fabrika/trace/memory";
import {Author, PullRequests, tracker} from "@tea-fabrika/tracker";
import {LANE, SEVEN, SEVEN_BODY, SEVEN_TITLE, SEVEN_TRACE} from "@tea-fabrika/tracker/seven";
import {Effect, FileSystem, Layer, Schema} from "effect";
import {describe, expect, it} from "vitest";
import {gridOf} from "./editor/grid.ts";
import {type History, memoryHistory, type SharedHistory, sharedHistory} from "./editor/history.ts";
import type {TileJobs} from "./tile-jobs.ts";
import {appPrograms, type Placed, type Runs, startTsh, tshList, type WindowScreen} from "./tsh.ts";

// One tile's tsh, with a fake terminal page and a fake tile and no Electron: what a person would see
// in the terminal, read off its grid (editor/grid.ts), and what each program's view is shown.
// The ledger is in memory.

/** What the fake tile saw, in order. */
type Seen =
	| {readonly kind: "open"; readonly run: string; readonly program: string; readonly placed: Placed}
	| {readonly kind: "forward"; readonly run: string}
	| {readonly kind: "line"; readonly runs: readonly string[]}
	| {readonly kind: "view"; readonly run: string; readonly data: unknown}
	| {readonly kind: "close"; readonly run: string}
	| {readonly kind: "running"; readonly count: number; readonly jobs: TileJobs};

/** Records nobody wrote: every trace id reads as an empty record. */
const noTraces = Effect.runSync(
	Effect.gen(function* () {
		return yield* Traces;
	}).pipe(Effect.provide(memoryTraces([]))),
);

const session = (
	opts: {
		/** Where the host keeps its job table, kept between hosts as the home's folder is. */
		readonly jobs?: Storage;
		/** Kept between hosts, as the history file is. Each host shares it with no other. */
		readonly history?: History;
		/** Shared with another host, as two tiles share it. */
		readonly shared?: SharedHistory;
		readonly ledger?: Ledger["Service"];
		/** The jobs' records `trace` reads. None written, unless a test hands its own. */
		readonly traces?: Layer.Layer<Traces>;
	} = {},
) =>
	Effect.gen(function* () {
		const seen: Seen[] = [];
		const screens = new Map<string, WindowScreen>();
		const runs: Runs = {
			began: (run, program, placed, screen) => {
				screens.set(run, screen);
				seen.push({kind: "open", run, program, placed});
				screen.show((m) => seen.push({kind: "view", run, data: m.data}));
			},
			forward: (run) => seen.push({kind: "forward", run}),
			line: (runs) => seen.push({kind: "line", runs}),
			ended: (run) => {
				const screen = screens.get(run);
				if (screen === undefined) return;
				screens.delete(run);
				seen.push({kind: "close", run});
				// As a real view does: taking it away says `closed`, whoever took it away.
				screen.closed();
			},
			jobs: (jobs) => seen.push({kind: "running", count: jobs.running.length, jobs}),
		};
		// Each session is a host of its own: it opens the host's table, on the storage it is handed.
		const jobs = yield* openJobs(opts.jobs ?? memoryStorage());
		const host = yield* startTsh({
			tile: "t1",
			jobs,
			history: opts.shared ?? (yield* sharedHistory(opts.history ?? memoryHistory())),
			runs,
		}).pipe(
			Effect.provideService(Ledger, opts.ledger ?? memoryService()),
			Effect.provideService(Author, {kind: "user", id: "owner"}),
			// No pull requests: no test reads GitHub.
			Effect.provideService(PullRequests, {open: Effect.succeed([])}),
			Effect.provide(opts.traces ?? memoryTraces([])),
		);
		let bytes = "";
		host.terminal.show((m) => {
			bytes += m.data;
		});
		const rows = () => gridOf(bytes, 80, 1000).rows;
		/** Wait until `check` holds, for at most five seconds. */
		const until = <T>(what: string, check: () => T | undefined) =>
			Effect.gen(function* () {
				for (let i = 0; i < 1000; i += 1) {
					const got = check();
					if (got !== undefined) return got;
					yield* Effect.sleep("5 millis");
				}
				return yield* Effect.die(`waited for ${what}; the terminal shows:\n${rows().join("\n")}`);
			});
		/** Wait until the terminal's last row is the prompt, after `n` prompts in all. */
		const prompts = (n: number) =>
			until(`prompt ${n}`, () => {
				const all = rows();
				return all.filter((r) => r.startsWith("tsh$")).length >= n && all.at(-1) === "tsh$"
					? all
					: undefined;
			});
		const type = (data: string) => host.terminal.heard({type: "keys", data});
		const opened = (n = 1) =>
			until(`window ${n}`, () => seen.filter((s) => s.kind === "open").at(n - 1));
		const viewed = (run: string, data: unknown) =>
			until(`${run} at ${JSON.stringify(data)}`, () =>
				seen.find(
					(s) =>
						s.kind === "view" && s.run === run && JSON.stringify(s.data) === JSON.stringify(data),
				),
			);
		const closed = (run: string) =>
			until(`${run} closed`, () => seen.find((s) => s.kind === "close" && s.run === run));
		/** The run's window, or one that refuses all it hears: a test pressing on no window fails on what it is told. */
		const window = (run: string): WindowScreen =>
			screens.get(run) ?? {
				show: () => () => {},
				heard: () => ({kind: "refused", why: `no window for ${run}`}),
				closed: () => {},
				kill: Effect.void,
			};
		const press = (run: string, value: unknown) =>
			window(run).heard({type: "msg", msg: {type: "press", value}});
		return {host, jobs, rows, until, prompts, type, opened, viewed, closed, window, press, seen};
	});

/** Ticket 7 on `ledger`, as a lane left it (@tea-fabrika/tracker/seven). */
const seedSeven = (ledger: Ledger["Service"]) =>
	Effect.gen(function* () {
		yield* ledger.register(nameOf(7), "user:owner");
		yield* ledger.send(streams(nameOf(7)).inbox, "filed", {
			kind: "filed",
			writer: "user:owner",
			data: {type: "filed", title: SEVEN_TITLE, body: SEVEN_BODY},
		});
		const tickets = yield* Tickets;
		for (const e of SEVEN.slice(1)) yield* tickets.write(7, `w/${e.pos}`, e.fact as CodeFact);
	}).pipe(Effect.provide(ticketsOnLedger(LANE)), Effect.provide(Layer.succeed(Ledger, ledger)));

const go = <A, E>(test: Effect.Effect<A, E, FileSystem.FileSystem>) =>
	Effect.runPromise(test.pipe(Effect.provide(nodeFileSystem)));

describe("the terminal", () => {
	it("runs a typed line, and shows what tsh printed under it", async () => {
		const rows = await go(
			Effect.gen(function* () {
				const s = yield* session();
				expect(s.type("seq --to 3 | double\r")).toEqual({kind: "read"});
				return yield* s.prompts(2);
			}).pipe(Effect.scoped),
		);
		expect(rows).toEqual(["tsh$ seq --to 3 | double", "double 2", "double 4", "double 6", "tsh$"]);
	});

	it("draws the screen once on a terminal that still holds it, as after the app reconnects", async () => {
		const rows = await go(
			Effect.gen(function* () {
				const s = yield* session();
				s.type("seq --to 3 | double\r");
				yield* s.prompts(2);
				// One page's terminal, shown the screen on its first port, then again on the next.
				let page = "";
				const first = s.host.terminal.show((m) => {
					page += m.data;
				});
				first();
				s.host.terminal.show((m) => {
					page += m.data;
				});
				return gridOf(page, 80, 1000).rows;
			}).pipe(Effect.scoped),
		);
		expect(rows).toEqual(["tsh$ seq --to 3 | double", "double 2", "double 4", "double 6", "tsh$"]);
	});

	it("completes a program's name on Tab", async () => {
		const rows = await go(
			Effect.gen(function* () {
				const s = yield* session();
				s.type("cou\t");
				return yield* s.until("counter on the line", () =>
					s.rows()[0] === "tsh$ counter" ? s.rows() : undefined,
				);
			}).pipe(Effect.scoped),
		);
		expect(rows).toEqual(["tsh$ counter"]);
	});

	it("refuses what does not read, and tells tsh nothing of it", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const s = yield* session();
				const refused = [
					s.host.terminal.heard({type: "line", value: "say --text no"}),
					s.host.terminal.heard({type: "keys", data: "say --text no\r", to: "tsh:p1"}),
					s.host.terminal.heard({type: "size", cols: 0, rows: 24}),
					s.host.terminal.heard("say --text no\r"),
				];
				s.type("say --text yes\r");
				return {refused, rows: yield* s.prompts(2)};
			}).pipe(Effect.scoped),
		);
		expect(seen.refused.map((r) => r.kind)).toEqual(Array(4).fill("refused"));
		expect(seen.rows).toEqual(["tsh$ say --text yes", "yes", "tsh$"]);
	});

	it("ends when tsh ends, on Ctrl-D", async () => {
		const ended = await go(
			Effect.gen(function* () {
				const s = yield* session();
				s.type("\x04");
				yield* s.host.ended;
				return true;
			}).pipe(Effect.scoped),
		);
		expect(ended).toBe(true);
	});
});

describe("a program's window", () => {
	it("opens for counter, is told a press, and closing it ends counter: tsh prints its count", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const s = yield* session();
				s.type("counter\r");
				const open = yield* s.opened();
				yield* s.viewed(open.run, {n: 0});
				const busy = s.rows();
				expect(s.press(open.run, "plus")).toEqual({kind: "read"});
				yield* s.viewed(open.run, {n: 1});
				// tsh's own input is not counter's: a line sent on counter's window is refused.
				const wrong = s.window(open.run).heard({type: "msg", msg: {type: "line", value: "x"}});
				const bad = s.press(open.run, "minus");
				const named = s.window(open.run).heard({type: "msg", to: "tsh:p1", msg: null});
				s.window(open.run).closed();
				const rows = yield* s.prompts(2);
				yield* s.closed(open.run);
				return {open, busy, wrong, bad, named, rows};
			}).pipe(Effect.scoped),
		);
		expect(seen.open.program).toBe("counter");
		expect(seen.open.placed).toBe("foreground");
		// The prompt waits while counter runs in the foreground: the cursor is on a fresh row.
		expect(seen.busy).toEqual(["tsh$ counter", ""]);
		expect(seen.wrong).toEqual({kind: "refused", why: "counter has no input line"});
		expect(seen.bad.kind === "refused" && seen.bad.why).toMatch(/^counter's press does not fit/);
		expect(seen.named.kind).toBe("refused");
		expect(seen.rows).toEqual(["tsh$ counter", "1", "tsh$"]);
	});

	it("opens for the tracker, files a ticket from it, and a new host on the same ledger lists it", async () => {
		const isShown = Schema.is(tracker.view.data);
		/** The titles the tracker's window was shown last, once it had read the ledger. */
		const titles = (seen: readonly Seen[], run: string) => {
			const last = seen.filter((s) => s.kind === "view" && s.run === run).at(-1);
			const data = last?.kind === "view" ? last.data : undefined;
			return isShown(data) && data.ready && data.page.kind === "list"
				? data.page.tickets.map((t) => t.title)
				: undefined;
		};
		const ledger = memoryService();
		const seen = await go(
			Effect.gen(function* () {
				const first = yield* Effect.gen(function* () {
					const s = yield* session({ledger});
					s.type("tracker\r");
					const open = yield* s.opened();
					const empty = yield* s.until("the empty list", () => titles(s.seen, open.run));
					const told = s.window(open.run).heard({
						type: "msg",
						msg: {type: "file", value: {title: "Login fails", body: ""}},
					});
					const filed = yield* s.until("the ticket on the list", () =>
						titles(s.seen, open.run)?.length === 1 ? titles(s.seen, open.run) : undefined,
					);
					// Closing its window is the person's "done": the tracker ends once its writes are saved.
					s.window(open.run).closed();
					yield* s.closed(open.run);
					return {program: open.program, empty, told, filed, rows: yield* s.prompts(2)};
				}).pipe(Effect.scoped);

				// A new host, with a new tsh, on the same ledger: the ticket is there.
				const s = yield* session({ledger});
				s.type("tracker\r");
				const open = yield* s.opened();
				return {first, again: yield* s.until("the list again", () => titles(s.seen, open.run))};
			}).pipe(Effect.scoped),
		);
		expect(seen).toEqual({
			first: {
				program: "tracker",
				empty: [],
				told: {kind: "read"},
				filed: ["Login fails"],
				rows: ["tsh$ tracker", "tsh$"],
			},
			again: ["Login fails"],
		});
	});

	it("closes when counter is done, pressed in its window", async () => {
		const rows = await go(
			Effect.gen(function* () {
				const s = yield* session();
				s.type("counter\r");
				const open = yield* s.opened();
				s.press(open.run, "plus");
				s.press(open.run, "plus");
				s.press(open.run, "done");
				yield* s.closed(open.run);
				return yield* s.prompts(2);
			}).pipe(Effect.scoped),
		);
		expect(rows).toEqual(["tsh$ counter", "2", "tsh$"]);
	});

	it("is stopped by Ctrl-C in the terminal, and closes", async () => {
		const rows = await go(
			Effect.gen(function* () {
				const s = yield* session();
				s.type("counter\r");
				const open = yield* s.opened();
				yield* s.viewed(open.run, {n: 0});
				s.type("\x03");
				yield* s.closed(open.run);
				return yield* s.prompts(2);
			}).pipe(Effect.scoped),
		);
		expect(rows.slice(0, 2)).toEqual(["tsh$ counter", "^C"]);
		expect(rows.at(-1)).toBe("tsh$");
	});

	it("opens for `counter &` and gives the prompt back at once, as a background job", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const s = yield* session();
				s.type("counter &\r");
				const open = yield* s.opened();
				const back = yield* s.prompts(2);
				const counted = yield* s.until("one running job", () =>
					s.seen.find((x) => x.kind === "running" && x.count === 1),
				);
				s.type("say --text meanwhile\r");
				yield* s.prompts(3);
				s.press(open.run, "plus");
				s.press(open.run, "done");
				yield* s.closed(open.run);
				const rows = yield* s.until("counter's count", () =>
					s.rows().some((r) => r.includes("1")) && s.rows().at(-1) === "tsh$"
						? s.rows()
						: undefined,
				);
				const none = yield* s.until("no running job", () =>
					s.seen.findLast((x) => x.kind === "running" && x.count === 0),
				);
				return {open, back, rows, counted, none};
			}).pipe(Effect.scoped),
		);
		expect(seen.open.placed).toBe("background");
		expect(seen.counted.kind === "running" && seen.counted.jobs.running).toEqual([
			{n: 1, text: "counter", since: expect.any(Number), foreground: false},
		]);
		// It ended on its own, after `done`: the tile is told so, in a job record's words.
		expect(seen.none.kind === "running" && seen.none.jobs).toEqual({
			running: [],
			ended: {
				n: 1,
				text: "counter",
				how: "done",
				since: expect.any(Number),
				at: expect.any(Number),
				foreground: false,
			},
		});
		expect(seen.back[0]).toBe("tsh$ counter &");
		expect(seen.back.at(-1)).toBe("tsh$");
		expect(seen.rows).toContain("meanwhile");
		expect(seen.rows.at(-1)).toBe("tsh$");
	});

	it("comes to the foreground on `attach %n`, as bash's fg, and the prompt waits for its end", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const s = yield* session();
				s.type("counter &\r");
				const open = yield* s.opened();
				yield* s.prompts(2);
				const before = s.seen.some((x) => x.kind === "forward");
				s.type("attach %1\r");
				const forward = yield* s.until("counter forward", () =>
					s.seen.find((x) => x.kind === "forward"),
				);
				s.press(open.run, "plus");
				s.press(open.run, "done");
				yield* s.closed(open.run);
				const rows = yield* s.prompts(3);
				return {open, before, forward, rows};
			}).pipe(Effect.scoped),
		);
		expect(seen.open.placed).toBe("background");
		expect(seen.before).toBe(false);
		expect(seen.forward).toEqual({kind: "forward", run: seen.open.run});
		expect(seen.rows).toContain("tsh$ attach %1");
		expect(seen.rows.at(-1)).toBe("tsh$");
	});

	it("closes: its programs get the end of their inputs and end on their own, then tsh ends", async () => {
		const rows = await go(
			Effect.gen(function* () {
				const s = yield* session();
				s.type("tally &\r");
				yield* s.prompts(2);
				s.type("counter &\r");
				const open = yield* s.opened();
				yield* s.prompts(3);
				yield* s.host.close;
				// Said again: nothing more happens.
				yield* s.host.close;
				yield* s.closed(open.run);
				yield* s.host.ended;
				// The terminal draws what tsh said last a moment after tsh ended.
				return yield* s.until("both ends", () =>
					s.rows().includes("[1] ended  tally") && s.rows().includes("[2] ended  counter")
						? s.rows()
						: undefined,
				);
			}).pipe(Effect.scoped),
		);
		// Each ended on its own, as on stdin's end: not "stopped".
		expect(rows).toContain("[1] ended  tally");
		expect(rows).toContain("[2] ended  counter");
		expect(rows.some((r) => r.includes("stopped") || r.includes("stop with tsh"))).toBe(false);
	});

	it("closes, and a program that does not end on its inputs' end keeps tsh running", async () => {
		const still = await go(
			Effect.gen(function* () {
				const s = yield* session();
				s.type("sleep --ms 600000 &\r");
				yield* s.until("one running job", () =>
					s.seen.find((x) => x.kind === "running" && x.count === 1),
				);
				yield* s.host.close;
				const ended = yield* s.host.ended.pipe(Effect.timeoutOption("300 millis"));
				return ended._tag;
			}).pipe(Effect.scoped),
		);
		expect(still).toBe("None");
	});

	it("tells the tile a job it waits for with no view, and how each job ended: stopped, failed", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const s = yield* session();
				// One program, no view, in the foreground: tsh `call`s it, and holds no handle to it.
				s.type("sleep --ms 600000\r");
				const waiting = yield* s.until("the sleep, waited for", () =>
					s.seen.find((x) => x.kind === "running" && x.count === 1),
				);
				s.type("\x03");
				const stopped = yield* s.until("the sleep, stopped", () =>
					s.seen.find((x) => x.kind === "running" && x.jobs.ended?.how === "stopped"),
				);
				yield* s.prompts(2);
				s.type("false &\r");
				const failed = yield* s.until("false, failed", () =>
					s.seen.find((x) => x.kind === "running" && x.jobs.ended?.how === "failed"),
				);
				return {waiting, stopped, failed};
			}).pipe(Effect.scoped),
		);
		const jobsOf = (x: (typeof seen)["waiting"]) => (x.kind === "running" ? x.jobs : null);
		expect(jobsOf(seen.waiting)?.running).toEqual([
			{n: 1, text: "sleep --ms 600000", since: expect.any(Number), foreground: true},
		]);
		expect(jobsOf(seen.stopped)).toMatchObject({
			running: [],
			ended: {n: 1, text: "sleep --ms 600000", how: "stopped", foreground: true},
		});
		expect(jobsOf(seen.failed)).toMatchObject({
			running: [],
			ended: {n: 2, text: "false", how: "failed", foreground: false},
		});
	});

	it("does not open for a line tsh refuses", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const s = yield* session();
				s.type("counter --missing yes\r");
				const rows = yield* s.prompts(2);
				return {rows, seen: [...s.seen]};
			}).pipe(Effect.scoped),
		);
		expect(seen.seen.filter((x) => x.kind !== "running")).toEqual([]);
		expect(seen.rows[1]).toMatch(/^tsh: /);
	});

	it("carries the pick down `tracker | ticket | runs`, and one window closed ends its one process", async () => {
		/** The ticket number the run's window was shown last, once it had read the ledger. */
		const numberOf = (seen: readonly Seen[], run: string) => {
			const last = seen.filter((s) => s.kind === "view" && s.run === run).at(-1);
			const data: unknown = last?.kind === "view" ? last.data : undefined;
			return typeof data === "object" && data !== null && "number" in data
				? data.number
				: undefined;
		};
		const got = await go(
			Effect.gen(function* () {
				const s = yield* session();
				s.type("tracker | ticket | runs\r");
				yield* s.opened(3);
				// The windows open from the end of the line back: each found by its program.
				const of = (program: string) =>
					s.until(`${program}'s window`, () => {
						const one = s.seen.find((x) => x.kind === "open" && x.program === program);
						return one?.kind === "open" ? one : undefined;
					});
				const [picker, page, trail] = [
					yield* of("tracker"),
					yield* of("ticket"),
					yield* of("runs"),
				];
				const pick = (ticket: number) =>
					s.window(picker.run).heard({type: "msg", msg: {type: "query", value: {ticket}}});
				const both = (n: number) =>
					s.until(`ticket and runs on #${n}`, () =>
						numberOf(s.seen, page.run) === n && numberOf(s.seen, trail.run) === n
							? [n, n]
							: undefined,
					);
				// Two tickets to pick from, filed in the tracker's own window.
				for (const title of ["Login fails", "Logout fails"])
					s.window(picker.run).heard({
						type: "msg",
						msg: {type: "file", value: {title, body: ""}},
					});
				const waiting = yield* s.until("ticket and runs shown", () =>
					numberOf(s.seen, page.run) !== undefined && numberOf(s.seen, trail.run) !== undefined
						? [numberOf(s.seen, page.run), numberOf(s.seen, trail.run)]
						: undefined,
				);
				pick(1);
				const first = yield* both(1);
				pick(2);
				const second = yield* both(2);
				// The ticket's window closes: that one process gets the end of its inputs, and ends.
				s.window(page.run).closed();
				yield* s.closed(page.run);
				// Its input from the ticket ended, and the runs go on showing the last ticket.
				const kept = numberOf(s.seen, trail.run);
				const runsOpen = !s.seen.some((x) => x.kind === "close" && x.run === trail.run);
				// The tracker's next pick goes down a pipe whose reader is gone: the send fails, and it ends.
				pick(1);
				yield* s.closed(picker.run);
				// The last window closed: the line is over, and the prompt is back.
				s.window(trail.run).closed();
				yield* s.closed(trail.run);
				const rows = yield* s.prompts(2);
				return {
					programs: [picker.program, page.program, trail.program],
					waiting,
					first,
					second,
					kept,
					runsOpen,
					rows,
				};
			}).pipe(Effect.scoped),
		);
		expect(got).toMatchObject({
			programs: ["tracker", "ticket", "runs"],
			// Started with no ticket, each waits on its input.
			waiting: [null, null],
			first: [1, 1],
			second: [2, 2],
			kept: 2,
			runsOpen: true,
		});
		// The ticket had ended, so the pipe answered `stopped`: tsh says why the tracker failed.
		expect(got.rows).toEqual([
			"tsh$ tracker | ticket | runs",
			"tsh: tracker failed: tracker sent ticket down a pipe that answered stopped",
			"tsh$",
		]);
	});

	it("is the first stage of a pipe: closing it sends the count on", async () => {
		const rows = await go(
			Effect.gen(function* () {
				const s = yield* session();
				s.type("counter | double\r");
				const open = yield* s.opened();
				s.press(open.run, "plus");
				yield* s.viewed(open.run, {n: 1});
				s.window(open.run).closed();
				return yield* s.prompts(2);
			}).pipe(Effect.scoped),
		);
		expect(rows).toEqual(["tsh$ counter | double", "double 2", "tsh$"]);
	});

	it("is one of two on `runs --ticket 7 | trace`: both open in the foreground, and a run picked in runs opens its trace", async () => {
		const ledger = memoryService();
		const seen = await go(
			Effect.gen(function* () {
				yield* seedSeven(ledger);
				const s = yield* session({ledger});
				s.type("runs --ticket 7 | trace\r");
				yield* s.opened(2);
				const opens = s.seen.flatMap((x) => (x.kind === "open" ? [x] : []));
				const of = (program: string) => opens.find((o) => o.program === program)?.run ?? "";
				// Picked once runs has drawn ticket 7, as a person can only click a drawn clip.
				yield* s.until("runs drew ticket 7", () =>
					s.seen.find(
						(x) =>
							x.kind === "view" &&
							x.run === of("runs") &&
							JSON.stringify(x.data).includes(SEVEN_TRACE),
					),
				);
				const picked = s
					.window(of("runs"))
					.heard({type: "msg", msg: {type: "choose", value: {run: "r-2"}}});
				// Before the pick, trace shows its own line's job; the pick replaces it.
				const read = yield* s.until("trace read #7's record", () =>
					s.seen.find(
						(x) =>
							x.kind === "view" &&
							x.run === of("trace") &&
							(x.data as {read?: string; id?: string}).read === "read" &&
							(x.data as {id?: string}).id === SEVEN_TRACE,
					),
				);
				s.window(of("runs")).closed();
				s.window(of("trace")).closed();
				yield* s.prompts(2);
				return {opens, picked, read};
			}).pipe(Effect.scoped),
		);
		// tsh tells the tile of both windows, each in the foreground, the last stage first, as tsh
		// starts a line's stages. Once both are shown it tells the tile the whole line, and the desk
		// opens the two in place, runs in the typed-in tile and trace beside it (desk/layout/line.ts).
		expect(seen.opens.map((o) => [o.program, o.placed])).toEqual([
			["trace", "foreground"],
			["runs", "foreground"],
		]);
		expect(seen.picked).toEqual({kind: "read"});
		expect((seen.read as {data: {id: string}}).data.id).toBe(SEVEN_TRACE);
	});

	it("ends `seq --to 3 | tally | trace` on trace's window, showing that line's own job", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const s = yield* session();
				s.type("seq --to 3 | tally | trace\r");
				yield* s.opened(1);
				const open = s.seen.find((x) => x.kind === "open");
				if (open?.kind !== "open") return yield* Effect.die("trace did not open");
				const read = yield* s.until("trace read its job's record", () =>
					s.seen.find(
						(x) =>
							x.kind === "view" &&
							x.run === open.run &&
							(x.data as {read?: string}).read === "read",
					),
				);
				const job = s.jobs.table.getState().jobs[0];
				s.window(open.run).closed();
				yield* s.prompts(2);
				return {open, read, job};
			}).pipe(Effect.scoped),
		);
		expect([seen.open.program, seen.open.placed]).toEqual(["trace", "foreground"]);
		// tally's total fits no typed input of trace, so it went to `any`: the line is one job.
		expect(seen.job?.stages.map((st) => st.program)).toEqual(["seq", "tally", "trace"]);
		// Its trace id is its first run's, seq's: the record trace follows is the line's own.
		const first = seen.job?.stages[0].run ?? "";
		expect((seen.read as {data: {id: string}}).data.id).toBe(runTraceId(first));
	});
});

describe("what a pipe can feed", () => {
	const apps = appPrograms(
		memoryService(),
		{kind: "user", id: "owner"},
		{open: Effect.succeed([])},
		noTraces,
	);
	const list = tshList(apps);
	const takes = (name: string) => {
		const entry = apps.find((e) => e.program.name === name);
		if (entry === undefined) throw new Error(`no program ${name}`);
		return Shell.fedBy(entry.program, list);
	};

	it("is each program's data, never its commands: the frame's takes", () => {
		expect(takes("tracker")).toEqual([]);
		expect(takes("ticket")).toEqual(["ticket"]);
		expect(takes("runs")).toEqual(["ticket"]);
		// `any` takes whatever no typed input does (`anyInput`): a pipe feeds it from anything.
		expect(takes("trace")).toEqual(["id", "any"]);
		expect(takes("map")).toEqual([]);
	});

	it("is what a line wires each stage's pipe into", () => {
		const text = "tracker | ticket | runs | trace";
		const parsed = Shell.parse(text);
		if (parsed.kind !== "parsed" || parsed.statements[0]?.kind !== "run") throw new Error(text);
		const checked = Shell.check(parsed.statements[0].pipeline, Shell.programList(list), text);
		if (checked.kind !== "line") throw new Error(text);
		for (const stage of checked.line.stages.slice(1))
			expect(takes(stage.entry.program.name)).toContain(stage.fed);
	});
});

describe("what is kept for the next start", () => {
	it("keeps the history: Up at the next start shows the last line", async () => {
		const history = memoryHistory();
		const rows = await go(
			Effect.gen(function* () {
				yield* Effect.gen(function* () {
					const s = yield* session({history});
					s.type("say --text one\r");
					yield* s.prompts(2);
					s.type("seq --to 2\r");
					yield* s.prompts(3);
				}).pipe(Effect.scoped);
				const s = yield* session({history});
				s.type("\x1b[A");
				return yield* s.until("the last line", () =>
					s.rows()[0] === "tsh$ seq --to 2" ? s.rows() : undefined,
				);
			}).pipe(Effect.scoped),
		);
		expect(history.kept()).toEqual(["say --text one", "seq --to 2"]);
		expect(rows).toEqual(["tsh$ seq --to 2"]);
	});

	it("shares the history between two tiles: a line typed in one is in the other's Up", async () => {
		const rows = await go(
			Effect.gen(function* () {
				const shared = yield* sharedHistory(memoryHistory());
				const one = yield* session({shared});
				const two = yield* session({shared});
				one.type("say --text from-one\r");
				yield* one.prompts(2);
				two.type("\x1b[A");
				return yield* two.until("tile one's line", () =>
					two.rows()[0] === "tsh$ say --text from-one" ? two.rows() : undefined,
				);
			}).pipe(Effect.scoped),
		);
		expect(rows).toEqual(["tsh$ say --text from-one"]);
	});

	it("keeps jobs in a folder: the app quits with counter's window up, the next host attaches it at 1", async () => {
		const seen = await go(
			Effect.gen(function* () {
				const dir = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped();
				// The first host: counter, +1, then the host stops with counter's window up, as the app
				// quits. Its window closes as the host stops, and says `closed`: that must not end counter.
				const first = yield* Effect.gen(function* () {
					const s = yield* session({jobs: fileStorage(dir)});
					s.type("counter\r");
					const open = yield* s.opened();
					s.press(open.run, "plus");
					yield* s.viewed(open.run, {n: 1});
					return open.run;
				}).pipe(Effect.scoped);

				// The next host, on the same folder: a new tsh, which finds the table the first one left.
				const s = yield* session({jobs: fileStorage(dir)});
				const found = yield* s.until("the earlier job", () =>
					s.rows().find((r) => r.startsWith("tsh: 1 job")),
				);
				s.type("attach %1\r");
				const open = yield* s.opened();
				yield* s.viewed(open.run, {n: 1});
				s.press(open.run, "plus");
				yield* s.viewed(open.run, {n: 2});
				s.press(open.run, "done");
				yield* s.closed(open.run);
				yield* s.prompts(2);
				s.type("jobs\r");
				const rows = yield* s.prompts(3);
				return {first, found, attached: open.run, rows};
			}).pipe(Effect.scoped),
		);
		expect(seen.found).toMatch(/^tsh: 1 job from an earlier tsh, not running: %1\./);
		// The same run, under its id, found where it was left.
		expect(seen.attached).toBe(seen.first);
		// Then it ends on its own, so it leaves the table: `jobs` lists nothing.
		expect(seen.rows.slice(-2)).toEqual(["tsh$ jobs", "tsh$"]);
		expect(seen.rows).toContain("2");
	});
});
