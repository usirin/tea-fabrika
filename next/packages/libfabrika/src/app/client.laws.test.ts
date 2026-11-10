// P14, next/ (Tier 1, ticket 286): the program client's rules, p1 and p3 and the counter folds, as
// properties on one tea machine (plan A5, decision 0046). Written before `app/client.ts`'s
// `clientMachine`, `app/window.ts` and `app/patch.ts#applyPatch` (docs/plan/ticket-115.md p1, p3; the
// plan's "Shared client data" and "Checked views"). The modules load by `import()` inside each test,
// so a missing one is a red test and not a file that cannot be collected.
//
// The shape these laws hold the modules to, from the plan's sketches (the build may add more):
// - `clientMachine` (app/client.ts): a tea machine whose Model is `Client` and whose `init(null)` is
//   the empty client: no pending letter, `written` 0, `seen` 0, no view. It has no Cmds of its own.
// - `press {pid, m}`: reserves slot `n = written` as `{_tag: "dating", n, pid, m, seen, viewRev}` with
//   the view revision shown for `pid` (0 if none) and `seen`; `written` grows by one.
// - `dated {n, letter, sentAt}`: the slot `n` becomes `{_tag: "ready", ..., letter, sentAt}`. No slot,
//   or a slot already ready, changes nothing: a second answer cannot rewrite a letter.
// - `reply {letter, answer}`: `answer` is `Sent` (accepted or refused), or `{_tag: "unreachable"}` or
//   `{_tag: "unknown"}`. Only a matching accepted or refused answer removes that one letter.
// - `read {rev}`: raises `seen` to `rev`, never lowers it, and moves no letter.
// - `outbox(c)` (app/client.ts, a read of the Model): the ready letters in slot order, each with the
//   letter id it first got.
// - `notice`: a view notification. Its form is the lead's open call (this round's answer): the p3 and
//   counter laws below still call today's `notice(c, pid, note, decode)` until it is made.
// - `applyPatch(before, ops)`: an Effect `Result` of the next value; it never changes `before`.
// - `ClientRecord` and `failureRecord(error)` (app/window.ts): a record row holds ids, numbers and
//   fixed words only.
import {applyCell} from "@demlik/tea";
import {Machine} from "@demlik/tea/effect";
import {propertyTrace} from "@demlik/tea/pbt";
import {describe, expect, it} from "@effect/vitest";
import {Effect, Result, Schema} from "effect";
import * as fc from "fast-check";
import {diff} from "./patch.ts";

const SEED = 119120;
const LOAD = "./client.ts";
const WINDOW = "./window.ts";
const PATCH = "./patch.ts";
const RUNS = 300;
const SENT_AT = "2026-11-09T00:00:00.000Z";

type Letter = string;

type Pending = {
	readonly _tag: "dating" | "ready";
	readonly n: number;
	readonly pid: string;
	readonly m: unknown;
	readonly seen: number;
	readonly viewRev: number;
	readonly letter?: Letter;
	readonly sentAt?: string;
};

type Client = {
	readonly written: number;
	readonly seen: number;
	readonly pending: ReadonlyArray<Pending>;
	readonly views: Readonly<Record<string, {readonly rev: number; readonly view: unknown}>>;
};

type Answer = {readonly _tag: string; readonly [key: string]: unknown};

/** The client's Msgs these laws draw. `notice` waits on the lead's call (header). */
type ClientMsg =
	| {readonly type: "press"; readonly pid: string; readonly m: unknown}
	| {readonly type: "dated"; readonly n: number; readonly letter: Letter; readonly sentAt: string}
	| {readonly type: "reply"; readonly letter: Letter; readonly answer: Answer}
	| {readonly type: "read"; readonly rev: number};

type Step = {
	readonly prev: Client;
	readonly msg: ClientMsg;
	readonly next: Client;
	readonly cmds: ReadonlyArray<unknown>;
};

type Update = (s: Client, m: ClientMsg) => readonly [Client, ReadonlyArray<unknown>];

