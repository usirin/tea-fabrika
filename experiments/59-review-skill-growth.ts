// How did fabrika's review skill get so big? This reads the whole history of
// its text out of git: the four old review gates (one page each) and the merged
// skill that replaced them (a page, a command manual, three rubrics and an
// agent file). It prints the size after every commit, the weeks it grew, the
// commits that made it smaller, and what the text at one commit is made of.
//
// Run with
//   node experiments/59-review-skill-growth.ts <a full-history clone of kamp-us/phoenix>
//
//   (no clone)   print the tables from the saved answers: no git, no network
//   <clone>      read git and write the saved answers again. A bare clone is
//                fine. Read-only: `log`, `show`, `blame`, `rev-parse`. CLONE=
//                works too
//
// The clone has to hold the whole history. A shallow one cuts the answer short.
// The script says so in its first lines, prints what it can, and saves nothing.
//
// `59-readings.json` holds what was sorted by hand: a cause for each commit to
// the merged skill, a pile for every line of the text, and the rules found in
// more than one place. `results/review-skill-growth.json` holds every number.
// Neither holds a person's name: commits are counted, and a co-author line is
// only matched, never kept.
//
// The last tables are about this repo itself, read from its own git history at
// TEA_REV (default HEAD).
import {spawnSync} from "node:child_process";
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {REVIEW_NAMES} from "@kampus/pipeline/stages/review/outcome";

const here = import.meta.dirname;
const root = join(here, "..");
const CLONE = process.argv[2] ?? process.env.CLONE ?? "";
const TEA_REV = process.env.TEA_REV ?? "HEAD";
const resultsFile = join(here, "results", "review-skill-growth.json");
const readingsFile = join(here, "59-readings.json");

/** The commit of the plugin's repo whose text is studied. */
const COMMIT = "0ac2c6bfc342b8d18918b78150a8b95c43233496";
/** The commit that deleted the four old gates. Their history is read from its parent. */
const RETIRED = "f38a49b2";
/** The commit the merged skill was born in. */
const BORN = "5f23d08b";
/** A sweep that rewrote most references in the text. Marks are counted on both sides of it. */
const SWEEP = "47d44111";
const WEEK = 7 * 24 * 3600;

/** A file whose history is followed, with every place it has lived, newest first. */
interface Tracked {
	readonly name: string;
	readonly paths: readonly string[];
}
const oldGate = (gate: string): Tracked => ({
	name: `${gate}/SKILL.md`,
	paths: [
		`claude-plugins/kampus-pipeline/skills/${gate}/SKILL.md`,
		`skills/${gate}/SKILL.md`,
		`.claude/skills/${gate}/SKILL.md`,
	],
});
const OLD: readonly Tracked[] = ["review-code", "review-doc", "review-skill", "review-trivial"].map(
	oldGate,
);
const SKILL = "claude-plugins/fabrika/skills/review";
const MERGED: readonly Tracked[] = [
	{name: "SKILL.md", paths: [`${SKILL}/SKILL.md`]},
	{name: "contract.md", paths: [`${SKILL}/contract.md`]},
	{name: "rubrics/code.md", paths: [`${SKILL}/rubrics/code.md`]},
	{name: "rubrics/doc.md", paths: [`${SKILL}/rubrics/doc.md`]},
	{name: "rubrics/skill.md", paths: [`${SKILL}/rubrics/skill.md`]},
	{name: "agents/reviewer.md", paths: ["claude-plugins/fabrika/agents/reviewer.md"]},
];

// ---------------------------------------------------------------- small tools

const pct = (n: number, of: number) => (of === 0 ? "" : `${((100 * n) / of).toFixed(1)}%`);
const share = (n: number, of: number) => `${n} (${pct(n, of)})`;
const sum = (ns: readonly number[]) => ns.reduce((a, b) => a + b, 0);
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const short = (text: string, most: number) =>
	text.length > most ? `${text.slice(0, most - 1)}…` : text;
/** A commit title as a table cell: no pipes, and no reference that would link somewhere by accident. */
const cell = (text: string) => short(text.replaceAll("|", "/"), 90);
function table(
	title: string,
	head: readonly string[],
	rows: readonly (readonly (string | number)[])[],
): void {
	console.log(`\n${title}\n`);
	console.log(`| ${head.join(" | ")} |`);
	console.log(`|${head.map(() => "---").join("|")}|`);
	for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}
class Tally {
	readonly counts = new Map<string, number>();
	add(key: string, by = 1): void {
		this.counts.set(key, (this.counts.get(key) ?? 0) + by);
	}
	get(key: string): number {
		return this.counts.get(key) ?? 0;
	}
	get total(): number {
		return sum([...this.counts.values()]);
	}
	object(): Record<string, number> {
		return Object.fromEntries([...this.counts].sort((a, b) => b[1] - a[1]));
	}
}
const linesOf = (text: string) =>
	text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
/** The day a commit landed, in UTC, from its commit time in seconds. */
const dayOf = (at: number) => new Date(at * 1000).toISOString().slice(0, 10);

