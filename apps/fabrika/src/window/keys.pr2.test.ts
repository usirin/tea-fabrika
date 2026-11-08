import {applyCell, type Machine} from "@demlik/tea";
import {Result} from "effect";
import * as fc from "fast-check";
import {describe, expect, it, vi} from "vitest";
import {packs, installed} from "../../../../fixtures/keybindings/programs.ts";
import {decodeKeys, type Keys} from "../desk/keymap.ts";
import type {Press} from "../desk/keys.ts";

// The planned window/keys.ts owns this machine. Import it at each test, so the absent
// implementation reports each law, rather than preventing the whole file from collecting.
type Target = {readonly program: string; readonly word: string; readonly mode: string | null};
type Place = {readonly program: string; readonly tile: string};
type Model = {
	readonly prefix: {readonly armed: boolean};
	readonly modes: Readonly<Record<string, string | null>>;
	readonly mapping: boolean;
};
type Msg =
	| {readonly type: "press"; readonly press: Press; readonly at: number; readonly editing?: boolean}
	| {readonly type: "mode"; readonly program: string; readonly mode: string | null}
	| {readonly type: "target"; readonly target: Place}
	| {readonly type: "recording"; readonly active: boolean}
	| {readonly type: "mapping"; readonly active: boolean}
	| {readonly type: "over"; readonly program: string | null}
	| {readonly type: "palette"}
	| {
			readonly type: "command";
			readonly target: Target;
			readonly via: "palette" | "tsh";
			readonly window?: string;
	  }
	| {readonly type: "applied"; readonly id: string; readonly target: Place}
	| {readonly type: "down" | "up"};
type Command = {
	readonly type: string;
	readonly id?: string;
	readonly target?: Target & {readonly tile: string};
	readonly via?: unknown;
	readonly press?: Press;
	readonly why?: string;
};
type Context = {
	readonly keys: Keys;
	readonly window: string;
	readonly target: Place;
	readonly mac: boolean;
};
type Router = Machine<Model, Msg, Command, never, Context>;
const load = async () => (await vi.importActual<{keysMachine: Router}>("./keys.ts")).keysMachine;
const press = (key: string, overrides: Partial<Press> = {}): Press => ({
	key,
	code: "",
	ctrl: false,
	alt: false,
	meta: false,
	shift: false,
	composing: false,
	altGraph: false,
	...overrides,
});
const open = async (window = "w1", program = "alpha") => {
	const machine = await load();
	const result = decodeKeys("", false, {programs: packs, client: installed});
	expect(Result.isSuccess(result)).toBe(true);
	if (Result.isFailure(result)) throw new Error(result.failure.why);
	let state = machine.init(null, {
		keys: result.success,
		window,
		target: {program, tile: "t1"},
		mac: true,
	})[0];
	const send = (msg: Msg) => {
		const [next, cmds] = applyCell<Model, Msg, Command>(machine, state, msg);
		state = next;
		return cmds;
	};
	const key = (key: string, at = 0, overrides: Partial<Press> = {}, editing = false) =>
		send({type: "press", press: press(key, overrides), at, editing});
	return {send, key, state: () => state};
};

