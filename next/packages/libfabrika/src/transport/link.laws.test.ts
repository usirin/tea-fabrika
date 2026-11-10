// P14, next/ (Tier 1, ticket 286): p5, the link never sits still, with Tier 1's grant-wait
// amendment, and the stale-dial and grant laws. Written before `transport/link.ts`
// (docs/plan/ticket-115.md p5; the plan's "Shared client data and the window parent").
//
// The shape these laws hold the module to, from the plan's sketch (the build may add more):
// - `Link`: Schema.TaggedUnion of dialing{dial}, waiting_grant{dial, fingerprint, code, until},
//   online{dial, ping}, retrying{dial, tries}, removed{fingerprint}, blocked{reason}.
// - `linkMachine`: a tea machine whose model is a `Link`, init `dialing` at some dial. Msgs, by
//   `type`: admitted{dial, ping}, not_granted{dial, fingerprint, code, until}, granted{dial},
//   closed{dial, code, fingerprint}, retry{dial, tries}, beat{dial}, pong{dial}, stalled{dial},
//   renew{dial}, blocked{reason}, ask_again{dial}. Every Msg that names a `dial` is about that dial.
// - `linkTimer(link)`: the timer the state is waiting for, `{after, msg}` in ms, or null when only a
//   person can move it (removed, blocked). Applying `msg` is what the timer does.
// - `backoff(tries)`: the wait before a retry, in ms.
import {applyCell} from "@demlik/tea";
import {arbMsgSequence} from "@demlik/tea/pbt";
import {describe, expect, it} from "@effect/vitest";
import {Schema} from "effect";
import * as fc from "fast-check";

const SEED = 119120;
const LOAD = "./link.ts";
// The test kit lives in the app layer above transport, so it loads by a path the layer graph does not follow.
const KIT = "../testing.ts";
const RUNS = 200;
const CAP = 30_000; // p5: no wait is over 30 seconds

type Link = {readonly _tag: string; readonly [key: string]: unknown};
type Msg = {readonly type: string; readonly [key: string]: unknown};

interface LinkApi {
	readonly Link: Schema.Codec<Link, unknown>;
	readonly linkMachine: Parameters<typeof applyCell>[0] & {
		readonly init: (loaded: Link | null, ctx: object) => readonly [Link, ReadonlyArray<unknown>];
		readonly model: Schema.Codec<Link, unknown>;
	};
	readonly linkTimer: (link: Link) => {readonly after: number; readonly msg: Msg} | null;
	readonly backoff: (tries: number) => number;
}

const api = async (): Promise<LinkApi> => (await import(LOAD)) as LinkApi;

const step = (a: LinkApi, s: Link, msg: Msg): readonly [Link, ReadonlyArray<unknown>] =>
	// oxlint-disable-next-line fabrika/no-type-assertions -- the module is loaded by import() so a missing one is a red test; the cast names the shape the plan gives it
	applyCell(a.linkMachine, s as never, msg as never) as unknown as readonly [
		Link,
		ReadonlyArray<unknown>,
	];

// The dials are small so a Msg often names the current one, and often an old or a future one.
const dial = fc.integer({min: 0, max: 5});
const word = fc.constantFrom("a", "b", "SHA256:x");

const msg: fc.Arbitrary<Msg> = fc.oneof(
	fc.record({type: fc.constant("admitted"), dial, ping: fc.nat(3)}),
	fc.record({
		type: fc.constant("not_granted"),
		dial,
		fingerprint: word,
		code: word,
		until: fc.integer({min: 0, max: 60_000}),
	}),
	fc.record({type: fc.constant("granted"), dial}),
	fc.record({
		type: fc.constant("closed"),
		dial,
		code: fc.constantFrom(1000, 1006, 4003, 4000),
		fingerprint: word,
	}),
	fc.record({type: fc.constant("retry"), dial, tries: fc.integer({min: 0, max: 12})}),
	fc.record({type: fc.constant("beat"), dial}),
	fc.record({type: fc.constant("pong"), dial}),
	fc.record({type: fc.constant("stalled"), dial}),
	fc.record({type: fc.constant("renew"), dial}),
	fc.record({type: fc.constant("blocked"), reason: word}),
	fc.record({type: fc.constant("ask_again"), dial: fc.integer({min: 6, max: 9})}),
);

