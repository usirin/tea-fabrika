import {Effect, Result, Schema} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {ProcessManager} from "../coordination/process-manager.ts";
import {
	BRAIN,
	brain,
	first,
	from,
	ids,
	manager,
	storage,
} from "../coordination/process.test-support.ts";
import {p18Ids, p18Reason, p18Suffix} from "./tile.test-support.ts";

const options = {seed: 119120, numRuns: 30};

describe("P18 tile exit observations", () => {
	// Plants: omit ref or shown.ledger, or collapse the two displayed revisions into one.
	it("round trips exact decisions, recipient, ref and both displayed revisions", async () => {
		const {TileExitObservation, ClientObservation} = await import("./recording.ts");
		fc.assert(
			fc.property(
				p18Ids,
				p18Suffix,
				p18Reason,
				fc.constantFrom("never", "failed", "always"),
				fc.boolean(),
				fc.nat(),
				fc.nat(),
				(v, observation, why, keep, kept, rev, ledger) => {
					const raw = {
						_tag: "tile.exited",
						id: `observation_${observation}`,
						tab: v.tileA.replace("tile_", "tab_"),
						tile: v.tileA,
						process: v.processA,
						ref: v.refA,
						to: {client: v.client, session: v.sessionA},
						signal: "derived-signal",
						keep,
						kept,
						why,
						sentAt: "2026-11-08T00:00:00Z",
						shown: {hash: "build-a", rev, ledger},
					};
					const checked = Schema.decodeUnknownSync(TileExitObservation)(raw);
					expect(
						Schema.decodeUnknownSync(ClientObservation)(JSON.parse(JSON.stringify(checked))),
					).toEqual(raw);
					for (const field of ["ref", "to", "shown", "keep", "kept", "why"]) {
						const bad = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== field));
						expect(Result.isFailure(Schema.decodeUnknownResult(TileExitObservation)(bad))).toBe(
							true,
						);
					}
				},
			),
			options,
		);
	});

	// Plants: let a report exit a process, trust its by/arrivedAt, or append it twice on retry.
	it("client claims never change lifecycle facts or choose a writer, even on retry", async () => {
		const {routeClient} = await import("../server/client.ts");
		await fc.assert(
			fc.asyncProperty(p18Ids, p18Suffix, fc.nat({max: 3}), async (v, observation, retries) => {
				const store = storage();
				await Effect.runPromise(
					Effect.gen(function* () {
						const pm = yield* ProcessManager;
						yield* pm.start(first(), from());
						const life = store.rows().filter((e) => e.stream.startsWith("processes"));
						const report = {
							_tag: "tile.exited",
							id: `observation_${observation}`,
							tab: v.tileA.replace("tile_", "tab_"),
							tile: v.tileA,
							process: v.processA,
							ref: v.refA,
							to: {client: v.client, session: v.sessionA},
							signal: "forged",
							keep: "always",
							kept: true,
							why: "crashed",
							sentAt: "2026-11-08T00:00:00Z",
							shown: null,
						};
						for (let i = 0; i <= retries; i++)
							yield* routeClient(
								"client.observe",
								{observation: report},
								from({by: "SHA256:checked-client"}),
							);
						expect(yield* pm.isLive(v.processA)).toBe(true);
						expect(store.rows().filter((e) => e.stream.startsWith("processes"))).toEqual(life);
						const observations = store.rows().filter((e) => e._tag === "tile.exited");
						expect(observations).toHaveLength(1);
						expect(observations[0]?.by).toBe("SHA256:checked-client");
						expect(observations[0]?.arrivedAt).toEqual(expect.any(Number));
						const forged = yield* routeClient(
							"client.observe",
							{observation: {...report, by: BRAIN, arrivedAt: -1}},
							from(),
						);
						expect(forged._tag).toBe("refused");
					}).pipe(Effect.provide(manager(store, brain(), ids(v.processA).next))),
				);
			}),
			options,
		);
	});
});