interface ClientMachine {
	readonly init: (loaded: Client | null, ctx: object) => readonly [Client, ReadonlyArray<unknown>];
	readonly update: Readonly<Record<string, Update>>;
}

/** What the machine laws run on: the real machine and its read, or a planted copy of either. */
interface MachineApi {
	readonly clientMachine: ClientMachine;
	readonly outbox: (c: Client) => ReadonlyArray<Pending>;
}

/** Today's view step, which the p3 and counter laws still call until the lead's call on `notice`. */
interface ClientApi {
	readonly emptyClient: Client;
	readonly press: (c: Client, input: {pid: string; m: unknown}) => Client;
	readonly dated: (c: Client, n: number, stamp: {letter: Letter; sentAt: string}) => Client;
	readonly outbox: (c: Client) => ReadonlyArray<Pending>;
	readonly notice: (
		c: Client,
		pid: string,
		note: unknown,
		decode: (u: unknown) => unknown,
	) => {readonly client: Client; readonly ask: boolean};
}

interface WindowApi {
	readonly failureRecord: (error: unknown) => unknown;
	readonly ClientRecord: Schema.Top;
}

interface PatchApi {
	readonly applyPatch: (
		before: unknown,
		ops: ReadonlyArray<unknown>,
	) => Result.Result<unknown, unknown>;
}

const client = async (): Promise<ClientApi> => (await import(LOAD)) as ClientApi;
const patching = async (): Promise<PatchApi> => (await import(PATCH)) as PatchApi;

const windowing = async (): Promise<WindowApi> => {
	const api = (await import(WINDOW)) as Partial<WindowApi>;
	expect(api.failureRecord, "app/window.ts exports failureRecord").toBeTypeOf("function");
	expect(api.ClientRecord, "app/window.ts exports ClientRecord").toBeDefined();
	return api as WindowApi;
};

const machine = async (): Promise<MachineApi> => {
	const api = (await import(LOAD)) as Partial<MachineApi>;
	expect(api.clientMachine, "app/client.ts exports clientMachine").toBeDefined();
	expect(api.outbox, "app/client.ts keeps outbox, a read of the Model").toBeTypeOf("function");
	return api as MachineApi;
};

/** The real machine with one Msg's step post-processed: a plant's one break. */
const planted = (
	api: MachineApi,
	type: ClientMsg["type"],
	change: (out: readonly [Client, ReadonlyArray<unknown>], s: Client, m: ClientMsg) => Client,
): MachineApi => {
	const real = api.clientMachine.update[type];
	expect(real, `clientMachine has a ${type} step`).toBeTypeOf("function");
	const step: Update = (s, m) => {
		const out = (real as Update)(s, m);
		return [change(out, s, m), out[1]];
	};
	return {
		...api,
		clientMachine: {...api.clientMachine, update: {...api.clientMachine.update, [type]: step}},
	};
};

// --- p1: a letter is never lost -----------------------------------------------------------------

const PIDS = ["process_a", "process_b"] as const;

type Op =
	| {readonly op: "press"; readonly pid: string; readonly m: {type: string}}
	| {readonly op: "dated"; readonly slot: number; readonly dup: boolean}
	| {readonly op: "reply"; readonly nth: number; readonly kind: string}
	| {readonly op: "read"; readonly rev: number};

/** Blind events: the same presses, dating answers and replies as before A5, plus reads. */
const ops = fc.array(
	fc.oneof(
		{
			weight: 4,
			arbitrary: fc.record({
				op: fc.constant("press" as const),
				pid: fc.constantFrom(...PIDS),
				m: fc.record({type: fc.constantFrom("inc", "dec", "reset")}),
			}),
		},
		{
			weight: 4,
			arbitrary: fc.record({
				op: fc.constant("dated" as const),
				slot: fc.nat(12),
				dup: fc.boolean(),
			}),
		},
		{
			weight: 5,
			arbitrary: fc.record({
				op: fc.constant("reply" as const),
				nth: fc.nat(12),
				kind: fc.constantFrom("accepted", "refused", "unreachable", "unknown"),
			}),
		},
		{
			weight: 2,
			arbitrary: fc.record({op: fc.constant("read" as const), rev: fc.nat(40)}),
		},
	) as fc.Arbitrary<Op>,
	{minLength: 1, maxLength: 60},
);