const sequences = arbMsgSequence(msg, {minLength: 1, maxLength: 40});

// A half of the lists start on a normal path in, so deep states are reached (demlik#745).
const prefixed = fc.oneof(
	sequences,
	arbMsgSequence(msg, {
		minLength: 1,
		maxLength: 40,
		prefix: [{type: "not_granted", dial: 1, fingerprint: "SHA256:x", code: "a", until: 1000}],
	}),
	arbMsgSequence(msg, {
		minLength: 1,
		maxLength: 40,
		prefix: [{type: "admitted", dial: 1, ping: 0}],
	}),
);

const opts = {seed: SEED, numRuns: RUNS};
const currentDial = (s: Link): number | null => (typeof s["dial"] === "number" ? s["dial"] : null);
const same = (x: unknown, y: unknown): boolean => JSON.stringify(x) === JSON.stringify(y);

/** What the laws drive: the real machine's reducer from its real init, or the real one with a break. */
interface Driver {
	readonly init: Link;
	readonly step: (s: Link, m: Msg) => readonly [Link, ReadonlyArray<unknown>];
	readonly timer: LinkApi["linkTimer"];
	readonly backoff: LinkApi["backoff"];
	readonly isLink: (s: unknown) => boolean;
}

const real = (a: LinkApi): Driver => ({
	init: a.linkMachine.init(null, {})[0],
	step: (s, m) => step(a, s, m),
	timer: a.linkTimer,
	backoff: a.backoff,
	isLink: Schema.is(a.Link),
});

/** Folds a list through the driver, handing each step to `each`. */
const walk = (
	d: Driver,
	list: ReadonlyArray<Msg>,
	each: (prev: Link, m: Msg, next: Link, cmds: ReadonlyArray<unknown>) => void,
): void => {
	let s = d.init;

	for (const m of list) {
		const [next, cmds] = d.step(s, m);
		each(s, m, next, cmds);
		s = next;
	}
};

const fail = (what: string): never => {
	throw new Error(what);
};

