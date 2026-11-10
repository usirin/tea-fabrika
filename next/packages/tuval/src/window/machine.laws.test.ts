// P14, next/ (Tier 1, ticket 286): the window parent's laws p1, p2, p4 and "now", and the parent
// composing the link and the client by hand (docs/plan/ticket-115.md p1 to p5 with Tier 1's
// fixed-layout and grant-wait amendments; the plan's "Shared client data and the window parent").
// Written before `window/machine.ts`; the modules load by `import()` inside each test.
//
// The shape these laws hold the module to, from the plan's sketch (the build may add more):
// - `windowMachine`: a tea machine; its ctx is `{layout}`, a `Layout` (desktop/layout.ts). Its model
//   holds `link` (a `Link`, transport/link.ts), `client` (an app/client.ts `Client`: `pending`,
//   `written`, `views`) and `opened`, the pids opened on this dial.
// - Msgs, by `type`: every `linkMachine` Msg, unchanged, steps the link; `press {pid, m}` reserves a
//   numbered slot and asks the Cmd `now {n}`; `view {pid, note}` is a view notification; and the
//   settle Msgs tea mints for the Cmds `now {n}`, `send {pid, letter, n}` (process.send) and
//   `open {pid, dial}` (view.open): `<cmd>_ok {cmd, value}` and `<cmd>_err {cmd, error}`. `now`'s ok
//   value is `{letter, sentAt}`, `send`'s is a `Sent`, `open`'s is `{rev, view}`.
// - A window that was just granted (`granted` while it waited, on its dial) asks the Cmd `persist {}`
//   once, when it next goes online; `persist_ok` carries a boolean, `persist_err` a failure. A window
//   that was never in a grant wait, and a reconnect, ask it never. Either answer leaves the link as it was.
// - Going online (`admitted` on the current dial) asks `open` once per distinct pid of the layout
//   and `send` for every letter that is ready, in slot order, each once. Not online asks no `send`.
//   Leaving online forgets what was opened and sent, so the next dial starts over.
import {applyCell} from "@demlik/tea";
import {arbGuidedSequence, propertyTrace} from "@demlik/tea/pbt";
import {describe, expect, it} from "@effect/vitest";
import {Schema} from "effect";
import * as fc from "fast-check";

const SEED = 119120;
const opts = {seed: SEED, numRuns: 250};

type Pending = {
	readonly _tag: string;
	readonly n: number;
	readonly pid: string;
	readonly letter?: string;
	readonly viewRev: number;
	readonly seen: number;
};

type Model = {
	readonly link: {readonly _tag: string; readonly [key: string]: unknown};
	readonly client: {
		readonly pending: ReadonlyArray<Pending>;
		readonly written: number;
		readonly views: Readonly<Record<string, {readonly rev: number}>>;
	};
	readonly opened: ReadonlyArray<string>;
};

type Cmd = {readonly type: string; readonly [key: string]: unknown};
type Msg = {readonly type: string; readonly [key: string]: unknown};
type Tree = unknown;

interface Machine {
	readonly init: (loaded: unknown, ctx: object) => readonly [Model, ReadonlyArray<Cmd>];
	readonly model: unknown;
}

const machine = async (): Promise<Machine> => {
	const m = ((await import("./machine.ts")) as {windowMachine?: Machine}).windowMachine;
	expect(m, "window/machine.ts exports windowMachine").toBeDefined();
	return m as Machine;
};

const layoutApi = async (): Promise<{
	tilesIn: (t: Tree) => ReadonlyArray<{id: string; pid: string}>;
}> => (await import("../desktop/layout.ts")) as never;

const A = "process_a";
const B = "process_b";
const C = "process_c";
const tile = (id: string, pid: string) => ({_tag: "tile", id, pid});
const split = (dir: "row" | "col", a: Tree, b: Tree) => ({_tag: "split", dir, at: 50, a, b});

/** The fixed layouts the laws run on: one tile, two, a repeated pid, and a 2x2 that repeats two. */
const LAYOUTS: ReadonlyArray<readonly [string, Tree, ReadonlyArray<string>]> = [
	["one tile", tile("t0", A), [A]],
	["two tiles", split("row", tile("t0", A), tile("t1", B)), [A, B]],
	[
		"a repeated pid",
		split("col", tile("t0", A), split("row", tile("t1", B), tile("t2", A))),
		[A, B],
	],
	[
		"a 2x2 grid",
		split(
			"col",
			split("row", tile("t0", A), tile("t1", B)),
			split("row", tile("t2", A), tile("t3", C)),
		),
		[A, B, C],
	],
];

