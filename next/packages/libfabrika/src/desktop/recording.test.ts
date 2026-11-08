// P19, next/. What the app records before the brain can (plan "What this row records"): a desktop
// observation round-trips and a reopened row decodes through the typed path, and rows wait in a
// durable pending file while the brain is away, leave it only after an acknowledgement, and are
// never sent again once acknowledged.
//
// Plan gap, for the lead: the plan names `DesktopRecording` but not the durable Layer that P12's
// journal pattern gives it. These laws call it `desktopJournal({home, forward})` from
// `desktop/recording.ts`; the name and the forward callback are this step's reading of "extend its
// typed local journal consumer", and stay red as a missing export until the lead names the real one.
import {NodeServices} from "@effect/platform-node";
import {describe, expect, it} from "@effect/vitest";
import {Arbitrary, Effect, Exit, Layer, Ref, Schema} from "effect";
import * as fc from "fast-check";
import {SEED, tempHome} from "./desktop.test-support.ts";
import type * as FoundingModule from "./founding.ts";
import type * as Recording from "./recording.ts";

const load = async <T>(spec: string, path: string, names: ReadonlyArray<keyof T>): Promise<T> => {
	const mod: Partial<T> = await import(/* @vite-ignore */ spec).catch((cause: unknown) => {
		throw new Error(`P19 missing module ${path} (${String(cause)})`);
	});
	for (const name of names)
		if (mod[name] === undefined) throw new Error(`P19 missing export ${String(name)} from ${path}`);
	return mod as T;
};
type Journal = (options: {
	readonly home: string;
	readonly forward: (
		rows: ReadonlyArray<typeof Recording.DesktopObservation.Type>,
	) => Effect.Effect<void, FoundingModule.DesktopDown>;
}) => Layer.Layer<Recording.DesktopRecording>;

describe("P19 recording: the observation", () => {
	it("plant, hand-write the tag or drop a field on save: every observation round-trips, and any reopened row decodes or fails typed", async () => {
		const r = await load<typeof Recording>("./recording.ts", "desktop/recording.ts", [
			"DesktopObservation",
			"DesktopRecording",
		]);
		const encode = Schema.encodeSync(r.DesktopObservation);
		const decode = Schema.decodeUnknownSync(r.DesktopObservation);
		const result = Effect.runSync(
			Arbitrary.checkEffect(
				Arbitrary.schema(r.DesktopObservation),
				(row) => {
					const back = decode(JSON.parse(JSON.stringify(encode(row))));
					return JSON.stringify(back) === JSON.stringify(row) && back._tag === "desktop";
				},
				{runs: 200, seed: SEED},
			),
		);
		expect(result._tag).toBe("Passed");
		fc.assert(
			fc.property(fc.jsonValue(), (json) => {
				expect(
					Exit.hasDies(Effect.runSyncExit(Schema.decodeUnknownEffect(r.DesktopObservation)(json))),
				).toBe(false);
			}),
			{seed: SEED, numRuns: 300},
		);
	});
});

describe("P19 recording: durable until acknowledged", () => {
	it("plant, keep a memory-only queue or delete before the acknowledgement: rows outlive a reopen and an absent brain, and leave only when acknowledged", async () => {
		const r = await load<typeof Recording & {readonly desktopJournal: Journal}>(
			"./recording.ts",
			"desktop/recording.ts (durable Layer, name pending the lead)",
			["DesktopObservation", "DesktopRecording", "desktopJournal"],
		);
		const f = await load<typeof FoundingModule>("./founding.ts", "desktop/founding.ts", [
			"DesktopDown",
		]);
		const rows = Effect.runSync(
			Arbitrary.sampleEffect(
				Arbitrary.array(Arbitrary.schema(r.DesktopObservation), {maxLength: 6}),
				{
					count: 40,
					seed: SEED,
				},
			),
		);
		// Per row: is the brain up for its put, does a reopen follow it, is the acknowledgement lost.
		const plan = fc.array(fc.record({up: fc.boolean(), reopen: fc.boolean(), lose: fc.boolean()}), {
			minLength: 6,
			maxLength: 6,
		});
		await fc.assert(
			fc.asyncProperty(fc.constantFrom(...rows), plan, async (batch, steps) => {
				await Effect.runPromise(
					Effect.scoped(
						Effect.gen(function* () {
							const home = yield* tempHome;
							const received = yield* Ref.make<ReadonlyArray<string>>([]);
							const acked = yield* Ref.make<ReadonlySet<string>>(new Set());
							const up = yield* Ref.make(false);
							const lose = yield* Ref.make(false);
							const forward = (sent: ReadonlyArray<typeof r.DesktopObservation.Type>) =>
								Effect.gen(function* () {
									if (!(yield* Ref.get(up))) return yield* new f.DesktopDown({why: "startup"});
									const ids = sent.map((row) => row.id);
									const before = yield* Ref.get(acked);
									for (const id of ids)
										expect(before.has(id), `row ${id} sent again after its acknowledgement`).toBe(
											false,
										);
									yield* Ref.update(received, (all) => [...all, ...ids]);
									if (yield* Ref.getAndSet(lose, false))
										return yield* new f.DesktopDown({why: "startup"});
									yield* Ref.update(acked, (all) => new Set([...all, ...ids]));
								});
							const open = () =>
								r.desktopJournal({home, forward}).pipe(Layer.provide(NodeServices.layer));
							let layer = open();
							for (const [i, row] of batch.entries()) {
								const s = steps[i]!;
								yield* Ref.set(up, s.up);
								yield* Ref.set(lose, s.lose);
								yield* Effect.gen(function* () {
									const rec = yield* r.DesktopRecording;
									yield* rec.put(row);
									yield* Effect.ignore(rec.flush);
								}).pipe(Effect.provide(layer));
								if (s.reopen) layer = open();
							}
							// The brain comes back for good: one flush, then one more that sends nothing.
							yield* Ref.set(up, true);
							yield* Ref.set(lose, false);
							yield* Effect.gen(function* () {
								const rec = yield* r.DesktopRecording;
								yield* rec.flush;
								const count = (yield* Ref.get(received)).length;
								yield* rec.flush;
								expect((yield* Ref.get(received)).length).toBe(count);
							}).pipe(Effect.provide(open()));
							const ids = new Set(batch.map((row) => row.id));
							expect(new Set(yield* Ref.get(acked))).toEqual(ids);
						}),
					),
				);
			}),
			{seed: SEED, numRuns: 40},
		);
	});
});
