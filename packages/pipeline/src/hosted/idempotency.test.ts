import {Ledger} from "@kampus/fabrika";
import {layerMemory} from "@kampus/fabrika/memory";
import {Duration, Effect, Layer, Option, Schema} from "effect";
import {describe, expect, it} from "vitest";
import {
	type Faults,
	gate,
	Key,
	KeyRefused,
	noFaults,
	useKey,
	type Write,
	type WriteNote,
	writesOf,
} from "./idempotency.ts";

// The S6 gate: a write leaves the ledger at most once per key, only under a live lease whose claim
// is the newest, and only with a key the gate handed out.

const NAME = "ship:7";

/** The lease on NAME for `ttlMs`, as `holder`. */
const claimed = (holder: string, ttlMs: number) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		const rev = (yield* ledger.readLast(NAME, 1))[0]?.rev ?? 0;
		return yield* ledger.claim(NAME, holder, rev, ttlMs);
	});

/** A world with one counter: how many times the write was sent. `out` is what the world has. */
const world = () => {
	const sent: string[] = [];
	const write = (op = "comment"): Write<string> => ({
		op,
		subject: "pr@abc",
		answer: Schema.String,
		look: (key) => Effect.succeed(sent.includes(key) ? Option.some(`found ${key}`) : Option.none()),
		send: (key) =>
			useKey(key).pipe(
				Effect.map((text) => {
					sent.push(text);
					return `sent ${text}`;
				}),
			),
	});
	return {sent, write};
};

const run = <A, E>(effect: Effect.Effect<A, E, Ledger | Faults>) =>
	Effect.runPromise(
		effect.pipe(Effect.scoped, Effect.provide(Layer.merge(layerMemory(), noFaults))),
	);

const notes = () => {
	const said: WriteNote[] = [];
	return {said, say: (n: WriteNote) => said.push(n)};
};

