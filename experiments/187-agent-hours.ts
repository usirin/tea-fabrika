// Experiment 187: what is an agent hour, and how many lines does one buy?
// See 187-agent-hours.md.
//
//   STEP=fetch env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY \
//     nice -n 15 node experiments/187-agent-hours.ts      # read GitHub once, save the PRs
//   env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY \
//     nice -n 15 node experiments/187-agent-hours.ts      # measure from the saved PRs
//
// Env: STEP (fetch, or measure by default), RUNS (default field/runs.jsonl), EXTRA (a second
// runs file whose rows are added, such as an open field PR's copy), OUT (default
// experiments/results/187-agent-hours.json).
//
// fetch reads GitHub read-only through gh and git: this repo's merged PRs and which of them are
// on origin/main, and kamp-us/demlik's merged PRs with the issues each one closes. It saves them to
// experiments/results/187-agent-hours-prs.json. measure reads only that file, the runs file and
// this checkout's origin. No model, no key, $0.
//
// This repo is read off the checkout's origin, as `<owner>/<name>`, so no owner is written here.
//
// A join is never guessed. A run joins a PR only on one of three written links:
//   named   its `why` names the PR: `<name>/pull/<n>` or `PR <n>`, the same n as its lane
//   dated   its lane is `<owner>/<name>#<n>` for this repo, n is a PR merged into main, and the
//           run's date falls in the PR's life (opened, less one day for time zones, to merged)
//   closes  its lane is `kamp-us/demlik#<n>`, and a PR merged into main closes issue n
//           (GitHub's closingIssuesReferences)
// Everything else is counted as not joined, with its reason.
import {execFileSync} from "node:child_process";
import {readFileSync, writeFileSync} from "node:fs";
import {basename} from "node:path";

const SAVED = "experiments/results/187-agent-hours-prs.json";

/** This repo as `<owner>/<name>`, from the checkout's origin URL. */
const HERE = (() => {
	const url = execFileSync("git", ["remote", "get-url", "origin"], {encoding: "utf8"}).trim();
	const m = /[:/]([^/:]+\/[^/]+?)(\.git)?$/.exec(url);
	if (m === null) throw new Error(`origin is not a GitHub repository: ${url}`);
	return m[1];
})();
const NAME = HERE.split("/")[1];
const HERE_LANE = new RegExp(`^${HERE.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}#(\\d+)$`);
const DEMLIK = "kamp-us/demlik";

type File = {path: string; additions: number; deletions: number};
type Pr = {
	number: number;
	createdAt: string;
	mergedAt: string;
	onMain: boolean;
	closes: Array<number>;
	lines: Lines; // additions by kind of file, sorted at fetch; no path is saved
};
type Saved = {read: string; repos: {[repo: string]: Array<Pr>}};

type Run = {
	date: string;
	lane: string | null;
	role: string;
	model: string | null;
	outcome: string;
	why: string | null;
	minutes: number | null;
	replay?: boolean;
	driver_caused?: boolean;
};

// ---------------------------------------------------------------- fetch

const gh = (args: Array<string>): string =>
	execFileSync("gh", args, {encoding: "utf8", maxBuffer: 256 * 1024 * 1024});

// gh's PR list and GraphQL give at most 100 files a PR. A PR with more is read again from the
// REST files list, which pages to 3,000 and names a file `filename`.
type RestFile = {filename: string; additions: number; deletions: number};
const filesOf = (repo: string, number: number, files: Array<File>, changed: number) =>
	files.length >= changed
		? files.map(({path, additions, deletions}) => ({path, additions, deletions}))
		: (
				JSON.parse(
					gh(["api", "--paginate", "--slurp", `repos/${repo}/pulls/${number}/files?per_page=100`]),
				) as Array<Array<RestFile>>
			)
				.flat()
				.map((f) => ({path: f.filename, additions: f.additions, deletions: f.deletions}));