const answerFor = (kind: string): Answer =>
	kind === "accepted"
		? {_tag: "accepted", rev: 1, pos: 1}
		: kind === "refused"
			? {_tag: "refused", why: "bad_msg"}
			: {_tag: kind};

/**
 * Turns blind events into the client's Msgs with an independent model, not the machine: a dating
 * answer carries a fresh letter id for its slot every time (so a second answer would rewrite, if
 * the machine let it), and a reply names the `nth` letter the model has out, or one never sent.
 */
const toMsgs = (list: ReadonlyArray<Op>): ReadonlyArray<ClientMsg> => {
	const model: Array<{n: number; letter: Letter | null}> = [];
	let written = 0;
	return list.map((o, i): ClientMsg => {
		if (o.op === "press") {
			model.push({n: written++, letter: null});
			return {type: "press", pid: o.pid, m: o.m};
		}

		if (o.op === "read") {
			return {type: "read", rev: o.rev};
		}

		if (o.op === "dated") {
			const letter = `letter_${i}_${o.slot}`;
			const slot = model.find((x) => x.n === o.slot);

			if (slot !== undefined && slot.letter === null) {
				slot.letter = letter;
			}

			return {type: "dated", n: o.slot, letter, sentAt: SENT_AT};
		}

		const live = model.filter((x) => x.letter !== null);
		const hit = live.length === 0 ? undefined : live[o.nth % live.length];

		if (hit !== undefined && (o.kind === "accepted" || o.kind === "refused")) {
			model.splice(model.indexOf(hit), 1);
		}

		return {type: "reply", letter: hit?.letter ?? "letter_never_sent", answer: answerFor(o.kind)};
	});
};

const msgs = ops.map(toMsgs);

/** The p1 law over one run's steps, against an independent model of slots by number. */
const lettersKept = (api: MachineApi, steps: ReadonlyArray<Step>): string | null => {
	const model: Array<{n: number; letter: Letter | null; pid: string; m: unknown}> = [];
	const first = new Map<number, Letter>();
	let presses = 0;
	let seen = 0;

	for (const {msg, next} of steps) {
		if (msg.type === "press") {
			model.push({n: presses++, letter: null, pid: msg.pid, m: msg.m});
		} else if (msg.type === "dated") {
			const slot = model.find((x) => x.n === msg.n);

			if (slot !== undefined && slot.letter === null) {
				slot.letter = msg.letter;
				first.set(slot.n, msg.letter);
			}
		} else if (msg.type === "read") {
			seen = Math.max(seen, msg.rev);
		} else if (msg.answer._tag === "accepted" || msg.answer._tag === "refused") {
			const at = model.findIndex((x) => x.letter === msg.letter);

			if (at >= 0) {
				model.splice(at, 1);
			}
		}

		// After every step: the pending slots are the model's, in slot order, nothing lost.
		const got = {
			n: next.pending.map((p) => p.n),
			pid: next.pending.map((p) => p.pid),
			m: next.pending.map((p) => p.m),
			letter: next.pending.map((p) => p.letter ?? null),
			written: next.written,
			seen: next.seen,
			outbox: api.outbox(next).map((p) => p.letter),
		};
		const want = {
			n: model.map((x) => x.n),
			pid: model.map((x) => x.pid),
			m: model.map((x) => x.m),
			letter: model.map((x) => x.letter),
			// Written counts presses, and a read never moves a letter.
			written: presses,
			seen,
			// A dated letter keeps its first id: a resend twice is the same letters.
			outbox: model.filter((x) => x.letter !== null).map((x) => x.letter),
		};

		if (JSON.stringify(got) !== JSON.stringify(want)) {
			return `${msg.type}: the client holds ${JSON.stringify(got)}, the model ${JSON.stringify(want)}`;
		}

		for (const p of next.pending) {
			if (p.letter !== undefined && p.letter !== first.get(p.n)) {
				return `${msg.type}: slot ${p.n} has letter ${p.letter}, first dated as ${first.get(p.n)}`;
			}
		}

		const once = JSON.stringify(api.outbox(next));
		const twice = JSON.stringify(api.outbox(next));

		if (once !== twice) {
			return "the outbox reads differently twice on one Model";
		}
	}

	return null;
};

