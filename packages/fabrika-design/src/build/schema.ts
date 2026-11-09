// What a token file may say (design foundations, PR 2; keys decided by the owner, 2026-11-07).
// One file per semantic color token, tokens/color/<token>.toml, its name the token's:
//
//   # tokens/color/text-faint.toml
//   type = "text"
//   tier = "global"
//   owner = "design"
//   description = "every quieter word"
//   theme = "faint"
//   on = ["surface", "surface-hover/surface"]   # "a/b": a drawn over b
//   floor = 4.5
//
//   [colors]
//   dark = "slate.a11"
//   light = "slate.a11"
//
// A token that points at another says `[colors] extends = "<token>"` instead. tokens/manti.toml
// maps each --manti-* to one of our custom properties, or to a plain value with its reason.
// tokens/parts.toml names each owner, and where a part's tokens may appear.
//
// This file is exam: the owner reads every change. The build (tokens.ts) decodes each file with
// `decodeToken`, `decodeManti` and `decodeParts`, then runs `checkAcross` for what one file cannot
// see, then resolves each step and checks each pair against its floor. Every error names the file
// and the field: `text-faint.toml: floor: ...`.
import {Cause, Exit, Schema} from "effect";

/** A token's name, which is its file's name: lowercase words joined by hyphens. */
const Name = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/));

/** Radix Colors 3.0.0's six grays and twenty-five accents, without P3 variants. */
const Scale = Schema.Literals([
	"gray",
	"mauve",
	"slate",
	"sage",
	"olive",
	"sand",
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
]);

/** A Radix 3.0.0 step: a scale and a step, `a` for alpha. Black and white come in alpha only. */
const Step = Schema.String.check(
	Schema.isPattern(/^(?:(?:slate|indigo|grass|amber|red)\.a?|(?:black|white)\.a)(?:[1-9]|1[0-2])$/),
);

