import {access, mkdir, readFile, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {Effect} from "effect";
import {answerFrom, drive, printEnd, printTriageEnd, untilFrom} from "./drive.ts";
import {saveEnrichment} from "./enrichment.ts";
import {parseIssueRef, rawIssueFrom, splitEnriched} from "./github.ts";
import {realLayers, testingFor} from "./host.ts";
import {checkBase, githubIssue, isClean, seedTicket, TicketFile} from "./local.ts";
import {defaultSettings, settingsFile} from "./settings.ts";

// Run one real GitHub ticket on a real pnpm monorepo, triage through ship, and
// print every step. Real Claude Code agents and real Jev; nothing is pushed and
// nothing is written to GitHub.
//   ISSUE=owner/repo#n     the ticket, read once with `gh issue view`. When fabrika's triage
//                          already rewrote it, only the original report is filed, so our
//                          enricher does that work again; fabrika's rewrite is saved beside
//                          the run as fabrika-enriched.md to compare
//   REPO=<folder>          a git checkout of the repo, on the branch the builder works on,
//                          clean, with its packages installed
//   BASE=<branch>          the branch the change lands in. Nobody may have it checked out
//   RUN=<folder>           keep the run's state there: stop it at any point (Ctrl-C), run the
//                          same command again, and it carries on from where it stopped
//   PACKAGE=<folder>       the package whose tests the issue's examples join (default packages/tea)
//   TYPESAFE_API_KEY=...   Jev, for the sort and every reader
//   CONFIG=<file>          a fabrika.toml with the floors, limits and try limit; otherwise today's
//   MODEL=...              the model the agents are asked for
//   ANSWER='<json>'        answer the park the run stopped at, as in src/demo.ts
//   UNTIL=triage           stop once triage is done, before the lane touches the repo, and print
//                          our whole enrichment beside the path of fabrika's. The lane's first
//                          step is kept asked: the same command without UNTIL carries on from it
//   <RUN>/tracker/<n>.json the ticket, as the folder tracker keeps it; add {"id", "text"} to its
//                          "comments" to comment
// ISSUE, REPO, BASE and PACKAGE are kept in <RUN>/run.json, so a resumed run needs only RUN.
// Our enricher's rewrite is kept as <RUN>/ours-enriched.md, laid out like fabrika-enriched.md.

/** What a run is about, kept in its folder from the first start. */
interface Kept {
	readonly issue: string;
	readonly repo: string;
	readonly base: string;
	readonly package: string;
}

const runDir = process.env.RUN || undefined;
if (runDir === undefined)
	throw new Error("RUN is needed: a real run is always kept, so it can stop and resume");
const key = process.env.TYPESAFE_API_KEY || undefined;
if (key === undefined)
	throw new Error("TYPESAFE_API_KEY is needed: a real run sorts and reads with the real Jev");
const answer = answerFrom(process.env.ANSWER);
const until = untilFrom(process.env.UNTIL);

const keptFile = join(runDir, "run.json");
const kept = await readFile(keptFile, "utf8").then(
	(text) => JSON.parse(text) as Kept,
	() => null,
);
const given = {
	issue: process.env.ISSUE || undefined,
	repo: process.env.REPO ? resolve(process.env.REPO) : undefined,
	base: process.env.BASE || undefined,
	package: process.env.PACKAGE || undefined,
};
// A kept run answers to what it started with; a value given again must agree with it.
for (const [name, value] of Object.entries(given)) {
	const was = kept?.[name as keyof Kept];
	if (value !== undefined && was !== undefined && value !== was) {
		throw new Error(
			`${name.toUpperCase()} is ${value}, and the run in ${runDir} was started with ${was}`,
		);
	}
}
const need = (name: keyof Kept, fallback?: string): string => {
	const value = kept?.[name] ?? given[name] ?? fallback;
	if (value === undefined) throw new Error(`${name.toUpperCase()} is needed to start a run`);
	return value;
};
const setup: Kept = {
	issue: need("issue"),
	repo: need("repo"),
	base: need("base"),
	package: need("package", "packages/tea"),
};
const ref = parseIssueRef(setup.issue);
const id = String(ref.number);
const dir = setup.repo;

await checkBase(dir, setup.base);
if (kept === null) {
	// The builder's diff is everything uncommitted, so it has to start from nothing.
	if (!(await isClean(dir)))
		throw new Error(`${dir} has uncommitted changes; a run starts from a clean checkout`);
	await mkdir(runDir, {recursive: true});
	await writeFile(keptFile, `${JSON.stringify(setup, null, 2)}\n`);
}

// Where the ticket lives: a folder tracker, seeded once from GitHub. A kept run keeps its own, comments and all.
const trackerDir = join(runDir, "tracker");
const ticketFile = join(trackerDir, `${id}.json`);
const seeded = await access(ticketFile).then(
	() => true,
	() => false,
);
if (!seeded) {
	const issue = await githubIssue(ref);
	const split = splitEnriched(issue.body);
	if (split !== null) await writeFile(join(runDir, "fabrika-enriched.md"), `${split.enriched}\n`);
	await seedTicket(trackerDir, rawIssueFrom(id, issue));
	console.log(
		split === null
			? `seeded:  the whole body of ${setup.issue}: fabrika had not rewritten it`
			: `seeded:  the original report of ${setup.issue}; fabrika's rewrite is in ${join(runDir, "fabrika-enriched.md")}`,
	);
}
const ticket = TicketFile.parse(JSON.parse(await readFile(ticketFile, "utf8")));

// The issue's tests: a vitest file in the package, named for the ticket, run from the package's folder.
const real = {
	dir,
	package: setup.package,
	base: setup.base,
	testsFile: `src/fabrika-${id}.test.ts`,
};
const {testTsconfig, tests, testing} = await testingFor(real);

// A real ticket takes longer than a toy: half an hour a turn before a turn counts as failed.
const claude = {
	timeoutMs: 30 * 60 * 1000,
	...(process.env.MODEL ? {model: process.env.MODEL} : {}),
};
const settings =
	process.env.CONFIG === undefined ? defaultSettings : settingsFile(process.env.CONFIG);
const layers = realLayers(real, {testing, trackerDir, key, claude, settings});

console.log(`kept in: ${runDir}`);
console.log(`issue:   https://github.com/${ref.repo}/issues/${ref.number}`);
console.log(`filed:   "${ticket.title}" by a ${ticket.filedBy === "human" ? "person" : "agent"}`);
console.log(`ticket:  ${ticketFile} (add to its "comments" to comment)`);
console.log(`repo:    ${dir}, landing in ${setup.base}`);
console.log(`tests:   ${tests.file}, run with ${tests.run.join(" ")}`);
console.log(
	`vetting: each draft's examples, type snippets and existing tests on HEAD in a fresh copy, typechecked with ${setup.package}/${testTsconfig}`,
);
console.log(
	`types:   ${tests.typecheck?.snippets ?? "none: the package is not typechecked"}, typechecked on its own after each build`,
);
console.log(
	`checks:  ${testing.test.slice(2).join(" ")}, then the type snippets and existing tests alone`,
);
console.log(
	`api:     ${setup.package}'s export map, its declarations at HEAD against the change's`,
);
console.log(`agents:  Claude Code${process.env.MODEL ? ` (${process.env.MODEL})` : ""}`);
console.log(`jev:     real\n`);

const {final, diff, rewrite} = await Effect.runPromise(
	drive({
		issue: id,
		state: join(runDir, "state.json"),
		until,
		...(answer === undefined ? {} : {answer}),
	}).pipe(Effect.scoped, Effect.provide(layers)),
);
const ours = rewrite === null ? null : await saveEnrichment(runDir, rewrite);
if (until === "triage") {
	const theirs = join(runDir, "fabrika-enriched.md");
	const hasTheirs = await access(theirs).then(
		() => true,
		() => false,
	);
	printTriageEnd(final, rewrite, {ours, theirs: hasTheirs ? theirs : null});
} else {
	printEnd(final, diff, dir);
	if (ours !== null) console.log(`our enrichment: ${ours}`);
}
