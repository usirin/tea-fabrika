// Today's app, T343 PR 1, tests-owned calibration. No network or model calls.
// node experiments/239-theme-repair.ts --map     prepares the kept input themes
// node experiments/239-theme-repair.ts          measures using the real shared checker
// Raw measurements go to runs/. Copy a reviewed summary into fixtures/themes/calibration.json.
import {createHash} from "node:crypto";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import {dirname, join} from "node:path";
import {stringify} from "smol-toml";
import {lab, mix, wcag} from "../fixtures/themes/laws.ts";

const require = createRequire(new URL("../oxlint-plugins/package.json", import.meta.url));
const {parse} = require("yaml") as {
	parse: (text: string) => {
		name: string;
		author?: string;
		variant: "dark" | "light";
		palette: Record<string, string>;
	};
};
const root = new URL("../fixtures/themes/", import.meta.url);
const candidates = [
	{file: "base16-nord.yaml", name: "nord", kind: "base16", look: "dark"},
	{file: "base16-solarized-light.yaml", name: "solarized-light", kind: "base16", look: "light"},
	{file: "base24-catppuccin-mocha.yaml", name: "catppuccin-mocha", kind: "base24", look: "dark"},
	{file: "ghostty-Dracula", name: "dracula", kind: "ghostty", look: "dark"},
	{file: "ghostty-Catppuccin_Latte", name: "catppuccin-latte", kind: "ghostty", look: "light"},
] as const;
const required = <A>(value: A | undefined): A => {
	if (value === undefined) throw new Error("fixture is missing a required value");
	return value;
};
const normalize = (c: string) => `#${c.replace(/^#/, "").toLowerCase()}`;
const ladder = {
	dark: {desk: -0.026, raised: 0.045, hover: 0.096, edge: 0.136, focus: 0.403, faint: 0.766},
	light: {desk: 0.012, raised: 0, hover: 0.059, edge: 0.091, focus: 0.467, faint: 0.656},
};
const map = (candidate: (typeof candidates)[number]) => {
	const bytes = readFileSync(new URL(`source/${candidate.file}`, root));
	const text = bytes.toString("utf8");
	let palette: string[],
		fg: string,
		bg: string,
		cursor: string,
		selection: string,
		by: string | undefined;
	if (candidate.kind === "ghostty") {
		const fields = new Map(
			text.split(/\r?\n/).map((line) => {
				const at = line.indexOf("=");
				return [line.slice(0, at).trim(), line.slice(at + 1).trim()] as const;
			}),
		);
		palette = text
			.split(/\r?\n/)
			.filter((line) => line.startsWith("palette = "))
			.map((line) => normalize(line.slice(line.lastIndexOf("=") + 1)));
		fg = normalize(required(fields.get("foreground")));
		bg = normalize(required(fields.get("background")));
		cursor = normalize(fields.get("cursor-color") ?? fg);
		selection = normalize(fields.get("selection-background") ?? bg);
	} else {
		const yaml = parse(text),
			base = Object.fromEntries(
				Object.entries(yaml.palette).map(([key, value]) => [key.toLowerCase(), normalize(value)]),
			);
		palette = [
			"00",
			"08",
			"0b",
			"0a",
			"0d",
			"0e",
			"0c",
			"05",
			"03",
			...(candidate.kind === "base24"
				? ["12", "14", "13", "16", "17", "15"]
				: ["08", "0b", "0a", "0d", "0e", "0c"]),
			"07",
		].map((n) => required(base[`base${n}`]));
		fg = required(base["base05"]);
		bg = required(base["base00"]);
		cursor = fg;
		selection = required(base["base02"]);
		by = yaml.author;
	}
	const colors = {
		...Object.fromEntries(
			Object.entries(ladder[candidate.look]).map(([key, t]) => [key, mix(bg, fg, t)]),
		),
		ground: bg,
		text: fg,
		"turn-fill": required(palette[4]),
		"turn-text": required(palette[4]),
		"on-turn":
			wcag("#ffffff", required(palette[4])) >= wcag("#000000", required(palette[4]))
				? "#ffffff"
				: "#000000",
		done: required(palette[2]),
		running: required(palette[3]),
		stuck: required(palette[1]),
	};
	const metadata = {
		file: candidate.file,
		sha256: createHash("sha256").update(bytes).digest("hex"),
		...(by === undefined ? {} : {by}),
	};
	return {
		format: 1,
		name: candidate.name,
		look: candidate.look,
		from: {[candidate.kind]: metadata},
		colors: {...colors, closed: colors["faint"]},
		terminal: {foreground: fg, background: bg, cursor, selection, palette},
	};
};
const inputs = candidates.map(map);
if (process.argv.includes("--map")) {
	mkdirSync(new URL("mapped/", root), {recursive: true});
	for (const input of inputs)
		writeFileSync(new URL(`mapped/${input.name}.toml`, root), stringify(input));
	const madeUp = structuredClone(required(inputs[0]));
	const ugly = {
		...madeUp,
		name: "unreadable-made-up",
		from: undefined,
		colors: Object.fromEntries(Object.keys(madeUp.colors).map((key) => [key, "#777777"])),
		terminal: {
			foreground: "#777777",
			background: "#777777",
			cursor: "#777777",
			selection: "#777777",
			palette: Array.from({length: 16}, () => "#777777"),
		},
	};
	delete ugly.from;
	writeFileSync(
		new URL("mapped/unreadable-made-up.toml", root),
		`# Deliberately unreadable invented test input. It never sets the cap.\n${stringify(ugly)}`,
	);
	console.log("Prepared five mapped input themes and one explicitly invented input.");
} else {
	const {check} = await import("../packages/fabrika-design/src/build/contrast.ts");
	const {pairs} = await import("../packages/fabrika-design/src/theme-contract.ts");
	const policy = {fix: "nudge", contrast: 4.5} as const;
	const version = {version: "1", cap: 1};
	const initial = inputs.map((input) => ({input, result: check(input, pairs, policy, version)}));
	const moves = initial
		.flatMap(({input, result}) =>
			result.changes
				.filter((c) => c._tag === "moved")
				.map((c) => ({
					theme: input.name,
					token: c.token,
					on: c.on,
					move: Math.abs(lab(c.now)[0] - lab(c.was)[0]),
					was: c.was,
					now: c.now,
					from: c.from,
					to: c.to,
				})),
		)
		.sort((a, b) => a.move - b.move);
	if (initial.some(({result}) => result.changes.some((c) => c._tag === "builtin")))
		throw new Error("uncapped pass substituted a value");
	const cap = moves.at(-1)?.move;
	if (cap === undefined || !Number.isFinite(cap)) throw new Error("no finite measured cap");
	const report = {
		version: version.version,
		cap,
		setsCap: moves.at(-1),
		policy,
		moves,
		themes: inputs.map((input) => ({
			name: input.name,
			from: input.from,
			result: check(input, pairs, policy, {...version, cap}),
		})),
	};
	const output = process.argv[process.argv.indexOf("--output") + 1];
	const file = process.argv.includes("--output") && output ? output : "runs/themes-repair.json";
	mkdirSync(dirname(file), {recursive: true});
	writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
	console.log(
		`Measured ${inputs.length} real themes; cap ${cap}; report ${join(dirname(file), "themes-repair.json")}`,
	);
}