/** Git in a repo, read-only. `null` when the command fails: a path that is not there, mostly. */
function gitIn(repo: string, args: readonly string[]): string | null {
	const run = spawnSync("git", ["-C", repo, ...args], {
		encoding: "utf8",
		maxBuffer: 1024 * 1024 * 1024,
	});
	return run.status === 0 ? run.stdout : null;
}
function must(repo: string, args: readonly string[]): string {
	const out = gitIn(repo, args);
	if (out === null) throw new Error(`git ${args.join(" ")} failed`);
	return out;
}

// ---------------------------------------------------------------- what is saved

/** One commit's change to one file. */
interface Touch {
	readonly sha: string;
	readonly at: number;
	readonly date: string;
	readonly subject: string;
	readonly added: number;
	readonly removed: number;
	/** Lines in the file after the commit. */
	readonly lines: number;
}
interface FileHistory {
	readonly name: string;
	readonly touches: readonly Touch[];
	/** Commits git follows the file back into, from before it had its own name. */
	readonly before: number;
}
/** One commit's change to a whole generation of files. */
interface Step {
	readonly sha: string;
	readonly at: number;
	readonly date: string;
	readonly subject: string;
	readonly added: number;
	readonly removed: number;
	/** Lines in all the generation's files after the commit. */
	readonly total: number;
	readonly files: readonly string[];
	readonly agent: boolean;
}
interface Generation {
	readonly files: readonly FileHistory[];
	readonly steps: readonly Step[];
}
interface Marks {
	readonly at: string;
	readonly lines: number;
	readonly bytes: number;
	readonly marks: Record<string, number>;
}
interface PileRow {
	readonly file: string;
	readonly from: number;
	readonly to: number;
	readonly pile: string;
	readonly step: number;
	readonly tag: string;
	readonly lines: number;
}
interface OwnFile {
	readonly path: string;
	readonly commits: number;
	readonly shrinks: number;
	readonly first: {readonly date: string; readonly lines: number};
	readonly last: {readonly date: string; readonly lines: number};
}
interface OwnPrompt {
	readonly name: string;
	readonly file: string;
	readonly commits: number;
	readonly first: {readonly date: string; readonly chars: number};
	readonly last: {readonly date: string; readonly chars: number};
	readonly shrinks: number;
}
interface Saved {
	readonly commit: string;
	readonly shallow: boolean;
	readonly commitsInClone: number;
	readonly old: Generation;
	readonly merged: Generation;
	readonly marks: readonly Marks[];
	readonly blame: Record<string, Record<string, number>>;
	readonly piles: readonly PileRow[];
	readonly fileLines: Record<string, number>;
	readonly textChecks: readonly (readonly [string, string])[];
	readonly own: {
		readonly rev: string;
		readonly files: readonly OwnFile[];
		readonly prompts: readonly OwnPrompt[];
	};
}

// ---------------------------------------------------------------- the hand readings

interface Readings {
	readonly causes: {
		readonly bins: Record<string, string>;
		readonly gen2: Record<string, readonly [string, boolean, number]>;
	};
	readonly piles: {
		readonly bins: Record<string, string>;
		readonly tags: Record<string, string>;
		readonly files: Record<string, readonly (readonly [number, number, string, number, string?])[]>;
	};
	readonly repeats: {
		readonly rows: readonly {
			readonly rule: string;
			readonly places: readonly (readonly [string, number, number])[];
		}[];
	};
}
const readings = JSON.parse(readFileSync(readingsFile, "utf8")) as Readings;

// ---------------------------------------------------------------- reading git

const AGENT = /^co-authored-by:.*(anthropic|claude)/im;

/** Every commit that touched a file, oldest first, following it through its moves. */
function historyOf(repo: string, tip: string, file: Tracked): FileHistory {
	const log = must(repo, [
		"log",
		"--follow",
		"--format=%x01%H%x09%ct%x09%s",
		"--numstat",
		tip,
		"--",
		file.paths[0] ?? "",
	]);
	const touches: Touch[] = [];
	let before = 0;
	for (const chunk of log.split("\x01").slice(1).reverse()) {
		const [head = "", ...rest] = chunk.split("\n");
		const [sha = "", at = "0", ...subject] = head.split("\t");
		const stat = rest.find((line) => /^\d+\t\d+\t/.test(line)) ?? "0\t0\t";
		const [added = "0", removed = "0"] = stat.split("\t");
		const text = file.paths
			.map((path) => gitIn(repo, ["show", `${sha}:${path}`]))
			.find((found) => found !== null);
		if (text === undefined || text === null) {
			before += 1;
			continue;
		}
		touches.push({
			sha: sha.slice(0, 8),
			at: Number(at),
			date: dayOf(Number(at)),
			subject: subject.join("\t"),
			added: Number(added),
			removed: Number(removed),
			lines: linesOf(text),
		});
	}
	return {name: file.name, touches, before};
}