const fetchTeaFabrika = (): Array<Pr> => {
	const onMain = new Set(
		execFileSync("git", ["log", "origin/main", "--format=%H"], {encoding: "utf8"}).split("\n"),
	);
	const prs = JSON.parse(
		gh([
			"pr",
			"list",
			"--repo",
			HERE,
			"--state",
			"merged",
			"--limit",
			"300",
			"--json",
			"number,createdAt,mergedAt,mergeCommit,files,changedFiles",
		]),
	) as Array<{
		number: number;
		createdAt: string;
		mergedAt: string;
		mergeCommit: {oid: string} | null;
		files: Array<File>;
		changedFiles: number;
	}>;
	return prs.map((p) => ({
		number: p.number,
		createdAt: p.createdAt,
		mergedAt: p.mergedAt,
		onMain: p.mergeCommit !== null && onMain.has(p.mergeCommit.oid),
		closes: [],
		lines: linesOfFiles(filesOf(HERE, p.number, p.files, p.changedFiles)),
	}));
};

const DEMLIK_QUERY = `query($endCursor: String) { repository(owner: "kamp-us", name: "demlik") {
  pullRequests(states: MERGED, first: 50, after: $endCursor, orderBy: {field: CREATED_AT, direction: DESC}) {
    pageInfo { hasNextPage endCursor }
    nodes { number baseRefName createdAt mergedAt changedFiles
      closingIssuesReferences(first: 10) { nodes { number } }
      files(first: 100) { nodes { path additions deletions } } } } } }`;

const fetchDemlik = (): Array<Pr> => {
	const out = gh(["api", "graphql", "--paginate", "--slurp", "-f", `query=${DEMLIK_QUERY}`]);
	const pages = JSON.parse(out) as Array<{
		data: {
			repository: {
				pullRequests: {
					nodes: Array<{
						number: number;
						baseRefName: string;
						createdAt: string;
						mergedAt: string;
						changedFiles: number;
						closingIssuesReferences: {nodes: Array<{number: number}>};
						files: {nodes: Array<File>};
					}>;
				};
			};
		};
	}>;
	// Only PRs merged since the field log began (its first row is 2026-10-10), to keep the file
	// small: a PR merged before the first logged run cannot hold that run's work.
	return pages.flatMap((page) =>
		page.data.repository.pullRequests.nodes
			.filter((p) => p.mergedAt >= "2026-10-01")
			.map((p) => ({
				number: p.number,
				createdAt: p.createdAt,
				mergedAt: p.mergedAt,
				onMain: p.baseRefName === "main",
				closes: p.closingIssuesReferences.nodes.map((n) => n.number),
				lines: linesOfFiles(filesOf(DEMLIK, p.number, p.files.nodes, p.changedFiles)),
			})),
	);
};

// ---------------------------------------------------------------- kinds of lines

type Kind = "code" | "test" | "docs" | "experiment" | "record" | "config" | "other";
const WRITTEN: ReadonlyArray<Kind> = ["code", "test", "docs", "experiment"];

