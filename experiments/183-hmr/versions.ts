// Experiment 183: five versions of one counter program, as an agent might save them in a row.
// The driver bundles each one on its own (VERSION picks it at build time), so each is its own
// hash and its own isolate. Only `v1` to `v5` are real code; `top-throw` is a module that fails
// as it loads, the kind of bad save esbuild does not catch.
import {Schema} from "effect";
import {define} from "./define.ts";

declare const VERSION: string;

const N = Schema.Struct({n: Schema.Number});
const Count = Schema.Struct({count: Schema.Number});
const Total = Schema.Struct({total: Schema.Number, since: Schema.String});

const versions = {
	// v1: the first save.
	v1: define({
		state: N,
		init: () => ({n: 0}),
		step: (m, msg) => (msg.type === "plus" ? {n: m.n + 1} : m),
		view: (m) => `${m.n} so far`,
	}),
	// v2: only the view changed. The state fits as it is.
	v2: define({
		state: N,
		init: () => ({n: 0}),
		step: (m, msg) => (msg.type === "plus" ? {n: m.n + 1} : m),
		view: (m) => `count: ${m.n}`,
	}),
	// v3: a new shape, {count}, with an upcast from the old {n}. Erlang's code_change.
	v3: define({
		state: Count,
		upcast: (raw) =>
			typeof raw === "object" && raw !== null && "n" in raw
				? {count: (raw as {n: unknown}).n}
				: raw,
		init: () => ({count: 0}),
		step: (m, msg) => (msg.type === "plus" ? {count: m.count + 1} : m),
		view: (m) => `count: ${m.count}`,
	}),
	// v4: a new shape with no upcast. The old model cannot be read, so the swap is refused.
	v4: define({
		state: Total,
		init: () => ({total: 0, since: "now"}),
		step: (m, msg) => (msg.type === "plus" ? {...m, total: m.total + 1} : m),
		view: (m) => `${m.total} since ${m.since}`,
	}),
	// v5: reads the state, then throws on every step: a bad edit that only shows when it runs.
	v5: define({
		state: Count,
		init: () => ({count: 0}),
		step: (m, msg) => {
			if (msg.type === "plus") throw new Error("count is not a function");
			return m;
		},
		view: (m) => `count: ${m.count}`,
	}),
};

if (VERSION === "top-throw") throw new Error("a module that throws as it loads");
export const Program = versions[VERSION as keyof typeof versions];
export default {fetch: () => new Response("a counter; call its entrypoint")};
