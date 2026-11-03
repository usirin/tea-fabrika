// Does the duplicate hint work on this repo's own tracker? (experiment 167)
//
// The code under test is what ships: the cheap filter (`candidatesOf`), the question
// (`duplicateJudge`), the text Jev reads (`textOf`) and the live Jev with its cap and receipts
// (`jevFromConfig`). Each ticket is filed again, in number order, against the tickets that were
// open when it was filed. Three kinds of pair come out:
//
//   duplicate    a pair labelled by hand as the same work (DUPLICATES below)
//   related      a pair labelled by hand as close but not the same: a part, a sequel, a spec
//                of (RELATED below). A hint here is a false alarm a person would dismiss.
//   control      every other pair the filter keeps. A hint here is a false alarm.
//
// Then each PARAPHRASE below, a re-filing of an open ticket in other words, written by hand, is
// filed against today's open tickets: `paraphrase` is the pair with its original, and the rest
// are `paraphrase_control`. The labels were written down before any Jev call.
//
//   node experiments/167-duplicate-hint.ts plan <tickets.json>          no key, no call: the pairs and a cost estimate
//   TYPESAFE_API_KEY=... node experiments/167-duplicate-hint.ts run <tickets.json> [n]
//                                                                       asks the pairs not yet in the results, at most n;
//                                                                       KIND=<kind> asks only that kind
//   node experiments/167-duplicate-hint.ts report                       no key, no call: the tables
//
// <tickets.json> is a read-only dump of the tracker: [{number, state, title, body, at, notes:
// [{type, at, body}]}]. It stays on the laptop; the results keep numbers, titles and scores.
import {readFileSync, writeFileSync} from "node:fs";
import {DEFAULT_JEV_MODEL} from "@demlik/tea/jev";
import {JevReceipts, jevFromConfig, receiptLine, spentOf} from "@kampus/pipeline/jev-live";
import {
	type Candidate,
	candidatesOf,
	duplicateJudge,
	textOf,
} from "@kampus/pipeline/tickets/duplicates";
import {Effect, Layer, Schedule} from "effect";
import {FetchHttpClient} from "effect/http";

const RESULTS = new URL("./results/167-duplicate-hint.json", import.meta.url);

/** The real near-duplicates, as [filed later, filed first]. Read by hand from all 78 tickets. */
const DUPLICATES: readonly (readonly [number, number])[] = [
	// "Ticket view: see each agent's state at a glance" asks what "The ticket view shows what the
	// agents do, and whether it is done" asks, with a lean on the layout.
	[64, 6],
];

/** Close but not the same work: closing the later one would lose something. */
const RELATED: readonly (readonly [number, number])[] = [
	// Parts A to D of slice 3t ("The trace tile", #46): a split, kept on purpose.
	[72, 46],
	[73, 46],
	[74, 46],
	[75, 46],
	[73, 72],
	[74, 73],
	[75, 74],
	// A sequel or a follow-up of the earlier ticket.
	[37, 9],
	[11, 10],
	[40, 38],
	[65, 38],
	[51, 50],
	[48, 47],
	[63, 62],
	[77, 76],
	[77, 52],
	[22, 20],
	[53, 42],
];