const p1 = (api: MachineApi) =>
	propertyTrace(
		api.clientMachine as never,
		{} as never,
		msgs as never,
		((steps: ReadonlyArray<Step>) => lettersKept(api, steps)) as never,
		{seed: SEED, numRuns: RUNS},
	);

describe("p1: a letter is never lost (clientMachine)", () => {
	it("only a matching terminal answer removes a letter; written grows per press; ids never repeat", async () => {
		const api = await machine();
		const [empty] = api.clientMachine.init(null, {});
		expect(empty).toEqual({written: 0, seen: 0, pending: [], views: {}});
		p1(api);
	});

	it("good thing: the runs leave a ready letter, settle one, keep a dating slot, and every drawn Msg acts", async () => {
		const api = await machine();
		let ready = 0,
			settled = 0,
			dating = 0;
		const run = propertyTrace(
			api.clientMachine as never,
			{} as never,
			msgs as never,
			((steps: ReadonlyArray<Step>, final: Client) => {
				for (const {prev, msg, next} of steps) {
					if (msg.type === "reply" && next.pending.length < prev.pending.length) {
						settled++;
					}
				}

				ready += final.pending.filter((p) => p._tag === "ready").length;
				dating += final.pending.filter((p) => p._tag === "dating").length;
				return null;
			}) as never,
			{seed: SEED, numRuns: RUNS},
		);
		expect({ready: ready > 0, settled: settled > 0, dating: dating > 0}).toEqual({
			ready: true,
			settled: true,
			dating: true,
		});

		for (const type of ["press", "dated", "reply", "read"]) {
			expect(run.msgCounts.get(type)?.acted ?? 0, `${type} acted`).toBeGreaterThan(0);
		}
	});

	// Plant (p1): clear the queue on any reply; allocate a new letter on resend. Each plant wraps the
	// real machine's step (or its read) with one break, and the law above must fail on it.
	it("plant: a client that clears the queue on any reply is caught", async () => {
		const api = await machine();
		expect(() => p1(planted(api, "reply", ([c]) => ({...c, pending: []})))).toThrow();
	});
	it("plant: a client that gives a resent letter a new id is caught", async () => {
		const api = await machine();
		expect(() =>
			p1(
				planted(api, "dated", ([c]) => ({
					...c,
					pending: c.pending.map((p) =>
						p.letter === undefined ? p : {...p, letter: `${p.letter}!`},
					),
				})),
			),
		).toThrow();
		expect(() =>
			p1({...api, outbox: (c) => api.outbox(c).map((p) => ({...p, letter: `${p.letter}-again`}))}),
		).toThrow();
	});
	it("plant: a read that moves a letter or lowers what was read is caught", async () => {
		const api = await machine();
		expect(() =>
			p1(planted(api, "read", ([c], _s, m) => ({...c, seen: m.type === "read" ? m.rev : c.seen}))),
		).toThrow();
		expect(() =>
			p1(planted(api, "read", ([c]) => ({...c, pending: c.pending.slice(1)}))),
		).toThrow();
	});
});

// --- p3: views move forward by one ------------------------------------------------------------

// `__proto__` is the one key a view may not carry: it is a pointer the patch refuses.
const json: fc.Arbitrary<unknown> = fc
	.jsonValue({maxDepth: 3})
	.filter((v) => !JSON.stringify(v).includes("__proto__"));

const objects = fc.dictionary(fc.string({maxLength: 6}), json, {maxKeys: 5});
const decodeAny = (u: unknown): unknown => u;

const isJson = (u: unknown): boolean => {
	try {
		return JSON.stringify(u) !== undefined;
	} catch {
		return false;
	}
};

