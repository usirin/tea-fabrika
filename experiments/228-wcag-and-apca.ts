// Experiment 228: today's color pairs against WCAG 2.2 and APCA (apca-w3 0.1.9).
//
//   (cd experiments/228-wcag-and-apca && pnpm install --ignore-workspace)   # once
//   nice -n 15 node experiments/228-wcag-and-apca.ts
//
// Reads results/228-wcag-and-apca-pairs.jsonl: the pairs that
// packages/fabrika-design/src/themes.test.ts and apps/fabrika/src/window/colors.test.ts pass to
// their `under` check, with each test's floor as `bar` (4.5 for text, 3 for non-text). Adds the
// dark hovered-turn exception (ticket 153). Composites a see-through color over its ground as the
// tests do, then scores WCAG's ratio and APCA's Lc. Floors: text 4.5:1 and Lc 60, non-text 3:1
// and Lc 30. Writes results/228-wcag-and-apca.md. No model, no network, $0.
import {readFileSync, writeFileSync} from "node:fs";
import {createRequire} from "node:module";

const require = createRequire(new URL("./228-wcag-and-apca/package.json", import.meta.url));
const {APCAcontrast, sRGBtoY} = require("apca-w3") as {
	APCAcontrast: (text: number, ground: number) => number;
	sRGBtoY: (rgb: number[]) => number;
};

type Pair = {file: string; name: string; fg: string; bg: string; bar: number};
type Scored = Pair & {
	look: "dark" | "light";
	kind: "text" | "non-text";
	wcag: number;
	lc: number;
	wOk: boolean;
	aOk: boolean;
	lc75: boolean;
};

const here = new URL("./results/", import.meta.url);
const rgba = (h: string): number[] => {
	const at = (i: number) => Number.parseInt(h.slice(i, i + 2), 16) / 255;
	return [at(1), at(3), at(5), h.length === 9 ? at(7) : 1];
};
const ground = (h: string) =>
	rgba(h)
		.slice(0, 3)
		.map((c) => Math.round(c * 255));
const over = (top: string, under: number[]) => {
	const [r, g, b, a] = rgba(top);
	return [r, g, b].map((x, i) => Math.round(x * a * 255 + under[i] * (1 - a)));
};
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]: number[]) =>
	0.2126 * lin(r / 255) + 0.7152 * lin(g / 255) + 0.0722 * lin(b / 255);

const rows: Pair[] = readFileSync(new URL("228-wcag-and-apca-pairs.jsonl", here), "utf8")
	.trim()
	.split("\n")
	.map((l) => JSON.parse(l) as Pair);
rows.push({
	file: "src/themes.test.ts",
	name: "--turn-fg on --turn-fill-hover (known exception, ticket 153)",
	fg: "#ffffff",
	bg: "#5472e4",
	bar: 4.5,
});

const seen = new Set<string>();
const out: Scored[] = [];
for (const r of rows) {
	const key = [r.name, r.fg, r.bg, r.bar].join("|");
	if (seen.has(key)) continue;
	seen.add(key);
	const b = ground(r.bg);
	const ink = over(r.fg, b);
	const [hi, lo] = [lum(ink), lum(b)].sort((x, y) => y - x);
	const wcag = (hi + 0.05) / (lo + 0.05);
	const lc = Math.abs(APCAcontrast(sRGBtoY(ink), sRGBtoY(b)));
	const text = r.bar === 4.5;
	out.push({
		...r,
		look: lum(b) < 0.18 ? "dark" : "light",
		kind: text ? "text" : "non-text",
		wcag,
		lc,
		wOk: wcag >= r.bar,
		aOk: lc >= (text ? 60 : 30),
		lc75: lc >= 75,
	});
}

const count = (xs: Scored[], f: (o: Scored) => boolean) => xs.filter(f).length;
const sum = (xs: Scored[], kind: string) =>
	`${kind}: ${xs.length} pairs; WCAG fail ${count(xs, (o) => !o.wOk)}; APCA fail ${count(xs, (o) => !o.aOk)}; both pass ${count(xs, (o) => o.wOk && o.aOk)}; pass WCAG but fail APCA ${count(xs, (o) => o.wOk && !o.aOk)}${kind === "text" ? `; reach Lc 75 ${count(xs, (o) => o.lc75)}` : ""}`;
const line = (o: Scored) =>
	`| ${o.file} | ${o.look} | ${o.kind} | ${o.name} | ${o.fg} | ${o.bg} | ${o.wcag.toFixed(2)} | ${o.lc.toFixed(1)} | ${o.wOk ? "pass" : "FAIL"} | ${o.aOk ? "pass" : "FAIL"} |`;
const head =
	"| test | look | kind | pair | fg | bg | WCAG | Lc | WCAG | APCA |\n|---|---|---|---|---|---|---|---|---|---|";
const text = out.filter((o) => o.kind === "text");
const other = out.filter((o) => o.kind !== "text");
const gap = out.filter((o) => o.wOk && !o.aOk).sort((a, b) => a.lc - b.lc);

writeFileSync(
	new URL("228-wcag-and-apca.md", here),
	`# WCAG 2.2 and APCA on today's pairs\n\nWritten by experiments/228-wcag-and-apca.ts.\n\n- ${sum(text, "text")}\n- ${sum(other, "non-text")}\n\n## Pass WCAG, fail APCA\n\n${head}\n${gap.map(line).join("\n")}\n\n## All pairs\n\n${head}\n${out.map(line).join("\n")}\n`,
);
console.log(sum(text, "text"));
console.log(sum(other, "non-text"));