/** Re-filings of open tickets in other words, as a person might file the same thing again. */
const PARAPHRASES: readonly {readonly of: number; readonly title: string; readonly body: string}[] =
	[
		{
			of: 4,
			title: "A list of every tile to jump to",
			body: "One key that lists all workspaces and their tiles, like tmux's tree chooser. Pick a row and you land on that tile.",
		},
		{
			of: 7,
			title: "Swipe back inside a tile",
			body: "Swiping back on the trackpad should take the focused tile to where it was before, say from a ticket back to the list. Cmd-[ and Cmd-] too. Other tiles do not move.",
		},
		{
			of: 23,
			title: "A closed tile's text shows up in a new terminal",
			body: "With ghostty-web, a terminal created after another was disposed can display the old one's content. Reusing a reset terminal can also print junk.",
		},
		{
			of: 29,
			title: "Auth errors are retried as if the ledger were offline",
			body: "When the shared ledger answers 401 or 403, the host keeps retrying and ends with 'cannot reach the ledger'. It should say you are logged out or not allowed.",
		},
		{
			of: 39,
			title: "Tray icon for the host",
			body: "Put an icon in the macOS menu bar that says whether the host is running, which ledger it is connected to, and how long the session has left.",
		},
		{
			of: 40,
			title: "An agent can approve as me by reading my SSH key",
			body: "The post command signs grants with my key file, and an agent with a shell can read that file and act as me. Move the key into 1Password or a hardware key, and ask for a fresh signature for approvals.",
		},
		{
			of: 42,
			title: "Compare GPT sol with opus for triage",
			body: "Run the saved triage cases through Codex on GPT sol and see whether the answers match opus. If they do, move the stages over.",
		},
		{
			of: 49,
			title: "Mutation testing stage",
			body: "Run Stryker on the changed lines. A surviving mutant goes back to the test writer. No agent in this step.",
		},
		{
			of: 52,
			title: "Watch pull requests from the cloud",
			body: "A small program polls GitHub on a Durable Object alarm and writes a pr fact when a PR changes, so a merge closes its ticket without a lane doing it.",
		},
		{
			of: 58,
			title: "Dashboard of pipeline metrics",
			body: "Show cost per ticket, time per stage, how often work is sent back and merges per day, computed from the facts, so nobody writes field rows by hand.",
		},
		{
			of: 62,
			title: "Prompt testing inside the app",
			body: "A view where I edit an agent's instructions, run them over the labelled cases, and see each version's score in a grid, like promptfoo.",
		},
		{
			of: 66,
			title: "Replace gh CLI calls with the REST API",
			body: "Ten places still shell out to gh. Use the GitHub API behind CodeHost, with a token fabrika keeps itself.",
		},
		{
			of: 67,
			title: "Hot reload for programs",
			body: "When an agent edits a program's file, the running app should pick up the change without a restart.",
		},
		{
			of: 69,
			title: "Lease expiry test in host.test.ts is flaky",
			body: "It failed once on CI with only claimed and lease_expired, then passed on rerun. Probably a race between the expiry job and the host reconnecting.",
		},
		{
			of: 70,
			title: "Move live lines out of the tracker",
			body: "The live pipe lines should be their own program, a notebook like Jupyter, that works over any program.",
		},
		{
			of: 71,
			title: "Should Cmd-K belong to the app?",
			body: "The tracker has its own command palette, but a program should not own one. Decide whether to have a palette at all, and if so put it at the app level, listing every program's inputs.",
		},
		{
			of: 76,
			title: "Blocked-by between tickets",
			body: "Let a ticket record that it waits on another, as Linear does, so a stack of PRs knows its order.",
		},
		{
			of: 77,
			title: "Stacked PRs in the push stage",
			body: "Each PR is based on the one below. When the base changes, rebase the children. Merge from the bottom up, and do not start a fresh review after a restack.",
		},
		{
			of: 3,
			title: "Bring every tile back after a reboot",
			body: "Keep the layout and the running jobs on the ledger instead of desk.json, so that after a crash everything is restored as it was.",
		},
		{
			of: 33,
			title: "A remote agent logs in with my own ChatGPT plan",
			body: "The box does its own Sign in with ChatGPT, my app only passes a one-time code, and the token stays in the box's memory and is never stored.",
		},
		{
			of: 65,
			title: "Program inputs as MCP tools",
			body: "An agent in chat calls a tool like tracker.write, the host passes it to the program, and I watch the tile change. This would replace the post script.",
		},
		{
			of: 68,
			title: "Design tokens for the app",
			body: "Every window picks its own colours today. Use one set of tokens and one component library, so a theme switch changes every window.",
		},
		{
			of: 50,
			title: "Sandbox service for stage agents",
			body: "Each stage runs in a box that holds only what it needs, with a plain and an OS version. Check that a planted command finds no GitHub token.",
		},
		{
			of: 61,
			title: "Map Linear's features onto our ledger",
			body: "Sub-issues, projects, cycles, boards, triage: write down how each maps to facts, and make each view a small program.",
		},
	];