/** The files' histories folded into one line of commits, with the total after each. */
function generationOf(repo: string, tip: string, tracked: readonly Tracked[]): Generation {
	const files = tracked.map((file) => historyOf(repo, tip, file));
	const bySha = new Map<string, {touch: Touch; file: string}[]>();
	for (const file of files)
		for (const touch of file.touches) {
			const list = bySha.get(touch.sha) ?? [];
			list.push({touch, file: file.name});
			bySha.set(touch.sha, list);
		}
	const order = [...bySha.values()].sort((a, b) => (a[0]?.touch.at ?? 0) - (b[0]?.touch.at ?? 0));
	const now = new Map<string, number>();
	const steps: Step[] = [];
	for (const group of order) {
		const first = group[0];
		if (first === undefined) continue;
		for (const {touch, file} of group) now.set(file, touch.lines);
		const body = must(repo, ["show", "-s", "--format=%B", first.touch.sha]);
		steps.push({
			sha: first.touch.sha,
			at: first.touch.at,
			date: first.touch.date,
			subject: first.touch.subject,
			added: sum(group.map((g) => g.touch.added)),
			removed: sum(group.map((g) => g.touch.removed)),
			total: sum([...now.values()]),
			files: group.map((g) => g.file),
			agent: AGENT.test(body),
		});
	}
	return {files, steps};
}

const MARKS: Record<string, RegExp> = {
	"issue numbers": /#\d{3,5}\b/g,
	"decision record numbers": /\bADR[ -]?\d{3,4}\b/g,
	"the old version, by name (v1)": /\bv1\b/g,
	never: /\bnever\b/gi,
	"epic child": /epic child/gi,
	"another stage or the lane machine, by name":
		/\b(operate|lane prove|lane report|ship gate|ship scope|review-ui|heal-ci|build verdicts)\b/g,
};
function marksAt(repo: string, at: string, rev: string, tracked: readonly Tracked[]): Marks {
	const texts = tracked.map(
		(file) =>
			file.paths
				.map((path) => gitIn(repo, ["show", `${rev}:${path}`]))
				.find((found) => found !== null) ?? "",
	);
	const text = texts.join("\n");
	return {
		at,
		lines: sum(texts.map(linesOf)),
		bytes: sum(texts.map((one) => Buffer.byteLength(one))),
		marks: Object.fromEntries(
			Object.entries(MARKS).map(([name, pattern]) => [name, [...text.matchAll(pattern)].length]),
		),
	};
}

/** For each file, how many of today's lines were last touched by each commit. */
function blameOf(repo: string): Record<string, Record<string, number>> {
	const out: Record<string, Record<string, number>> = {};
	for (const file of MERGED) {
		const tally = new Tally();
		const blame = must(repo, ["blame", "--line-porcelain", COMMIT, "--", file.paths[0] ?? ""]);
		for (const line of blame.split("\n")) {
			const hit = /^([0-9a-f]{40}) \d+ \d+/.exec(line);
			if (hit) tally.add((hit[1] ?? "").slice(0, 8));
		}
		out[file.name] = tally.object();
	}
	return out;
}

/** The hand ranges laid over the text, with every line covered once. */
function pilesOf(repo: string): {rows: PileRow[]; fileLines: Record<string, number>} {
	const rows: PileRow[] = [];
	const fileLines: Record<string, number> = {};
	for (const file of MERGED) {
		const text = must(repo, ["show", `${COMMIT}:${file.paths[0] ?? ""}`]);
		const lines = text.split("\n").slice(0, linesOf(text));
		fileLines[file.name] = lines.length;
		const ranges = readings.piles.files[file.name] ?? [];
		let next = 1;
		ranges.forEach(([from, to, pile, step, tag], i) => {
			if (from < next || to < from || to > lines.length)
				throw new Error(`${file.name}: the range ${from}-${to} is out of order or out of the file`);
			for (let n = next; n < from; n++) {
				const gap = (lines[n - 1] ?? "").trim();
				if (gap !== "" && !gap.startsWith("#") && gap !== "---")
					throw new Error(`${file.name}: line ${n} is in no range and is not blank or a heading`);
			}
			// A blank line or a heading between two ranges goes with the one after it.
			const start = next;
			const end = i === ranges.length - 1 ? lines.length : to;
			for (let n = to + 1; n <= end; n++)
				if ((lines[n - 1] ?? "").trim() !== "")
					throw new Error(`${file.name}: line ${n} is after the last range and is not blank`);
			rows.push({
				file: file.name,
				from: start,
				to: end,
				pile,
				step,
				tag: tag ?? "",
				lines: end - start + 1,
			});
			next = to + 1;
		});
	}
	return {rows, fileLines};
}