/** A value: a step, or a step or a hex bent from the plain mapping, with its reason. */
const Value = Schema.Union([
	Step,
	Schema.Struct({step: Step, bend: Schema.NonEmptyString}),
	Schema.Struct({
		hex: Schema.String.check(Schema.isPattern(/^#[0-9a-f]{6}([0-9a-f]{2})?$/)),
		bend: Schema.NonEmptyString,
	}),
]);
export type Value = typeof Value.Type;

/** A WCAG number, never any number: 3 for lines and large text, 4.5 for text, 7 for AAA. */
const Bar = Schema.Literals([3, 4.5, 7]);

/** Call 3's category words, a closed set: surface and fill are background, line is border. */
const Type = Schema.Literals(["background", "text", "icon", "border"]);

const Tier = Schema.Literals(["primitive", "global", "shared", "component"]);

/** A backdrop: a token, or a token drawn over another, `surface-hover/surface`. */
const Backdrop = Schema.String.check(
	Schema.isPattern(/^[a-z][a-z0-9]*(-[a-z0-9]+)*(\/[a-z][a-z0-9]*(-[a-z0-9]+)*)?$/),
);

/** A pair kept under its floor on purpose, at its printed ratio, with its ticket. */
const Except = Schema.Struct({
	on: Backdrop,
	look: Schema.Literals(["dark", "light"]),
	ratio: Schema.Number.check(Schema.isGreaterThan(1)),
	ticket: Schema.Int.check(Schema.isGreaterThan(0)),
	why: Schema.NonEmptyString,
});

/** The keys every file has. */
const Common = {
	tier: Tier,
	owner: Name,
	/** Its key in themes.ts's Colors, when the terminal or the window's frame reads it. */
	theme: Schema.optionalKey(Schema.NonEmptyString),
};

/**
 * T343: the first of white and black passing both floors on every `on` background, per look.
 * White wins when both pass. Neither passing fails the pick; its backgrounds never move.
 * The tuple is closed: this records the decided label rule, not arbitrary color candidates.
 */
const Choice = Schema.Struct({
	choose: Schema.Tuple([Schema.Literal("#ffffff"), Schema.Literal("#000000")]),
});

/** A token with values of its own. */
const Own = Schema.Struct({
	...Common,
	type: Type,
	description: Schema.NonEmptyString,
	on: Schema.optionalKey(Schema.NonEmptyArray(Backdrop)),
	/** A hard floor: the build fails under it, in either look. */
	floor: Schema.optionalKey(Bar),
	/** A target: the build prints the pairs under it and does not fail. */
	aim: Schema.optionalKey(Bar),
	/** For a value no fact rides on: another cue identifies the part, so it needs no floor. */
	carries: Schema.optionalKey(Schema.Literal("nothing")),
	except: Schema.optionalKey(Schema.NonEmptyArray(Except)),
	colors: Schema.Union([
		Schema.Struct({dark: Value, light: Value}),
		Schema.Struct({scale: Scale}),
		Choice,
	]),
});
export type Own = typeof Own.Type;

/** A token that points at another. */
const Extends = Schema.Struct({
	...Common,
	description: Schema.optionalKey(Schema.NonEmptyString),
	colors: Schema.Struct({extends: Name}),
});
export type Extends = typeof Extends.Type;

export type TokenFile = Own | Extends;

/** A custom property's name, as CSS writes it. */
const Property = Schema.String.check(Schema.isPattern(/^--[a-z][a-z0-9]*(-[a-z0-9]+)*$/));

/** A plain value: a length, a word, never a color. */
const Plain = Schema.Struct({
	value: Schema.String.check(Schema.isPattern(/^[^#()]+$/)),
	why: Schema.NonEmptyString,
});

/** tokens/manti.toml: each --manti-* set from one of ours, by name, or to a plain value. */
const Manti = Schema.Record(
	Schema.String.check(Schema.isPattern(/^--manti-[a-z0-9]+(-[a-z0-9]+)*$/)),
	Schema.Union([Property, Plain]),
);
export type Manti = typeof Manti.Type;

/** tokens/parts.toml: each owner, and the stylesheets its tokens may appear in. */
const Parts = Schema.Record(
	Name,
	Schema.Union([
		Schema.Struct({
			description: Schema.NonEmptyString,
			stylesheets: Schema.NonEmptyArray(Schema.NonEmptyString),
		}),
		Schema.Struct({description: Schema.NonEmptyString, anywhere: Schema.Literal(true)}),
	]),
);
export type Parts = typeof Parts.Type;

/** A decoded file, or its errors, each naming the file and the field. */
export type Decoded<A> =
	| {readonly _tag: "ok"; readonly value: A}
	| {readonly _tag: "bad"; readonly errors: readonly string[]};

const decodeWith =
	<S extends Schema.Top>(schema: S & Schema.Codec<S["Type"], unknown>) =>
	(file: string, input: unknown): Decoded<S["Type"]> => {
		const exit = Schema.decodeUnknownExit(schema)(input, {
			onExcessProperty: "error",
			errors: "all",
		});
		if (Exit.isSuccess(exit)) return {_tag: "ok", value: exit.value};
		const said = String(Cause.squash(exit.cause)).replace(/^SchemaError\(|\)$/g, "");
		const errors = [...said.matchAll(/(.+)\n\s+at (\S+)/g)].map(
			([, what = "", at = ""]) => `${file}: ${fieldOf(at)}: ${what.trim()}`,
		);
		return {_tag: "bad", errors: errors.length > 0 ? errors : [`${file}: ${said}`]};
	};

/** `["colors"]["dark"]` as `colors.dark`. */
const fieldOf = (at: string) =>
	[...at.matchAll(/\[(?:"([^"]*)"|(\d+))\]/g)].map(([, key, index]) => key ?? index).join(".");

const isTable = (x: unknown): x is Readonly<Record<string, unknown>> =>
	typeof x === "object" && x !== null && !Array.isArray(x);

/** One token file, as `<token>.toml` and its parsed TOML. */
export const decodeToken = (file: string, input: unknown): Decoded<TokenFile> => {
	const name = file.replace(/\.toml$/, "");
	if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
		return {_tag: "bad", errors: [`${file}: name: a token's name is lowercase words and hyphens`]};
	}
	const extending = isTable(input) && isTable(input["colors"]) && "extends" in input["colors"];
	return extending ? decodeWith(Extends)(file, input) : decodeWith(Own)(file, input);
};

export const decodeManti = (input: unknown): Decoded<Manti> =>
	decodeWith(Manti)("manti.toml", input);

export const decodeParts = (input: unknown): Decoded<Parts> =>
	decodeWith(Parts)("parts.toml", input);

/** A value with alpha under 1 in a look: an `a` step, black or white alpha, an 8-digit hex. */
export const isTranslucent = (value: Value): boolean => {
	if (typeof value === "string") return /\.a\d+$/.test(value);
	return "step" in value ? /\.a\d+$/.test(value.step) : value.hex.length === 9;
};

export const isOwn = (token: TokenFile): token is Own => !("extends" in token.colors);

/** Everything one file cannot see. */
export interface Sources {
	readonly tokens: ReadonlyMap<string, TokenFile>;
	readonly manti: Manti;
	readonly parts: Parts;
	/** The custom properties tokens.css writes by hand, outside its generated regions. */
	readonly hand: readonly string[];
}

/** The checks across files, before any value is resolved. Empty when all hold. */
export const checkAcross = ({tokens, manti, parts, hand}: Sources): readonly string[] => {
	const errors: string[] = [];
	const bad = (token: string, field: string, what: string) =>
		errors.push(`${token}.toml: ${field}: ${what}`);

	for (const [name, token] of tokens) {
		if (!Object.hasOwn(parts, token.owner)) {
			bad(name, "owner", `"${token.owner}" is not named in parts.toml`);
		}
		if (!isOwn(token)) {
			if (!tokens.has(token.colors.extends)) {
				bad(name, "colors.extends", `no token "${token.colors.extends}"`);
			}
			continue;
		}
		const {type, on, floor, aim, carries, except, colors} = token;
		for (const backdrop of on ?? []) {
			for (const part of backdrop.split("/")) {
				if (!tokens.has(part)) bad(name, "on", `no token "${part}" in "${backdrop}"`);
			}
		}
		if (type === "text") {
			if (on === undefined) bad(name, "on", "a text token names what it sits on");
			if (floor === undefined || floor < 4.5) bad(name, "floor", "a text token needs 4.5 or more");
			if (carries !== undefined) bad(name, "carries", "text always carries a fact");
		}
		if (type === "border" || type === "icon") {
			const a = type === "icon" ? "an icon" : "a border";
			if (carries === undefined) {
				if (on === undefined) bad(name, "on", `${a} names what it sits on, or carries nothing`);
				if (floor === undefined) bad(name, "floor", `${a} needs 3 or more, or carries nothing`);
			} else if (floor !== undefined) {
				bad(name, "floor", "a value that carries nothing has no floor");
			}
		}
		if (type === "background" && carries !== undefined) {
			bad(name, "carries", "a background needs no floor, so it says nothing it carries");
		}
		if (
			!("scale" in colors) &&
			!("choose" in colors) &&
			(isTranslucent(colors.dark) || isTranslucent(colors.light)) &&
			on === undefined
		) {
			bad(name, "on", "a translucent value names its backdrop");
		}
		if ((floor !== undefined || aim !== undefined) && on === undefined) {
			bad(name, "on", "a floor or an aim is judged on what the token sits on");
		}
		for (const [i, e] of (except ?? []).entries()) {
			if (floor === undefined) bad(name, `except.${i}`, "an exception is to a floor");
			if (!(on ?? []).some((backdrop) => backdrop === e.on))
				bad(name, `except.${i}.on`, `"${e.on}" is not in on`);
		}
	}

	// No extends cycle: follow each chain to a token with values of its own.
	for (const name of tokens.keys()) {
		const seen = [name];
		let at = tokens.get(name);
		while (at !== undefined && !isOwn(at)) {
			const next = at.colors.extends;
			if (seen.includes(next)) {
				bad(name, "colors.extends", `a cycle: ${[...seen, next].join(" -> ")}`);
				break;
			}
			seen.push(next);
			at = tokens.get(next);
		}
	}

	// A name appears once across the token files, manti.toml and tokens.css's hand-written part,
	// case folded, since macOS's file system folds case.
	const where = new Map<string, string[]>();
	const note = (property: string, from: string) =>
		where.set(property.toLowerCase(), [...(where.get(property.toLowerCase()) ?? []), from]);
	for (const name of tokens.keys()) note(`--${name}`, `${name}.toml`);
	for (const property of Object.keys(manti)) note(property, `manti.toml ${property}`);
	for (const property of hand) note(property, `tokens.css ${property}`);
	for (const [property, from] of where) {
		if (from.length > 1)
			errors.push(`${from.join(", ")}: name: ${property} is written ${from.length} times`);
	}

	// Each Manti token names a custom property we define.
	const ours = new Set([...[...tokens.keys()].map((name) => `--${name}`), ...hand]);
	for (const [property, value] of Object.entries(manti)) {
		if (typeof value === "string" && !ours.has(value)) {
			errors.push(`manti.toml: ${property}: no custom property ${value} of ours`);
		}
	}
	return errors;
};

/**
 * Today's app, T343. tokens/terminal.toml: each look's terminal colors as Radix 3.0.0 steps, any
 * of the 31 scales (the palette needs blue, purple and cyan), solid or alpha. The one source of
 * the built-in terminal values; themes.ts and themes/*.toml are generated from it.
 *
 *   [dark]
 *   foreground = "slate.12"
 *   palette = ["slate.3", "red.9", ...]   # sixteen, in ANSI order
 */
const TerminalStep = Schema.String.check(
	Schema.isPattern(
		new RegExp(`^(?:(?:${Scale.literals.join("|")})\\.a?|(?:black|white)\\.a)(?:[1-9]|1[0-2])$`),
	),
);
const TerminalLook = Schema.Struct({
	foreground: TerminalStep,
	background: TerminalStep,
	cursor: TerminalStep,
	selection: TerminalStep,
	palette: Schema.Array(TerminalStep).check(Schema.isMinLength(16), Schema.isMaxLength(16)),
});
const TerminalFile = Schema.Struct({dark: TerminalLook, light: TerminalLook});
export type TerminalFile = typeof TerminalFile.Type;

export const decodeTerminal = (input: unknown): Decoded<TerminalFile> =>
	decodeWith(TerminalFile)("terminal.toml", input);