/** One law per rule, each a function of the client under test, so a plant can run the same check. */
const viewLaws: Readonly<Record<string, (api: ClientApi) => void>> = {
	"forward by one": (api) =>
		fc.assert(
			fc.property(
				objects,
				objects,
				fc.integer({min: 1, max: 1000}),
				fc.integer({min: 2, max: 9}),
				(a, b, rev, gap) => {
					const first = api.notice(
						api.emptyClient,
						"process_a",
						{type: "whole", rev, view: a},
						decodeAny,
					);
					expect(first.client.views["process_a"]).toEqual({rev, view: a});
					expect(first.ask).toBe(false);
					const next = api.notice(
						first.client,
						"process_a",
						{type: "patch", base: rev, rev: rev + 1, patch: diff(a, b)},
						decodeAny,
					);
					expect(next.client.views["process_a"]).toEqual({rev: rev + 1, view: b});
					expect(next.ask).toBe(false);
					// Older and equal revisions do nothing and ask for nothing.
					const old = api.notice(
						next.client,
						"process_a",
						{type: "patch", base: rev - 1, rev, patch: diff(b, a)},
						decodeAny,
					);
					expect(old.client.views).toEqual(next.client.views);
					expect(old.ask).toBe(false);
					// A gap leaves the view and asks for a whole.
					const hole = api.notice(
						next.client,
						"process_a",
						{type: "patch", base: rev + gap, rev: rev + gap + 1, patch: diff(b, a)},
						decodeAny,
					);
					expect(hole.client.views).toEqual(next.client.views);
					expect(hole.ask).toBe(true);
					// A whole copy always replaces, a lower revision included (data was reset).
					const reset = api.notice(
						next.client,
						"process_a",
						{type: "whole", rev: 1, view: a},
						decodeAny,
					);
					expect(reset.client.views["process_a"]).toEqual({rev: 1, view: a});
				},
			),
			{seed: SEED, numRuns: RUNS},
		),
	"real diffs reach their target": (api) =>
		fc.assert(
			fc.property(fc.array(objects, {minLength: 2, maxLength: 8}), (views) => {
				let c = api.notice(
					api.emptyClient,
					"process_a",
					{type: "whole", rev: 7, view: views[0]},
					decodeAny,
				).client;

				for (let i = 1; i < views.length; i++) {
					c = api.notice(
						c,
						"process_a",
						{type: "patch", base: 6 + i, rev: 7 + i, patch: diff(views[i - 1], views[i])},
						decodeAny,
					).client;
				}

				expect(c.views["process_a"]).toEqual({rev: 6 + views.length, view: views.at(-1)});
			}),
			{seed: SEED, numRuns: RUNS},
		),
	"junk never throws and changes nothing": (api) =>
		fc.assert(
			fc.property(json, fc.jsonValue(), objects, (junk, other, good) => {
				const base = api.notice(
					api.emptyClient,
					"process_a",
					{type: "whole", rev: 3, view: good},
					decodeAny,
				).client;

				for (const note of [
					junk,
					other,
					{type: "patch", base: 3, rev: 4, patch: "junk"},
					{type: "patch", base: 3, rev: 4, patch: 7},
					{type: "patch", base: 3, rev: 4, patch: [{op: "add", path: "/__proto__/x", value: 1}]},
					{type: "patch", base: 3, rev: 4, patch: [{op: "add", path: "no-slash", value: 1}]},
				]) {
					expect(api.notice(base, "process_a", note, decodeAny).client.views).toEqual(base.views);
				}

				expect(({} as {x?: unknown}).x).toBeUndefined();
			}),
			{seed: SEED, numRuns: RUNS},
		),
	"a candidate the decoder refuses is never installed": (api) =>
		fc.assert(
			fc.property(objects, fc.string(), (good, text) => {
				const base = api.notice(
					api.emptyClient,
					"process_a",
					{type: "whole", rev: 3, view: good},
					decodeAny,
				).client;
				const reject = (): unknown => {
					throw new Error("not a view");
				};
				const refused = api.notice(
					base,
					"process_a",
					{type: "patch", base: 3, rev: 4, patch: [{op: "replace", path: "", value: text}]},
					reject,
				);
				expect(refused.client.views).toEqual(base.views);
				expect(refused.ask).toBe(true);
			}),
			{seed: SEED, numRuns: RUNS},
		),
	"the old view is never mutated, untouched views keep their reference": (api) =>
		fc.assert(
			fc.property(objects, objects, (a, b) => {
				const frozen = structuredClone(a);
				const c0 = api.notice(
					api.emptyClient,
					"process_a",
					{type: "whole", rev: 1, view: a},
					decodeAny,
				).client;
				const other = api.notice(
					c0,
					"process_b",
					{type: "whole", rev: 1, view: {k: 1}},
					decodeAny,
				).client;
				const c1 = api.notice(
					other,
					"process_a",
					{type: "patch", base: 1, rev: 2, patch: diff(a, b)},
					decodeAny,
				).client;
				expect(a).toEqual(frozen);
				expect(c1.views["process_b"]).toBe(other.views["process_b"]);
			}),
			{seed: SEED, numRuns: RUNS},
		),
};

