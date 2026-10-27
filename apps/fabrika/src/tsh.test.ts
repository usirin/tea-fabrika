import {layer as nodeFileSystem} from "@effect/platform-node/NodeFileSystem";
import {Ledger, memoryStorage, type Storage} from "@kampus/fabrika";
import {memoryService} from "@kampus/fabrika/memory";
import {fileStorage} from "@kampus/fabrika/storage/node";
import {Pulls, tracker} from "@tea-fabrika/tracker";
import {Effect, FileSystem, Schema} from "effect";
import {describe, expect, it} from "vitest";
import {gridOf} from "./editor/grid.ts";
import {type History, memoryHistory, type SharedHistory, sharedHistory} from "./editor/history.ts";
import {type Placed, type Runs, startTsh, type WindowScreen} from "./tsh.ts";

// One tile's tsh, with a fake terminal page and a fake tile and no Electron: what a person would see
// in the terminal, read off its grid (editor/grid.ts), and what each program's view is shown.
// The ledger is in memory.

/** What the fake tile saw, in order. */
type Seen =
	| {readonly kind: "open"; readonly run: string; readonly program: string; readonly placed: Placed}
	| {readonly kind: "forward"; readonly run: string}
	| {readonly kind: "view"; readonly run: string; readonly data: unknown}
	| {readonly kind: "close"; readonly run: string}
	| {readonly kind: "running"; readonly count: number};

const session = (
	opts: {
		readonly jobs?: Storage;
		/** Kept between hosts, as the history file is. Each host shares it with no other. */
		readonly history?: History;
		/** Shared with another host, as two tiles share it. */
		readonly shared?: SharedHistory;
		readonly ledger?: Ledger["Service"];
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
			ended: (run) => {
				const screen = screens.get(run);
				if (screen === undefined) return;
				screens.delete(run);
				seen.push({kind: "close", run});
				// As a real view does: taking it away says `closed`, whoever took it away.
				screen.closed();
			},
			running: (count) => seen.push({kind: "running", count}),
		};
		const host = yield* startTsh({
			jobs: opts.jobs ?? memoryStorage(),
			history: opts.shared ?? (yield* sharedHistory(opts.history ?? memoryHistory())),
			runs,
		}).pipe(
			Effect.provideService(Ledger, opts.ledger ?? memoryService()),
			// No pull requests: no test reads GitHub.
			Effect.provideService(Pulls, {open: Effect.succeed([])}),
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
			};
		const press = (run: string, value: unknown) =>
			window(run).heard({type: "msg", msg: {type: "press", value}});
		return {host, rows, until, prompts, type, opened, viewed, closed, window, press, seen};
	});

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
						msg: {type: "do", value: {kind: "file", title: "Login fails", body: ""}},
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
		expect(seen.counted).toEqual({kind: "running", count: 1});
		expect(seen.none).toEqual({kind: "running", count: 0});
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