type Kind = "duplicate" | "related" | "control" | "paraphrase" | "paraphrase_control";

interface Dumped {
	readonly number: number;
	readonly state: "open" | "closed";
	readonly title: string;
	readonly body: string;
	readonly at: number;
	readonly notes: readonly {readonly type: string; readonly at: number}[];
}

interface Pair {
	readonly key: string;
	readonly new: string;
	readonly newTitle: string;
	readonly of: number;
	readonly ofTitle: string;
	readonly kind: Kind;
	/** Where the filter put `of` among the candidates, from 1. */
	readonly rank: number;
	readonly texts: {readonly new: string; readonly existing: string};
}

interface Answered {
	readonly key: string;
	readonly new: string;
	readonly newTitle: string;
	readonly of: number;
	readonly ofTitle: string;
	readonly kind: Kind;
	readonly rank: number;
	readonly yes: number;
}

interface Results {
	readonly model: string;
	readonly answers: Answered[];
	/** Each run's spend, from the live Jev's receipts. */
	readonly runs: {calls: number; input: number; output: number; usd: number; ms: number}[];
	/** The filter's recall: for each labelled pair, where its original ranked, or null if cut. */
	recall?: {key: string; kind: Kind; rank: number | null; open: boolean}[];
}

const has = (list: readonly (readonly [number, number])[], a: number, b: number) =>
	list.some(([x, y]) => x === a && y === b);

/** Open at `at`: filed before it, and not closed before it. */
const openAt = (t: Dumped, at: number) =>
	t.at < at && !t.notes.some((n) => n.type === "closed" && n.at < at);

const asCandidate = (t: Dumped): Candidate => ({number: t.number, title: t.title, body: t.body});

const pairsOf = (tickets: readonly Dumped[]) => {
	const by = new Map(tickets.map((t) => [t.number, t]));
	const pairs: Pair[] = [];
	const recall: NonNullable<Results["recall"]> = [];
	const sorted = tickets.toSorted((a, b) => a.number - b.number);
	for (const t of sorted) {
		const pool = sorted.filter((c) => c.number !== t.number && openAt(c, t.at)).map(asCandidate);
		const kept = candidatesOf(t, pool);
		for (const [i, c] of kept.entries())
			pairs.push({
				key: `${t.number}>${c.number}`,
				new: String(t.number),
				newTitle: t.title,
				of: c.number,
				ofTitle: c.title,
				kind: has(DUPLICATES, t.number, c.number)
					? "duplicate"
					: has(RELATED, t.number, c.number)
						? "related"
						: "control",
				rank: i + 1,
				texts: {new: textOf(t), existing: textOf(c)},
			});
		for (const [a, b] of [...DUPLICATES, ...RELATED].filter(([a]) => a === t.number)) {
			const i = kept.findIndex((c) => c.number === b);
			recall.push({
				key: `${a}>${b}`,
				kind: has(DUPLICATES, a, b) ? "duplicate" : "related",
				rank: i < 0 ? null : i + 1,
				open: pool.some((c) => c.number === b),
			});
		}
	}
	const today = sorted.filter((t) => t.state === "open").map(asCandidate);
	for (const [n, p] of PARAPHRASES.entries()) {
		const original = by.get(p.of);
		if (original === undefined || original.state !== "open")
			throw new Error(`paraphrase of #${p.of}: no such open ticket`);
		const kept = candidatesOf(p, today);
		for (const [i, c] of kept.entries())
			pairs.push({
				key: `p${n + 1}>${c.number}`,
				new: `p${n + 1}`,
				newTitle: p.title,
				of: c.number,
				ofTitle: c.title,
				kind: c.number === p.of ? "paraphrase" : "paraphrase_control",
				rank: i + 1,
				texts: {new: textOf(p), existing: textOf(c)},
			});
		const i = kept.findIndex((c) => c.number === p.of);
		recall.push({
			key: `p${n + 1}>${p.of}`,
			kind: "paraphrase",
			rank: i < 0 ? null : i + 1,
			open: true,
		});
	}
	return {pairs, recall};
};