/** Places where the text says a thing about itself that a count can check. */
function textChecksOf(repo: string, merged: Generation): (readonly [string, string])[] {
	const read = (name: string) => must(repo, ["show", `${COMMIT}:${SKILL}/${name}`]);
	const contract = read("contract.md");
	const skill = read("SKILL.md");
	const rows = contract.split("\n");
	const inventory = rows.filter((line) => /^\| `review [a-z-]+` \| /.test(line)).length;
	const sections = rows.filter((line) => /^## `review [a-z-]+`/.test(line)).length;
	const said = /All (\w+) verbs allocate/.exec(contract)?.[1] ?? "?";
	const matrixHead = rows.find((line) => line.startsWith("| Code | Meaning |")) ?? "";
	const matrix = new Set(
		rows
			.filter((line) => /^\| `\d+` \| .*(✓|—)/.test(line))
			.map((line) => /^\| `(\d+)`/.exec(line)?.[1] ?? ""),
	);
	// A code is "used" when a command's own exit table lists it, or the prose refuses "on" it.
	const used = new Set([...contract.matchAll(/\bon `(\d+)`/g)].map((hit) => hit[1] ?? ""));
	let inExitTable = false;
	for (const line of rows) {
		if (line.startsWith("| Code | Trigger |")) inExitTable = true;
		else if (line.trim() === "") inExitTable = false;
		const code = inExitTable ? /^\| `(\d+)` \| /.exec(line)?.[1] : undefined;
		if (code !== undefined) used.add(code);
	}
	const missing = [...used]
		.filter((code) => !matrix.has(code))
		.sort((a, b) => Number(a) - Number(b));
	const history = merged.files.find((file) => file.name === "contract.md")?.touches ?? [];
	const born = merged.steps[0];
	return [
		[
			`The commit that made the skill calls it "the ${/(\d+)-verb/.exec(born?.subject ?? "")?.[1] ?? "?"}-verb contract"`,
			`${sections} command sections in contract.md today`,
		],
		[
			`contract.md: "All ${said} verbs allocate from one internal table"`,
			`its own list of commands has ${inventory} rows, and its exit-code table has ${matrixHead.split("|").length - 4} command columns`,
		],
		[
			"contract.md: a code means one thing across the group, from one shared table",
			`codes used in the page and not in that table: ${missing.join(", ") || "none"}`,
		],
		[
			'contract.md, last section: the eval rule is "stated once, in SKILL.md\'s \\"Eval enumeration\\" section"',
			`SKILL.md has ${/eval enumeration/i.test(skill) ? "that section" : "no such section, and never says the words"}`,
		],
		[
			`contract.md, line 3: "Date: ${/\*\*Date:\*\* (\S+)/.exec(contract)?.[1] ?? "?"}"`,
			`${history.length} commits have changed the page; the last on ${history.at(-1)?.date ?? "?"}`,
		],
		[
			'contract.md, "The name situation": the four old gates "remain live" and nothing routes to this skill',
			`still in the text: ${/remain live project-level skills until the cutover/.test(contract) ? "yes" : "no"}. The old gates were deleted in ${RETIRED}`,
		],
		[
			'SKILL.md: "one lane\'s four verdicts"',
			`the same sentence lists ${["verdict-code", "verdict-doc", "verdict-skill"].filter((slug) => skill.includes(slug)).length} names for them`,
		],
	];
}

// ---------------------------------------------------------------- this repo itself

const OWN_FILES = [
	"src/stages/review/reviewer.ts",
	"src/stages/review/outcome.ts",
	"src/stages/review/sheet.ts",
	"src/stages/review/pack.ts",
	"src/claude.ts",
	"AGENTS.md",
	"docs/review-machine.md",
	"experiments/README.md",
	"docs/direction/README.md",
];
/** A prompt, as the source text from where it starts to where it ends. */
const OWN_PROMPTS: readonly {
	name: string;
	file: string;
	from: RegExp;
	to: RegExp;
}[] = [
	{
		name: "the builder's prompt",
		file: "src/claude.ts",
		from: /export function promptFor\(/,
		to: /\n}\n/,
	},
	{
		name: "the old reviewer's prompt",
		file: "src/claude.ts",
		from: /export function reviewPromptFor\(/,
		to: /\n}\n/,
	},
	{
		name: "the enricher's prompt",
		file: "src/claude.ts",
		from: /export function enrichPromptFor\(/,
		to: /\n}\n/,
	},
	{
		name: "the enricher's brief on data",
		file: "src/claude.ts",
		from: /const DATA_BRIEF = /,
		to: /\]\s*\.join\("\\n"\);/,
	},
	{
		name: "the new reviewer's prompt",
		file: "src/stages/review/reviewer.ts",
		from: /export function promptOf\(/,
		to: /\n}\n/,
	},
];
function ownOf(): Saved["own"] {
	const files = OWN_FILES.map((path): OwnFile => {
		const {touches} = historyOf(root, TEA_REV, {name: path, paths: [path]});
		const first = touches[0];
		const last = touches.at(-1);
		return {
			path,
			commits: touches.length,
			shrinks: touches.filter((touch) => touch.removed > touch.added).length,
			first: {date: first?.date ?? "", lines: first?.lines ?? 0},
			last: {date: last?.date ?? "", lines: last?.lines ?? 0},
		};
	});
	const prompts = OWN_PROMPTS.map(({name, file, from, to}): OwnPrompt => {
		const {touches} = historyOf(root, TEA_REV, {name: file, paths: [file]});
		const sizes: {date: string; chars: number}[] = [];
		for (const touch of touches) {
			const text = must(root, ["show", `${touch.sha}:${file}`]);
			const start = from.exec(text);
			if (!start) continue;
			const rest = text.slice(start.index);
			const end = to.exec(rest);
			const span = end ? rest.slice(0, end.index) : rest;
			sizes.push({date: touch.date, chars: span.replace(/\s+/g, "").length});
		}
		const changes = sizes.filter((size, i) => i > 0 && size.chars !== sizes[i - 1]?.chars);
		return {
			name,
			file,
			commits: changes.length + 1,
			first: sizes[0] ?? {date: "", chars: 0},
			last: sizes.at(-1) ?? {date: "", chars: 0},
			shrinks: sizes.filter((size, i) => i > 0 && size.chars < (sizes[i - 1]?.chars ?? 0)).length,
		};
	});
	return {rev: must(root, ["rev-parse", "--short", TEA_REV]).trim(), files, prompts};
}