const laws: Readonly<Record<string, (d: Driver) => void>> = {
	"valid states, online without a retry count, no wait over 30 s": (d) =>
		fc.assert(
			fc.property(prefixed, (list) =>
				walk(d, list, (_p, _m, s) => {
					if (!d.isLink(s)) {fail(`not a Link: ${JSON.stringify(s)}`);}

					if (s._tag === "online" && "tries" in s) {fail("online keeps a retry count");}

					if (s._tag === "retrying" && !(typeof s["tries"] === "number" && s["tries"] >= 1))
						{fail("retrying without tries");}

					const timer = d.timer(s);

					if (timer !== null && !(timer.after >= 0 && timer.after <= CAP))
						{fail(`a wait of ${timer.after} ms`);}
				}),
			),
			opts,
		),
	"the state's own timer moves it; a grant wait stays a grant wait": (d) =>
		fc.assert(
			fc.property(prefixed, (list) =>
				walk(d, list, (_p, _m, s) => {
					const timer = d.timer(s);
					const terminal = s._tag === "removed" || s._tag === "blocked";

					if (terminal) {return timer === null ? undefined : fail(`${s._tag} has a timer`);}

					if (timer === null) {return fail(`${s._tag} has no timer`);}

					const [after, cmds] = d.step(s, timer.msg);

					if (same(after, s) && cmds.length === 0) {fail(`${s._tag}'s timer did nothing`);}

					if (s._tag === "waiting_grant" && after._tag !== "waiting_grant")
						{fail("a timer left the grant wait");}
				}),
			),
			opts,
		),
	"backoff grows and stops at the cap, and the retry timer waits it": (d) => {
		fc.assert(
			fc.property(fc.nat(60), (tries) => {
				const wait = d.backoff(tries);

				if (!(wait > 0 && wait <= CAP && d.backoff(tries + 1) >= wait))
					{fail(`backoff(${tries}) = ${wait}`);}
			}),
			opts,
		);
		fc.assert(
			fc.property(dial, fc.integer({min: 1, max: 60}), (n, tries) => {
				if (d.timer({_tag: "retrying", dial: n, tries})?.after !== d.backoff(tries))
					{fail("the retry timer is not the backoff");}
			}),
			opts,
		);
	},
	"a Msg for another dial does nothing: no new state, no Cmd": (d) =>
		fc.assert(
			fc.property(prefixed, (list) =>
				walk(d, list, (p, m, next, cmds) => {
					const named = m["dial"];

					if (m.type === "ask_again" || typeof named !== "number") {return;}

					if (p._tag === "removed" || p._tag === "blocked" || currentDial(p) === named) {return;}

					if (!same(next, p) || cmds.length > 0)
						{fail(`dial ${String(named)} moved ${JSON.stringify(p)}`);}
				}),
			),
			opts,
		),
	"a grant wait leaves only by client.granted on its dial, or a close or a block": (d) =>
		fc.assert(
			fc.property(dial, word, word, fc.nat(60_000), msg, (n, fingerprint, code, until, m) => {
				const waiting: Link = {_tag: "waiting_grant", dial: n, fingerprint, code, until};
				const [after] = d.step(waiting, m);
				const allowed =
					(m.type === "granted" && m.dial === n) ||
					(m.type === "closed" && m.dial === n) ||
					m.type === "blocked";

				if (after._tag !== "waiting_grant" && !allowed)
					{fail(`${JSON.stringify(m)} took a grant wait away`);}

				if (m.type === "granted" && m.dial === n && after._tag !== "dialing")
					{fail("client.granted did not dial again");}

				if (m.type === "admitted" && after._tag !== "waiting_grant")
					{fail("an admit approved a grant wait");}

				const timer = d.timer(waiting);

				if (timer !== null && d.step(waiting, timer.msg)[0]._tag !== "waiting_grant")
					{fail("a timer approved a grant wait");}
			}),
			opts,
		),
	"a 4003 close on the current dial removes the key; only Ask again leaves it": (d) =>
		fc.assert(
			fc.property(prefixed, word, fc.integer({min: 6, max: 9}), (list, fingerprint, again) => {
				walk(d, list, (_p, _m, s) => {
					const n = currentDial(s);

					if (n === null || s._tag === "retrying") {return;}

					const [dead] = d.step(s, {type: "closed", dial: n, code: 4003, fingerprint});

					if (dead._tag !== "removed" || dead["fingerprint"] !== fingerprint)
						{fail(`4003 left ${s._tag} as ${dead._tag}`);}

					if (d.timer(dead) !== null) {fail("a removed key keeps retrying");}

					for (const m of list)
						{if (m.type !== "ask_again" && !same(d.step(dead, m)[0], dead))
							fail(`${m.type} moved a removed key`);}

					if (d.step(dead, {type: "ask_again", dial: again})[0]._tag !== "dialing")
						{fail("Ask again did not dial");}
				});
			}),
			opts,
		),
};

