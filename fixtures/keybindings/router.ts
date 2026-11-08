import {applyCell, type Machine} from "@demlik/tea";
import {vi} from "vitest";
import type {Keys} from "../../apps/fabrika/src/desk/keymap.ts";
import type {Press} from "../../apps/fabrika/src/desk/keys.ts";

// The planned window router, shared by the migrated PR 1 checks. Loading it inside a test
// keeps a missing implementation from hiding the desk's independent checks.
export type Place = {readonly program: string; readonly tile: string};
export type KeyModel = {readonly prefix: {readonly armed: boolean; readonly until?: number | null}};
export type KeyMsg =
	| {readonly type: "press"; readonly press: Press; readonly at: number}
	| {readonly type: "keys"; readonly keys: Keys}
	| {readonly type: "mode"; readonly program: string; readonly mode: string | null}
	| {readonly type: "question"; readonly tile: string | null}
	| {readonly type: "applied"; readonly id: string; readonly target: Place};
export type KeyCommand = {
	readonly type: string;
	readonly id?: string;
	readonly target?: Place & {readonly word: string; readonly mode: string | null};
	readonly press?: Press;
};
type KeyContext = {
	readonly keys: Keys;
	readonly window: string;
	readonly target: Place;
	readonly mac: boolean;
};
export type KeyRouter = Machine<KeyModel, KeyMsg, KeyCommand, never, KeyContext>;
export const loadKeyRouter = async () =>
	(await vi.importActual<{keysMachine: KeyRouter}>("../../apps/fabrika/src/window/keys.ts")).keysMachine;

/** Test spellings only. The production matcher still resolves each real Press. */
export const keyPress = (name: string): Press => {
	const named: Readonly<Record<string, string>> = {
		arrowup: "ArrowUp",
		arrowdown: "ArrowDown",
		arrowleft: "ArrowLeft",
		arrowright: "ArrowRight",
		enter: "Enter",
		escape: "Escape",
		f6: "F6",
		f12: "F12",
	};
	const parts = name.startsWith("<") ? name.slice(1, -1).split("-") : [name];
	const word = parts.at(-1) ?? name;
	const mods = parts.slice(0, -1);
	return {
		key: named[word] ?? word,
		code: "",
		ctrl: mods.includes("c"),
		alt: mods.includes("a"),
		meta: mods.includes("m"),
		shift: mods.includes("s") || (word.length === 1 && /[A-Z|?]/.test(word)),
		composing: false,
		altGraph: false,
	};
};

export const windowKeys = async (keys: Keys, target: Place = {program: "tsh", tile: "t1"}) => {
	const machine = await loadKeyRouter();
	let state = machine.init(null, {keys, target, window: "w1", mac: true})[0];
	const send = (msg: KeyMsg) => {
		const [next, cmds] = applyCell<KeyModel, KeyMsg, KeyCommand>(machine, state, msg);
		state = next;
		return cmds;
	};
	const key = (name: string, at = 0) => send({type: "press", press: keyPress(name), at});
	const prefixed = (name: string, at = 0, prefix = "<c-b>") => [
		...key(prefix, at),
		...key(name, at + 1),
	];
	return {send, key, prefixed, state: () => state};
};