// ---------------------------------------------------------------- compute or load

/** The four old gates, with the commit that deleted them as the last step. */
function oldGates(): Generation {
	const oldRead = generationOf(CLONE, `${RETIRED}^`, OLD);
	const end = must(CLONE, ["show", "-s", "--format=%ct%x09%s", RETIRED]).trim().split("\t");
	const last = oldRead.steps.at(-1);
	const gone = OLD.every((file) =>
		file.paths.every((path) => gitIn(CLONE, ["cat-file", "-e", `${RETIRED}:${path}`]) === null),
	);
	if (!gone) throw new Error(`${RETIRED} did not delete the old gates`);
	return {
		files: oldRead.files,
		steps: [
			...oldRead.steps,
			{
				sha: RETIRED,
				at: Number(end[0]),
				date: dayOf(Number(end[0])),
				subject: end.slice(1).join("\t"),
				added: 0,
				removed: last?.total ?? 0,
				total: 0,
				files: OLD.map((file) => file.name),
				agent: AGENT.test(must(CLONE, ["show", "-s", "--format=%B", RETIRED])),
			},
		],
	};
}

function compute(): Saved {
	const holds = (rev: string) => gitIn(CLONE, ["cat-file", "-e", `${rev}^{commit}`]) !== null;
	if (!holds(COMMIT)) {
		console.log(
			`${CLONE} does not hold commit ${COMMIT.slice(0, 7)} of kamp-us/phoenix, so there is nothing to read. Give a full-history clone that has it.`,
		);
		process.exit(1);
	}
	const shallow = must(CLONE, ["rev-parse", "--is-shallow-repository"]).trim() === "true";
	const commitsInClone = Number(must(CLONE, ["rev-list", "--count", COMMIT]).trim());
	if (shallow)
		console.log(
			`\nWARNING: this is a shallow clone (${commitsInClone} commits reachable). Its history stops early, so every count of commits, every "first day" and the whole growth curve below are cut short. Nothing is saved from this run. Use a clone with the full history.\n`,
		);
	const hasOld = holds(`${RETIRED}^`);
	if (!hasOld)
		console.log(
			`The clone does not reach back to ${RETIRED}, the commit that deleted the four old gates. They are left out, and every line about them below reads 0.\n`,
		);
	const old: Generation = hasOld ? oldGates() : {files: [], steps: []};
	const merged = generationOf(CLONE, COMMIT, MERGED);
	const {rows, fileLines} = pilesOf(CLONE);
	return {
		commit: COMMIT,
		shallow,
		commitsInClone,
		old,
		merged,
		marks: [
			marksAt(CLONE, "the four old gates, their last day", `${RETIRED}^`, OLD),
			marksAt(CLONE, "the merged skill, its first day", BORN, MERGED),
			marksAt(CLONE, "the merged skill, before the reference sweep", `${SWEEP}^`, MERGED),
			marksAt(CLONE, "the merged skill, after the sweep", SWEEP, MERGED),
			marksAt(CLONE, "the merged skill, at the commit studied", COMMIT, MERGED),
		],
		blame: blameOf(CLONE),
		piles: rows,
		fileLines,
		textChecks: textChecksOf(CLONE, merged),
		own: ownOf(),
	};
}

if (CLONE === "" && !existsSync(resultsFile)) {
	console.log(
		"No saved answers yet. Give the path of a full-history clone of kamp-us/phoenix as the first argument.",
	);
	process.exit(1);
}
const saved: Saved =
	CLONE === "" ? (JSON.parse(readFileSync(resultsFile, "utf8")) as Saved) : compute();
// A shallow clone's answer is printed and never saved: it must not replace the full one.
if (CLONE !== "" && !saved.shallow)
	writeFileSync(resultsFile, `${JSON.stringify(saved, null, "\t")}\n`);

// ---------------------------------------------------------------- 1. how big, and how it grew

const {old, merged} = saved;
/** The old gates without the commit that deleted them. */
const oldSteps = old.steps.slice(0, -1);
const oldPeak = Math.max(0, ...oldSteps.map((step) => step.total));
const atBirth = oldSteps.filter((step) => step.at <= (merged.steps[0]?.at ?? 0)).at(-1)?.total ?? 0;
const bornAt = merged.steps[0]?.total ?? 0;
const nowAt = merged.steps.at(-1)?.total ?? 0;

console.log(`The text studied: kamp-us/phoenix at ${saved.commit.slice(0, 7)}.`);
console.log(
	saved.shallow
		? `THE CLONE WAS SHALLOW (${saved.commitsInClone} commits): every number below is cut short.`
		: `The clone held the full history: ${saved.commitsInClone} commits behind that one.`,
);

