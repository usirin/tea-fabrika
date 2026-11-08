import {applyCell} from "@demlik/tea";
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