describe("p3: views move forward by one (client)", () => {
	for (const [name, law] of Object.entries(viewLaws)) {
		it(name, async () => law(await client()));
	}

	// Plants (p3): apply across a gap; install a string count; mutate the old view.
	it("plant: applying across a gap is caught", async () => {
		const real = await client();
		const broken: ClientApi = {
			...real,
			notice: (c, pid, note, d) => {
				const n = note as {type?: string; patch?: unknown};
				const at = c.views[pid]?.rev ?? 0;
				return n.type === "patch"
					? real.notice(c, pid, {...n, base: at, rev: at + 1}, d)
					: real.notice(c, pid, note, d);
			},
		};
		expect(() => viewLaws["forward by one"]?.(broken)).toThrow();
	});
	it("plant: installing a candidate the decoder refused is caught", async () => {
		const real = await client();
		const broken: ClientApi = {
			...real,
			notice: (c, pid, note, _d) => real.notice(c, pid, note, decodeAny),
		};
		expect(() =>
			viewLaws["a candidate the decoder refuses is never installed"]?.(broken),
		).toThrow();
	});
	it("plant: mutating the old view is caught", async () => {
		const real = await client();
		const broken: ClientApi = {
			...real,
			notice: (c, pid, note, d) => {
				const out = real.notice(c, pid, note, d);
				const cur = c.views[pid]?.view;

				if (typeof cur === "object" && cur !== null) {
					Object.assign(cur, {leak: 1});
				}

				return out;
			},
		};
		expect(() =>
			viewLaws["the old view is never mutated, untouched views keep their reference"]?.(broken),
		).toThrow();
	});
	it("plant: a throwing client on junk is caught", async () => {
		const real = await client();
		const broken: ClientApi = {
			...real,
			notice: (c, pid, note, d) =>
				note === null || typeof note !== "object" || Array.isArray(note)
					? (() => {
							throw new Error("boom");
						})()
					: real.notice(c, pid, note, d),
		};
		expect(() => viewLaws["junk never throws and changes nothing"]?.(broken)).toThrow();
	});
});

describe("applyPatch: checked, pure, and refused when malformed", () => {
	it("applies real diffs, arrays and escaped tokens included, and returns a new value", async () => {
		const {applyPatch} = await patching();
		fc.assert(
			fc.property(json, json, (a, b) => {
				const frozen = structuredClone(a);
				const out = applyPatch(a, diff(a, b));
				expect(Result.isSuccess(out)).toBe(true);

				if (Result.isSuccess(out)) {
					expect(out.success).toEqual(b);
				}

				expect(a).toEqual(frozen);
			}),
			{seed: SEED, numRuns: RUNS},
		);
	});
	it("refuses malformed pointers and unsafe keys, never throws", async () => {
		const {applyPatch} = await patching();
		const bad = fc.oneof(
			fc.constantFrom("x", "a/b", "/__proto__/x", "/constructor/prototype/x", "/a/~2", "/a/~"),
			fc.string({maxLength: 5}).filter((s) => s !== "" && !s.startsWith("/")),
		);
		fc.assert(
			fc.property(
				objects,
				bad,
				fc.constantFrom("add", "remove", "replace"),
				json,
				(view, path, op, value) => {
					const out = applyPatch(view, [{op, path, value}]);
					expect(Result.isFailure(out)).toBe(true);
					expect({}.constructor === Object && !("x" in {})).toBe(true);
				},
			),
			{seed: SEED, numRuns: RUNS},
		);
	});
	it("an operation outside add, remove and replace is refused", async () => {
		const {applyPatch} = await patching();
		fc.assert(
			fc.property(objects, fc.constantFrom("move", "copy", "test", "", "ADD"), (view, op) => {
				expect(Result.isFailure(applyPatch(view, [{op, path: "/a", from: "/b", value: 1}]))).toBe(
					true,
				);
			}),
			{seed: SEED, numRuns: 50},
		);
	});
});