table(
	"Each file: its commits, its size, and how often it got smaller",
	["File", "Born", "Commits", "Lines at birth", "Lines at the end", "Commits that made it smaller"],
	[...old.files, ...merged.files].map((file) => {
		const first = file.touches[0];
		const shrinks = file.touches.filter((touch) => touch.removed > touch.added).length;
		return [
			file.name,
			first?.date ?? "",
			file.touches.length,
			first?.lines ?? 0,
			file.touches.at(-1)?.lines ?? 0,
			share(shrinks, file.touches.length),
		];
	}),
);

const totalAt = (steps: readonly Step[], until: number) =>
	steps.filter((step) => step.at <= until).at(-1)?.total ?? 0;
const firstWeek = Date.UTC(2026, 5, 8) / 1000;
const lastStep = merged.steps.at(-1)?.at ?? firstWeek;
console.log(
	"\nLines of review text at the end of each week (one letter is 100 lines; o is the old gates, m is the merged skill)\n",
);
console.log("```text");
console.log("week of     old gates  merged  both");
for (let week = firstWeek; week <= lastStep; week += WEEK) {
	const until = week + WEEK - 1;
	const o = totalAt(old.steps, until);
	const m = totalAt(merged.steps, until);
	const day = new Date(week * 1000).toISOString().slice(0, 10);
	console.log(
		`${day}  ${String(o).padStart(9)}  ${String(m).padStart(6)}  ${String(o + m).padStart(4)}  ${"o".repeat(Math.round(o / 100))}${"m".repeat(Math.round(m / 100))}`,
	);
}
console.log("```");

const jumps = (steps: readonly Step[], most: number) =>
	steps
		.slice(1)
		.map((step) => ({step, net: step.added - step.removed}))
		.sort((a, b) => b.net - a.net)
		.slice(0, most);
for (const [title, gen] of [
	["The old gates: the eight commits that added most", {...old, steps: oldSteps}],
	["The merged skill: the ten commits that added most, after its birth", merged],
] as const)
	table(
		title,
		["Date", "Commit", "Net lines", "Lines after", "Title"],
		jumps(gen.steps, gen === merged ? 10 : 8).map(({step, net}) => [
			step.date,
			step.sha,
			signed(net),
			step.total,
			cell(step.subject),
		]),
	);

const shrinking = (steps: readonly Step[]) => steps.filter((step) => step.removed > step.added);
table(
	"Every commit that left the review text smaller",
	["Generation", "Date", "Commit", "Net lines", "Title"],
	[
		...shrinking(oldSteps).map((step) => ["old gates", step] as const),
		...shrinking(merged.steps).map((step) => ["merged skill", step] as const),
	].map(([gen, step]) => [
		gen,
		step.date,
		step.sha,
		signed(step.added - step.removed),
		cell(step.subject),
	]),
);

table(
	"The two generations side by side",
	["", "The four old gates", "The merged skill"],
	[
		["First commit", oldSteps[0]?.date ?? "", merged.steps[0]?.date ?? ""],
		["Last commit read", oldSteps.at(-1)?.date ?? "", merged.steps.at(-1)?.date ?? ""],
		["Commits", oldSteps.length, merged.steps.length],
		["Lines at birth", oldSteps[0]?.total ?? 0, bornAt],
		["Lines at the end", oldSteps.at(-1)?.total ?? 0, nowAt],
		["Most lines ever", oldPeak, Math.max(...merged.steps.map((step) => step.total))],
		[
			"Lines added, all commits",
			sum(oldSteps.map((s) => s.added)),
			sum(merged.steps.map((s) => s.added)),
		],
		[
			"Lines removed, all commits",
			sum(oldSteps.map((s) => s.removed)),
			sum(merged.steps.map((s) => s.removed)),
		],
		[
			"Commits that left it smaller",
			share(shrinking(oldSteps).length, oldSteps.length),
			share(shrinking(merged.steps).length, merged.steps.length),
		],
		[
			"Commits with an agent as co-author",
			share(oldSteps.filter((s) => s.agent).length, oldSteps.length),
			share(merged.steps.filter((s) => s.agent).length, merged.steps.length),
		],
	],
);
console.log(
	`\nThe rewrite: ${atBirth} lines in the old gates the day the merged skill was born at ${bornAt} (${pct(atBirth - bornAt, atBirth)} less). At the commit studied it is ${nowAt}, ${pct(nowAt, atBirth)} of the old size, ${Math.round(((merged.steps.at(-1)?.at ?? 0) - (merged.steps[0]?.at ?? 0)) / 86400)} days later.`,
);

table(
	"Marks left in the text, counted at five moments",
	["Moment", "Lines", "Bytes", ...Object.keys(MARKS)],
	saved.marks.map((m) => [
		m.at,
		m.lines,
		m.bytes,
		...Object.keys(MARKS).map((k) => m.marks[k] ?? 0),
	]),
);

// ---------------------------------------------------------------- 2. why each piece was added

const causes = readings.causes.gen2;
const unlabelled = merged.steps.filter((step) => causes[step.sha] === undefined);
if (unlabelled.length > 0)
	console.log(`\nNOT LABELLED: ${unlabelled.map((step) => step.sha).join(", ")}`);
