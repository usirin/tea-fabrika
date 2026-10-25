import {layer as nodeFileSystem} from "@effect/platform-node/NodeFileSystem";
import {Ledger, memoryStorage, type Storage} from "@kampus/fabrika";
import {memoryService} from "@kampus/fabrika/memory";
import {fileStorage} from "@kampus/fabrika/storage/node";
import {tracker} from "@tea-fabrika/tracker";
import {Effect, FileSystem, Schema} from "effect";
import {describe, expect, it} from "vitest";
import {gridOf} from "./editor/grid.ts";
import {type History, memoryHistory} from "./editor/history.ts";
import {startHost, type WindowScreen, type Windows} from "./host.ts";

// The host, with a fake terminal page and fake windows and no Electron: what a person would see
// in the terminal, read off its grid (editor/grid.ts), and what each program's window is shown.
// The ledger is in memory.

/** What the fake windows saw, in order. */
type Seen =
	| {readonly kind: "open"; readonly run: string; readonly program: string}
	| {readonly kind: "view"; readonly run: string; readonly data: unknown}
	| {readonly kind: "close"; readonly run: string};

const session = (
	opts: {
		readonly jobs?: Storage;
		readonly history?: History;
		readonly ledger?: Ledger["Service"];
	} = {},
) =>
	Effect.gen(function* () {
		const seen: Seen[] = [];
		const screens = new Map<string, WindowScreen>();
		const windows: Windows = {
			open: (run, program, screen) => {
				screens.set(run, screen);
				seen.push({kind: "open", run, program});
				screen.show((m) => seen.push({kind: "view", run, data: m.data}));
			},
			close: (run) => {
				const screen = screens.get(run);
				if (screen === undefined) return;
				screens.delete(run);
				seen.push({kind: "close", run});
				// As a real window does: closing it says `closed`, whoever closed it.
				screen.closed();
			},
		};
		const host = yield* startHost({
			jobs: opts.jobs ?? memoryStorage(),
			history: opts.history ?? memoryHistory(),
			windows,
		}).pipe(Effect.provideService(Ledger, opts.ledger ?? memoryService()));
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
				show: () => {},
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
				return {back, rows};
			}).pipe(Effect.scoped),
		);
		expect(seen.back[0]).toBe("tsh$ counter &");
		expect(seen.back.at(-1)).toBe("tsh$");
		expect(seen.rows).toContain("meanwhile");
		expect(seen.rows.at(-1)).toBe("tsh$");
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
		expect(seen.seen).toEqual([]);
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