describe("the idempotency gate", () => {
	it("sends a write once: a second ask, on this host or the next, reads the answer from the ledger", async () => {
		const w = world();
		const {said, say} = notes();
		const out = await run(
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				yield* ledger.register(NAME, "test");
				const c = yield* claimed("a", 30_000);
				const g = yield* gate({name: NAME, fence: c.fence, holder: "a", say});
				const first = yield* g.once(w.write());
				const again = yield* g.once(w.write());
				const other = yield* gate({name: NAME, fence: c.fence, holder: "b", say});
				const third = yield* other.once(w.write());
				return {first, again, third, rows: yield* ledger.readStream(writesOf(NAME))};
			}),
		);
		expect(w.sent).toEqual([`${NAME}#comment:pr@abc`]);
		expect([out.first, out.again, out.third]).toEqual(Array(3).fill(`sent ${NAME}#comment:pr@abc`));
		expect(out.rows.map((r) => r.id)).toEqual([
			`intent:${NAME}#comment:pr@abc`,
			`done:${NAME}#comment:pr@abc`,
		]);
		expect(said.map((n) => n.step)).toEqual([
			"intent",
			"send",
			"sent",
			"done",
			"done_found",
			"done_found",
		]);
	});

	it("after an intent row with no done row, looks out there first: found is not sent again", async () => {
		const w = world();
		const {said, say} = notes();
		await run(
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				yield* ledger.register(NAME, "test");
				const c = yield* claimed("a", 30_000);
				const key = `${NAME}#comment:pr@abc`;
				// The last holder wrote its intent, sent, and died before its done row.
				yield* ledger.append(
					writesOf(NAME),
					"any",
					{kind: "intent", writer: "a", id: `intent:${key}`, data: {key}},
					c.fence,
				);
				w.sent.push(key);
				const g = yield* gate({name: NAME, fence: c.fence, holder: "a", say});
				expect(yield* g.once(w.write())).toBe(`found ${key}`);
			}),
		);
		expect(w.sent).toHaveLength(1);
		expect(said.map((n) => n.step)).toEqual(["found_out_there", "done"]);
	});

	it("after an intent row with no done row, sends when the write is not out there", async () => {
		const w = world();
		const {said, say} = notes();
		await run(
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				yield* ledger.register(NAME, "test");
				const c = yield* claimed("a", 30_000);
				const key = `${NAME}#comment:pr@abc`;
				yield* ledger.append(
					writesOf(NAME),
					"any",
					{kind: "intent", writer: "a", id: `intent:${key}`, data: {key}},
					c.fence,
				);
				const g = yield* gate({name: NAME, fence: c.fence, holder: "a", say});
				yield* g.once(w.write());
			}),
		);
		expect(w.sent).toHaveLength(1);
		expect(said.map((n) => n.step)).toEqual(["send", "sent", "done"]);
	});

	it("a host whose lease was taken over sends nothing: its intent row is refused", async () => {
		const w = world();
		const {said, say} = notes();
		const out = await run(
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				yield* ledger.register(NAME, "test");
				const a = yield* claimed("a", 50);
				yield* Effect.sleep(Duration.millis(80));
				const b = yield* claimed("b", 30_000);
				const late = yield* gate({name: NAME, fence: a.fence, holder: "a", say});
				return {
					b: b.fence,
					a: a.fence,
					answered: yield* late.once(w.write()).pipe(Effect.timeoutOption(Duration.millis(300))),
				};
			}),
		);
		expect(out.b).toBeGreaterThan(out.a);
		expect(Option.isNone(out.answered)).toBe(true);
		expect(w.sent).toEqual([]);
		expect(said.map((n) => n.step)).toEqual(["refused_fence"]);
	});

	// 151: a lease past its end is not lost until someone newer claims. The gate waits there: the
	// holder's renew lets the send go, another holder's claim refuses it.
	it("a lease that has run out holds the send until it is renewed, and refuses it once another holder claims; the planted mistake sends", async () => {
		const send = async (next: "nothing" | "renew" | "claim", planted = false) => {
			const w = world();
			const {said, say} = notes();
			await run(
				Effect.gen(function* () {
					const ledger = yield* Ledger;
					yield* ledger.register(NAME, "test");
					const a = yield* claimed("a", 400);
					const g = yield* gate({
						name: NAME,
						fence: a.fence,
						holder: "a",
						say,
						...(planted ? {planted: "no_lease_check" as const} : {}),
					});
					// The intent row lands; the lease runs out before the send, and then what comes next.
					const then = Effect.gen(function* () {
						yield* Effect.sleep(Duration.millis(800));
						if (next === "renew") yield* ledger.renew(NAME, a.fence, 30_000);
						if (next === "claim") yield* claimed("b", 30_000);
					});
					yield* Effect.forkScoped(then);
					yield* Effect.sleep(Duration.millis(150));
					yield* g.once(w.write()).pipe(Effect.timeoutOption(Duration.millis(2_500)));
				}),
			);
			return {sent: w.sent.length, steps: said.map((n) => n.step)};
		};
		expect(await send("nothing")).toEqual({sent: 0, steps: ["intent"]});
		expect(await send("renew")).toEqual({sent: 1, steps: ["intent", "send", "sent", "done"]});
		expect(await send("claim")).toEqual({sent: 0, steps: ["intent", "refused_lease"]});
		const planted = await send("nothing", true);
		expect(planted.sent).toBe(1);
	});

	it("an adapter refuses a key the gate did not hand out, and one whose send is over", async () => {
		const spent: Key[] = [];
		await run(
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				yield* ledger.register(NAME, "test");
				const c = yield* claimed("a", 30_000);
				const g = yield* gate({name: NAME, fence: c.fence, holder: "a"});
				yield* g.once({
					...world().write(),
					send: (key) => {
						spent.push(key);
						return useKey(key);
					},
				});
			}),
		);
		const [kept] = spent;
		if (kept === undefined) throw new Error("the send never ran");
		expect(kept.real).toBe(true);
		const late = await Effect.runPromise(Effect.flip(useKey(kept)));
		expect(late).toBeInstanceOf(KeyRefused);
		expect(late.why).toBe("its send is over");

		// A key forged at run time, past the type: an object on the class's prototype.
		const forged: Key = Object.create(Key.prototype);
		const refused = await Effect.runPromise(Effect.flip(useKey(forged)));
		expect(refused.why).toBe("not a key");
		expect(() => forged.real).toThrow(TypeError);
	});

	it("an unkeyed outside write does not type-check", () => {
		const push = (key: Key, branch: string) => useKey(key).pipe(Effect.as(branch));
		// @ts-expect-error a string is not a key
		const bare = () => push("ship:7#push:main", "main");
		// @ts-expect-error a look-alike object is not a key: the private field is missing
		const lookAlike = () => push({text: "k", name: NAME, fence: 1, real: true}, "main");
		expect([bare, lookAlike]).toHaveLength(2);
	});
});
