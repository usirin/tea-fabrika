// Today's app: a complete theme file, with only the globals generated from token data.
import {Cause, Exit, Option, Result, Schema, type SchemaIssue} from "effect";
import {parse, TomlError} from "smol-toml";
import {GlobalColors, RepairableColor} from "./theme-contract.ts";

const Hex = Schema.String.check(Schema.isPattern(/^#[0-9a-f]{6}([0-9a-f]{2})?$/));
export const ThemeName = Schema.String.check(Schema.isPattern(/^[a-z0-9]+(-[a-z0-9]+)*$/u));
const Basename = Schema.String.check(
	Schema.isPattern(/^(?!\.{1,2}$)[^/\\]+$/),
	Schema.makeFilter((value) => [...value].every((letter) => letter.charCodeAt(0) >= 32)),
);
const Shared = {
	file: Basename,
	sha256: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
	by: Schema.optionalKey(Schema.String),
};
const Radix = {
	version: Schema.NonEmptyString,
	gray: Schema.Literals(["gray", "mauve", "slate", "sage", "olive", "sand"]),
	accent: Schema.Literals([
		"tomato",
		"red",
		"ruby",
		"crimson",
		"pink",
		"plum",
		"purple",
		"violet",
		"iris",
		"indigo",
		"blue",
		"cyan",
		"teal",
		"jade",
		"green",
		"grass",
		"brown",
		"bronze",
		"gold",
		"sky",
		"mint",
		"lime",
		"yellow",
		"amber",
		"orange",
	]),
};
const Source = Schema.TaggedUnion({radix: Radix, base16: Shared, base24: Shared, ghostty: Shared});
const FromFile = Schema.Union([
	Schema.Struct({radix: Schema.Struct(Radix)}),
	Schema.Struct({base16: Schema.Struct(Shared)}),
	Schema.Struct({base24: Schema.Struct(Shared)}),
	Schema.Struct({ghostty: Schema.Struct(Shared)}),
]);
const Repair = Schema.Struct({was: Hex, now: Hex, why: Schema.NonEmptyString});
const ThemeFile = Schema.Struct({
	format: Schema.Literal(1),
	name: ThemeName,
	look: Schema.Literals(["dark", "light"]),
	from: Schema.optionalKey(FromFile),
	colors: GlobalColors,
	terminal: Schema.Struct({
		foreground: Hex,
		background: Hex,
		cursor: Hex,
		selection: Hex,
		palette: Schema.Tuple([
			Hex,
			Hex,
			Hex,
			Hex,
			Hex,
			Hex,
			Hex,
			Hex,
			Hex,
			Hex,
			Hex,
			Hex,
			Hex,
			Hex,
			Hex,
			Hex,
		]),
	}),
	repaired: Schema.optionalKey(Schema.Record(RepairableColor, Schema.optionalKey(Repair))),
});

export type Theme = Omit<typeof ThemeFile.Type, "from"> & {
	readonly from?: typeof Source.Type;
};

export interface Diagnostic {
	readonly file: string;
	readonly field: string;
	readonly line: number;
	readonly message: string;
}

// Only schema-owned names may leave the decoder. An unknown key can contain private text.
const fields = new Set([
	...Object.keys(ThemeFile.fields),
	...Object.keys(GlobalColors.fields),
	"radix",
	"base16",
	"base24",
	"ghostty",
	"file",
	"sha256",
	"by",
	"version",
	"gray",
	"accent",
	"foreground",
	"background",
	"cursor",
	"selection",
	"palette",
	"was",
	"now",
	"why",
]);
const pathIn = (issue: SchemaIssue.Issue): readonly PropertyKey[] => {
	switch (issue._tag) {
		case "Pointer":
			return [...issue.path, ...pathIn(issue.issue)];
		case "Filter":
		case "Encoding":
			return pathIn(issue.issue);
		case "Composite":
		case "AnyOf":
			return issue.issues[0] === undefined ? [] : pathIn(issue.issues[0]);
		default:
			return [];
	}
};
const lineIn = (text: string, field: string): number => {
	const key = field.split(".").at(-1);
	if (key === undefined || !fields.has(key)) return 1;
	const line = text
		.split(/\r?\n/)
		.findIndex((s) => new RegExp(`^\\s*(?:${key}|"${key}"|'${key}')\\s*=`).test(s));
	return line < 0 ? 1 : line + 1;
};

/** Decode without retaining source text, parser excerpts or invalid field values in a refusal. */
export const decodeTheme = (text: string, file?: string): Result.Result<Theme, Diagnostic> => {
	const filename =
		file !== undefined && /^[a-z0-9]+(?:-[a-z0-9]+)*\.toml$/.test(file) ? file : "theme.toml";
	const refuse = (field: string, message: string, line = lineIn(text, field)) =>
		Result.fail({file: filename, field, line, message});
	let input: unknown;
	try {
		input = parse(text);
	} catch (error) {
		return refuse("toml", "invalid TOML", error instanceof TomlError ? error.line : 1);
	}
	const decoded = Schema.decodeUnknownExit(ThemeFile)(input, {onExcessProperty: "error"});
	if (Exit.isFailure(decoded)) {
		const error = Cause.findErrorOption(decoded.cause);
		const path = Option.isSome(error) ? pathIn(error.value.issue) : [];
		const safe: string[] = [];
		for (const key of path) {
			if (typeof key !== "string" || !fields.has(key)) break;
			safe.push(key);
		}
		return refuse(safe.join(".") || "theme", "expected a complete theme with valid fields");
	}
	const {from, ...theme} = decoded.value;
	if (file !== undefined && (file !== filename || filename !== `${theme.name}.toml`))
		return refuse("name", "the theme name must match its file");
	for (const token of RepairableColor.literals) {
		const repair = theme.repaired?.[token];
		const now = token === "cursor" ? theme.terminal.cursor : theme.colors[token];
		if (repair !== undefined && repair.now !== now)
			return refuse(`repaired.${token}.now`, "the repair must match the final color");
	}
	if (from === undefined) return Result.succeed(theme);
	const source =
		"radix" in from
			? Source.cases.radix.make(from.radix)
			: "base16" in from
				? Source.cases.base16.make(from.base16)
				: "base24" in from
					? Source.cases.base24.make(from.base24)
					: Source.cases.ghostty.make(from.ghostty);
	return Result.succeed({...theme, from: source});
};
