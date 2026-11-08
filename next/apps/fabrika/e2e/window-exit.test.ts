import {Effect, Schema} from "effect";
import * as fc from "fast-check";
import {expect, it} from "vitest";
import {browserStep, openP18Browser, withP18Stage} from "./p18.test-support.ts";

const State = Schema.Struct({
	focus: Schema.NullOr(Schema.String),
	tiles: Schema.Record(
		Schema.String,
		Schema.Struct({
			_tag: Schema.String,
			watch: Schema.optional(Schema.Struct({pid: Schema.String, ref: Schema.String})),
			why: Schema.optional(Schema.String),
		}),
	),
	views: Schema.Record(Schema.String, Schema.Unknown),
});

// Plants: keep every exit, re-enable a stopped input, or rerun a keep decision after reconnect.
it("W3: real exits keep or close tiles, retain checked views, stop inputs and survive reconnect", async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.constantFrom("never", "failed", "always"),
			fc.constantFrom("normal", "shutdown", "p18-crash"),
			async (keep, why) => {
				await Effect.runPromise(
					Effect.scoped(
						withP18Stage((stage) =>
							Effect.gen(function* () {
								const {page, errors} = yield* openP18Browser(stage, {keep});
								const before = yield* Schema.decodeUnknownEffect(State)(
									yield* browserStep(() => page.evaluate(() => window.p18.state())),
								);
								const [tile, state] = Object.entries(before.tiles)[0]!;
								expect(state.watch).toBeDefined();
								yield* browserStep(() =>
									page.evaluate((tile) => window.p18.send({type: "focus", tile}), tile),
								);
								yield* stage.exit(state.watch!.pid, why);
								const kept =
									keep === "always" || (keep === "failed" && !["normal", "shutdown"].includes(why));
								yield* browserStep(() =>
									page.waitForFunction(
										({tile, tag}) => {
											const s = window.p18.state();
											if (
												typeof s !== "object" ||
												s === null ||
												!("tiles" in s) ||
												typeof s.tiles !== "object" ||
												s.tiles === null
											)
												return false;
											const value = Reflect.get(s.tiles, tile);
											return (
												typeof value === "object" &&
												value !== null &&
												Reflect.get(value, "_tag") === tag
											);
										},
										{tile, tag: kept ? "kept" : "closed"},
									),
								);
								const after = yield* Schema.decodeUnknownEffect(State)(
									yield* browserStep(() => page.evaluate(() => window.p18.state())),
								);
								expect(after.tiles[tile]?.why).toBe(why);
								if (kept) {
									expect(after.views[tile]).toEqual(before.views[tile]);
									expect(
										yield* browserStep(() =>
											page.getByText(`Process stopped: ${why}`, {exact: true}).count(),
										),
									).toBeGreaterThan(0);
									yield* browserStep(() =>
										page.evaluate(
											(tile) =>
												window.p18.send({
													type: "press",
													tile,
													m: {type: "inc"},
													via: {_tag: "click"},
												}),
											tile,
										),
									);
									expect(yield* browserStep(() => page.evaluate(() => window.p18.state()))).toEqual(
										after,
									);
								} else expect(after.focus).not.toBe(tile);
								yield* browserStep(async () => {
									await page.context().setOffline(true);
									await page.context().setOffline(false);
									await windowReady(page);
								});
								const later = yield* Schema.decodeUnknownEffect(State)(
									yield* browserStep(() => page.evaluate(() => window.p18.state())),
								);
								expect(later.tiles[tile]).toEqual(after.tiles[tile]);
								expect(errors).toEqual([]);
							}),
						),
					),
				);
			},
		),
		{seed: 119120, numRuns: 9},
	);
});

// Plants: retain the last frame/focus, or start a shell when every presentation closes.
it("closing the last displayed tile shows the empty state and starts no replacement process", async () => {
	await Effect.runPromise(
		Effect.scoped(
			withP18Stage((stage) =>
				Effect.gen(function* () {
					const {page} = yield* openP18Browser(stage, {keep: "never"});
					const before = yield* Schema.decodeUnknownEffect(State)(
						yield* browserStep(() => page.evaluate(() => window.p18.state())),
					);
					for (const process of new Set(Object.values(before.tiles).map((s) => s.watch!.pid)))
						yield* stage.exit(process, "normal");
					yield* browserStep(() => page.getByText("No open tiles.", {exact: true}).waitFor());
					const after = yield* Schema.decodeUnknownEffect(State)(
						yield* browserStep(() => page.evaluate(() => window.p18.state())),
					);
					expect(after.focus).toBeNull();
					expect(Object.values(after.tiles).every((tile) => tile._tag === "closed")).toBe(true);
					expect(yield* browserStep(() => page.locator("[data-p18-body]").count())).toBe(0);
				}),
			),
		),
	);
});

const windowReady = (page: import("playwright").Page) => page.evaluate(() => window.p18.ready());