const load = (): Results => {
	try {
		return JSON.parse(readFileSync(RESULTS, "utf8")) as Results;
	} catch {
		return {model: DEFAULT_JEV_MODEL, answers: [], runs: []};
	}
};
const save = (r: Results) => writeFileSync(RESULTS, `${JSON.stringify(r, null, "\t")}\n`);

const count = (pairs: readonly Pair[]) =>
	Object.entries(Object.groupBy(pairs, (p) => p.kind)).map(([k, v]) => `${k} ${v?.length ?? 0}`);

const [verb, path, limit] = process.argv.slice(2);
const tickets = (): readonly Dumped[] => {
	if (path === undefined) throw new Error("give the tickets dump");
	return JSON.parse(readFileSync(path, "utf8")) as Dumped[];
};

if (verb === "plan") {
	const {pairs, recall} = pairsOf(tickets());
	const chars = pairs.reduce((n, p) => n + p.texts.new.length + p.texts.existing.length, 0);
	// About four characters a token, plus the question (about 200 tokens) on each call.
	const tokens = chars / 4 + pairs.length * 200;
	console.log(`${pairs.length} pairs: ${count(pairs).join(", ")}`);
	console.log(`about ${Math.round(tokens)} tokens, about $${(tokens * 0.042e-6).toFixed(3)}`);
	for (const r of recall)
		console.log(`filter ${r.key} ${r.kind}: rank ${r.rank ?? "cut"}${r.open ? "" : " (closed)"}`);
} else if (verb === "run") {
	const {pairs, recall} = pairsOf(tickets());
	const results = load();
	const done = new Set(results.answers.map((a) => a.key));
	// KIND=control asks only that kind: a handful of each kind first, then the rest.
	const kind = process.env.KIND;
	const todo = pairs
		.filter((p) => !done.has(p.key) && (kind === undefined || p.kind === kind))
		.slice(0, limit === undefined ? undefined : Number(limit));
	const ask = (p: Pair) =>
		duplicateJudge.judge(results.model, p.texts).pipe(
			Effect.retry({times: 3, schedule: Schedule.exponential("1 second")}),
			Effect.map(({yes}): Answered => {
				const {texts: _, ...rest} = p;
				return {...rest, yes};
			}),
		);
	const program = Effect.gen(function* () {
		const answers = yield* Effect.forEach(todo, (p) => Effect.option(ask(p)), {concurrency: 8});
		const spent = yield* (yield* JevReceipts).spent;
		return {answers, spent};
	});
	const {answers, spent} = await Effect.runPromise(
		program.pipe(
			Effect.provide(Layer.provide(jevFromConfig({calls: 3_000, usd: 1.5}), FetchHttpClient.layer)),
		),
	);
	const got = answers.flatMap((a) => (a._tag === "Some" ? [a.value] : []));
	save({
		...results,
		answers: [...results.answers, ...got],
		runs: [...results.runs, {...spent}],
		recall,
	});
	console.log(`${got.length} of ${todo.length} answered, ${todo.length - got.length} failed`);
	console.log(receiptLine(spent));
	for (const a of got.toSorted((x, y) => y.yes - x.yes).slice(0, 15))
		console.log(`${a.yes.toFixed(2)} ${a.kind} ${a.key} "${a.newTitle}" / "${a.ofTitle}"`);
} else if (verb === "report") {
	const {answers, runs, recall = []} = load();
	const spent = runs.reduce(
		(s, r) => ({
			calls: s.calls + r.calls,
			input: s.input + r.input,
			output: s.output + r.output,
			usd: s.usd + r.usd,
			ms: s.ms + r.ms,
		}),
		spentOf([]),
	);
	console.log(`${answers.length} pairs answered over ${runs.length} runs; ${receiptLine(spent)}`);
	const kinds: readonly Kind[] = [
		"duplicate",
		"paraphrase",
		"related",
		"control",
		"paraphrase_control",
	];
	console.log("\nfilter recall (labelled pairs, the original among the 20 kept):");
	for (const k of ["duplicate", "paraphrase", "related"] as const) {
		const rs = recall.filter((r) => r.kind === k);
		console.log(
			`  ${k}: ${rs.filter((r) => r.rank !== null).length} of ${rs.length} kept; cut: ${
				rs
					.filter((r) => r.rank === null)
					.map((r) => r.key)
					.join(" ") || "none"
			}`,
		);
	}
	console.log("\nat each floor: pairs at or above it, by kind");
	console.log(`floor | ${kinds.join(" | ")}`);
	for (const floor of [0.5, 0.6, 0.7, 0.8, 0.9]) {
		const cells = kinds.map((k) => {
			const of = answers.filter((a) => a.kind === k);
			return `${of.filter((a) => a.yes >= floor).length}/${of.length}`;
		});
		console.log(`${floor} | ${cells.join(" | ")}`);
	}
	// What a person sees: per filing, the top three at the floor.
	console.log(
		"\nper filing, at each floor: a true hint shown first, and filings with a false hint",
	);
	const filings = Object.groupBy(answers, (a) => a.new);
	for (const floor of [0.5, 0.6, 0.7, 0.8, 0.9]) {
		let first = 0;
		let shown = 0;
		let falseReal = 0;
		let falsePara = 0;
		let real = 0;
		let para = 0;
		for (const [, as] of Object.entries(filings)) {
			const hints = (as ?? [])
				.filter((a) => a.yes >= floor)
				.toSorted((a, b) => b.yes - a.yes)
				.slice(0, 3);
			const isPara = as?.[0]?.new.startsWith("p") ?? false;
			if (isPara) para++;
			else real++;
			const wrong = hints.some((h) => h.kind !== "duplicate" && h.kind !== "paraphrase");
			if (wrong) isPara ? falsePara++ : falseReal++;
			if (hints.some((h) => h.kind === "duplicate" || h.kind === "paraphrase")) shown++;
			if (hints[0]?.kind === "duplicate" || hints[0]?.kind === "paraphrase") first++;
		}
		console.log(
			`${floor}: true hint shown ${shown} (first ${first}); real filings with a false hint ${falseReal} of ${real}; paraphrases with a false hint ${falsePara} of ${para}`,
		);
	}
	console.log("\nthe labelled pairs:");
	for (const a of answers
		.filter((x) => x.kind === "duplicate" || x.kind === "paraphrase" || x.kind === "related")
		.toSorted((x, y) => y.yes - x.yes))
		console.log(`  ${a.yes.toFixed(2)} ${a.kind} ${a.key} "${a.newTitle}" / "${a.ofTitle}"`);
	console.log("\nthe surest unlabelled pairs (false alarms, unless the labels missed a twin):");
	for (const a of answers
		.filter((x) => x.kind === "control" || x.kind === "paraphrase_control")
		.toSorted((x, y) => y.yes - x.yes)
		.slice(0, 15))
		console.log(`  ${a.yes.toFixed(2)} ${a.kind} ${a.key} "${a.newTitle}" / "${a.ofTitle}"`);
} else {
	console.log("plan <tickets.json> | run <tickets.json> [n] | report");
}