const causeOf = (sha: string) => causes[sha]?.[0] ?? "not labelled";
const outsideOf = (sha: string) => causes[sha]?.[1] ?? false;
const blameAll = new Tally();
const blameOutside = new Tally();
for (const perFile of Object.values(saved.blame))
	for (const [sha, n] of Object.entries(perFile)) {
		blameAll.add(causeOf(sha), n);
		if (outsideOf(sha)) blameOutside.add(causeOf(sha), n);
	}
const afterBirth = merged.steps.slice(1);
const grown = sum(afterBirth.map((step) => step.added));
table(
	"The merged skill: what each commit was for (sorted by hand from its issue)",
	[
		"Cause",
		"Commits",
		"From outside the stage",
		"Lines added",
		"Share of lines added after birth",
		"Today's lines last touched by it",
	],
	[...Object.keys(readings.causes.bins), "not labelled"]
		.map((cause) => {
			const mine = merged.steps.filter((step) => causeOf(step.sha) === cause);
			const later = mine.filter((step) => step !== merged.steps[0]);
			return [
				cause,
				mine.length,
				mine.filter((step) => outsideOf(step.sha)).length,
				sum(mine.map((step) => step.added)),
				pct(sum(later.map((step) => step.added)), grown),
				share(blameAll.get(cause), blameAll.total),
			] as const;
		})
		.filter((row) => row[1] > 0),
);
const outsideSteps = afterBirth.filter((step) => outsideOf(step.sha));
console.log(
	`\nFrom outside the stage: ${share(outsideSteps.length, afterBirth.length)} of the commits after birth, ${share(sum(outsideSteps.map((s) => s.added)), grown)} of the lines they added, ${share(blameOutside.total, blameAll.total)} of today's lines.`,
);
console.log(
	`The birth commit still holds ${share(sum(Object.values(saved.blame).map((f) => f[merged.steps[0]?.sha ?? ""] ?? 0)), blameAll.total)} of today's lines.`,
);

/** A commit title's own word for what it is: `fix(review): ...` is a `fix`. */
const kindOf = (subject: string) =>
	/^(fix|feat|docs|chore|refactor|test|decision)(\([^)]*\))?!?:/.exec(subject)?.[1] ?? "no prefix";
const ownScope = (subject: string) =>
	/^[a-z]+\((review[^)]*|gates?|verdicts?)\)/.test(subject) || /^review-/.test(subject);
for (const [title, steps] of [
	["The old gates: what each commit called itself (from the title alone)", oldSteps],
	["The merged skill: the same count, as a check on the hand labels", merged.steps],
] as const) {
	const kinds = [...new Set(steps.map((step) => kindOf(step.subject)))].sort(
		(a, b) =>
			steps.filter((s) => kindOf(s.subject) === b).length -
			steps.filter((s) => kindOf(s.subject) === a).length,
	);
	table(
		title,
		[
			"Title starts with",
			"Commits",
			"Share",
			"Lines added",
			"Lines removed",
			"Title names a review gate",
		],
		kinds.map((kind) => {
			const mine = steps.filter((step) => kindOf(step.subject) === kind);
			return [
				kind,
				mine.length,
				pct(mine.length, steps.length),
				sum(mine.map((step) => step.added)),
				sum(mine.map((step) => step.removed)),
				mine.filter((step) => ownScope(step.subject)).length,
			];
		}),
	);
}

// ---------------------------------------------------------------- 3. the piles

const piles = Object.keys(readings.piles.bins);
const allLines = sum(saved.piles.map((row) => row.lines));
const linesIn = (keep: (row: PileRow) => boolean) =>
	sum(saved.piles.filter(keep).map((row) => row.lines));
for (const [file, lines] of Object.entries(saved.fileLines))
	if (linesIn((row) => row.file === file) !== lines)
		console.log(`\nNOT COVERED: ${file} has ${lines} lines and the ranges cover another number`);
table(
	"What the text is made of, by lines",
	["File", "Lines", ...piles],
	[
		...Object.entries(saved.fileLines).map(([file, lines]) => [
			file,
			lines,
			...piles.map((pile) =>
				share(
					linesIn((r) => r.file === file && r.pile === pile),
					lines,
				),
			),
		]),
		[
			"all six",
			allLines,
			...piles.map((pile) =>
				share(
					linesIn((r) => r.pile === pile),
					allLines,
				),
			),
		],
	],
);
const facts = linesIn((row) => row.pile === "manual" || row.pile === "inside");
console.log(
	`\nThe three piles asked for, and the one added: flow ${share(
		linesIn((r) => r.pile === "flow"),
		allLines,
	)}, facts code holds ${share(facts, allLines)} (manual + inside), judgment ${share(
		linesIn((r) => r.pile === "judgment"),
		allLines,
	)}, why ${share(
		linesIn((r) => r.pile === "why"),
		allLines,
	)}, other ${share(
		linesIn((r) => r.pile === "other"),
		allLines,
	)}.`,
);
const tags = Object.keys(readings.piles.tags);
table(
	"Lines that carry a tag (a line has one tag or none)",
	["Tag", "Lines", "Share of all", "In SKILL.md", "Share of SKILL.md", ...piles],
	[
		...tags.map((tag) => [
			tag,
			linesIn((r) => r.tag === tag),
			pct(
				linesIn((r) => r.tag === tag),
				allLines,
			),
			linesIn((r) => r.tag === tag && r.file === "SKILL.md"),
			pct(
				linesIn((r) => r.tag === tag && r.file === "SKILL.md"),
				saved.fileLines["SKILL.md"] ?? 0,
			),
			...piles.map((pile) => linesIn((r) => r.tag === tag && r.pile === pile)),
		]),
		[
			"no tag",
			linesIn((r) => r.tag === ""),
			pct(
				linesIn((r) => r.tag === ""),
				allLines,
			),
			linesIn((r) => r.tag === "" && r.file === "SKILL.md"),
			pct(
				linesIn((r) => r.tag === "" && r.file === "SKILL.md"),
				saved.fileLines["SKILL.md"] ?? 0,
			),
			...piles.map((pile) => linesIn((r) => r.tag === "" && r.pile === pile)),
		],
	],
);

