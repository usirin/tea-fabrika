import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {join} from "node:path";

// Experiment 177: shared theme files, read into the one shape the page decodes
// (apps/fabrika/src/window/theme.ts in the spike). Three formats nobody here invented: Base16,
// Base24 (the Tinted Theming scheme files) and Ghostty's theme file. Each reader is a pure
// function of the file's text. The page refuses what these make if it is not hex colors.

const norm = (hex: string): string => {
	const low = hex.trim().toLowerCase();
	const six = low.startsWith("#") ? low : `#${low}`;
	if (!/^#[0-9a-f]{6}$/.test(six)) throw new Error(`not a color: ${hex}`);
	return six;
};

const sha = (text: string) => `sha256-${createHash("sha256").update(text).digest("hex")}`;

/** The two flat shapes of a Tinted Theming scheme: top-level words, and its palette map. */
const readScheme = (text: string) => {
	const word = (key: string) => {
		const found = new RegExp(`^${key}:\\s*"?([^"\\n#]*)"?`, "m").exec(text);
		return found?.[1]?.trim() ?? "";
	};
	const base: Record<string, string> = {};
	for (const m of text.matchAll(/^\s+(base[0-9A-Fa-f]{2}):\s*"(#?[0-9a-fA-F]{6})"/gm)) {
		if (m[1] !== undefined && m[2] !== undefined) base[m[1]] = norm(m[2]);
	}
	return {
		system: word("system"),
		name: word("name"),
		by: word("author"),
		variant: word("variant"),
		base,
	};
};

const need = (base: Record<string, string>, key: string): string => {
	const hex = base[key];
	if (hex === undefined) throw new Error(`the scheme has no ${key}`);
	return hex;
};

/**
 * Base16 or Base24 to a theme. The roles are the styling guide's own: base00 the ground, base05 the
 * ink, base08 red, base0A yellow, base0B green, base0C cyan, base0D blue, base0E magenta. Base24
 * adds the bright six; Base16 repeats the plain ones, as base16-shell does.
 */
export const fromTinted = (text: string) => {
	const s = readScheme(text);
	const b = (key: string) => need(s.base, key);
	const bright = (key: string, plain: string) => s.base[key] ?? b(plain);
	return {
		format: 1,
		name: s.name,
		by: s.by.slice(0, 200),
		look: s.variant === "light" ? "light" : "dark",
		from: {format: s.system === "base24" ? "base24" : "base16", hash: sha(text)},
		ground: b("base00"),
		ink: b("base05"),
		turn: b("base0D"),
		done: b("base0B"),
		running: b("base0A"),
		stuck: b("base08"),
		// The app's own order: amber, blue, teal, violet, rose, green.
		lines: [b("base0A"), b("base0D"), b("base0C"), b("base0E"), b("base08"), b("base0B")],
		services: [b("base0D"), b("base0E"), b("base0C"), b("base0F"), b("base0B"), b("base09")],
		tint: 30,
		terminal: {
			foreground: b("base05"),
			background: b("base00"),
			cursor: b("base05"),
			selectionBackground: b("base02"),
			selectionForeground: b("base05"),
			palette: [
				b("base00"),
				b("base08"),
				b("base0B"),
				b("base0A"),
				b("base0D"),
				b("base0E"),
				b("base0C"),
				b("base05"),
				b("base03"),
				bright("base12", "base08"),
				bright("base14", "base0B"),
				bright("base13", "base0A"),
				bright("base16", "base0D"),
				bright("base17", "base0E"),
				bright("base15", "base0C"),
				b("base07"),
			],
		},
	};
};

/** A Ghostty theme file, keeping only its color keys. Any other key in the file is left out. */
export const fromGhostty = (name: string, text: string, look: "dark" | "light") => {
	const keys: Record<string, string> = {};
	const palette: string[] = [];
	for (const line of text.split("\n")) {
		const entry = /^palette\s*=\s*(\d+)=(#?[0-9a-fA-F]{6})\s*$/.exec(line);
		if (entry?.[1] !== undefined && entry[2] !== undefined) {
			palette[Number(entry[1])] = norm(entry[2]);
			continue;
		}
		const kv = /^([a-z-]+)\s*=\s*(#?[0-9a-fA-F]{6})\s*$/.exec(line);
		if (kv?.[1] !== undefined && kv[2] !== undefined) keys[kv[1]] = norm(kv[2]);
	}
	const p = (i: number) => {
		const hex = palette[i];
		if (hex === undefined) throw new Error(`the file has no palette ${i}`);
		return hex;
	};
	const key = (k: string) => need(keys, k);
	return {
		format: 1,
		name,
		by: "iTerm2-Color-Schemes",
		look,
		from: {format: "ghostty", hash: sha(text)},
		ground: key("background"),
		ink: key("foreground"),
		turn: p(4),
		done: p(2),
		running: p(3),
		stuck: p(1),
		lines: [p(3), p(4), p(6), p(5), p(1), p(2)],
		services: [p(4), p(5), p(6), p(13), p(2), p(11)],
		tint: 30,
		terminal: {
			foreground: key("foreground"),
			background: key("background"),
			cursor: keys["cursor-color"] ?? key("foreground"),
			selectionBackground: keys["selection-background"] ?? p(8),
			selectionForeground: keys["selection-foreground"] ?? key("foreground"),
			palette: Array.from({length: 16}, (_, i) => p(i)),
		},
	};
};

const at = (file: string) => readFileSync(join(import.meta.dirname, "schemes", file), "utf8");

/** The themes the run swaps between: real shared files, as downloaded. */
export const THEMES = {
	mocha: fromTinted(at("base24-catppuccin-mocha.yaml")),
	solarized: fromTinted(at("base16-solarized-light.yaml")),
	nord: fromTinted(at("base16-nord.yaml")),
	dracula: fromGhostty("Dracula", at("ghostty-Dracula"), "dark"),
	latte: fromGhostty("Catppuccin Latte", at("ghostty-Catppuccin_Latte"), "light"),
};

/** Not a shared file: a theme made to be unreadable, every color near one gray. */
const G = "#808080";
const H = "#858585";
export const UNREADABLE = {
	format: 1,
	name: "Unreadable on purpose",
	by: "experiment 177",
	look: "dark",
	from: {format: "fabrika", hash: sha("unreadable")},
	ground: G,
	ink: H,
	turn: H,
	done: H,
	running: H,
	stuck: H,
	lines: [H, H, H, H, H, H],
	services: [H, H, H, H, H, H],
	tint: 30,
	terminal: {
		foreground: H,
		background: G,
		cursor: H,
		selectionBackground: H,
		selectionForeground: G,
		palette: Array.from({length: 16}, () => H),
	},
};
