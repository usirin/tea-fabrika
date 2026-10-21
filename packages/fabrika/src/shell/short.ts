// A value a program sent, as one short line a person reads: how tsh prints
// by default. `tsh --json` prints each value whole instead, as one JSON line,
// for a script that reads tsh's output. Pipes and `$( )` never see either:
// they carry the value itself.
//
// It reads the value alone, not its program, so it works for any program:
//
//   "hello"                                         hello
//   {pr: "https://…/pull/597", name: "done", …}     #597  done  head 9eb6b52c75d6…  criteria 3
//   {pr, facts: {state: "open", …}, wouldSend: {type: "ship_enqueue", …}}
//                                                   #597  facts (open, green, …)  wouldSend ship_enqueue
//
// What it leaves out: null, false, an empty list, a long text's tail, and
// anything past the width. The whole value is one `--json` away.

const WIDTH = 100;
/** A text this long or longer is cut. */
const LONG = 24;
/** The fields that name what a value is about, shown first and bare. */
const FIRST = ["pr", "id"] as const;
const TAGS = ["kind", "type", "_tag"] as const;

type Fields = Readonly<Record<string, unknown>>;
const isFields = (value: unknown): value is Fields =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** A pull request's url as `#n`; any other text cut when long. */
const text = (value: string): string => {
	const pull = /\/pull\/(\d+)$/.exec(value);
	if (pull !== null) return `#${pull[1]}`;
	const one = value.split("\n")[0] ?? "";
	return one.length > LONG || one !== value ? `${one.slice(0, LONG - 12)}…` : one;
};

/** A tagged value by its tag, with its `why` when it has one: `skip:draft`. */
const tagOf = (value: Fields): string | null => {
	const tag = TAGS.map((k) => value[k]).find((t): t is string => typeof t === "string");
	if (tag === undefined) return null;
	return typeof value.why === "string" ? `${tag}:${value.why}` : tag;
};

/** An untagged record's short texts and numbers, in brackets: `(open, green, clean)`. */
const scalars = (value: Fields): string | null => {
	const kept = Object.values(value).flatMap((v) => {
		if (typeof v === "number") return [String(v)];
		if (typeof v === "string" && v !== "" && v.length < LONG && !v.includes("\n")) return [v];
		return [];
	});
	return kept.length === 0 ? null : `(${kept.join(", ")})`;
};

/** One field as a part of the line, or null to leave it out. `name`: the value's name, already shown. */
const part = (key: string, value: unknown, name: string | null): string | null => {
	if (value === null || value === undefined || value === false || value === "") return null;
	if (value === true) return key;
	if (typeof value === "number") return `${key} ${value}`;
	if (typeof value === "string") return `${key} ${text(value)}`;
	if (Array.isArray(value)) return value.length === 0 ? null : `${key} ${value.length}`;
	if (!isFields(value)) return null;
	const tag = tagOf(value);
	if (tag !== null) return name?.startsWith(tag) === true ? null : `${key} ${tag}`;
	const inside = scalars(value);
	return inside === null ? null : `${key} ${inside}`;
};

const cut = (line: string, width: number) =>
	line.length > width ? `${line.slice(0, width - 1)}…` : line;

/** A value as one short line. */
export function shortOf(value: unknown, width = WIDTH): string {
	if (typeof value === "string") return cut(value.split("\n")[0] ?? "", width);
	if (Array.isArray(value))
		return `a list of ${value.length}: ${cut(value.map((v) => shortOf(v, 20)).join(", "), width - 14)}`;
	if (!isFields(value)) return JSON.stringify(value) ?? String(value);
	const name = typeof value.name === "string" ? value.name : null;
	const parts: string[] = [];
	for (const key of FIRST)
		if (typeof value[key] === "string") parts.push(text(value[key] as string));
	if (name !== null) parts.push(name);
	const tag = tagOf(value);
	if (tag !== null && name === null) parts.push(tag);
	for (const [key, field] of Object.entries(value)) {
		if (
			(FIRST as readonly string[]).includes(key) ||
			key === "name" ||
			(TAGS as readonly string[]).includes(key)
		)
			continue;
		if (key === "why" && tag !== null) continue;
		const shown = part(key, field, name);
		if (shown !== null) parts.push(shown);
	}
	return cut(parts.join("  "), width);
}

/** How tsh prints a value: short for a person, or the JSON whole for a script. */
export type Show = "short" | "json";

export const shown = (value: unknown, show: Show): string =>
	show === "json" ? (typeof value === "string" ? value : JSON.stringify(value)) : shortOf(value);
