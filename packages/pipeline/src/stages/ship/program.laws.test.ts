import {foldEvents, stubCtxThrowingProxy} from "@demlik/tea/pbt";
import {memoryStorage} from "@kampus/fabrika-old";
import {Effect} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {type AnyShipMsg, msgs, PR} from "../../laws/ship-pbt.ts";
import {type Ship, ship} from "./machine.ts";
import {shipKind} from "./program.ts";

// The ship machine as its kind keeps it, on tea's pbt: every state it reaches from its init,
// driven by any list of its Msgs (ship's own pbt lists, ../../laws/ship-pbt.ts), saves through the
// schema the kind declares and loads back equal. A start after a kill reads it back through that
// schema, so a state the machine can reach and the schema cannot read is a run that cannot go on.
//
// Beside the kind, not the machine: the ship machine is made in a factory, under no name.

const ctx = stubCtxThrowingProxy<undefined>();
const State = shipKind().state;

/**
 * Every state `machine` reaches from its init, saved through the kind's schema and loaded back.
 * `saved`: the phase of each state saved, so a test can say the law held on every shape of state.
 */
const keepsEvery = (machine: typeof ship, runs = 150, saved = new Set<string>()) =>
	fc.assert(
		fc.asyncProperty(msgs, async (list: readonly AnyShipMsg[]) => {
			const handle = await Effect.runPromise(memoryStorage().open("ship:r1", null));
			const store = handle.store("ship", PR, State);
			for (const s of foldEvents(machine, ctx, null, list).states) {
				await store.save(s);
				expect(store.migrate(await store.load())).toEqual(s);
				saved.add(s.phase);
			}
		}),
		{numRuns: runs, seed: 1},
	);

/** Every phase the schema has. */
const PHASES = [
	"idle",
	"reading",
	"rerunning",
	"waiting",
	"enqueueing",
	"merging",
	"queued",
	"finishing",
	"over",
];

describe("the ship machine is kept", () => {
	it("every state it reaches from its init saves and loads back equal, in every phase", async () => {
		const saved = new Set<string>();
		await keepsEvery(ship, 150, saved);
		expect([...saved].sort()).toEqual([...PHASES].sort());
	});

	it("the law is seen to fail on a planted mistake: a ship run that keeps the whole read it was answered dies at its first save", async () => {
		const keepsTheRead: typeof ship = {
			...ship,
			update: {
				...ship.update,
				ship_facts_ok: (s, m) => {
					const [next, cmds] = ship.update.ship_facts_ok(s, m);
					return [{...next, ...m} as Ship, cmds];
				},
			},
		};
		await expect(keepsEvery(keepsTheRead, 20)).rejects.toThrow(/Counterexample/);
	});
});