// --- the counter's shape: an independent fold -------------------------------------------------

// libfabrika may not import a program (layers.test.ts), so the machine below is the counter's own
// schema and arithmetic as `programs/counter/src/program.ts` has them. The real counter runs the
// same fold in the browser, in `e2e/first-window.test.ts`.
const CounterMsg = Schema.Union([
	Schema.Struct({type: Schema.Literal("inc")}),
	Schema.Struct({type: Schema.Literal("dec")}),
	Schema.Struct({type: Schema.Literal("reset")}),
]);

const CounterModel = Schema.Struct({count: Schema.Int});

const counterMachine = Machine.make({
	model: CounterModel,
	msg: CounterMsg,
	cmds: [],
	init: (loaded) => [loaded ?? {count: 0}, []],
	update: {
		inc: (s) => [{count: s.count + 1}, []],
		dec: (s) => [{count: s.count - 1}, []],
		reset: () => [{count: 0}, []],
	},
});

/** The independent fold: the count after `msgs` is what arithmetic says, reset to zero included. */
const fold = (msgs: ReadonlyArray<{type: string}>): number =>
	msgs.reduce((n, m) => (m.type === "inc" ? n + 1 : m.type === "dec" ? n - 1 : 0), 0);

describe("the counter's typed views and resends agree with an independent fold", () => {
	it.effect.prop(
		"each distinct letter moves the shown count once, however many times it is resent, and the cache is not the truth",
		{
			msgs: Schema.Array(CounterMsg).check(Schema.isMaxLength(25)),
			resends: Schema.Array(Schema.Int.check(Schema.isBetween({minimum: 0, maximum: 24}))).check(
				Schema.isMaxLength(30),
			),
		},
		({msgs, resends}) =>
			Effect.promise(async () => {
				const api = await client();
				const decode = Schema.decodeUnknownSync(CounterModel);
				// The "brain": the real counter machine, stepping each distinct letter once, saving letters.
				let [model] = counterMachine.init(null, {});
				let rev = 0;
				const saved: Array<{type: string}> = [];
				const seenLetters = new Set<string>();
				let c = api.emptyClient;
				c = api.notice(
					c,
					"process_a",
					{type: "whole", rev, view: {count: model.count}},
					decode,
				).client;

				for (const m of msgs) {
					c = api.press(c, {pid: "process_a", m});
				}

				for (const n of msgs.keys()) {
					c = api.dated(c, n, {letter: `letter_${n}`, sentAt: "2026-11-09T00:00:00.000Z"});
				}

				const send = (n: number): void => {
					const letter = api.outbox(c).find((p) => p.n === n)?.letter;

					if (letter === undefined || seenLetters.has(letter)) {
						return;
					} // a resend: placed once already

					seenLetters.add(letter);
					const m = msgs[n];

					if (m === undefined) {
						return;
					}

					const [next] = applyCell(counterMachine, model, m as never);
					const patch = diff({count: model.count}, {count: next.count});
					model = next;
					saved.push(m);
					rev++;
					c = api.notice(c, "process_a", {type: "patch", base: rev - 1, rev, patch}, decode).client;
				};

				for (const n of [...msgs.keys(), ...resends.filter((r) => r < msgs.length)]) {
					send(n);
				}

				expect(c.views["process_a"]?.view).toEqual({count: fold(saved)});
				expect(c.views["process_a"]?.view).toEqual({
					count: fold(msgs.filter((_, n) => seenLetters.has(`letter_${n}`))),
				});
				// Discarding the view cache loses no saved count: a whole view from the saved letters restores it.
				const cleared = {...c, views: {}};
				const restored = api.notice(
					cleared,
					"process_a",
					{type: "whole", rev, view: {count: fold(saved)}},
					decode,
				).client;
				expect(restored.views["process_a"]?.view).toEqual(c.views["process_a"]?.view);
			}),
		{arbitrary: {seed: SEED, runs: 150}},
	);
	it("a patch that makes a string count is not installed", async () => {
		const api = await client();
		const decode = Schema.decodeUnknownSync(CounterModel);
		const base = api.notice(
			api.emptyClient,
			"process_a",
			{type: "whole", rev: 1, view: {count: 1}},
			decode,
		).client;
		const out = api.notice(
			base,
			"process_a",
			{type: "patch", base: 1, rev: 2, patch: [{op: "replace", path: "/count", value: "2"}]},
			decode,
		);
		expect(out.client.views["process_a"]).toEqual({rev: 1, view: {count: 1}});
		expect(out.ask).toBe(true);
	});
});

