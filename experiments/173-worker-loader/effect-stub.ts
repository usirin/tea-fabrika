// Part 2's measuring tool for the pure-step sandbox: what stands in for `effect` when the hands
// build a program with no Effect in it. Every name `effect` exports becomes an inert value. While
// the program's modules load (`init`), touching one is noted and answers another inert value, so
// `Schema.Struct({...})` at the top of a module still loads. Once the entry calls `seal()` (`run`),
// touching one throws `EffectAtRunTime`: the program's update needed Effect after all.
//
//   const Shown = Schema.Struct({n: Schema.Int})   init: notes "Schema.Struct", "Schema.Int"
//   seal()
//   update.plus({n: 1})                            run: no Effect touched, {n: 2}
//   Schema.decodeUnknownSync(Shown)(x)             run: throws EffectAtRunTime
//
// In a build with the real `effect`, nothing here is ever reached but `seal` and `usedOf`.

type Phase = "init" | "run";
let phase: Phase = "init";
const used: Record<Phase, Map<string, number>> = {init: new Map(), run: new Map()};

export class EffectAtRunTime extends Error {
	constructor(readonly what: string) {
		super(`the program touched Effect at run time: ${what}`);
	}
}

/** The program's modules have loaded: from now on, touching Effect is a finding. */
export const seal = () => {
	phase = "run";
};

/** What the program touched while it loaded, and after. Names only, most used first. */
export const usedOf = () => {
	const names = (m: Map<string, number>) =>
		[...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => `${name} x${n}`);
	return {init: names(used.init), run: names(used.run)};
};

const note = (what: string) => {
	const m = used[phase];
	m.set(what, (m.get(what) ?? 0) + 1);
	if (phase === "run") throw new EffectAtRunTime(what);
};

/** `Schema.Struct().check` reads as `Schema.Struct.check`: a call is not a new name. */
const named = (path: string) => path.replaceAll("()", "");

const empty = function* () {};

/** One inert value: callable, constructible, and every property another inert value. */
export const inert = (path: string): any =>
	// oxlint-disable-next-line eslint/prefer-arrow-callback -- a Proxy can only be constructed if its target can, and an arrow function cannot.
	new Proxy(function inert() {}, {
		get(_target, key) {
			if (key === "prototype") return {};
			if (key === Symbol.iterator) return empty;
			if (key === Symbol.toPrimitive) return () => `[effect ${path}]`;
			// Not a thenable: an awaited inert value stays itself.
			if (key === "then" || typeof key === "symbol") return undefined;
			if (phase === "run") note(named(`${path}.${key}`));
			return inert(`${path}.${key}`);
		},
		apply() {
			note(named(path));
			return inert(`${path}()`);
		},
		construct() {
			note(`new ${named(path)}`);
			return inert(`new ${path}`);
		},
	});
