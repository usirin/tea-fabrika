import {Effect} from "effect";
import {describe, expect, it} from "vitest";
import {limitEnds} from "./dead-letters.ts";
import {Ledger} from "./ledger.ts";
import {layerMemory} from "./memory.ts";

// limitEnds reads the one record a limit end leaves in `<name>/dead`, in dollars, and nothing else.

describe("limitEnds", () => {
	it("lists the run a dollar limit ended, once, with what it used and its limit", async () => {
		const out = await Effect.runPromise(
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				yield* ledger.register("t:1", "test");
				yield* ledger.setLimits("t:1", {usd: 1}, "desk");
				const rev = (yield* ledger.readLast("t:1", 1))[0]?.rev ?? 1;
				const c = yield* ledger.claim("t:1", "h", rev, 30_000);
				if (c === null) return yield* Effect.die("no claim");
				const before = yield* limitEnds("t:1");
				yield* ledger.charge(c.fence, "a", {usd: 0.6});
				yield* ledger.charge(c.fence, "b", {usd: 0.6});
				yield* ledger.charge(c.fence, "b", {usd: 0.6});
				return {before, after: yield* limitEnds("t:1")};
			}).pipe(Effect.provide(layerMemory())),
		);
		expect(out.before).toEqual([]);
		expect(out.after.map(({limit, of, used, max}) => ({limit, of, used, max}))).toEqual([
			{limit: "usd", of: "t:1", used: 1.2, max: 1},
		]);
	});
});