// ---------------------------------------------------------------- 4. one rule, many places

table(
	"Rules stated in more than one place",
	["Rule", "Places", "Files", "Lines in all"],
	readings.repeats.rows
		.map((row) => {
			for (const [file, from, to] of row.places)
				if (from > to || to > (saved.fileLines[file] ?? 0))
					throw new Error(`${row.rule}: ${file} ${from}-${to} is not in the file`);
			return [
				row.rule,
				row.places.length,
				new Set(row.places.map(([file]) => file)).size,
				sum(row.places.map(([, from, to]) => to - from + 1)),
			] as const;
		})
		.sort((a, b) => b[1] - a[1]),
);
const repeatLines = new Set(
	readings.repeats.rows.flatMap((row) =>
		row.places.flatMap(([file, from, to]) =>
			Array.from({length: to - from + 1}, (_, i) => `${file}:${from + i}`),
		),
	),
);
console.log(
	`\n${readings.repeats.rows.length} rules, ${sum(readings.repeats.rows.map((row) => row.places.length))} places, ${share(repeatLines.size, allLines)} lines that state a rule also stated somewhere else.`,
);
table(
	"Where the text says a thing about itself that a count can check",
	["The text", "The count"],
	saved.textChecks,
);

// ---------------------------------------------------------------- 7. which step the text serves

const stage = readFileSync(join(root, "docs", "review-machine.md"), "utf8");
const steps = [
	...stage.matchAll(
		/^\s*(?:read|checks|think|say)?\s+(\d+)\s{2}(.+?)\s{2,}(code|reader|not sure)$/gm,
	),
]
	.map((hit) => ({n: Number(hit[1]), name: (hit[2] ?? "").trim(), who: hit[3] ?? ""}))
	.filter((step, i, all) => all.findIndex((other) => other.n === step.n) === i);
if (steps.length !== 22)
	console.log(`\nNOT 22 STEPS: docs/review-machine.md's block gave ${steps.length}`);
table(
	"Lines of the text by the step of docs/review-machine.md they serve",
	["Step", "Who does it there", "Lines", "Share", ...piles],
	[
		...steps.map((step) => [
			`${step.n}. ${step.name}`,
			step.who,
			linesIn((r) => r.step === step.n),
			pct(
				linesIn((r) => r.step === step.n),
				allLines,
			),
			...piles.map((pile) => linesIn((r) => r.step === step.n && r.pile === pile)),
		]),
		[
			"none of the 22",
			"",
			linesIn((r) => r.step === 0),
			pct(
				linesIn((r) => r.step === 0),
				allLines,
			),
			...piles.map((pile) => linesIn((r) => r.step === 0 && r.pile === pile)),
		],
	],
);
for (const who of ["code", "reader", "not sure"]) {
	const mine = new Set(steps.filter((step) => step.who === who).map((step) => step.n));
	const lines = linesIn((r) => mine.has(r.step));
	console.log(
		`${who}: ${mine.size} steps, ${share(lines, allLines)} lines, of them judgment ${share(
			linesIn((r) => mine.has(r.step) && r.pile === "judgment"),
			lines,
		)}`,
	);
}

// ---------------------------------------------------------------- 6. this repo itself

table(
	`This repo's own text, at ${saved.own.rev}`,
	["File", "First commit", "Commits", "Lines then", "Lines now", "Commits that made it smaller"],
	saved.own.files.map((file) => [
		file.path,
		file.first.date,
		file.commits,
		file.first.lines,
		file.last.lines,
		file.shrinks,
	]),
);
table(
	"This repo's own prompts: characters of source, spaces left out",
	["Prompt", "File", "First", "Then", "Last", "Now", "Times it changed", "Times it got smaller"],
	saved.own.prompts.map((prompt) => [
		prompt.name,
		prompt.file,
		prompt.first.date,
		prompt.first.chars,
		prompt.last.date,
		prompt.last.chars,
		prompt.commits - 1,
		prompt.shrinks,
	]),
);
const verbs = new Tally();
for (const name of REVIEW_NAMES) verbs.add(name.split(":")[0] ?? "");
console.log(
	`\nThe review stage's outcome names today: ${REVIEW_NAMES.length} (${Object.entries(
		verbs.object(),
	)
		.map(([verb, n]) => `${verb} ${n}`)
		.join(", ")}).`,
);