const dial = fc.integer({min: 1, max: 3});
const sentAt = "2026-11-09T00:00:00.000Z";
const word = fc.constantFrom("a", "b", "SHA256:x");

/** The Msgs nothing sends a Cmd for, and the answers to the Cmds the window asks. */
const cells = (pids: ReadonlyArray<string>) => {
	const pid = fc.constantFrom(...pids);
	const body = fc.constantFrom({type: "inc"}, {type: "dec"}, {type: "reset"});
	const outside = {
		admitted: fc.record({type: fc.constant("admitted"), dial, ping: fc.constant(0)}),
		closed: fc.record({
			type: fc.constant("closed"),
			dial,
			code: fc.constantFrom(1000, 1006),
			fingerprint: word,
		}),
		retry: fc.record({type: fc.constant("retry"), dial, tries: fc.constant(1)}),
		not_granted: fc.record({
			type: fc.constant("not_granted"),
			dial,
			fingerprint: word,
			code: word,
			until: fc.nat(1000),
		}),
		granted: fc.record({type: fc.constant("granted"), dial}),
		stalled: fc.record({type: fc.constant("stalled"), dial}),
		press: fc.record({type: fc.constant("press"), pid, m: body}),
		view: fc.record({
			type: fc.constant("view"),
			pid,
			note: fc.oneof(
				fc.record({
					type: fc.constant("whole"),
					rev: fc.nat(6),
					view: fc.record({count: fc.integer({min: -5, max: 5})}),
				}),
				fc.record({
					type: fc.constant("patch"),
					base: fc.nat(6),
					rev: fc.nat(7),
					patch: fc.constant([{op: "replace", path: "/count", value: 1}]),
				}),
				fc.jsonValue(),
			),
		}),
	};
	const answers = {
		now: {
			draw: fc.record({ok: fc.boolean(), letter: fc.uuid()}),
			make: (cmd: Cmd, v: {ok: boolean; letter: string}): Msg =>
				v.ok
					? {type: "now_ok", cmd, value: {letter: `letter_${v.letter}`, sentAt}}
					: {type: "now_err", cmd, error: {_tag: "clock"}},
		},
		send: {
			draw: fc.constantFrom("accepted", "refused", "unreachable"),
			make: (cmd: Cmd, kind: string): Msg =>
				kind === "accepted"
					? {type: "send_ok", cmd, value: {_tag: "accepted", rev: 1, pos: 1}}
					: kind === "refused"
						? {type: "send_ok", cmd, value: {_tag: "refused", why: "bad_msg"}}
						: {type: "send_err", cmd, error: {_tag: "unreachable"}},
		},
		persist: {
			draw: fc.constantFrom("true", "false", "error"),
			make: (cmd: Cmd, v: string): Msg =>
				v === "error"
					? {type: "persist_err", cmd, error: {_tag: "unsupported"}}
					: {type: "persist_ok", cmd, value: v === "true"},
		},
		open: {
			draw: fc.record({ok: fc.boolean(), rev: fc.nat(5), count: fc.integer({min: -3, max: 3})}),
			make: (cmd: Cmd, v: {ok: boolean; rev: number; count: number}): Msg =>
				v.ok
					? {type: "open_ok", cmd, value: {rev: v.rev, view: {count: v.count}}}
					: {type: "open_err", cmd, error: {_tag: "unreachable"}},
		},
	};
	return {outside, answers};
};

const lists = (m: Machine, layout: Tree, pids: ReadonlyArray<string>, loaded?: Model) =>
	arbGuidedSequence(m as never, {layout} as never, cells(pids) as never, {
		maxLength: 70,
		...(loaded === undefined ? {} : {loaded: loaded as never}),
	});

/** A new grant, as the browser meets it on its first dial: told `not_granted`, granted while it
 *  waits, then admitted. */
const GRANT: ReadonlyArray<Msg> = [
	{type: "not_granted", dial: 1, fingerprint: "SHA256:x", code: "a", until: 1000},
	{type: "granted", dial: 1},
	{type: "admitted", dial: 1, ping: 0},
];

