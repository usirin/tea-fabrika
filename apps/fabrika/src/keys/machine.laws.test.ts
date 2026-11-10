import {applyCell} from "@demlik/tea";
import {propertyInvariant} from "@demlik/tea/pbt";
import * as fc from "fast-check";
import {describe, expect, it, vi} from "vitest";
import {defaults} from "../desk/keymap.ts";
import {type Editor, type EditorCmd, type EditorMsg, editorMachine} from "./machine.ts";

const step = (model: Editor, msg: EditorMsg) =>
	applyCell<Editor, EditorMsg, EditorCmd>(editorMachine, model, msg);

const event = (key: string, mods = {}) => ({
	key,
	code: "",
	ctrl: false,
	alt: false,
	meta: false,
	shift: false,
	composing: false,
	altGraph: false,
	...mods,
});

describe("today's recording laws", () => {
	it("K4: a prefix waits indefinitely; modifiers, dead keys and composition cannot finish it", () => {
		vi.useFakeTimers();

		try {
			fc.assert(
				fc.property(
					fc.array(
						fc.constantFrom("Shift", "Control", "Alt", "Meta", "Dead", "Unidentified", "Process"),
						{maxLength: 30},
					),
					fc.integer({min: 1, max: 2_000_000_000}),
					(noise, delay) => {
						let model = editorMachine.init(defaults, undefined)[0];
						model = step(model, {type: "select", does: "tezgah.zoom"})[0];
						model = step(model, {type: "change"})[0];
						const [armed, cmds] = step(model, {type: "press", press: event("b", {ctrl: true})});
						expect(cmds).toEqual([]);
						expect(armed.recording).toMatchObject({_tag: "waiting", prefix: true});
						model = armed;

						for (const key of noise) {
							const [next, out] = step(model, {
								type: "press",
								press: event(key, {composing: key === "Process"}),
							});
							expect(next.recording).toEqual(armed.recording);
							expect(out).toEqual([]);
							model = next;
						}

						const [composed, out] = step(model, {
							type: "press",
							press: event("m", {composing: true}),
						});
						expect(composed.recording).toEqual(armed.recording);
						expect(out).toEqual([]);
						vi.advanceTimersByTime(delay);
						expect(vi.getTimerCount()).toBe(0);
						expect(step(composed, {type: "press", press: event("m")})[0].recording).toMatchObject({
							_tag: "candidate",
							keys: [{_tag: "after_prefix", key: "m"}],
						});
					},
				),
				{seed: 119120, numRuns: 100},
			);
		} finally {
			vi.useRealTimers();
		}
	});
});

// The editor `machine` (machine.ts), on tea's pbt: any messages in any order, as a broken world
// might send them, answers nobody asked for included.
const press = fc
	.tuple(fc.constantFrom("b", "m", "z", "Escape", "F6", "q", "Shift"), fc.boolean(), fc.boolean())
	.map(([key, ctrl, meta]) => ({type: "press", press: event(key, {ctrl, meta})}) as const);

const request = fc.constantFrom("keys-0", "keys-1", "keys-2", "open");
const version = fc.constantFrom("v1", "v2");

const msg: fc.Arbitrary<EditorMsg> = fc.oneof(
	fc.constantFrom<EditorMsg>(
		{type: "change"},
		{type: "add"},
		{type: "cancel"},
		{type: "save"},
		{type: "unbind"},
		{type: "reset"},
		{type: "escape-key"},
		{type: "undo"},
		{type: "select", does: "tezgah.zoom"},
		{type: "select", does: "prefix"},
		{type: "select", does: null},
		{type: "query", query: "zoom"},
	),
	press,
	fc.record({type: fc.constant("saved" as const), request, version}),
	fc.record({type: fc.constant("failed" as const), request, why: fc.constant("denied")}),
	version.map((v) => ({type: "keys", keys: defaults, version: v}) as const),
);

describe("today's editor laws on tea's pbt", () => {
	it("a save goes out only as the editor starts saving, with the request it waits on", () => {
		propertyInvariant(
			editorMachine,
			undefined,
			fc.array(msg, {maxLength: 30}),
			({next, cmds}) =>
				cmds.length === 0 ||
				(cmds.length === 1 &&
					next.recording._tag === "saving" &&
					next.recording.request === cmds[0]?.request),
			{numRuns: 300, seed: 1},
		);
	});
});
