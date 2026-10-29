// What changed between two JSON values, as a JSON Patch (RFC 6902), and that patch applied again.
// A job's record keeps a machine's steps this way: a whole state every so many steps, and only
// what changed in between, the way a video keeps key frames (experiment 169).
//
//   diff({total: 1}, {total: 3})                       [{op: "replace", path: "/total", value: 3}]
//   diff({list: [1]}, {list: [1, 2]})                  [{op: "add", path: "/list/1", value: 2}]
//   apply({total: 1}, [{op: "replace", path: "/total", value: 3}])   {total: 3}
//
// Only three of the RFC's six ops are written: `add`, `remove` and `replace`. `move`, `copy` and
// `test` are never needed to say what changed, and `apply` refuses them. Values are JSON: what
// `JSON.parse` gives. An array that changed length is patched at its end, one op per element.

/** A JSON value, as `JSON.parse` gives it. */
export type Json =
	| null
	| boolean
	| number
	| string
	| readonly Json[]
	| {readonly [k: string]: Json};

/** One op of a JSON Patch, of the three written here. */
export type Op =
	| {readonly op: "add"; readonly path: string; readonly value: Json}
	| {readonly op: "remove"; readonly path: string}
	| {readonly op: "replace"; readonly path: string; readonly value: Json};

/** RFC 6901: `~` is `~0` and `/` is `~1` inside one part of a pointer. */
const escape = (part: string) => part.replaceAll("~", "~0").replaceAll("/", "~1");
const unescape = (part: string) => part.replaceAll("~1", "/").replaceAll("~0", "~");

const isObject = (v: Json): v is {readonly [k: string]: Json} =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/** Two JSON values are the same value. */
const same = (a: Json, b: Json): boolean => {
	if (a === b) return true;
	if (Array.isArray(a) && Array.isArray(b))
		return a.length === b.length && a.every((v, i) => same(v, b[i] as Json));
	if (isObject(a) && isObject(b)) {
		const keys = Object.keys(a);
		return (
			keys.length === Object.keys(b).length &&
			keys.every((k) => Object.hasOwn(b, k) && same(a[k] as Json, b[k] as Json))
		);
	}
	return false;
};

const walk = (from: Json, to: Json, path: string, out: Op[]): void => {
	if (same(from, to)) return;
	if (Array.isArray(from) && Array.isArray(to)) {
		const both = Math.min(from.length, to.length);
		for (let i = 0; i < both; i++) walk(from[i] as Json, to[i] as Json, `${path}/${i}`, out);
		for (let i = both; i < to.length; i++)
			out.push({op: "add", path: `${path}/${i}`, value: to[i] as Json});
		// From the end, so each index still names the element it removes.
		for (let i = from.length - 1; i >= both; i--) out.push({op: "remove", path: `${path}/${i}`});
		return;
	}
	if (isObject(from) && isObject(to)) {
		for (const k of Object.keys(from))
			if (!Object.hasOwn(to, k)) out.push({op: "remove", path: `${path}/${escape(k)}`});
		for (const k of Object.keys(to)) {
			const at = `${path}/${escape(k)}`;
			if (Object.hasOwn(from, k)) walk(from[k] as Json, to[k] as Json, at, out);
			else out.push({op: "add", path: at, value: to[k] as Json});
		}
		return;
	}
	out.push({op: "replace", path, value: to});
};

/** The ops that make `from` into `to`. `[]`: they are the same value. */
export const diff = (from: Json, to: Json): readonly Op[] => {
	const out: Op[] = [];
	walk(from, to, "", out);
	return out;
};

/** A patch that does not fit the value it is applied to. */
export class PatchMisfit extends Error {}

const partsOf = (path: string): readonly string[] => {
	if (path === "") return [];
	if (!path.startsWith("/")) throw new PatchMisfit(`not a JSON pointer: ${path}`);
	return path.slice(1).split("/").map(unescape);
};

const indexOf = (part: string, length: number, adding: boolean): number => {
	if (adding && part === "-") return length;
	if (!/^(0|[1-9][0-9]*)$/.test(part)) throw new PatchMisfit(`not an array index: ${part}`);
	const i = Number(part);
	if (i > length || (!adding && i === length)) throw new PatchMisfit(`index ${i} is past the end`);
	return i;
};

/** `value` with `op` done to it, as a new value: `value` is not changed. */
const applyOne = (value: Json, op: Op): Json => {
	const parts = partsOf(op.path);
	const at = (node: Json, depth: number): Json => {
		const part = parts[depth];
		if (part === undefined) {
			if (op.op === "remove") throw new PatchMisfit("the whole value cannot be removed");
			return op.value;
		}
		const last = depth === parts.length - 1;
		if (Array.isArray(node)) {
			const copy = [...node];
			const i = indexOf(part, copy.length, last && op.op === "add");
			if (!last) copy[i] = at(copy[i] as Json, depth + 1);
			else if (op.op === "add") copy.splice(i, 0, op.value);
			else if (op.op === "remove") copy.splice(i, 1);
			else copy[i] = op.value;
			return copy;
		}
		if (isObject(node)) {
			const copy: {[k: string]: Json} = {...node};
			if (!last) {
				if (!Object.hasOwn(copy, part)) throw new PatchMisfit(`no key ${part}`);
				copy[part] = at(copy[part] as Json, depth + 1);
			} else if (op.op === "remove") {
				if (!Object.hasOwn(copy, part)) throw new PatchMisfit(`no key ${part}`);
				delete copy[part];
			} else {
				if (op.op === "replace" && !Object.hasOwn(copy, part))
					throw new PatchMisfit(`no key ${part}`);
				copy[part] = op.value;
			}
			return copy;
		}
		throw new PatchMisfit(`${op.path}: a ${typeof node} has no parts`);
	};
	return at(value, 0);
};

/** `value` with every op of `patch` done to it, in order. Throws `PatchMisfit` when one does not fit. */
export const apply = (value: Json, patch: readonly Op[]): Json => patch.reduce(applyOne, value);
