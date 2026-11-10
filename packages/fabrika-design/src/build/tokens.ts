import {existsSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
// The token build (design foundations, PR 2): tokens/color/*.toml, tokens/manti.toml and
// tokens/parts.toml in; tokens.css's two generated regions, theme-colors.ts and token-names.json
// out. Each step is read from @radix-ui/colors 3.0.0, the one place in the repo that imports it.
//
//   node src/build/tokens.ts                     # write the generated files and regions
//   node src/build/tokens.ts --check             # exit 1 on a bad file, a missed floor, or drift
//   node src/build/tokens.ts --check --root <d>  # the same, for a package copied to <d>
//
// It reads, decodes with schema.ts, checks across files, resolves each step in both looks, judges
// each floor with contrast.ts, then writes or compares. Every error names the file and the field:
//
//   turn-fg.toml: floor: dark on turn-fill-hover reads 4.28, under 4.5
//
// An `aim` missed is printed and never fails. The output is written as oxfmt prints it, so
// `pnpm format` leaves it alone.
import * as radix from "@radix-ui/colors";
import {parse} from "smol-toml";
import {over, ratio} from "./contrast.ts";
import {
	checkAcross,
	decodeManti,
	decodeParts,
	decodeToken,
	isOwn,
	type Decoded,
	type Manti,
	type Own,
	type Parts,
	type TokenFile,
	type Value,
} from "./schema.ts";

type Look = "dark" | "light";
const LOOKS: readonly Look[] = ["dark", "light"];

/** What went wrong, each naming its file and field; and what only prints. */
interface Said {
	readonly errors: string[];
	readonly notes: string[];
}

// ---- Radix's steps -----------------------------------------------------------------------------

/** Each Radix object by its export name, `slateDarkA`, its steps by theirs, `slateA9`. */
const SCALES: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map(
	Object.entries(radix).flatMap(([name, steps]) => {
		const scale = name.replace(/(Dark)?(P3)?A?$/, "");

		if (!/^[a-z]+(Dark)?(P3)?A?$/.test(name) || typeof steps !== "object" || steps === null) {
			return [];
		}

		const entries = Object.entries(steps).filter(
			(entry): entry is [string, string] =>
				entry[0].startsWith(scale) && typeof entry[1] === "string",
		);
		return entries.length === 12 ? [[name, new Map(entries)] as const] : [];
	}),
);

/** `rgba(0, 0, 0, 0.4)`, as Radix writes black and white alpha, as `#00000066`. */
const hexOf = (color: string): string => {
	const rgba = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(color);

	if (rgba === null) {
		return color.toLowerCase();
	}

	const [, r = "", g = "", b = "", a = ""] = rgba;
	const two = (n: number) => n.toString(16).padStart(2, "0");
	return `#${[r, g, b].map((c) => two(Number(c))).join("")}${two(Math.round(Number(a) * 255))}`;
};

/** A step such as `slate.a9` in a look, as hex. Black and white alpha are the same in both. */
const stepIn = (step: string, look: Look): string | undefined => {
	const [scale = "", at = ""] = step.split(".");
	const alpha = at.startsWith("a");
	const plain = scale === "black" || scale === "white";
	const object = `${scale}${look === "dark" && !plain ? "Dark" : ""}${alpha ? "A" : ""}`;
	const color = SCALES.get(object)?.get(`${scale}${alpha ? "A" : ""}${at.replace(/^a/, "")}`);
	return color === undefined ? undefined : hexOf(color);
};

/** Every step a stylesheet could name, in Radix's CSS spellings and its JS one. */
const allSteps = (): readonly string[] => {
	const scales = [...new Set([...SCALES.keys()].map((n) => n.replace(/(Dark)?(P3)?A?$/, "")))];
	const n = Array.from({length: 12}, (_, i) => i + 1);
	return scales
		.sort()
		.flatMap((s) =>
			s === "black" || s === "white"
				? n.flatMap((i) => [`--${s}-a${i}`, `--${s}A${i}`])
				: n.flatMap((i) => [`--${s}-${i}`, `--${s}-a${i}`, `--${s}A${i}`]),
		);
};

// ---- reading -----------------------------------------------------------------------------------

interface Sources {
	readonly tokens: ReadonlyMap<string, TokenFile>;
	readonly manti: Manti;
	readonly parts: Parts;
	readonly css: string;
}

const readToml = <A>(
	path: string,
	file: string,
	decode: (input: unknown) => Decoded<A>,
	said: Said,
): A | undefined => {
	let input: unknown;

	try {
		input = parse(readFileSync(path, "utf8"));
	} catch (error) {
		said.errors.push(`${file}: toml: ${error instanceof Error ? error.message : String(error)}`);
		return undefined;
	}

	const decoded = decode(input);

	if (decoded._tag === "ok") {
		return decoded.value;
	}

	said.errors.push(...decoded.errors);
	return undefined;
};

const read = (root: string, said: Said): Sources | undefined => {
	const dir = join(root, "tokens", "color");
	const tokens = new Map<string, TokenFile>();

	for (const file of readdirSync(dir).sort()) {
		if (!file.endsWith(".toml")) {
			said.errors.push(`${file}: name: a token file is <token>.toml`);
			continue;
		}

		const token = readToml(join(dir, file), file, (input) => decodeToken(file, input), said);

		if (token !== undefined) {
			tokens.set(file.replace(/\.toml$/, ""), token);
		}
	}

	const manti = readToml(join(root, "tokens", "manti.toml"), "manti.toml", decodeManti, said);
	const parts = readToml(join(root, "tokens", "parts.toml"), "parts.toml", decodeParts, said);
	const css = readFileSync(join(root, "src", "tokens.css"), "utf8");

	if (manti === undefined || parts === undefined) {
		return undefined;
	}

	return {tokens, manti, parts, css};
};

// ---- tokens.css's regions ----------------------------------------------------------------------

type Region = "colors" | "manti";

/** Where a region's generated text starts and ends: between its two marking comments. */
const regionIn = (css: string, name: Region): {from: number; to: number} | string => {
	const opens = [...css.matchAll(new RegExp(`/\\*\\s*@generated ${name}\\b[^*]*\\*/`, "g"))];
	const closes = [...css.matchAll(new RegExp(`/\\*\\s*@end generated ${name}\\s*\\*/`, "g"))];
	const [open] = opens;
	const [close] = closes;

	if (opens.length !== 1 || closes.length !== 1 || open === undefined || close === undefined) {
		return `tokens.css: @generated ${name}: needs one opening comment and one closing comment`;
	}

	const from = open.index + open[0].length;

	if (close.index < from) {
		return `tokens.css: @generated ${name}: closes before it opens`;
	}

	return {from, to: close.index};
};

const uncommented = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Each custom property a stretch of CSS declares. */
const declared = (css: string): readonly string[] =>
	[...uncommented(css).matchAll(/(--[\w-]+)\s*:/g)].map(([, name = ""]) => name);

/** Each declaration in a region, by name. */
const declarationsIn = (css: string): ReadonlyMap<string, string> =>
	new Map(
		[...uncommented(css).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(
			([, name = "", value = ""]) => [name, value.trim()] as const,
		),
	);

/** tokens.css with its two regions' generated text taken out: what is written by hand. */
const handOf = (css: string, said: Said): string | undefined => {
	const colors = regionIn(css, "colors");
	const manti = regionIn(css, "manti");

	if (typeof colors === "string" || typeof manti === "string") {
		for (const e of [colors, manti]) {
			if (typeof e === "string") {
				said.errors.push(e);
			}
		}

		return undefined;
	}

	const [first, second] = colors.from < manti.from ? [colors, manti] : [manti, colors];
	return css.slice(0, first.from) + css.slice(first.to, second.from) + css.slice(second.to);
};

// ---- resolving ---------------------------------------------------------------------------------

/** A value in a look, as hex. */
const valueIn = (value: Value, look: Look): string | undefined => {
	if (typeof value === "string") {
		return stepIn(value, look);
	}

	return "step" in value ? stepIn(value.step, look) : value.hex;
};

/** The token a name ends at once `extends` is followed. checkAcross has ruled out a cycle. */
const ownOf = (tokens: ReadonlyMap<string, TokenFile>, name: string): Own | undefined => {
	const token = tokens.get(name);

	if (token === undefined) {
		return undefined;
	}

	return isOwn(token) ? token : ownOf(tokens, token.colors.extends);
};

type Resolved = ReadonlyMap<string, Readonly<Record<Look, string>>>;

const resolveAll = (tokens: ReadonlyMap<string, TokenFile>, said: Said): Resolved => {
	const out = new Map<string, Record<Look, string>>();

	for (const name of tokens.keys()) {
		const own = ownOf(tokens, name);

		if (own === undefined) {
			continue;
		}

		const [dark, light] = LOOKS.map((look) => valueIn(own.colors[look], look));

		if (dark === undefined || light === undefined) {
			said.errors.push(`${name}.toml: colors: a step Radix 3.0.0 does not have`);
			continue;
		}

		out.set(name, {dark, light});
	}

	return out;
};

/** A backdrop, `a/b` drawn as a over b, in a look, as hex; why, when it cannot be drawn. */
const backdropIn = (resolved: Resolved, backdrop: string, look: Look): string | {why: string} => {
	const layers = backdrop.split("/").map((name) => resolved.get(name)?.[look]);
	const bottom = layers.at(-1);

	if (layers.some((l) => l === undefined) || bottom === undefined) {
		return {why: "not resolved"};
	}

	if (bottom.length !== 7) {
		return {why: `"${backdrop}" ends on a translucent token`};
	}

	return layers.slice(0, -1).reduceRight<string>((under, top) => over(top ?? under, under), bottom);
};

/** Each floor and aim, judged on each backdrop in both looks. */
const judge = (tokens: ReadonlyMap<string, TokenFile>, resolved: Resolved, said: Said) => {
	for (const [name, token] of tokens) {
		if (!isOwn(token) || (token.floor === undefined && token.aim === undefined)) {
			continue;
		}

		const {on = [], floor, aim, except = []} = token;

		for (const look of LOOKS) {
			const fg = resolved.get(name)?.[look];

			if (fg === undefined) {
				continue;
			}

			for (const backdrop of on) {
				const bg = backdropIn(resolved, backdrop, look);

				if (typeof bg !== "string") {
					said.errors.push(`${name}.toml: on: ${bg.why}; name what it is drawn over`);
					continue;
				}

				const r = ratio(fg, bg);
				const reads = r.toFixed(2);
				const i = except.findIndex((e) => e.on === backdrop && e.look === look);
				const e = except[i];

				if (floor !== undefined && r < floor) {
					if (e === undefined) {
						said.errors.push(
							`${name}.toml: floor: ${look} on ${backdrop} reads ${reads}, under ${floor}`,
						);
					} else if (Number(reads) !== e.ratio) {
						said.errors.push(
							`${name}.toml: except.${i}.ratio: ${look} on ${backdrop} reads ${reads}, not ${e.ratio}`,
						);
					}
				} else if (e !== undefined) {
					said.errors.push(
						`${name}.toml: except.${i}: ${look} on ${backdrop} reads ${reads}, over its floor; take it out`,
					);
				}

				if (aim !== undefined && r < aim) {
					said.notes.push(`${name}.toml: aim: ${look} on ${backdrop} reads ${reads}, under ${aim}`);
				}
			}
		}
	}
};

// ---- writing -----------------------------------------------------------------------------------

const TYPES = ["background", "border", "text", "icon"] as const;

const PLURAL: Record<(typeof TYPES)[number], string> = {
	background: "backgrounds",
	border: "borders",
	text: "text",
	icon: "icons",
};

/** A value as its file says it, for a comment: `slate a9`, `slate a9, a bend`, `a bend`. */
const spoken = (value: Value): string => {
	const step = (s: string) => s.replace(".", " ");

	if (typeof value === "string") {
		return step(value);
	}

	return "step" in value ? `${step(value.step)}, a bend` : "a bend";
};

const colorsRegion = (sources: Sources, resolved: Resolved): string => {
	const {tokens, parts} = sources;
	const byName = ([a]: readonly [string, unknown], [b]: readonly [string, unknown]) =>
		a < b ? -1 : 1;
	const groups: string[] = [];
	const group = (title: string, lines: readonly string[]) => {
		if (lines.length > 0) {
			groups.push([`\t/* ${title} */`, ...lines].join("\n"));
		}
	};

	for (const owner of Object.keys(parts)) {
		const owned = [...tokens].filter(([, t]) => t.owner === owner).sort(byName);

		for (const type of TYPES) {
			const lines = owned.flatMap(([name, t]) => {
				if (!isOwn(t) || t.type !== type) {
					return [];
				}

				const {dark = "", light = ""} = resolved.get(name) ?? {};
				const value = dark === light ? dark : `light-dark(${light}, ${dark})`;
				const [d, l] = [spoken(t.colors.dark), spoken(t.colors.light)];
				return [`\t--${name}: ${value}; /* ${d === l ? d : `light ${l}; dark ${d}`} */`];
			});
			group(`The ${owner}'s ${PLURAL[type]}.`, lines);
		}

		const named = owned.flatMap(([name, t]) =>
			isOwn(t) ? [] : [`\t--${name}: var(--${t.colors.extends});`],
		);
		group(`The ${owner}'s names for other tokens.`, named);
	}

	return `\n${groups.join("\n\n")}\n\t`;
};

const mantiRegion = ({manti}: Sources): string => {
	const lines = Object.entries(manti).map(([property, value]) =>
		typeof value === "string"
			? `\t${property}: var(${value});`
			: `\t${property}: ${value.value}; /* ${value.why} */`,
	);
	return `\n${lines.join("\n")}\n\t`;
};

const writeCss = (css: string, regions: Readonly<Record<Region, string>>): string => {
	const spans = (["colors", "manti"] as const).flatMap((name) => {
		const at = regionIn(css, name);
		return typeof at === "string" ? [] : [{...at, text: regions[name]}];
	});
	// The later region first, so the earlier one's offsets still hold.
	return spans
		.sort((a, b) => b.from - a.from)
		.reduce((out, {from, to, text}) => out.slice(0, from) + text + out.slice(to), css);
};

const themeColors = (tokens: ReadonlyMap<string, TokenFile>, resolved: Resolved): string => {
	const themed = [...tokens]
		.flatMap(([name, t]) => (t.theme === undefined ? [] : [[t.theme, name] as const]))
		.sort(([a], [b]) => (a < b ? -1 : 1));
	const key = (k: string) => (/^[a-z_$][\w$]*$/i.test(k) ? k : `"${k}"`);
	const object = (look: Look) =>
		themed
			.map(([theme, name]) => `\t${key(theme)}: "${resolved.get(name)?.[look] ?? ""}",`)
			.join("\n");
	return [
		"// Generated by src/build/tokens.ts from the token files' `theme` keys, tokens/color/<token>.toml:",
		"// edit a TOML file, then run `pnpm tokens`. The colors themes.ts gives the terminal and the frame.",
		"",
		`export const dark = {\n${object("dark")}\n} as const;`,
		"",
		`export const light = {\n${object("light")}\n} as const;`,
		"",
	].join("\n");
};

const tokenNames = ({tokens, parts}: Sources, css: string): string => {
	const owners = new Map(declared(css).map((name) => [name, "design"]));

	for (const [name, t] of tokens) {
		owners.set(`--${name}`, t.owner);
	}

	const listed = [...owners].sort(([a], [b]) => (a < b ? -1 : 1));
	const stylesheets = Object.entries(parts).flatMap(([part, p]) =>
		"stylesheets" in p
			? [`${JSON.stringify(part)}: [${p.stylesheets.map((s) => JSON.stringify(s)).join(", ")}]`]
			: [],
	);
	const json = (s: string) => JSON.stringify(s);
	return [
		"{",
		'\t"tokens": [',
		listed.map(([n, owner]) => `\t\t{ "name": ${json(n)}, "owner": ${json(owner)} }`).join(",\n"),
		"\t],",
		`\t"parts": { ${stylesheets.join(", ")} },`,
		'\t"steps": [',
		allSteps()
			.map((step) => `\t\t${json(step)}`)
			.join(",\n"),
		"\t]",
		"}",
		"",
	].join("\n");
};

// ---- the program -------------------------------------------------------------------------------

/** What the build makes from the sources, by file, or undefined when a check failed. */
const build = (root: string, said: Said): ReadonlyMap<string, string> | undefined => {
	const sources = read(root, said);

	if (sources === undefined) {
		return undefined;
	}

	const hand = handOf(sources.css, said);

	if (hand === undefined || said.errors.length > 0) {
		return undefined;
	}

	said.errors.push(...checkAcross({...sources, hand: declared(hand)}));

	if (said.errors.length > 0) {
		return undefined;
	}

	const resolved = resolveAll(sources.tokens, said);
	judge(sources.tokens, resolved, said);

	if (said.errors.length > 0) {
		return undefined;
	}

	const css = writeCss(sources.css, {
		colors: colorsRegion(sources, resolved),
		manti: mantiRegion(sources),
	});
	return new Map([
		["tokens.css", css],
		["theme-colors.ts", themeColors(sources.tokens, resolved)],
		["token-names.json", tokenNames(sources, css)],
	]);
};

/** Each way a file on disk differs from what the build makes. */
const drift = (file: string, now: string, made: string): readonly string[] => {
	if (now === made) {
		return [];
	}

	if (file !== "tokens.css") {
		return [`${file}: differs from what the TOML gives; run pnpm tokens`];
	}

	const names = (["colors", "manti"] as const).flatMap((region) => {
		const [a, b] = [now, made].map((css) => {
			const at = regionIn(css, region);
			return typeof at === "string"
				? new Map<string, string>()
				: declarationsIn(css.slice(at.from, at.to));
		});
		const all = [...new Set([...(a?.keys() ?? []), ...(b?.keys() ?? [])])];
		return all
			.filter((n) => a?.get(n) !== b?.get(n))
			.map((n) => `tokens.css: ${region}: ${n} is not what the TOML gives; run pnpm tokens`);
	});
	return names.length > 0
		? names
		: ["tokens.css: differs from what the TOML gives; run pnpm tokens"];
};

const main = (argv: readonly string[]) => {
	const at = argv.indexOf("--root");
	const root = resolve(at >= 0 ? (argv[at + 1] ?? ".") : join(import.meta.dirname, "..", ".."));
	const checking = argv.includes("--check");
	const said: Said = {errors: [], notes: []};
	const made = build(root, said);

	for (const note of said.notes) {
		console.log(note);
	}

	if (made === undefined) {
		for (const error of said.errors) {
			console.error(error);
		}

		return 1;
	}

	for (const [file, text] of made) {
		const path = join(root, "src", file);
		const now = existsSync(path) ? readFileSync(path, "utf8") : "";

		if (checking) {
			said.errors.push(...drift(file, now, text));
		} else if (now !== text) {
			writeFileSync(path, text);
		}
	}

	for (const error of said.errors) {
		console.error(error);
	}

	return said.errors.length > 0 ? 1 : 0;
};

process.exitCode = main(process.argv.slice(2));