/** The window's state at the end of `list` and the Cmds its last step asked, folded by the real runner. */
const after = (
	m: Machine,
	layout: Tree,
	list: ReadonlyArray<Msg>,
): {state: Model; cmds: ReadonlyArray<Cmd>} => {
	let out: {state: Model; cmds: ReadonlyArray<Cmd>} | undefined;
	propertyTrace(
		m as never,
		{layout} as never,
		fc.constant(list) as never,
		((steps: ReadonlyArray<Step>, final: Model) => {
			out = {state: final, cmds: steps.at(-1)?.cmds ?? []};
			return null;
		}) as never,
		{numRuns: 1},
	);

	if (out === undefined) {
		throw new Error("the fold of a fixed list never ran");
	}

	return out;
};

/** Lists where every run reaches a new grant going online, then the persistence answer, then a
 *  guided tail drawn from the state the real fold reached. Blind lists reach a new grant going
 *  online about once in 250 runs (build round 1), so a plant on the answer went uncaught. When the
 *  window asks no persistence, no answer follows and the persist law names that. */
const grantedLists = (m: Machine, layout: Tree, pids: ReadonlyArray<string>) => {
	const opened = after(m, layout, GRANT);
	const asked = opened.cmds.find((c) => c.type === "persist");
	const persist = cells(pids).answers.persist;
	const variants = (["true", "false", "error"] as const).map((v) => {
		const list = asked === undefined ? GRANT : [...GRANT, persist.make(asked, v)];
		return {list, state: after(m, layout, list).state};
	});

	return fc
		.constantFrom(...variants)
		.chain(({list, state}) =>
			lists(m, layout, pids, state).map((tail) => [...list, ...(tail as ReadonlyArray<Msg>)]),
		);
};

type Step = {
	readonly prev: Model;
	readonly msg: Msg;
	readonly next: Model;
	readonly cmds: ReadonlyArray<Cmd>;
};

type Law = (steps: ReadonlyArray<Step>, tiles: ReadonlyArray<string>) => string | null;
const online = (m: Model): boolean => m.link._tag === "online";

const kinds = (cmds: ReadonlyArray<Cmd>, type: string): ReadonlyArray<Cmd> =>
	cmds.filter((c) => c.type === type);

const PERSIST =
	"persist: asked once per new grant, never on a reconnect, and an answer leaves the window online";

