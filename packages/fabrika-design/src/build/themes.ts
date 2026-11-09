// Today's app. Generate the checker's complete global pair list and repair version from token data, the built-in
// terminal colors from tokens/terminal.toml (themes.ts's generated region and the two built-in
// TOML files), and the settings JSON Schema.
// node src/build/themes.ts [--check] [--root <package>]
import {existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import * as radix from "@radix-ui/colors";
import {Result, Schema} from "effect";
import {parse, stringify} from "smol-toml";
import {decodeThemeSettings, Settings} from "../theme-settings.ts";
import {decodeTheme} from "../theme.ts";
import {fabrika, fabrikaLight} from "../themes.ts";
import {
	checkAcross,
	decodeParts,
	decodeTerminal,
	decodeToken,
	isOwn,
	type Own,
	type TerminalFile,
	type TokenFile,
} from "./schema.ts";

const args = process.argv.slice(2);
const at = args.indexOf("--root");
const root = resolve(at < 0 ? join(import.meta.dirname, "../..") : (args[at + 1] ?? "."));
const tokens = new Map<string, TokenFile>();
const errors: string[] = [];
const read = (file: string): unknown => {
	try {
		return parse(readFileSync(join(root, "tokens", file), "utf8"));
	} catch {
		errors.push(`${file}: toml: could not read valid TOML`);
		return undefined;
	}
};
for (const file of readdirSync(join(root, "tokens/color")).sort()) {
	if (!file.endsWith(".toml")) {
		errors.push(`${file}: name: a token file is <token>.toml`);
		continue;
	}
	const decoded = decodeToken(file, read(`color/${file}`));
	if (decoded._tag === "bad") errors.push(...decoded.errors);
	else tokens.set(file.slice(0, -5), decoded.value);
}
const parts = decodeParts(read("parts.toml"));
if (parts._tag === "bad") errors.push(...parts.errors);
// Token ownership, aliases and requirements apply here too. CSS and Manti stay in tokens.ts.
if (parts._tag === "ok")
	errors.push(...checkAcross({tokens, manti: {}, parts: parts.value, hand: []}));

// The terminal's built-in colors: Radix 3.0.0 steps per look, the one source (design language,
// call 5). `slate.a5` is slateDarkA's slateA5 in dark; black and white alpha are one set.
const RADIX: object = radix;
const stepHex = (step: string, look: "dark" | "light"): string | undefined => {
	const [scale = "", at = ""] = step.split(".");
	const alpha = at.startsWith("a");
	const plain = scale === "black" || scale === "white";
	const set: unknown = Reflect.get(
		RADIX,
		`${scale}${look === "dark" && !plain ? "Dark" : ""}${alpha ? "A" : ""}`,
	);
	const value: unknown =
		typeof set === "object" && set !== null
			? Reflect.get(set, `${scale}${alpha ? "A" : ""}${at.replace(/^a/, "")}`)
			: undefined;
	if (typeof value !== "string") return undefined;
	const rgba = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(value);
	if (rgba === null) return value.toLowerCase();
	const [, r = "", g = "", b = "", a = ""] = rgba;
	const two = (n: number) => n.toString(16).padStart(2, "0");
	return `#${[r, g, b].map((c) => two(Number(c))).join("")}${two(Math.round(Number(a) * 255))}`;
};
type Look = "dark" | "light";
interface Step {
	readonly step: string;
	readonly hex: string;
}
interface Terminal {
	readonly foreground: Step;
	readonly background: Step;
	readonly cursor: Step;
	readonly selection: Step;
	readonly palette: readonly Step[];
}
const terminalFile = decodeTerminal(read("terminal.toml"));
if (terminalFile._tag === "bad") errors.push(...terminalFile.errors);
const terminalIn = (file: TerminalFile, look: Look): Terminal => {
	const at = (field: string, step: string): Step => {
		const hex = stepHex(step, look);
		if (hex === undefined)
			errors.push(`terminal.toml: ${look}.${field}: a step Radix 3.0.0 does not have`);
		return {step, hex: hex ?? ""};
	};
	const t = file[look];
	return {
		foreground: at("foreground", t.foreground),
		background: at("background", t.background),
		cursor: at("cursor", t.cursor),
		selection: at("selection", t.selection),
		palette: t.palette.map((step, i) => at(`palette.${i}`, step)),
	};
};
const terminals =
	terminalFile._tag === "ok"
		? {dark: terminalIn(terminalFile.value, "dark"), light: terminalIn(terminalFile.value, "light")}
		: undefined;
const hexes = (t: Terminal) => ({
	foreground: t.foreground.hex,
	background: t.background.hex,
	cursor: t.cursor.hex,
	selection: t.selection.hex,
	palette: t.palette.map(({hex}) => hex),
});
/** themes.ts's generated region: each value with the step it is, as tokens.css writes them. */
const terminalRegion = (all: Readonly<Record<Look, Terminal>>): string => {
	const line = (indent: string, key: string, {step, hex}: Step) =>
		`${indent}${key}"${hex}", // ${step.replace(".", " ")}`;
	const look = (name: Look) => {
		const t = all[name];
		return [
			`\t${name}: {`,
			line("\t\t", "foreground: ", t.foreground),
			line("\t\t", "background: ", t.background),
			line("\t\t", "cursor: ", t.cursor),
			line("\t\t", "selection: ", t.selection),
			"\t\tpalette: [",
			...t.palette.map((step) => line("\t\t\t", "", step)),
			"\t\t],",
			"\t},",
		];
	};
	return ["", ...look("dark"), ...look("light"), "\t"].join("\n");
};
const OPEN = /\/\/ @generated terminal\b[^\n]*/;
const CLOSE = "// @end generated terminal";
const withRegion = (ts: string, region: string): string | undefined => {
	const open = OPEN.exec(ts);
	const close = ts.indexOf(CLOSE);
	if (open === null || close < open.index) return undefined;
	return ts.slice(0, open.index + open[0].length) + region + ts.slice(close);
};

const own = (name: string, seen: readonly string[] = []): Own | undefined => {
	const token = tokens.get(name);
	if (token === undefined || seen.includes(name)) {
		errors.push(`${name}.toml: colors.extends: missing token or alias cycle`);
		return undefined;
	}
	return isOwn(token) ? token : own(token.colors.extends, [...seen, name]);
};

const pairs = [...tokens].flatMap(([name, token]) => {
	if (token.tier !== "global") return [];
	const value = own(name);
	if (value === undefined || value.floor === undefined) return [];
	const {floor} = value;
	return (value.on ?? []).map((on) => {
		for (const layer of on.split("/")) {
			if (tokens.get(layer)?.tier !== "global")
				errors.push(`${name}.toml: on: ${layer} is not a global color`);
		}
		return {token: name, on, floor: {wcag: floor, apca: value.type === "text" ? 60 : 15}};
	});
});
pairs.push({token: "cursor", on: "terminal.background", floor: {wcag: 3, apca: 15}});

// The measured cap and its repair version (tokens/repair.toml, experiment 239): every checker call
// in the app uses these two, so a cap change is a version change everywhere at once.
const repairFile = read("repair.toml");
const repairVersion = typeof repairFile === "object" && repairFile !== null ? repairFile : {};
const version: unknown = Reflect.get(repairVersion, "version");
const cap: unknown = Reflect.get(repairVersion, "cap");
if (typeof version !== "string" || version === "")
	errors.push("repair.toml: version: a repair version is a string");
if (typeof cap !== "number" || !Number.isFinite(cap) || cap <= 0)
	errors.push("repair.toml: cap: a measured cap is a positive number");

const globals = [...tokens].filter(([, token]) => token.tier === "global");
const movable = globals.flatMap(([name]) => {
	const value = own(name);
	return value !== undefined && value.type !== "background" && value.carries !== "nothing"
		? [name]
		: [];
});
const key = (name: string) => (/^[a-z][a-z0-9]*$/.test(name) ? name : JSON.stringify(name));
const output = [
	"// Generated by src/build/themes.ts from tokens/color. Never edit by hand.",
	"// The checker's apca-w3 declaration, for every program that runs the checker with these pairs.",
	'/// <reference path="./apca-w3.d.ts" />',
	'import {Schema} from "effect";',
	'import type {check} from "./build/contrast.ts";',
	"",
	"const Hex = Schema.String.check(Schema.isPattern(/^#[0-9a-f]{6}([0-9a-f]{2})?$/));",
	"",
	"export const GlobalColors = Schema.Struct({",
	...globals.map(([name]) => `\t${key(name)}: Hex,`),
	"});",
	"",
	"export const RepairableColor = Schema.Literals([",
	...movable.map((name) => `\t${JSON.stringify(name)},`),
	'\t"cursor",',
	"]);",
	"",
	"export const pairs = [",
	...pairs.map(({token, on, floor}) =>
		[
			"\t{",
			`\t\ttoken: ${JSON.stringify(token)},`,
			`\t\ton: ${JSON.stringify(on)},`,
			`\t\tfloor: {wcag: ${floor.wcag}, apca: ${floor.apca}},`,
			"\t},",
		].join("\n"),
	),
	"] as const satisfies Parameters<typeof check>[1];",
	"",
	"/** The measured cap and its repair version, from tokens/repair.toml. */",
	`export const repair = {version: ${JSON.stringify(version)}, cap: ${String(cap)}} as const satisfies Parameters<`,
	"\ttypeof check",
	">[3];",
	"",
].join("\n");
const generated = new Map([["src/theme-contract.ts", output]]);
const colors: {readonly dark: unknown; readonly light: unknown} = await import(
	pathToFileURL(join(root, "src/theme-colors.ts")).href
);
for (const builtin of terminals === undefined ? [] : [fabrika, fabrikaLight]) {
	const terminal = terminals === undefined ? builtin.terminal : hexes(terminals[builtin.look]);
	const theme = {...builtin, colors: colors[builtin.look], terminal};
	const file = `${theme.name}.toml`;
	const text = `# Generated by src/build/themes.ts. Never edit by hand.\n${stringify({format: 1, ...theme})}`;
	const decoded = decodeTheme(text, file);
	if (Result.isFailure(decoded)) {
		const {field, message} = decoded.failure;
		errors.push(`${file}: ${field}: ${message}`);
	} else generated.set(`themes/${file}`, text);
}
// The region is written where src/themes.ts exists: a copied package without it has nothing to fill.
const themesTs = join(root, "src/themes.ts");
if (terminals !== undefined && existsSync(themesTs)) {
	const written = withRegion(readFileSync(themesTs, "utf8"), terminalRegion(terminals));
	if (written === undefined)
		errors.push(
			"src/themes.ts: needs one // @generated terminal and one // @end generated terminal",
		);
	else generated.set("src/themes.ts", written);
}
const defaults = Result.getOrThrow(decodeThemeSettings(""));
const {schema, definitions} = Schema.toJsonSchemaDocument(Settings);
generated.set(
	"src/theme-settings.schema.json",
	`${JSON.stringify(
		{
			$schema: "https://json-schema.org/draft/2020-12/schema",
			...schema,
			...(Object.keys(definitions).length === 0 ? {} : {$defs: definitions}),
			default: {
				theme: defaults.pick,
				"theme-fix": defaults.policy.fix,
				"theme-contrast": defaults.policy.contrast,
			},
		},
		null,
		"\t",
	)}\n`,
);
if (errors.length === 0) {
	for (const [file, text] of generated) {
		const path = join(root, file);
		if (args.includes("--check")) {
			const now = existsSync(path) ? readFileSync(path, "utf8") : "";
			// Formatting does not change JSON data. The checked schema must still match exactly.
			const matches = file.endsWith(".json")
				? Result.getOrElse(
						Result.try(() => JSON.stringify(JSON.parse(now)) === JSON.stringify(JSON.parse(text))),
						() => false,
					)
				: now === text;
			if (!matches) errors.push(`${file}: differs from the generated theme data; run pnpm themes`);
		} else {
			mkdirSync(dirname(path), {recursive: true});
			writeFileSync(path, text);
		}
	}
}
for (const error of errors) console.error(error);
process.exitCode = errors.length === 0 ? 0 : 1;