describe("p5: the link never sits still", () => {
	for (const [name, law] of Object.entries(laws)) {it(name, async () => law(real(await api())));}

	it("good thing: the generated runs reach every state, a grant, a stale Msg and a removal", async () => {
		const d = real(await api());
		const tags = new Set<string>();
		let granted = 0,
			stale = 0;
		fc.assert(
			fc.property(prefixed, (list) =>
				walk(d, list, (p, m, next) => {
					tags.add(next._tag);

					if (m.type === "granted" && p._tag === "waiting_grant" && next._tag === "dialing")
						{granted++;}

					if (typeof m["dial"] === "number" && currentDial(p) !== m["dial"]) {stale++;}
				}),
			),
			opts,
		);
		expect([...tags].sort()).toEqual([
			"blocked",
			"dialing",
			"online",
			"removed",
			"retrying",
			"waiting_grant",
		]);
		expect(granted).toBeGreaterThan(0);
		expect(stale).toBeGreaterThan(0);
	});

	it("saved state: stopping at every message and booting from the saved text gives the same run", async () => {
		const a = await api();
		const {syncTest} = (await import(KIT)) as {
			syncTest: (m: never, ctx: object, o: object) => void;
		};
		fc.assert(
			fc.property(prefixed, (list) => {
				syncTest(
					a.linkMachine as never,
					{},
					{
						msgs: list as never,
						encode: Schema.encodeSync(a.Link),
						decode: Schema.decodeUnknownSync(a.Link),
						equals: same,
						seed: SEED,
					},
				);
			}),
			opts,
		);
	});
});

// Plants (p5): ignore retry; honor an old close; admit on a timer; remove the 30-second cap. Each is
// the real reducer with one break, and the law that names it must throw.
describe("p5 plants: each break is caught by the law that names it", () => {
	const plant = (d: Driver, over: Partial<Driver>): Driver => ({...d, ...over});
	const live = (s: Link): boolean =>
		["dialing", "online", "retrying", "waiting_grant"].includes(s._tag);
	it("ignoring retry is caught", async () => {
		const d = real(await api());
		const broken = plant(d, {step: (s, m) => (m.type === "retry" ? [s, []] : d.step(s, m))});
		expect(() =>
			laws["the state's own timer moves it; a grant wait stays a grant wait"]?.(broken),
		).toThrow();
	});
	it("honoring an old close is caught", async () => {
		const d = real(await api());
		const broken = plant(d, {
			step: (s, m) =>
				m.type === "closed" && live(s) && currentDial(s) !== m["dial"]
					? [{_tag: "retrying", dial: currentDial(s) ?? 0, tries: 1}, []]
					: d.step(s, m),
		});
		expect(() =>
			laws["a Msg for another dial does nothing: no new state, no Cmd"]?.(broken),
		).toThrow();
	});
	it("admitting a grant wait on a timer is caught", async () => {
		const d = real(await api());
		const broken = plant(d, {
			step: (s, m) =>
				m.type === "renew" && s._tag === "waiting_grant"
					? [{_tag: "online", dial: currentDial(s) ?? 0, ping: 0}, []]
					: d.step(s, m),
		});
		expect(() =>
			laws["a grant wait leaves only by client.granted on its dial, or a close or a block"]?.(
				broken,
			),
		).toThrow();
	});
	it("a client.granted that is ignored is caught", async () => {
		const d = real(await api());
		const broken = plant(d, {step: (s, m) => (m.type === "granted" ? [s, []] : d.step(s, m))});
		expect(() =>
			laws["a grant wait leaves only by client.granted on its dial, or a close or a block"]?.(
				broken,
			),
		).toThrow();
	});
	it("removing the 30-second cap is caught", async () => {
		const d = real(await api());
		const uncapped = (tries: number): number => 250 * 2 ** tries;
		const broken = plant(d, {
			backoff: uncapped,
			timer: (s) =>
				s._tag === "retrying"
					? {
							after: uncapped(s["tries"] as number),
							msg: {type: "retry", dial: s["dial"], tries: s["tries"]},
						}
					: d.timer(s),
		});
		expect(() =>
			laws["backoff grows and stops at the cap, and the retry timer waits it"]?.(broken),
		).toThrow();
	});
	it("honoring a 4003 as an ordinary close is caught", async () => {
		const d = real(await api());
		const broken = plant(d, {
			step: (s, m) =>
				m.type === "closed" && m["code"] === 4003 && live(s)
					? [{_tag: "retrying", dial: currentDial(s) ?? 0, tries: 1}, []]
					: d.step(s, m),
		});
		expect(() =>
			laws["a 4003 close on the current dial removes the key; only Ask again leaves it"]?.(broken),
		).toThrow();
	});
});
