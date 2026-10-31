// A JSON value as the lines a tree draws, the way Elm's debugger and Redux DevTools show a Model:
// one key per line, nested ones indented under their key, no braces and no commas. Pure, so the
// window only draws the lines.
//
//   linesOf({total: 3, seen: [1, 2]}, new Set(["/total"]))
//   // [{depth: 0, key: "total", text: "3", kind: "number", path: "/total", changed: true},
//   //  {depth: 0, key: "seen", text: "", kind: "open", path: "/seen", changed: false},
//   //  {depth: 1, key: "0", text: "1", kind: "number", path: "/seen/0", changed: false},
//   //  {depth: 1, key: "1", text: "2", kind: "number", path: "/seen/1", changed: false}]
//   inline({type: "add", n: 2})      // '{"type":"add","n":2}': short enough for one line
//   inline({a: "x".repeat(80)})      // "{1 key}": too long, so the tree shows it below

export type LineKind = "string" | "number" | "boolean" | "null" | "empty" | "open";

export interface Line {
	readonly depth: number;
	/** The key in its parent, or `null` for a value that is not inside one. */
	readonly key: string | null;
	/** The value as it reads; `""` on a line whose value is the lines under it. */
	readonly text: string;
	readonly kind: LineKind;
	/** Its JSON Pointer (RFC 6901), as a change names it. */
	readonly path: string;
	/** A change names this path: the tree marks it. */
	readonly changed: boolean;
}

/** The longest value a line holds as it is: past this, a tree shows it. */
const INLINE = 48;

const isContainer = (v: unknown): v is object => typeof v === "object" && v !== null;

const entriesOf = (v: object): readonly (readonly [string, unknown])[] =>
	Array.isArray(v) ? v.map((x, i) => [String(i), x] as const) : Object.entries(v);

const leafOf = (v: unknown): {readonly text: string; readonly kind: LineKind} => {
	if (v === null) return {text: "null", kind: "null"};
	if (typeof v === "string") return {text: JSON.stringify(v), kind: "string"};
	if (typeof v === "number") return {text: String(v), kind: "number"};
	if (typeof v === "boolean") return {text: String(v), kind: "boolean"};
	if (isContainer(v)) return {text: Array.isArray(v) ? "[]" : "{}", kind: "empty"};
	return {text: String(v), kind: "null"};
};

const pointer = (parent: string, key: string) =>
	`${parent}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;

/** A value's lines, with the paths in `changed` marked. A plain value is one line with no key. */
export const linesOf = (value: unknown, changed: ReadonlySet<string> = new Set()): Line[] => {
	if (!isContainer(value) || entriesOf(value).length === 0)
		return [{depth: 0, key: null, ...leafOf(value), path: "", changed: changed.has("")}];
	const out: Line[] = [];
	const walk = (v: object, depth: number, at: string) => {
		for (const [key, x] of entriesOf(v)) {
			const path = pointer(at, key);
			const opens = isContainer(x) && entriesOf(x).length > 0;
			out.push({
				depth,
				key,
				...(opens ? {text: "", kind: "open" as const} : leafOf(x)),
				path,
				changed: changed.has(path),
			});
			if (opens) walk(x, depth + 1, path);
		}
	};
	walk(value, 0, "");
	return out;
};

/** A value on one line when it is short, else how big it is: `{2 keys}`, `[5 items]`. */
export const inline = (value: unknown): string => {
	const one = JSON.stringify(value) ?? String(value);
	if (one.length <= INLINE || !isContainer(value)) return one;
	const n = entriesOf(value).length;
	return Array.isArray(value)
		? `[${n} ${n === 1 ? "item" : "items"}]`
		: `{${n} ${n === 1 ? "key" : "keys"}}`;
};

/** It does not fit on one line, so a tree shows it. */
export const needsTree = (value: unknown): boolean => inline(value) !== JSON.stringify(value);
