import {Effect, Schema} from "effect";
import * as fc from "fast-check";
import {expect, it} from "vitest";
import {browserStep, openP18Browser, readBrowser, withP18Stage} from "./p18.test-support.ts";

const State = Schema.Struct({
	focus: Schema.NullOr(Schema.String),
	tiles: Schema.Record(Schema.String, Schema.Unknown),
	views: Schema.Record(Schema.String, Schema.Unknown),
});

// Plants: subscribe each body to the whole model, or replace every selected view reference.
it("p50: one changed process commits only its own tile among 16 distinct real processes", async () => {
	await fc.assert(
		fc.asyncProperty(fc.integer({min: 0, max: 15}), async (selected) => {
			await Effect.runPromise(
				Effect.scoped(
					withP18Stage((stage) =>
						Effect.gen(function* () {
							const {page, errors} = yield* openP18Browser(stage);
							const before = yield* readBrowser(page);
							expect(before).toHaveLength(16);
							const state = yield* Schema.decodeUnknownEffect(State)(
								yield* browserStep(() => page.evaluate(() => window.p18.state())),
							);
							const tiles = Object.keys(state.tiles);
							// Reset only after Strict Mode's initial setup and both animation frames have completed.
							yield* browserStep(() => page.evaluate(() => window.p18.reset()));
							yield* browserStep(() =>
								page.evaluate(
									(tile) =>
										window.p18.send({type: "press", tile, m: {type: "inc"}, via: {_tag: "click"}}),
									tiles[selected]!,
								),
							);
							yield* browserStep(() =>
								page.waitForFunction(() => window.p18.readings().some((r) => r.commits > 0)),
							);
							yield* browserStep(() => page.evaluate(() => window.p18.ready()));
							const after = yield* readBrowser(page);
							expect(after.filter((r) => r.commits > 0).map((r) => r.id)).toEqual([
								before[selected]!.id,
							]);
							expect(after.filter((r) => r.effects > 0).map((r) => r.id)).toEqual([
								before[selected]!.id,
							]);
							expect(errors).toEqual([]);
						}),
					),
				),
			);
		}),
		{seed: 119120, numRuns: 2},
	);
});

// Plants: unmount a folded body, pass changed props into hidden Activity, focus the first control.
it("p50: fold retains DOM and local state, pauses hidden commits and effects, then reveals fresh data with model focus", async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.integer({min: 1, max: 4}),
			fc.integer({min: 1, max: 15}),
			async (updates, hiddenIndex) => {
				await Effect.runPromise(
					Effect.scoped(
						withP18Stage((stage) =>
							Effect.gen(function* () {
								const {page, errors} = yield* openP18Browser(stage);
								const before = yield* readBrowser(page);
								expect(before).toHaveLength(16);
								const first = before[hiddenIndex]!.id;
								const note = page
									.locator(`[data-p18-body="${first}"]`)
									.getByRole("textbox", {name: "Local note"});
								yield* browserStep(() => note.fill("keep this local text"));
								const node = yield* browserStep(() => note.elementHandle());
								const state = yield* Schema.decodeUnknownEffect(State)(
									yield* browserStep(() => page.evaluate(() => window.p18.state())),
								);
								const tile = Object.keys(state.tiles)[hiddenIndex];
								const next = Object.keys(state.tiles)[0];
								yield* browserStep(() =>
									page.evaluate((tile) => window.p18.send({type: "focus", tile}), next!),
								);
								yield* browserStep(() => page.setViewportSize({width: 440, height: 240}));
								yield* browserStep(() =>
									page.waitForFunction((id) => {
										const el = [...document.querySelectorAll<HTMLElement>("[data-p18-body]")].find(
											(el) => el.dataset.p18Body === id,
										);
										return el !== undefined && getComputedStyle(el).display === "none";
									}, first),
								);
								yield* browserStep(() => page.evaluate(() => window.p18.reset()));
								for (let i = 0; i < updates; i++)
									yield* browserStep(() =>
										page.evaluate(
											(tile) =>
												window.p18.send({
													type: "press",
													tile,
													m: {type: "inc"},
													via: {_tag: "click"},
												}),
											tile!,
										),
									);
								yield* browserStep(() => page.evaluate(() => window.p18.ready()));
								const hidden = yield* readBrowser(page);
								expect(hidden.find((r) => r.id === first)).toMatchObject({commits: 0, effects: 0});
								yield* browserStep(() =>
									page.evaluate((tile) => window.p18.send({type: "focus", tile}), tile!),
								);
								yield* browserStep(() => page.setViewportSize({width: 4096, height: 900}));
								yield* browserStep(() => page.evaluate(() => window.p18.ready()));
								expect(yield* browserStep(() => note.inputValue())).toBe("keep this local text");
								expect(
									yield* browserStep(() => note.evaluate((current, old) => current === old, node)),
								).toBe(true);
								const revealed = yield* readBrowser(page);
								expect(revealed.find((r) => r.id === first)?.text).not.toBe(
									before[hiddenIndex]!.text,
								);
								expect(
									yield* browserStep(() =>
										page.evaluate(
											(id) =>
												document.activeElement
													?.closest("[data-p18-body]")
													?.getAttribute("data-p18-body") === id,
											first,
										),
									),
								).toBe(true);
								expect(errors).toEqual([]);
							}),
						),
					),
				);
			},
		),
		{seed: 119120, numRuns: 2},
	);
});
