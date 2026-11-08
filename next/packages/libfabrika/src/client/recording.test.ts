// T293, next/. Observe real parent decisions; arbitrary draft strings never enter diagnostics.
import {Effect, Schema} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";

describe("P20 body-free observations", () => {
	it("L27 actions and delivery outcomes retain correlation and configured pause without text", async () => {
		const {ClientObservation, ClientRecording} = await import("./recording.ts");
		const Observation: Schema.Codec<typeof ClientObservation.Type, Schema.Json> = ClientObservation;
		const {sample, options, frozen, first} = await import("./editor.test-support.ts");
		fc.assert(
			fc.property(
				sample,
				fc.integer({min: 1, max: 10000}),
				fc.constantFrom("edit", "done", "escape", "keep", "drop", "history"),
				fc.constantFrom("changed_elsewhere", "too_long"),
				(s, pauseMs, command, why) => {
					const letter = frozen(s),
						note = first(s.ids),
						records: Array<typeof ClientObservation.Type> = [];
					const values = [
						{
							_tag: "note.action",
							id: `observation_${note.slice(5)}`,
							tab: `tab_${note.slice(5)}`,
							tile: `tile_${note.slice(5)}`,
							note,
							base: s.base,
							command,
							via: {_tag: "key", keys: command === "escape" ? "escape" : "mod+enter"},
							before: null,
							after: "editing",
							letter: letter.id,
							sentAt: letter.sentAt,
							pauseMs,
						},
						{
							_tag: "sent",
							id: `observation_${note.slice(5)}`,
							tab: `tab_${note.slice(5)}`,
							letter: letter.id,
							tries: 1,
							sentAt: letter.sentAt,
							pauseMs,
						},
						{
							_tag: "sent",
							id: `observation_${note.slice(5)}`,
							tab: `tab_${note.slice(5)}`,
							letter: letter.id,
							tries: 2,
							sentAt: letter.sentAt,
							pauseMs,
						},
						{
							_tag: "settled",
							id: `observation_${note.slice(5)}`,
							tab: `tab_${note.slice(5)}`,
							letter: letter.id,
							answer: "refused",
							why,
							sentAt: letter.sentAt,
						},
						{
							_tag: "settled",
							id: `observation_${note.slice(5)}`,
							tab: `tab_${note.slice(5)}`,
							letter: letter.id,
							answer: "accepted",
							why: null,
							sentAt: letter.sentAt,
						},
					];
					for (const value of values) {
						const decoded = Effect.runSync(
							Schema.decodeUnknownEffect(Observation)({
								...value,
								body: s.draft,
								title: s.later,
								frame: {m: letter.m},
							}),
						);
						expect(decoded).toMatchObject(value);
						const program = Effect.gen(function* () {
							yield* (yield* ClientRecording).put(decoded);
							yield* (yield* ClientRecording).flush;
						});
						Effect.runSync(
							program.pipe(
								Effect.provideService(ClientRecording, {
									put: (o: typeof ClientObservation.Type) =>
										Effect.sync(() => {
											records.push(o);
										}),
									flush: Effect.void,
								}),
							),
						);
					}
					const json = Schema.encodeSync(Schema.Array(Observation))(records);
					expect(json).toHaveLength(values.length);
					for (const row of json) {
						expect(Object.keys(row)).not.toEqual(expect.arrayContaining(["body"]));
						expect(Object.keys(row)).not.toEqual(expect.arrayContaining(["title"]));
						expect(Object.keys(row)).not.toEqual(expect.arrayContaining(["frame"]));
					}
					// The encoder must also catch a body planted inside an otherwise valid action.
					const leaked = {...values[0], body: s.draft};
					expect(Object.keys(leaked)).toContain("body");
				},
			),
			options,
		);
	});
});
