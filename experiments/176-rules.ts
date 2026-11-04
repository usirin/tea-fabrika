// Experiment 176, pick 10: oxlint's other React rules on every window file of today's version, each
// finding read by hand. The verdicts below are that reading. A finding no verdict covers prints as
// "unread", so a later change cannot slip past the reading. No window, no key, $0.
//
//   node experiments/176-rules.ts
//
// Writes experiments/results/176-rules.jsonl, one row per finding but the 1003-odd of
// react-in-jsx-scope, which are counted. Changes no lint setting.

import {execFileSync, spawnSync} from "node:child_process";
import {mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

const root = join(import.meta.dirname, "..");
process.chdir(root);

type Verdict = "true" | "false";
interface Read {
	readonly verdict: Verdict;
	readonly why: string;
}

const ALL = (verdict: Verdict, why: string) => (): Read => ({verdict, why});

/** The reading: what each finding was, by rule, with the few that differ inside a rule. */
const READING: Record<string, (file: string, text: string) => Read> = {
	"react(react-in-jsx-scope)": ALL("false", "this repo uses the automatic JSX runtime"),
	"react(no-unescaped-entities)": ALL("false", "an apostrophe in prose renders as written"),
	"react(no-array-index-key)": ALL(
		"false",
		"pieces cut fresh from one string or a fixed list; no state, and they never move",
	),
	"react(exhaustive-effect-dependencies)": ALL(
		"false",
		"a dep kept on purpose as the trigger, or a helper that only touches refs and setters",
	),
	"react(display-name)": ALL(
		"true",
		"memo around an arrow has no name in the devtools; the format step turned the named function into one",
	),
	"react(purity)": ALL(
		"true",
		"Date.now or Math.random in a render; a cached render would keep it",
	),
	"react(refs)": ALL("true", "reads a ref in render; useId is the plain answer"),
	"react(immutability)": ALL(
		"true",
		"a counter of the render's changed in a callback: harmless today, and the Compiler gives up on it",
	),
	"react(set-state-in-effect)": (file) =>
		file.endsWith("frame.tsx")
			? {
					verdict: "false",
					why: "the clock starts right when it starts moving; one extra render, on purpose",
				}
			: {verdict: "true", why: "hides a tip when a prop says so: derivable in render"},
	"react-perf(jsx-no-new-array-as-prop)": (_file, text) =>
		text.includes("edges=")
			? {verdict: "true", why: "React Flow takes a new edge list on every render of the map"}
			: {verdict: "false", why: "the child is not memoized: nothing to skip"},
	"react-perf(jsx-no-new-function-as-prop)": ALL(
		"false",
		"a DOM element, or a child that is not memoized: nothing to skip",
	),
	"react-perf(jsx-no-new-object-as-prop)": ALL(
		"false",
		"a style on a DOM element, or a child that is not memoized: nothing to skip",
	),
};

const list = JSON.parse(
	execFileSync("pnpm", ["exec", "oxlint", "--rules", "-f", "json"], {
		encoding: "utf8",
		maxBuffer: 2 ** 26,
	}),
);
const today = readFileSync(".oxlintrc.json", "utf8");
const rules: Record<string, string> = {};
const offRules: string[] = [];
for (const r of list) {
	if (r.scope !== "react" && r.scope !== "react_perf") continue;
	if (!["correctness", "suspicious", "perf", "pedantic"].includes(r.category)) continue;
	const name = `${r.scope === "react_perf" ? "react-perf" : "react"}/${r.value}`;
	if (today.includes(`"${name}"`)) continue;
	rules[name] = "warn";
	offRules.push(name);
}
const config = join(mkdtempSync(join(tmpdir(), "fabrika-176-rules-")), "react.json");
writeFileSync(
	config,
	JSON.stringify({plugins: ["react", "react-perf"], categories: {correctness: "off"}, rules}),
);
const files = execFileSync(
	"git",
	["ls-files", "--cached", "--others", "--exclude-standard", "*.tsx"],
	{encoding: "utf8"},
)
	.trim()
	.split("\n")
	.filter((f) => !f.endsWith(".test.tsx") && /^(apps|programs)\//.test(f));
const out = spawnSync("pnpm", ["exec", "oxlint", "-c", config, "-f", "json", ...files], {
	encoding: "utf8",
	maxBuffer: 2 ** 28,
}).stdout;
const found = JSON.parse(out.slice(out.indexOf("{"))).diagnostics;

const sources = new Map<string, readonly string[]>();
const lineOf = (file: string, n: number) => {
	if (!sources.has(file)) sources.set(file, readFileSync(file, "utf8").split("\n"));
	return sources.get(file)?.[n - 1]?.trim() ?? "";
};

const tally = new Map<string, {findings: number; right: number; wrong: number; unread: number}>();
const rows: string[] = [];
for (const d of found) {
	const line = d.labels?.[0]?.span?.line ?? 0;
	const text = lineOf(d.filename, line);
	const read = READING[d.code]?.(d.filename, text) ?? null;
	const t = tally.get(d.code) ?? {findings: 0, right: 0, wrong: 0, unread: 0};
	t.findings += 1;
	if (read === null) t.unread += 1;
	else if (read.verdict === "true") t.right += 1;
	else t.wrong += 1;
	tally.set(d.code, t);
	if (d.code !== "react(react-in-jsx-scope)")
		rows.push(
			JSON.stringify({
				rule: d.code,
				file: d.filename,
				line,
				text: text.slice(0, 100),
				verdict: read?.verdict ?? "unread",
				why: read?.why ?? "",
			}),
		);
}
writeFileSync("experiments/results/176-rules.jsonl", `${rows.join("\n")}\n`);
const named = new Set([...tally.keys()].map((c) => c.replace("(", "/").replace(")", "")));
console.log(`${files.length} files, ${offRules.length} rules tried`);
console.table(
	Object.fromEntries(
		[...tally].map(([code, t]) => [
			code,
			{...t, falseAlarmPct: Math.round((t.wrong / t.findings) * 100)},
		]),
	),
);
console.log(`no finding: ${offRules.filter((r) => !named.has(r)).join(" ")}`);
