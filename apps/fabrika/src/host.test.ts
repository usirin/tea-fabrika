import {layer as nodeFileSystem} from "@effect/platform-node/NodeFileSystem";
import {memoryStorage, type Storage} from "@kampus/fabrika";
import {fileStorage} from "@kampus/fabrika/storage/node";
import {Effect, FileSystem, Queue} from "effect";
import {describe, expect, it} from "vitest";
import {startHost, TSH} from "./host.ts";
import type {PaneView, ToPage} from "./messages.ts";

// The host, with a fake page and no Electron: what the window would see, step by step. A view is
// the whole pane, so waiting for one that passes a check may skip the ones before it.

const session = (jobs: Storage = memoryStorage()) =>
	Effect.gen(function* () {
		const host = yield* startHost(jobs);
		const views = yield* Queue.unbounded<ToPage>();
		host.show((m) => Queue.offerUnsafe(views, m));
		/** Wait for a view that passes `ok`. */
		const until = (ok: (pane: PaneView) => boolean) =>
			Effect.gen(function* () {
				for (;;) {
					const m = yield* Queue.take(views);
					if (ok(m.data)) return m.data;
				}
			});
		const toTsh = (msg: unknown) => host.heard({type: "msg", pane: "p1", to: TSH, msg});
		const texts = (pane: PaneView) =>
			pane.tsh.lines.map((l) => (l.kind === "typed" ? `> ${l.text}` : l.text));
		const ready = (pane: PaneView) =>
			pane.tsh.state.kind === "ready" && pane.tsh.state.status !== null;
		return {host, until, toTsh, texts, ready};
	});

describe("the host", () => {
	it("tells tsh a line and shows what it printed", async () => {
		const lines = await Effect.runPromise(
			Effect.gen(function* () {
				const {until, toTsh, texts, ready} = yield* session();
				expect(toTsh({type: "line", value: "seq --to 3 | double"})).toEqual({kind: "read"});
				return texts(yield* until(ready));
			}).pipe(Effect.scoped),
		);
		expect(lines).toEqual(["> seq --to 3 | double", "double 2", "double 4", "double 6"]);
	});

	it("puts counter's window over tsh, tells it a press, and shows tsh again once it is done", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const {host, until, toTsh, texts, ready} = yield* session();
				toTsh({type: "line", value: "counter"});
				const opened = yield* until((p) => p.front.length === 1);
				const run = opened.front[0]?.run ?? "";
				const press = (value: unknown) =>
					host.heard({type: "msg", pane: "p1", to: run, msg: {type: "press", value}});
				expect(press("plus")).toEqual({kind: "read"});
				const pressed = yield* until((p) => JSON.stringify(p.front[0]?.data) === '{"n":1}');
				// tsh's own input is not counter's: a line sent to counter's run is refused.
				const wrong = host.heard({
					type: "msg",
					pane: "p1",
					to: run,
					msg: {type: "line", value: "x"},
				});
				const bad = press("minus");
				expect(press("done")).toEqual({kind: "read"});
				const back = yield* until((p) => p.front.length === 0 && ready(p));
				const late = press("plus");
				return {opened, pressed, wrong, bad, back: texts(back), late};
			}).pipe(Effect.scoped),
		);
		expect(seen.opened.front).toEqual([
			{program: "counter", run: expect.any(String), data: {n: 0}},
		]);
		expect(seen.opened.tsh.state).toEqual({kind: "busy", waiting: 1});
		expect(seen.pressed.front[0]?.data).toEqual({n: 1});
		expect(seen.wrong).toEqual({kind: "refused", why: "counter has no input line"});
		expect(seen.bad.kind === "refused" && seen.bad.why).toMatch(/^counter's press does not fit/);
		expect(seen.back).toEqual(["> counter", "1"]);
		expect(seen.late.kind === "refused" && seen.late.why).toMatch(/^no run .* is shown here$/);
	});

	it("refuses what does not read, and tells tsh nothing of it", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const {host, until, toTsh, texts, ready} = yield* session();
				const refused = [
					host.heard({
						type: "msg",
						pane: "p9",
						to: TSH,
						msg: {type: "line", value: "say --text no"},
					}),
					host.heard({
						type: "msg",
						pane: "p1",
						to: "nobody",
						msg: {type: "line", value: "say --text no"},
					}),
					toTsh({type: "signal", value: "kill"}),
					toTsh({type: "line", value: 7}),
					toTsh({type: "exec", value: "say --text no"}),
					host.heard("say --text no"),
				];
				toTsh({type: "line", value: "say --text yes"});
				return {refused, lines: texts(yield* until(ready))};
			}).pipe(Effect.scoped),
		);
		expect(seen.refused.map((r) => r.kind)).toEqual(Array(6).fill("refused"));
		expect(seen.lines).toEqual(["> say --text yes", "yes"]);
	});

	it("keeps tsh's jobs in a folder: the next host on it finds counter, and attach shows it at 1", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const dir = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped();
				// The first host: counter, +1, then the host stops with counter's window up, as the app quits.
				const first = yield* Effect.gen(function* () {
					const {host, until, toTsh} = yield* session(fileStorage(dir));
					toTsh({type: "line", value: "counter"});
					const run = (yield* until((p) => p.front.length === 1)).front[0]?.run ?? "";
					host.heard({type: "msg", pane: "p1", to: run, msg: {type: "press", value: "plus"}});
					yield* until((p) => JSON.stringify(p.front[0]?.data) === '{"n":1}');
					return run;
				}).pipe(Effect.scoped);

				// The next host, on the same folder: a new tsh, which finds the table the first one left.
				const {host, until, toTsh, texts, ready} = yield* session(fileStorage(dir));
				const found = texts(yield* until((p) => p.tsh.lines.length > 0));
				toTsh({type: "line", value: "attach %1"});
				const attached = (yield* until((p) => p.front.length === 1)).front;
				const press = (value: unknown) =>
					host.heard({type: "msg", pane: "p1", to: first, msg: {type: "press", value}});
				// Still counting: +1 goes on from 1, and done ends it, as in the first host.
				press("plus");
				yield* until((p) => JSON.stringify(p.front[0]?.data) === '{"n":2}');
				press("done");
				yield* until((p) => p.front.length === 0 && ready(p));
				toTsh({type: "line", value: "jobs"});
				toTsh({type: "line", value: "say --text end"});
				const lines = texts(yield* until((p) => texts(p).at(-1) === "end"));
				return {first, found, attached, lines};
			}).pipe(Effect.scoped, Effect.provide(nodeFileSystem)),
		);
		expect(seen.found).toEqual([
			"tsh: 1 job from an earlier tsh, not running: %1. attach %n starts one again; jobs lists them.",
		]);
		// The same run, under its id, found where it was left: its first view is already 1.
		expect(seen.attached).toEqual([{program: "counter", run: seen.first, data: {n: 1}}]);
		// Then it ends on its own, so it leaves the table: `jobs` lists nothing.
		expect(seen.lines.slice(1)).toEqual([
			"> attach %1",
			"2",
			"[1] ended  counter",
			"[1] counter ended: it had nothing left to do",
			"> jobs",
			"> say --text end",
			"end",
		]);
	});
});