describe("today's window key router", () => {
	it("P5: focused base keys stop in another mode; each global uses its own mode", async () => {
		const h = await open();
		expect(h.key("j")).toContainEqual(
			expect.objectContaining({
				type: "run",
				target: expect.objectContaining({program: "alpha", word: "next", mode: null}),
			}),
		);
		h.send({type: "mode", program: "alpha", mode: "search"});
		expect(h.key("j").some((c) => c.type === "run")).toBe(false);
		expect(h.key("n")).toContainEqual(
			expect.objectContaining({
				type: "run",
				target: expect.objectContaining({word: "find", mode: "search"}),
			}),
		);
		h.send({type: "mode", program: "tezgah", mode: "info"});
		expect(h.key("Escape")).toContainEqual(
			expect.objectContaining({
				type: "run",
				target: expect.objectContaining({program: "tezgah", word: "exit", mode: "info"}),
			}),
		);
	});
	it("P14: two windows own prefix, info and mapping independently, including across focus moves", async () => {
		const a = await open("w1");
		const b = await open("w2");
		a.key("b", 0, {ctrl: true});
		expect(a.state().prefix.armed).toBe(true);
		expect(b.state().prefix.armed).toBe(false);
		a.send({type: "mode", program: "tezgah", mode: "info"});
		a.send({type: "mapping", active: true});
		a.send({type: "target", target: {program: "beta", tile: "t2"}});
		expect(a.state().modes.tezgah).toBe("info");
		expect(a.state().mapping).toBe(true);
		expect(b.state().modes.tezgah ?? null).toBeNull();
		expect(b.state().mapping).toBe(false);
	});
	it("P15: an ordinary prefix survives arbitrary elapsed time, composition and AltGraph", async () => {
		const machine = await load();
		fc.assert(
			fc.property(fc.integer({min: 501, max: 2_000_000_000}), (at) => {
				const keys = decodeKeys("", false);
				if (Result.isFailure(keys)) throw new Error(keys.failure.why);
				let state = machine.init(null, {
					keys: keys.success,
					window: "w1",
					target: {program: "tsh", tile: "t1"},
					mac: true,
				})[0];
				const step = (p: Press, now = at) => {
					const [next, cmds] = applyCell<Model, Msg, Command>(machine, state, {
						type: "press",
						press: p,
						at: now,
					});
					state = next;
					return cmds;
				};
				expect(step(press("b", {ctrl: true}), 0)).toEqual([]);
				expect(step(press("Process", {composing: true}))).toEqual([]);
				expect(step(press("j", {ctrl: true, alt: true, altGraph: true}))).toEqual([]);
				expect(state.prefix.armed).toBe(true);
				expect(step(press("|"))).toContainEqual(
					expect.objectContaining({
						type: "run",
						target: expect.objectContaining({program: "tezgah", word: "split"}),
					}),
				);
			}),
			{seed: 119120, numRuns: 50},
		);
	});
	it("P16: following input waits for its completed layout action and uses the returned target", async () => {
		const h = await open("w1", "tsh");
		h.key("b", 0, {ctrl: true});
		const split = h.key("|").find((c) => c.type === "run");
		expect(split?.id).toBeTypeOf("string");
		expect(h.key("x")).toEqual([]);
		expect(
			h.send({type: "applied", id: "wrong-action", target: {program: "tsh", tile: "t3"}}),
		).toEqual([]);
		const after = h.send({type: "applied", id: split!.id!, target: {program: "tsh", tile: "t2"}});
		expect(after).toContainEqual(
			expect.objectContaining({
				type: "pass",
				target: expect.objectContaining({tile: "t2"}),
				press: expect.objectContaining({key: "x"}),
			}),
		);
		expect(after.some((c) => c.target?.tile === "t1")).toBe(false);
	});
	it("P17: link loss discards pending typing and commands, including late acknowledgements", async () => {
		const h = await open("w1", "tsh");
		h.key("b", 0, {ctrl: true});
		const split = h.key("|").find((c) => c.type === "run");
		expect(split).toBeDefined();
		h.key("x");
		expect(h.send({type: "down"}).some((c) => c.type === "pass" || c.type === "run")).toBe(false);
		expect(h.send({type: "up"})).toEqual([]);
		expect(h.send({type: "applied", id: split!.id!, target: {program: "tsh", tile: "t2"}})).toEqual(
			[],
		);
		expect(h.state().prefix.armed).toBe(false);
	});
	it("P19: native typing and text-editing controls keep their ordinary keys", async () => {
		const h = await open();
		for (const key of ["j", "k", "c", " ", "Tab", "ArrowLeft"]) {
			const cmds = h.key(key, 0, {}, true);
			expect(cmds.some((c) => c.type === "run")).toBe(false);
			expect(cmds).toContainEqual(
				expect.objectContaining({type: "pass", press: expect.objectContaining({key})}),
			);
		}
	});
	it("P21: system quit and Ctrl-C beat modes, popovers, mapping and the recorder", async () => {
		const h = await open();
		h.send({type: "mode", program: "tezgah", mode: "info"});
		h.send({type: "mapping", active: true});
		h.send({type: "recording", active: true});
		h.send({type: "over", program: "palette"});
		expect(h.key("q", 0, {meta: true})).toEqual([expect.objectContaining({type: "system"})]);
		expect(h.key("c", 0, {ctrl: true})).toContainEqual(
			expect.objectContaining({type: "pass", target: expect.objectContaining({tile: "t1"})}),
		);
		expect(h.key("F6").some((c) => c.type === "record")).toBe(true);
	});
	it("P23: the palette saves its target and tsh refuses inactive or absent commands", async () => {
		const h = await open();
		h.send({type: "palette"});
		h.send({type: "target", target: {program: "palette", tile: "t1"}});
		expect(
			h.send({
				type: "command",
				target: {program: "alpha", word: "next", mode: null},
				via: "palette",
			}),
		).toContainEqual(
			expect.objectContaining({
				type: "run",
				target: expect.objectContaining({program: "alpha", tile: "t1"}),
				via: "palette",
			}),
		);
		for (const target of [
			{program: "alpha", word: "find", mode: "search"},
			{program: "missing", word: "next", mode: null},
		])
			expect(h.send({type: "command", target, via: "tsh"})).toContainEqual(
				expect.objectContaining({
					type: "refuse",
					why: expect.stringMatching(/mode|search|missing|unavailable/i),
				}),
			);
	});
});