/** The laws, each a check over a run's steps, so a plant can run the same one. */
const laws: Readonly<Record<string, Law>> = {
	// p1: a letter leaves only on its matching terminal answer; written grows per press; ids never repeat.
	"p1: a letter is never lost, written counts presses, ids never repeat": (steps) => {
		const model = new Map<number, string | null>(); // slot -> its first letter
		let presses = 0;

		for (const {prev, msg, next} of steps) {
			if (msg.type === "press") {
				model.set(next.client.written - 1, null);
				presses++;
			} else if (msg.type === "now_ok") {
				const n = (msg["cmd"] as {n: number}).n;

				if (model.has(n) && model.get(n) === null) {
					model.set(n, (msg["value"] as {letter: string}).letter);
				}
			} else if (msg.type === "send_ok") {
				const letter = (msg["cmd"] as {letter: string}).letter;
				const value = msg["value"] as {_tag: string};

				if (value._tag === "accepted" || value._tag === "refused") {
					for (const [n, l] of model) {
						if (l === letter) {
							model.delete(n);
						}
					}
				}
			}

			const slots = next.client.pending.map((p) => p.n).sort((x, y) => x - y);

			if (JSON.stringify(slots) !== JSON.stringify([...model.keys()].sort((x, y) => x - y))) {
				return `slots ${JSON.stringify(slots)} are not the model's ${JSON.stringify([...model.keys()])}`;
			}

			for (const p of next.client.pending) {
				if (model.get(p.n) !== (p.letter ?? null)) {
					return `slot ${p.n} holds ${String(p.letter)}, its first letter was ${String(model.get(p.n))}`;
				}
			}

			if (next.client.written !== presses) {
				return `written ${next.client.written} after ${presses} presses`;
			}

			void prev;
		}

		return null;
	},
	// p2: coming online sends every ready letter once, in order; not online sends nothing; no letter twice on one dial.
	"p2: what waited goes out: online sends every ready letter once in order, offline sends nothing":
		(steps) => {
			let sentThisDial = new Set<string>();

			for (const {prev, msg, next, cmds} of steps) {
				const sends = kinds(cmds, "send");

				if (!online(next)) {
					if (sends.length > 0) {
						return `${msg.type} sent ${sends.length} letter(s) while ${next.link._tag}`;
					}

					sentThisDial = new Set();
					continue;
				}

				if (!online(prev)) {
					sentThisDial = new Set();
				}

				const letters = sends.map((s) => String(s["letter"]));

				if (new Set(letters).size !== letters.length) {
					return `${msg.type} sent a letter twice in one step`;
				}

				for (const l of letters) {
					if (sentThisDial.has(l) && !(msg.type === "send_err")) {
						return `${l} went out twice on one dial`;
					}

					sentThisDial.add(l);
				}

				const slotFor = (l: string) =>
					next.client.pending.find((p) => p.letter === l)?.n ?? Number.NaN;
				const order = letters.map(slotFor);

				if (JSON.stringify(order) !== JSON.stringify([...order].sort((x, y) => x - y))) {
					return `letters went out out of order: ${JSON.stringify(order)}`;
				}

				if (!online(prev)) {
					// Going online: every ready letter ahead of the first slot still waiting for its time goes out.
					const firstDating =
						next.client.pending.find((p) => p._tag === "dating")?.n ?? Number.POSITIVE_INFINITY;
					const ready = next.client.pending
						.filter((p) => p._tag === "ready" && p.n < firstDating)
						.map((p) => p.letter);

					if (JSON.stringify(letters) !== JSON.stringify(ready)) {
						return `going online sent ${JSON.stringify(letters)}, the ready letters were ${JSON.stringify(ready)}`;
					}
				}

				if (msg.type === "send_err") {
					sentThisDial.delete(String((msg["cmd"] as {letter: string}).letter));
				}
			}

			return null;
		},
	// p4: every distinct pid in the layout is opened once per dial; a new dial opens again.
	"p4: every distinct pid of the layout opens once per dial, and a new dial opens again": (
		steps,
		tiles,
	) => {
		const distinct = [...new Set(tiles)].sort();

		for (const {prev, msg, next, cmds} of steps) {
			const opens = kinds(cmds, "open");

			if (online(next) && !online(prev)) {
				const pids = opens.map((o) => String(o["pid"])).sort();

				if (JSON.stringify(pids) !== JSON.stringify(distinct)) {
					return `going online opened ${JSON.stringify(pids)}, not each of ${JSON.stringify(distinct)} once`;
				}

				if ([...next.opened].sort().join() !== distinct.join()) {
					return `opened is ${JSON.stringify(next.opened)} after going online`;
				}

				if (new Set(next.opened).size !== next.opened.length) {
					return "opened holds a repeat";
				}
			}

			if (!online(next) && next.opened.length > 0) {
				return `opened keeps ${JSON.stringify(next.opened)} while ${next.link._tag}`;
			}

			if (msg.type === "press" && opens.length > 0) {
				return "a press opened a view";
			}

			if (online(prev) && online(next) && msg.type !== "view" && opens.length > 0) {
				return `${msg.type} opened again on the same dial`;
			}
		}

		return null;
	},
	// Persistence is asked once after a new grant, never on a reconnect, and its answer never moves the link.
	[PERSIST]: (steps) => {
		let fresh = false;

		for (const {prev, msg, next, cmds} of steps) {
			if (
				msg.type === "granted" &&
				prev.link._tag === "waiting_grant" &&
				prev.link["dial"] === msg["dial"]
			) {
				fresh = true;
			}

			const asked = kinds(cmds, "persist").length;

			if (asked > 1) {
				return "persistence asked twice in one step";
			}

			if (asked === 1 && !(fresh && online(next) && !online(prev))) {
				return `persistence asked on ${msg.type} with no new grant just admitted`;
			}

			if (asked === 0 && fresh && online(next) && !online(prev)) {
				return "a new grant went online and never asked for persistence";
			}

			if (asked === 1) {
				fresh = false;
			}

			if (
				(msg.type === "persist_ok" || msg.type === "persist_err") &&
				JSON.stringify(next.link) !== JSON.stringify(prev.link)
			) {
				return `${msg.type} moved the link`;
			}

			if (
				(msg.type === "persist_ok" || msg.type === "persist_err") &&
				next.client.pending.length !== prev.client.pending.length
			) {
				return `${msg.type} changed the queue`;
			}
		}

		return null;
	},
	// now: a press keeps what was shown when it was pressed; answers in any order send in slot order.
	"now: a press captures what it showed, and reversed or failed answers still send in slot order": (
		steps,
	) => {
		const shown = new Map<number, {viewRev: number}>();

		for (const {prev, msg, next, cmds} of steps) {
			if (msg.type === "press") {
				const pid = String(msg["pid"]);
				const slot = next.client.written - 1;
				shown.set(slot, {viewRev: prev.client.views[pid]?.rev ?? 0});

				if (kinds(cmds, "now").length !== 1) {
					return "a press asks for its time once";
				}
			}

			for (const p of next.client.pending) {
				const was = shown.get(p.n);

				if (was !== undefined && p.viewRev !== was.viewRev) {
					return `slot ${p.n} re-read the shown revision: ${p.viewRev}, it was pressed at ${was.viewRev}`;
				}
			}

			const slots = kinds(cmds, "send").map(
				(s) => next.client.pending.find((p) => p.letter === s["letter"])?.n ?? -1,
			);
			const firstDating =
				next.client.pending.find((p) => p._tag === "dating")?.n ?? Number.POSITIVE_INFINITY;

			for (const n of slots) {
				if (n > firstDating) {
					return `slot ${n} went out before slot ${firstDating} had its letter`;
				}
			}

			if (msg.type === "now_err" && next.client.written !== prev.client.written) {
				return "a failed now made a second press";
			}

			if (
				msg.type === "now_err" &&
				!next.client.pending.some((p) => p.n === (msg["cmd"] as {n: number}).n)
			) {
				return "a failed now lost the press";
			}
		}

		return null;
	},
};