const kindOf = (path: string): Kind => {
	if (/(^|\/)pnpm-lock\.yaml$/.test(path)) return "config";
	if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(path)) return "test";
	if (/(^|\/)(fixtures|__snapshots__|e2e)\//.test(path) || /(^|\/)e2e\.[jt]s$/.test(path))
		return "test";
	if (/\.(md|mdx)$/.test(path)) return "docs";
	if (/^field\//.test(path) || /^experiments\/results\//.test(path) || /\.jsonl$/.test(path))
		return "record";
	if (/unreachable-ledger\.json$/.test(path)) return "record";
	if (/^experiments\//.test(path) && /\.[cm]?[jt]sx?$/.test(path)) return "experiment";
	if (
		/(^|\/)(package\.json|tsconfig[^/]*\.json|\.oxlintrc[^/]*|\.oxfmtrc[^/]*|layer-rules\.json|pnpm-workspace\.yaml|\.gitignore|\.npmrc)$/.test(
			path,
		) ||
		/^\.github\//.test(path) ||
		/^patches\//.test(path) ||
		/\.(ya?ml|toml)$/.test(path)
	)
		return "config";
	if (/\.(ts|tsx|js|mjs|cjs|css|html|tla|cfg|sh|swift|zig|rs|go|grit)$/.test(path)) return "code";
	return "other";
};

type Lines = {[K in Kind]: number};
const noLines = (): Lines => ({
	code: 0,
	test: 0,
	docs: 0,
	experiment: 0,
	record: 0,
	config: 0,
	other: 0,
});
const linesOfFiles = (files: Array<File>): Lines => {
	const lines = noLines();
	for (const f of files) lines[kindOf(f.path)] += f.additions;
	return lines;
};
const linesOf = (prs: Array<Pr>): Lines => {
	const lines = noLines();
	for (const pr of prs) for (const k of Object.keys(lines) as Array<Kind>) lines[k] += pr.lines[k];
	return lines;
};
const written = (l: Lines): number => WRITTEN.reduce((s, k) => s + l[k], 0);

// A PR's bucket: the written kind with 60% or more of its written lines; else code and tests
// together at 60% or more; else mixed.
type Bucket = "code" | "test" | "docs" | "experiment" | "code and tests" | "mixed" | "none";
const bucketOf = (l: Lines): Bucket => {
	const all = written(l);
	if (all === 0) return "none";
	for (const k of WRITTEN) if (l[k] / all >= 0.6) return k as Bucket;
	if ((l.code + l.test) / all >= 0.6) return "code and tests";
	return "mixed";
};

// ---------------------------------------------------------------- joins

type Join = "named" | "dated" | "closes";
type Unit = {
	repo: string;
	prs: Array<number>;
	issues: Array<number>;
	join: Join;
	runs: Array<Run>;
	minutes: number;
	failed: number;
	lines: Lines;
	bucket: Bucket;
	perHour: number;
};

const DAY = 86_400_000;
const dayOf = (iso: string): number => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

// tea-fabrika: one unit per merged PR on main that a run names or dates into.
const joinTeaFabrika = (
	runs: Array<Run>,
	prs: Array<Pr>,
	misses: {[why: string]: number},
	missed: Array<{lane: string; why: string}>,
): Array<Unit> => {
	const byNumber = new Map(prs.map((p) => [p.number, p]));
	const units = new Map<number, {join: Join; runs: Array<Run>}>();
	for (const r of runs) {
		const m = HERE_LANE.exec(r.lane ?? "");
		if (m === null) continue;
		const n = Number(m[1]);
		const miss = (_: Run, why: string): void => {
			misses[why] = (misses[why] ?? 0) + 1;
			missed.push({lane: `#${n}`, why});
		};
		const why = r.why ?? "";
		if (/same agent run as the row for \d+/.test(why)) {
			miss(r, "a copy of another row's run");
			continue;
		}
		if (r.minutes === null) {
			miss(r, "no minutes recorded");
			continue;
		}
		if (new RegExp(`tracker ticket ${n}\\b`).test(why)) {
			miss(r, "lane is a tracker ticket, not a PR");
			continue;
		}
		const named = why.includes(`${NAME}/pull/${n}`) || new RegExp(`\\bPR ${n}\\b`).test(why);
		const pr = byNumber.get(n);
		if (pr === undefined) {
			miss(r, "no merged PR has its number");
			continue;
		}
		if (!pr.onMain) {
			miss(r, "its PR merged into a branch, not main");
			continue;
		}
		const runDay = dayOf(r.date);
		const dated = runDay >= dayOf(pr.createdAt) - DAY && runDay <= dayOf(pr.mergedAt);
		if (!named && !dated) {
			miss(r, "the run's date is outside its PR's life");
			continue;
		}
		const join: Join = named ? "named" : "dated";
		const unit = units.get(n) ?? {join, runs: []};
		if (join === "dated") unit.join = unit.join === "named" ? "named" : "dated";
		unit.runs.push(r);
		units.set(n, unit);
	}
	return [...units].map(([n, u]) => {
		const pr = byNumber.get(n) as Pr;
		return unitOf(NAME, [pr], [], u.join, u.runs);
	});
};

// demlik: leaf agent runs (not the operator, which waits on its children, and not a ship stage
// with no agent), joined issue to PR by GitHub's closing link. Issues and PRs that share a link
// fold into one unit.
const LEAF = new Set(["builder", "reviewer", "shipper", "planner", "triager"]);

const joinDemlik = (
	runs: Array<Run>,
	prs: Array<Pr>,
	misses: {[why: string]: number},
	drivers: {minutes: number; runs: number},
): Array<Unit> => {
	const merged = prs.filter((p) => p.onMain);
	const closers = new Map<number, Array<Pr>>();
	for (const p of merged) for (const i of p.closes) closers.set(i, [...(closers.get(i) ?? []), p]);
	const runsByIssue = new Map<number, Array<Run>>();
	for (const r of runs) {
		const m = /^kamp-us\/demlik#(\d+)$/.exec(r.lane ?? "");
		if (m === null || r.replay === true) continue;
		if (r.role === "operator" || r.role === "machine") {
			drivers.minutes += r.minutes ?? 0;
			drivers.runs += 1;
			continue;
		}
		if (!LEAF.has(r.role) || r.model === null) continue;
		if (r.minutes === null) {
			misses["no minutes recorded"] = (misses["no minutes recorded"] ?? 0) + 1;
			continue;
		}
		const i = Number(m[1]);
		if (!closers.has(i)) {
			misses["no merged PR closes its issue"] = (misses["no merged PR closes its issue"] ?? 0) + 1;
			misses["minutes of those"] = Math.round((misses["minutes of those"] ?? 0) + r.minutes);
			continue;
		}
		runsByIssue.set(i, [...(runsByIssue.get(i) ?? []), r]);
	}
	// Union issues that share a PR.
	const parent = new Map<string, string>();
	const find = (x: string): string => {
		const p = parent.get(x) ?? x;
		if (p === x) return x;
		const root = find(p);
		parent.set(x, root);
		return root;
	};
	const union = (a: string, b: string): void => parent.set(find(a), find(b));
	for (const i of runsByIssue.keys())
		for (const p of closers.get(i) ?? []) union(`i${i}`, `p${p.number}`);
	const groups = new Map<string, {issues: Set<number>; prs: Map<number, Pr>}>();
	for (const i of runsByIssue.keys()) {
		const root = find(`i${i}`);
		const g = groups.get(root) ?? {issues: new Set(), prs: new Map()};
		g.issues.add(i);
		for (const p of closers.get(i) ?? []) g.prs.set(p.number, p);
		groups.set(root, g);
	}
	return [...groups.values()].map((g) =>
		unitOf(
			"demlik",
			[...g.prs.values()],
			[...g.issues],
			"closes",
			[...g.issues].flatMap((i) => runsByIssue.get(i) ?? []),
		),
	);
};

const unitOf = (
	repo: string,
	prs: Array<Pr>,
	issues: Array<number>,
	join: Join,
	runs: Array<Run>,
): Unit => {
	const minutes = runs.reduce((s, r) => s + (r.minutes ?? 0), 0);
	const lines = linesOf(prs);
	return {
		repo,
		prs: prs.map((p) => p.number).sort((a, b) => a - b),
		issues: issues.sort((a, b) => a - b),
		join,
		runs,
		minutes,
		failed: runs.filter((r) => r.outcome !== "pass" && r.outcome !== "merged").length,
		lines,
		bucket: bucketOf(lines),
		perHour: minutes > 0 ? written(lines) / (minutes / 60) : 0,
	};
};

// ---------------------------------------------------------------- spread

const quantile = (sorted: Array<number>, q: number): number => {
	if (sorted.length === 0) return Number.NaN;
	const at = (sorted.length - 1) * q;
	const lo = Math.floor(at);
	const hi = Math.ceil(at);
	return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
};

const spread = (units: Array<Unit>) => {
	const rates = units
		.filter((u) => u.minutes >= 1)
		.map((u) => u.perHour)
		.sort((a, b) => a - b);
	const hours = units.reduce((s, u) => s + u.minutes / 60, 0);
	const lines = units.reduce((s, u) => s + written(u.lines), 0);
	const r = (x: number): number => Math.round(x);
	return {
		prs: units.length,
		hours: Math.round(hours * 10) / 10,
		writtenLines: lines,
		pooled: r(lines / hours),
		median: r(quantile(rates, 0.5)),
		p25: r(quantile(rates, 0.25)),
		p75: r(quantile(rates, 0.75)),
		min: r(rates[0] ?? Number.NaN),
		max: r(rates.at(-1) ?? Number.NaN),
	};
};

const byBucket = (units: Array<Unit>) => {
	const out: {[b: string]: ReturnType<typeof spread>} = {};
	for (const b of ["code", "code and tests", "test", "docs", "experiment", "mixed", "none"]) {
		const us = units.filter((u) => u.bucket === b);
		if (us.length > 0) out[b] = spread(us);
	}
	return out;
};

// Pooled lines of one kind per agent hour, over the units that wrote any of that kind.
const byKind = (units: Array<Unit>) => {
	const out: {[k: string]: {prs: number; lines: number; hours: number; pooled: number}} = {};
	for (const k of WRITTEN) {
		const us = units.filter((u) => u.lines[k] > 0);
		const hours = us.reduce((s, u) => s + u.minutes / 60, 0);
		const lines = us.reduce((s, u) => s + u.lines[k], 0);
		out[k] = {
			prs: us.length,
			lines,
			hours: Math.round(hours * 10) / 10,
			pooled: Math.round(lines / hours),
		};
	}
	return out;
};

// Tests per product line, on units that wrote both.
const testRatio = (units: Array<Unit>) => {
	const us = units.filter((u) => u.lines.code > 0 && u.lines.test > 0);
	const ratios = us.map((u) => u.lines.test / u.lines.code).sort((a, b) => a - b);
	const r2 = (x: number): number => Math.round(x * 100) / 100;
	return {
		prs: us.length,
		pooled: r2(us.reduce((s, u) => s + u.lines.test, 0) / us.reduce((s, u) => s + u.lines.code, 0)),
		median: r2(quantile(ratios, 0.5)),
		p25: r2(quantile(ratios, 0.25)),
		p75: r2(quantile(ratios, 0.75)),
	};
};

// ---------------------------------------------------------------- past guesses
//
// Every size guess found in docs/ and experiments/ on main that gives both lines and agent
// hours, read by hand on 2026-11-01. `lines` and `hours` are the middle of each range. None of
// these was built on main yet, so each is compared with the measured rate, not with its own
// actual.
const GUESSES: Array<{at: string; what: string; lines: number; hours: number}> = [
	{at: "docs/plan/tier-1-detail.md:28", what: "Tier 1, the stated rate", lines: 150, hours: 1},
	{
		at: "docs/plan/tier-1-detail.md:24",
		what: "Tier 1, all of it, product and tests",
		lines: (5360 + 7440) / 2 + (4940 + 7200) / 2,
		hours: (63 + 92) / 2,
	},
	{
		at: "docs/plan/ticket-115.md:24",
		what: "ticket 115, product and tests",
		lines: 600 + 1000,
		hours: 3,
	},
	{at: "docs/direction/tile-guidelines.md:512", what: "tiles and the wash", lines: 410, hours: 8.5},
	{at: "docs/direction/modes.md:327", what: "the desk's modes", lines: 80, hours: 1},
	{
		at: "docs/direction/windows-in-next.md:52",
		what: "windows in Tier 1",
		lines: 320,
		hours: 4,
	},
	{at: "experiments/171-alchemy-local-twin.md:363", what: "the twin child", lines: 140, hours: 4},
	{at: "experiments/177-themes.md:411", what: "misused tokens", lines: 20, hours: 0.5},
	{at: "experiments/177-themes.md:412", what: "tones, not RGB", lines: 60, hours: 1},
	{at: "experiments/177-themes.md:413", what: "Theme and Radix picks", lines: 300, hours: 2.5},
	{at: "experiments/177-themes.md:414", what: "theme file readers", lines: 150, hours: 1},
	{at: "experiments/177-themes.md:415", what: "code highlighter", lines: 100, hours: 1.5},
	{at: "experiments/177-themes.md:417", what: "store on the person", lines: 200, hours: 2},
	{at: "experiments/185-dsh-superagent-study.md:367", what: "attention view", lines: 100, hours: 1},
	{at: "experiments/185-dsh-superagent-study.md:374", what: "brief test", lines: 200, hours: 2.5},
	{
		at: "experiments/185-dsh-superagent-study.md:384",
		what: "write-time facts",
		lines: 60,
		hours: 1,
	},
	{at: "experiments/185-dsh-superagent-study.md:408", what: "comment test", lines: 350, hours: 4},
	{at: "experiments/185-dsh-superagent-study.md:417", what: "message test", lines: 200, hours: 2},
	{at: "experiments/185-dsh-superagent-study.md:423", what: "ask cap", lines: 100, hours: 1},
];

// ---------------------------------------------------------------- main

const readRuns = (path: string): Array<Run> =>
	readFileSync(path, "utf8")
		.split("\n")
		.filter((l) => l.trim() !== "")
		.map((l) => JSON.parse(l) as Run);

const measure = (): void => {
	const saved = JSON.parse(readFileSync(SAVED, "utf8")) as Saved;
	const runsPath = process.env["RUNS"] ?? "field/runs.jsonl";
	const extra = process.env["EXTRA"];
	const runs = [...readRuns(runsPath), ...(extra === undefined ? [] : readRuns(extra))];

	const teaMisses: {[why: string]: number} = {};
	const teaMissed: Array<{lane: string; why: string}> = [];
	const tea = joinTeaFabrika(runs, saved.repos[NAME], teaMisses, teaMissed);
	const demMisses: {[why: string]: number} = {};
	const drivers = {minutes: 0, runs: 0};
	const dem = joinDemlik(runs, saved.repos["demlik"], demMisses, drivers);

	const teaRuns = runs.filter((r) => HERE_LANE.test(r.lane ?? ""));
	const teaOnMain = saved.repos[NAME].filter((p) => p.onMain);
	const teaPrsMerged = teaOnMain.length;
	// How much of the repo's merged work has any logged run: PRs merged on or after the first
	// logged run's day.
	const firstRun = teaRuns.map((r) => r.date).sort()[0] ?? "";
	const sinceFirst = teaOnMain.filter((p) => p.mergedAt.slice(0, 10) >= firstRun).length;
	const demIssues = new Set(
		runs
			.filter((r) => /^kamp-us\/demlik#\d+$/.test(r.lane ?? "") && r.replay !== true)
			.map((r) => r.lane),
	).size;

	// A whole lane: a builder, a reviewer and a shipper run each logged on it. The rows of such a
	// lane are the nearest thing here to every agent minute the work took.
	const whole = dem.filter((u) =>
		["builder", "reviewer", "shipper"].every((role) => u.runs.some((r) => r.role === role)),
	);
	const roleHours: {[role: string]: number} = {};
	for (const u of whole)
		for (const r of u.runs) roleHours[r.role] = (roleHours[r.role] ?? 0) + (r.minutes ?? 0) / 60;
	for (const k of Object.keys(roleHours)) roleHours[k] = Math.round(roleHours[k] * 10) / 10;

	const guesses = GUESSES.map((g) => ({...g, perHour: Math.round(g.lines / g.hours)}));
	const all = [...tea, ...dem];
	const result = {
		read: saved.read,
		// A file outside the repo is named by its base name only, so no machine path is saved.
		runsFile: runsPath.startsWith("/") ? basename(runsPath) : runsPath,
		extraFile: extra === undefined ? null : basename(extra),
		teaFabrika: {
			mergedOnMain: teaPrsMerged,
			firstRun,
			mergedSinceFirstRun: sinceFirst,
			runsOnItsLanes: teaRuns.length,
			joinedRuns: tea.reduce((s, u) => s + u.runs.length, 0),
			joinedPrs: tea.length,
			named: tea.filter((u) => u.join === "named").length,
			dated: tea.filter((u) => u.join === "dated").length,
			notJoined: teaMisses,
			all: spread(tea),
			namedOnly: spread(tea.filter((u) => u.join === "named")),
			byBucket: byBucket(tea),
			byKind: byKind(tea),
			testRatio: testRatio(tea),
		},
		demlik: {
			issuesWithRuns: demIssues,
			joinedUnits: dem.length,
			joinedRuns: dem.reduce((s, u) => s + u.runs.length, 0),
			notJoinedLeafRuns: demMisses,
			driverRunsLeftOut: {runs: drivers.runs, hours: Math.round((drivers.minutes / 60) * 10) / 10},
			all: spread(dem),
			wholeLanes: {...spread(whole), roleHours, testRatio: testRatio(whole)},
			byBucket: byBucket(dem),
			byKind: byKind(dem),
			testRatio: testRatio(dem),
		},
		both: {all: spread(all), byBucket: byBucket(all)},
		failedRunShare: {
			runs: all.reduce((s, u) => s + u.runs.length, 0),
			failed: all.reduce((s, u) => s + u.failed, 0),
			failedHours:
				Math.round(
					all.reduce(
						(s, u) =>
							s +
							u.runs
								.filter((r) => r.outcome !== "pass" && r.outcome !== "merged")
								.reduce((t, r) => t + (r.minutes ?? 0), 0),
						0,
					) / 6,
				) / 10,
		},
		guesses,
		units: all.map((u) => ({
			repo: u.repo,
			prs: u.prs,
			issues: u.issues,
			join: u.join,
			runs: u.runs.length,
			failed: u.failed,
			minutes: Math.round(u.minutes * 10) / 10,
			lines: u.lines,
			bucket: u.bucket,
			perHour: Math.round(u.perHour),
		})),
		teaFabrikaNotJoined: teaMissed,
	};
	const out = process.env["OUT"] ?? "experiments/results/187-agent-hours.json";
	writeFileSync(out, `${JSON.stringify(result, null, "\t")}\n`);

	const show = (name: string, s: ReturnType<typeof spread>): void =>
		console.log(
			`${name.padEnd(28)} ${String(s.prs).padStart(3)} PRs ${String(s.hours).padStart(6)} h  pooled ${String(s.pooled).padStart(4)}  median ${String(s.median).padStart(4)}  p25-p75 ${s.p25}-${s.p75}  min-max ${s.min}-${s.max}`,
		);
	console.log(
		`tea-fabrika: ${result.teaFabrika.joinedPrs} of ${teaPrsMerged} merged PRs on main joined (${result.teaFabrika.named} named, ${result.teaFabrika.dated} dated), ${result.teaFabrika.joinedRuns} of ${teaRuns.length} runs`,
	);
	console.log(
		`  ${sinceFirst} PRs merged on main since the first logged run (${firstRun}); the rest of them have no logged run`,
	);
	console.log("  not joined:", JSON.stringify(teaMisses));
	show("  all", result.teaFabrika.all);
	show("  named only", result.teaFabrika.namedOnly);
	for (const [b, s] of Object.entries(result.teaFabrika.byBucket)) show(`  ${b}`, s);
	console.log("  by kind:", JSON.stringify(result.teaFabrika.byKind));
	console.log("  tests per product line:", JSON.stringify(result.teaFabrika.testRatio));
	console.log(
		`demlik: ${dem.length} units from ${demIssues} issues with runs, ${result.demlik.joinedRuns} leaf runs`,
	);
	console.log(
		"  not joined:",
		JSON.stringify(demMisses),
		"drivers left out:",
		JSON.stringify(result.demlik.driverRunsLeftOut),
	);
	show("  all", result.demlik.all);
	show("  whole lanes", result.demlik.wholeLanes);
	console.log(
		"  whole lanes, hours by role:",
		JSON.stringify(roleHours),
		"tests per product line:",
		JSON.stringify(result.demlik.wholeLanes.testRatio),
	);
	for (const [b, s] of Object.entries(result.demlik.byBucket)) show(`  ${b}`, s);
	console.log("  by kind:", JSON.stringify(result.demlik.byKind));
	console.log("  tests per product line:", JSON.stringify(result.demlik.testRatio));
	show("both", result.both.all);
	console.log("failed runs:", JSON.stringify(result.failedRunShare));
	console.log("past guesses, lines per agent hour:");
	for (const g of guesses) console.log(`  ${String(g.perHour).padStart(4)}  ${g.what} (${g.at})`);
	console.log(`wrote ${out}`);
};

const fetchAll = (): void => {
	const saved: Saved = {
		read: new Date().toISOString(),
		repos: {[NAME]: fetchTeaFabrika(), demlik: fetchDemlik()},
	};
	writeFileSync(SAVED, `${JSON.stringify(saved)}\n`);
	for (const [repo, prs] of Object.entries(saved.repos))
		console.log(`${repo}: ${prs.length} merged PRs, ${prs.filter((p) => p.onMain).length} on main`);
	console.log(`wrote ${SAVED}`);
};

if (process.env["STEP"] === "fetch") fetchAll();
else measure();