// --- [secrets]: what the client records ---------------------------------------------------------

const SECRET_FORMS = (s: string): ReadonlyArray<string> => [
	s,
	btoa(s),
	btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""),
	encodeURIComponent(s),
	encodeURIComponent(encodeURIComponent(s)),
	Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join(""),
	JSON.stringify(s).slice(1, -1),
];

const sentinel = fc.stringMatching(/^[A-Za-z0-9+/=_ -]{12,32}$/).map((s) => `KEY-${s}`);

describe("[secrets] client records carry ids, numbers and fixed words only", () => {
	const failures = fc.record({
		secret: sentinel,
		shape: fc.constantFrom("error", "cause", "tagged", "object", "string", "nested"),
		name: fc.constantFrom("KeyError", "DataError", "NotAllowedError", "TypeError"),
	});
	const make = ({secret, shape, name}: {secret: string; shape: string; name: string}): unknown => {
		const error = Object.assign(new Error(`${name}: ${secret}`), {
			name,
			stack: `at ${secret}`,
			secret,
		});
		return shape === "cause"
			? new Error("outer", {cause: error})
			: shape === "tagged"
				? {_tag: name, key: secret, message: secret}
				: shape === "object"
					? {message: secret, key: secret, url: `/client/${encodeURIComponent(secret)}/tab`}
					: shape === "string"
						? secret
						: shape === "nested"
							? {why: {inner: [error]}}
							: error;
	};
	it("a failure's record keeps none of the secret in any form, and decodes as a ClientRecord", async () => {
		const api = await windowing();
		fc.assert(
			fc.property(failures, (f) => {
				const row = api.failureRecord(make(f));
				Schema.decodeUnknownSync(api.ClientRecord as Schema.Decoder<unknown>)(row);
				const text = JSON.stringify(row);

				for (const form of SECRET_FORMS(f.secret)) {
					expect(text).not.toContain(form);
				}
			}),
			{seed: SEED, numRuns: RUNS},
		);
	});
	// Plant: a record that copies the failure's message leaks the sentinel, and the check sees it.
	it("plant: a record that copies the message is caught", async () => {
		const api = await windowing();
		const leaky = (e: unknown) => ({
			...(api.failureRecord(e) as object),
			why: String((e as {message?: unknown})?.message ?? e),
		});
		const caught = (f: {secret: string; shape: string; name: string}) =>
			SECRET_FORMS(f.secret).some((form) => JSON.stringify(leaky(make(f))).includes(form));
		fc.assert(
			fc.property(
				failures.filter((f) => f.shape === "error" || f.shape === "object" || f.shape === "string"),
				(f) => caught(f) === true,
			),
			{seed: SEED, numRuns: 50},
		);
		expect(isJson({})).toBe(true);
	});
});