const fold = async (
	m: Machine,
	layout: Tree,
	tiles: ReadonlyArray<string>,
	name: string,
	over?: (m: Machine) => Machine,
): Promise<void> => {
	const used = over === undefined ? m : over(m);
	const law = ((steps: ReadonlyArray<Step>) => laws[name]?.(steps, tiles) ?? null) as never;
	propertyTrace(used as never, {layout} as never, lists(m, layout, tiles) as never, law, opts);

	// The persist law also runs on lists that each reach a new grant, so its answer is always met.
	if (name === PERSIST) {
		propertyTrace(
			used as never,
			{layout} as never,
			grantedLists(m, layout, tiles) as never,
			law,
			opts,
		);
	}
};

describe("window machine: p1, p2, p4 and now, on every fixed layout", () => {
	for (const name of Object.keys(laws)) {
		for (const [label, layout, tiles] of LAYOUTS) {
			it(`${name} (${label})`, async () => fold(await machine(), layout, tiles, name));
		}
	}

	it("the layout's tiles are what opens: tilesIn names the pids this law expects", async () => {
		const {tilesIn} = await layoutApi();

		for (const [, layout, tiles] of LAYOUTS) {
			expect([...new Set(tilesIn(layout).map((t) => t.pid))].sort()).toEqual([...tiles].sort());
		}
	});

	it("good thing: the runs press, date, go online, send, settle, reconnect and open again, and persist", async () => {
		const m = await machine();
		const seen = {
			pressed: 0,
			dated: 0,
			online: 0,
			sent: 0,
			settled: 0,
			reopened: 0,
			failedNow: 0,
			persisted: 0,
		};

		for (const [, layout, tiles] of LAYOUTS) {
			propertyTrace(
				m as never,
				{layout} as never,
				lists(m, layout, tiles) as never,
				((steps: ReadonlyArray<Step>) => {
					let dials = 0;

					for (const {prev, msg, next, cmds} of steps) {
						if (msg.type === "press") {
							seen.pressed++;
						}

						if (msg.type === "now_ok") {
							seen.dated++;
						}

						if (msg.type === "now_err") {
							seen.failedNow++;
						}

						if (online(next) && !online(prev)) {
							seen.online++;
							dials++;

							if (dials > 1) {
								seen.reopened += kinds(cmds, "open").length > 0 ? 1 : 0;
							}
						}

						seen.sent += kinds(cmds, "send").length;
						seen.persisted += kinds(cmds, "persist").length;

						if (msg.type === "send_ok" && next.client.pending.length < prev.client.pending.length) {
							seen.settled++;
						}
					}

					return null;
				}) as never,
				{...opts, numRuns: 150} as never,
			);
		}

		for (const [name, n] of Object.entries(seen)) {
			expect(n, name).toBeGreaterThan(0);
		}
	});

	it("the parent steps the link and the client by hand: its link is the link machine's own fold", async () => {
		const m = await machine();
		// oxlint-disable-next-line fabrika/no-type-assertions -- the module is loaded by import() so a missing one is a red test; the cast names the shape the plan gives it
		const {linkMachine} = (await import("@kampus/libfabrika/transport")) as unknown as {
			linkMachine: {
				readonly init: (
					loaded: unknown,
					ctx: object,
				) => readonly [Model["link"], ReadonlyArray<Cmd>];
			};
		};
		expect(linkMachine, "the library's transport exports linkMachine").toBeDefined();
		const [, layout, tiles] = LAYOUTS[2] as (typeof LAYOUTS)[number];
		propertyTrace(
			m as never,
			{layout} as never,
			lists(m, layout, tiles) as never,
			((steps: ReadonlyArray<Step>) => {
				let link = linkMachine.init(null, {})[0];

				for (const {msg, next} of steps) {
					const own = [
						"admitted",
						"closed",
						"retry",
						"not_granted",
						"granted",
						"stalled",
						"beat",
						"pong",
						"renew",
						"blocked",
						"ask_again",
					].includes(msg.type);

					if (own) {
						link = applyCell(linkMachine as never, link as never, msg as never)[0] as never;
					}

					if (JSON.stringify(next.link) !== JSON.stringify(link)) {
						return `${msg.type}: the window's link is ${JSON.stringify(next.link)}, the link machine's is ${JSON.stringify(link)}`;
					}
				}

				return null;
			}) as never,
			opts as never,
		);
	});
});

