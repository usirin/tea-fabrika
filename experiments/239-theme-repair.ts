// Today's app, T343 PR 1, tests-owned calibration. No network or model calls.
// pnpm exec node experiments/239-theme-repair.ts --map     prepares the kept input themes
// pnpm exec node experiments/239-theme-repair.ts          measures using the real shared checker
// pnpm exec node experiments/239-theme-repair.ts --radix  measures all 300 token picks independently
// Reports go to runs/. Review before copying into fixtures/themes/calibration.json.
import {createHash} from "node:crypto";
import {mkdirSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import {dirname} from "node:path";
import {parse as parseToml, stringify} from "smol-toml";
import type {TokenFile} from "../packages/fabrika-design/src/build/schema.ts";

// Resolve the fixture package from itself, so this standalone script needs no root dependency.
const fixture = createRequire(new URL("../fixtures/themes/package.json", import.meta.url));
const {
	builtinColors,
	composite,
	flatten,
	importedColors,
	lab,
	ladder,
	positions,
	radixPick,
}: typeof import("@kampus/themes-fixture/laws") = fixture("@kampus/themes-fixture/laws");

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
const css = readFileSync(
	new URL("../packages/fabrika-design/src/tokens.css", import.meta.url),
	"utf8",
);
const builtin = {dark: builtinColors(css, "dark"), light: builtinColors(css, "light")};
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
	const colors = importedColors(candidate.look, bg, fg, palette, builtin[candidate.look]);
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
		colors,
		terminal: {foreground: fg, background: bg, cursor, selection, palette},
	};
};
const inputs = candidates.map(map);
const ugly = {
	format: 1,
	name: "unreadable-made-up",
	look: "dark" as const,
	colors: importedColors(
		"dark",
		"#777777",
		"#777777",
		Array.from({length: 16}, () => "#777777"),
		builtin.dark,
	),
	terminal: {
		foreground: "#777777",
		background: "#777777",
		cursor: "#777777",
		selection: "#777777",
		palette: Array.from({length: 16}, () => "#777777"),
	},
};
if (process.argv.includes("--radix")) {
	const {decodeToken} = await import("../packages/fabrika-design/src/build/schema.ts");
	const dir = new URL("../packages/fabrika-design/tokens/color/", import.meta.url);
	const tokens = new Map<string, TokenFile>();
	const hashes: Record<string, string> = {};
	for (const file of readdirSync(dir).sort()) {
		const bytes = readFileSync(new URL(file, dir));
		const decoded = decodeToken(file, parseToml(bytes.toString("utf8")));
		if (decoded._tag === "bad") throw new Error(decoded.errors.join("\n"));
		tokens.set(file.replace(/\.toml$/, ""), decoded.value);
		hashes[file] = createHash("sha256").update(bytes).digest("hex");
	}
	const radix = JSON.parse(
		readFileSync(new URL("./177-themes/schemes/radix-colors-3.0.0.json", import.meta.url), "utf8"),
	) as {
		scales: Record<string, Record<string, string[]>>;
	};
	const grays = ["gray", "mauve", "slate", "sage", "olive", "sand"];
	const accents = [
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
	];
	const looks = ["dark", "light"] as const;
	const picks = grays.flatMap((gray) =>
		accents.flatMap((accent) =>
			looks.map((look) => ({
				gray,
				accent,
				look,
				...radixPick(tokens, {gray, accent, look}, (scale, at, look) => {
					const n = Number(at.replace(/^a/, "")) - 1;
					if (scale === "black" || scale === "white") {
						const a = required([0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95][n]);
						return `${scale === "black" ? "#000000" : "#ffffff"}${Math.round(a * 255)
							.toString(16)
							.padStart(2, "0")}`;
					}
					return required(
						required(radix.scales[scale])[`${look}${at.startsWith("a") ? "A" : ""}`]?.[n],
					).toLowerCase();
				}),
			})),
		),
	);
	const failures = picks.filter((pick) => pick.failures.length > 0);
	const builtinChanges = picks
		.filter((pick) => pick.gray === "slate" && pick.accent === "indigo")
		.map((pick) => ({
			look: pick.look,
			changes: Object.entries(builtin[pick.look])
				.filter(([name, color]) => pick.colors[name] !== color)
				.map(([token, was]) => ({token, was, now: pick.colors[token]})),
		}));
	const report = {
		version: "radix-3.0.0",
		seed: 119120,
		providerFees: 0,
		tokens: hashes,
		passing: picks.length - failures.length,
		failing: failures.length,
		builtinChanges,
		picks,
	};
	const output = process.argv[process.argv.indexOf("--output") + 1];
	const file = process.argv.includes("--output") && output ? output : "runs/themes-radix.json";
	mkdirSync(dirname(file), {recursive: true});
	writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
	console.log(`${report.passing}/300 picks pass; ${report.failing} fail; report ${file}`);
	for (const pick of failures)
		console.log(
			`${pick.gray}/${pick.accent}/${pick.look}: ${pick.failures.map(({token, on}) => `${token} on ${on}`).join("; ")}`,
		);
} else if (process.argv.includes("--map")) {
	mkdirSync(new URL("mapped/", root), {recursive: true});
	for (const input of inputs)
		writeFileSync(new URL(`mapped/${input.name}.toml`, root), stringify(input));
	writeFileSync(
		new URL("mapped/unreadable-made-up.toml", root),
		`# Deliberately unreadable invented test input. It never sets the cap.\n${stringify(ugly)}`,
	);
	writeFileSync(
		new URL("mapped-hashes.json", root),
		`${JSON.stringify(
			[...inputs, ugly]
				.map(({name}) => ({
					file: `${name}.toml`,
					sha256: createHash("sha256")
						.update(readFileSync(new URL(`mapped/${name}.toml`, root)))
						.digest("hex"),
				}))
				.sort((a, b) => a.file.localeCompare(b.file)),
			null,
			2,
		)}\n`,
	);
	console.log("Prepared five mapped input themes and one explicitly invented input.");
	console.log(
		JSON.stringify(
			{note: ladder, computed: {dark: positions(builtin.dark), light: positions(builtin.light)}},
			null,
			2,
		),
	);
} else {
	const {Result} = await import("effect");
	const {decodeTheme} = await import("../packages/fabrika-design/src/theme.ts");
	const {check} = await import("../packages/fabrika-design/src/build/contrast.ts");
	const {pairs} = await import("../packages/fabrika-design/src/theme-contract.ts");
	const policy = {fix: "nudge", contrast: 4.5} as const;
	// The whole OKLCH lightness interval is available. This is an attempted algorithm
	// version, not a calibrated shipping policy until all five inputs finish.
	const version = {version: "1", cap: 1};
	const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
	const mapped = (input: {name: string}) => {
		const bytes = readFileSync(new URL(`mapped/${input.name}.toml`, root));
		const written = parseToml(bytes.toString("utf8"));
		if (JSON.stringify(written) !== JSON.stringify(input))
			throw new Error(`mapped/${input.name}.toml differs from the mapping oracle; run --map`);
		return {
			input: Result.getOrThrow(decodeTheme(bytes.toString("utf8"), `${input.name}.toml`)),
			sha256: hash(bytes),
		};
	};
	const measure = (input: (typeof inputs)[number] | typeof ugly) => {
		const {input: written, sha256} = mapped(input);
		try {
			return {name: input.name, sha256, result: check(written, pairs, policy, version)};
		} catch (cause) {
			return {
				name: input.name,
				sha256,
				error: cause instanceof Error ? cause.message : "checker failed",
			};
		}
	};
	const initial = inputs.map(measure);
	const unreadable = measure(ugly);
	const moves = initial
		.flatMap(({name, result}) =>
			(result?.changes ?? [])
				.filter((c) => c._tag === "moved")
				.map((c) => ({
					theme: name,
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
	const common = {
		policy,
		seed: 119120,
		providerFees: 0,
		builtinCssSha256: hash(css),
		ladder: {
			note: ladder,
			computed: {dark: positions(builtin.dark), light: positions(builtin.light)},
		},
		pairs,
		attemptedVersion: version.version,
		uncapped: initial,
	};
	const setsCap = moves.at(-1);
	const errors = [...initial, unreadable].filter(({error}) => error !== undefined);
	let report;
	if (errors.length > 0 || setsCap === undefined) {
		report = {
			status: "unmeasured",
			reason:
				errors.length > 0
					? `The shared checker cannot finish all six inputs: ${errors.map(({name, error}) => `${name}: ${error}`).join("; ")}. No cap, pair or repair version can be pinned from an incomplete pass.`
					: "The five real themes produced no finite minimal lightness move; no cap can be measured.",
			...common,
			moves,
			unreadable,
		};
	} else {
		const cap = setsCap.move;
		if (!Number.isFinite(cap)) throw new Error("no finite measured cap");
		const themes = inputs.map((input) => {
			const written = mapped(input).input;
			return {
				name: input.name,
				from: written.from,
				result: check(written, pairs, policy, {...version, cap}),
			};
		});
		const invented = {
			name: ugly.name,
			result: check(mapped(ugly).input, pairs, policy, {...version, cap}),
		};
		report = {
			status: "measured",
			...common,
			version: version.version,
			cap,
			setsCap,
			moves,
			themes,
			unreadable: invented,
			// Final 8-bit drawn colors, including alpha. Every required pair stays visible.
			rendered: [...themes, invented].map(({name, result}) => ({
				name,
				pairs: pairs.map(({token, on}) => {
					const color = (theme: typeof result.written, key: string) =>
						key === "cursor"
							? theme.terminal.cursor
							: key === "terminal.background"
								? theme.terminal.background
								: required(theme.colors[key as keyof typeof theme.colors]);
					const background = flatten(
						on
							.split("/")
							.reverse()
							.map((key) => color(result.written, key)),
					);
					return {
						token,
						on,
						background,
						was: composite(color(result.written, token), background),
						now: composite(color(result.shown, token), background),
					};
				}),
			})),
		};
	}
	const output = process.argv[process.argv.indexOf("--output") + 1];
	const file = process.argv.includes("--output") && output ? output : "runs/themes-repair.json";
	mkdirSync(dirname(file), {recursive: true});
	writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
	console.log(
		report.status === "measured"
			? `Measured ${inputs.length} real themes; cap ${report.cap}; report ${file}`
			: `Unmeasured: ${report.reason} Report: ${file}`,
	);
	process.exitCode = report.status === "measured" ? 0 : 1;
}