// Plants: reverse two letters; send offline; skip the resend; keep opened after a reconnect; re-read
// the displayed revision after the Cmd. Each wraps the real machine's reducer with one break, and the
// law that names it must throw.
describe("window machine plants: each break is caught by the law that names it", () => {
	type Update = (state: Model, msg: Msg, ctx: object) => readonly [Model, ReadonlyArray<Cmd>];
	/** The real machine with its steps post-processed, `layout` in the ctx as the laws give it. */
	const broken = (
		real: Machine,
		change: (
			out: readonly [Model, ReadonlyArray<Cmd>],
			state: Model,
			msg: Msg,
		) => readonly [Model, ReadonlyArray<Cmd>],
	): Machine => {
		// oxlint-disable-next-line fabrika/no-type-assertions -- the module is loaded by import() so a missing one is a red test; the cast names the shape the plan gives it
		const update = (real as unknown as {update: Record<string, Update>}).update;
		// oxlint-disable-next-line fabrika/no-type-assertions -- the module is loaded by import() so a missing one is a red test; the cast names the shape the plan gives it
		return {
			...real,
			update: Object.fromEntries(
				Object.entries(update).map(([type, f]) => [
					type,
					(state: Model, msg: Msg, ctx: object) => change(f(state, msg, ctx), state, msg),
				]),
			),
		} as unknown as Machine;
	};
	const expectCaught = async (
		name: string,
		change: Parameters<typeof broken>[1],
		layoutAt = 2,
	): Promise<void> => {
		const real = await machine();
		const [, layout, tiles] = LAYOUTS[layoutAt] as (typeof LAYOUTS)[number];
		const planted = broken(real, change);
		expect(() => {
			propertyTrace(
				planted as never,
				{layout} as never,
				// A persist plant breaks the answer, so its lists always reach a new grant (folded by the planted machine).
				(name === PERSIST
					? grantedLists(planted, layout, tiles)
					: lists(real, layout, tiles)) as never,
				((steps: ReadonlyArray<Step>) => laws[name]?.(steps, tiles) ?? null) as never,
				opts as never,
			);
		}).toThrow();
	};
	it("clearing the queue on any answer is caught (p1)", () =>
		expectCaught(
			"p1: a letter is never lost, written counts presses, ids never repeat",
			([m, c], _s, msg) =>
				msg.type === "send_err" ? [{...m, client: {...m.client, pending: []}}, c] : [m, c],
		));
	it("a new letter on a resend is caught (p1)", () =>
		expectCaught(
			"p1: a letter is never lost, written counts presses, ids never repeat",
			([m, c], _s, msg) =>
				msg.type === "now_ok"
					? [
							{
								...m,
								client: {
									...m.client,
									pending: m.client.pending.map((p) =>
										p.letter === undefined ? p : {...p, letter: `${p.letter}!`},
									),
								},
							},
							c,
						]
					: [m, c],
		));
	it("sending while offline is caught (p2)", () =>
		expectCaught(
			"p2: what waited goes out: online sends every ready letter once in order, offline sends nothing",
			([m, c], _s, msg) =>
				msg.type === "press" && m.link._tag !== "online"
					? [m, [...c, {type: "send", pid: "process_a", letter: "x", n: 0}]]
					: [m, c],
		));
	it("skipping the resend on coming online is caught (p2)", () =>
		expectCaught(
			"p2: what waited goes out: online sends every ready letter once in order, offline sends nothing",
			([m, c], _s, msg) =>
				msg.type === "admitted" ? [m, c.filter((x) => x.type !== "send")] : [m, c],
		));
	it("reversing two letters is caught (p2 and now)", () =>
		expectCaught(
			"p2: what waited goes out: online sends every ready letter once in order, offline sends nothing",
			([m, c]) => [
				m,
				[...c].sort((x, y) =>
					x.type === "send" && y.type === "send" ? Number(y["n"]) - Number(x["n"]) : 0,
				),
			],
		));
	it("keeping opened after a reconnect is caught (p4)", () =>
		expectCaught(
			"p4: every distinct pid of the layout opens once per dial, and a new dial opens again",
			([m, c], s, msg) =>
				msg.type === "admitted" && s.opened.length > 0
					? [{...m}, c.filter((x) => x.type !== "open")]
					: [{...m, opened: s.opened.length > 0 ? s.opened : m.opened}, c],
		));
	it("opening a view when a press is made is caught (p4)", () =>
		expectCaught(
			"p4: every distinct pid of the layout opens once per dial, and a new dial opens again",
			([m, c], _s, msg) =>
				msg.type === "press" ? [m, [...c, {type: "open", pid: "process_a", dial: 1}]] : [m, c],
		));
	it("re-reading the displayed revision after the Cmd is caught (now)", () =>
		expectCaught(
			"now: a press captures what it showed, and reversed or failed answers still send in slot order",
			([m, c], _s, msg) =>
				msg.type === "now_ok"
					? [
							{
								...m,
								client: {
									...m.client,
									pending: m.client.pending.map((p) => ({...p, viewRev: p.viewRev + 1})),
								},
							},
							c,
						]
					: [m, c],
		));
	it("asking for persistence on every reconnect is caught (persist)", () =>
		expectCaught(PERSIST, ([m, c], _s, msg) =>
			msg.type === "admitted" && m.link._tag === "online" ? [m, [...c, {type: "persist"}]] : [m, c],
		));
	it("taking the granted window offline when persistence is refused is caught (persist)", () =>
		expectCaught(PERSIST, ([m, c], _s, msg) =>
			msg.type === "persist_ok" ? [{...m, link: {_tag: "retrying", dial: 1, tries: 1}}, c] : [m, c],
		));
	it("a failed now that drops the press is caught (now)", () =>
		expectCaught(
			"now: a press captures what it showed, and reversed or failed answers still send in slot order",
			([m, c], _s, msg) =>
				msg.type === "now_err" ? [{...m, client: {...m.client, pending: []}}, c] : [m, c],
		));
});

describe("window machine: saved state", () => {
	it("stopping at every message and booting from the saved model gives the same run", async () => {
		const m = await machine();
		const {syncTest} = await import("@kampus/libfabrika/testing");
		const [, layout, tiles] = LAYOUTS[2] as (typeof LAYOUTS)[number];
		// oxlint-disable-next-line fabrika/no-type-assertions -- the module is loaded by import() so a missing one is a red test; the cast names the shape the plan gives it
		const model = (m as unknown as {model: Schema.Codec<unknown, unknown>}).model;
		fc.assert(
			fc.property(lists(m, layout, tiles), (list) => {
				syncTest(m as never, {layout} as never, {
					msgs: list as never,
					encode: Schema.encodeSync(model),
					decode: Schema.decodeUnknownSync(model),
					equals: (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b),
					seed: SEED,
				});
			}),
			{seed: SEED, numRuns: 100},
		);
	});
});
