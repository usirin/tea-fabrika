// Experiment 117: do promise records keep every formal check tied to the code
// it describes? Five breaks done on purpose, each in scratch commits on a
// throwaway worktree that is removed at the end.
//
//   node experiments/117-promises-stay-in-step.ts      # from the top of the repo
//
// No key, no network, no model. About 30 seconds. It writes what each case
// printed to experiments/results/117-promises-stay-in-step.json.
//
// The worktree is detached at this checkout's HEAD, so the records there are
// the committed ones. Each case starts from that HEAD again (`git reset --hard`
// inside the scratch worktree only), makes its edits, commits them, and runs
// `pnpm promises` or `pnpm promises gate --base <HEAD>`, the same commands CI runs.

import {spawnSync} from "node:child_process";
import {existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {splitPiece, textOf} from "@kampus/promises/blocks";
import {printOf} from "@kampus/promises/node";

const repo = process.cwd();
const SHIP = "promises/ship-ended-run-sends-nothing.json";
const MACHINE = "packages/pipeline/src/stages/ship/machine.ts";
const LAWS = "packages/pipeline/src/laws/ship.ts";
const CHECK = "packages/pipeline/src/laws/promise-check.ts";

interface Ran {
	readonly code: number;
	readonly out: string;
}

const env = (): Record<string, string> => ({
	PATH: process.env.PATH ?? "/usr/bin:/bin",
	HOME: process.env.HOME ?? "/",
});

function run(cwd: string, file: string, args: readonly string[]): Ran {
	const r = spawnSync(file, [...args], {cwd, env: env(), encoding: "utf8"});
	return {code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trimEnd()};
}

function must(cwd: string, file: string, args: readonly string[]): string {
	const r = run(cwd, file, args);
	if (r.code !== 0) throw new Error(`${file} ${args.join(" ")} failed:\n${r.out}`);
	return r.out;
}

const base = must(repo, "git", ["rev-parse", "HEAD"]);
const at = mkdtempSync(join(tmpdir(), "promises-117-"));
must(repo, "git", ["worktree", "add", "--detach", at, base]);
// The scratch worktree uses this checkout's installed packages.
for (const dir of [".", "packages/fabrika", "packages/pipeline", "packages/promises"])
	if (existsSync(join(repo, dir, "node_modules")))
		symlinkSync(join(repo, dir, "node_modules"), join(at, dir, "node_modules"));

const git = (...args: string[]) =>
	must(at, "git", ["-c", "user.name=experiment", "-c", "user.email=exp@example.invalid", ...args]);
const read = (file: string) => readFileSync(join(at, file), "utf8");
function edit(file: string, from: string, to: string) {
	const text = read(file);
	if (!text.includes(from)) throw new Error(`${file} has no ${JSON.stringify(from)}`);
	writeFileSync(join(at, file), text.replace(from, to));
}
const commit = (what: string) => {
	git("commit", "-qam", what);
	return git("rev-parse", "HEAD");
};
const promises = (...args: string[]) => run(at, "node", ["packages/promises/src/main.ts", ...args]);
const gate = () => promises("gate", "--base", base);

// The edits the cases make.
/** Covered, and the promise still holds: a resume at the end now says so twice. */
const GUARD = [
	'resume: (s): Step => ("asked" in s ? [s, [s.asked]] : stay(s)),',
	'resume: (s): Step => (s.phase !== "over" && "asked" in s ? [s, [s.asked]] : stay(s)),',
] as const;
/** Covered, and the promise breaks: the planted mistake, written into the real code. */
const BREAK = [
	'resume: (s): Step => ("asked" in s ? [s, [s.asked]] : stay(s)),',
	'resume: (s): Step =>\n\t\t\t\t"asked" in s ? [s, [s.asked]] : s.phase === "over" ? [s, [readShipFacts({pr: s.pr})]] : stay(s),',
] as const;

interface Case {
	readonly name: string;
	readonly expect: string;
	readonly steps: readonly {readonly did: string; readonly code: number; readonly out: string}[];
}
const cases: Case[] = [];

function scratch(name: string, expect: string, body: (say: (did: string, r: Ran) => void) => void) {
	git("reset", "-q", "--hard", base);
	const steps: {did: string; code: number; out: string}[] = [];
	body((did, r) => steps.push({did, code: r.code, out: r.out}));
	cases.push({name, expect, steps});
	const last = steps.at(-1);
	process.stdout.write(`\n=== ${name} (expect: ${expect})\n`);
	for (const s of steps) process.stdout.write(`--- ${s.did}: exit ${s.code}\n${s.out}\n`);
	return last;
}

try {
	scratch("0. nothing changed", "the gate passes", (say) => say("gate", gate()));

	scratch("1. covered code changed, record not moved", "the gate fails", (say) => {
		edit(MACHINE, ...GUARD);
		commit("guard resume at the end");
		say("gate", gate());
	});

	scratch(
		"1b. the same change, confirmed again (the whole example)",
		"the gate passes, no exam change",
		(say) => {
			edit(MACHINE, ...GUARD);
			commit("guard resume at the end");
			say("confirm", promises("confirm", "ship-ended-run-sends-nothing"));
			commit("confirm the ship promise again");
			say("gate", gate());
		},
	);

	scratch("2. code nothing covers changed", "the gate passes", (say) => {
		edit(MACHINE, "checksMs: 15 * 60_000, queueMs", "checksMs: 20 * 60_000, queueMs");
		commit("wait longer for checks");
		say("gate", gate());
	});

	scratch("2b. a covered block renamed", "the gate fails: the record points at nothing", (say) => {
		edit(MACHINE, "function revived(s: Ship): Ship {", "function revive(s: Ship): Ship {");
		edit(MACHINE, "revived(loaded)", "revive(loaded)");
		commit("rename revived");
		say("gate", gate());
	});

	scratch(
		"3. record moved by hand, check not green at the head",
		"the gate fails: the check broke",
		(say) => {
			edit(MACHINE, ...BREAK);
			const head = commit("read again on a resume after the end");
			// Write the record as if confirmed, without running the check: the prints match the new code.
			const record = JSON.parse(read(SHIP));
			const prints: Record<string, string> = {};
			for (const piece of Object.keys(record.confirmed.prints)) {
				const {file, name} = splitPiece(piece);
				const text = textOf(read(file), name);
				if (text !== null) prints[piece] = printOf(text);
			}
			record.confirmed = {commit: head, prints};
			writeFileSync(join(at, SHIP), `${JSON.stringify(record, null, "\t")}\n`);
			commit("move the record by hand");
			say("gate", gate());
		},
	);

	scratch(
		"4. covered code and the check changed, run green, record moved",
		"the gate passes, marked as an exam change",
		(say) => {
			edit(MACHINE, ...GUARD);
			edit(LAWS, "} after the run ended`", "} after the run was over`");
			commit("guard resume at the end, and reword the law's report");
			say("confirm", promises("confirm", "ship-ended-run-sends-nothing"));
			commit("confirm the ship promise again");
			say("gate", gate());
		},
	);

	scratch(
		"5a. the check made unable to fail",
		"pnpm promises shows the plant not caught",
		(say) => {
			edit(
				LAWS,
				'law<S, AnyShipMsg, ShipCmd>("an ended run sends nothing", (step) =>\n\t\t\tstep.prev.phase === "over"',
				'law<S, AnyShipMsg, ShipCmd>("an ended run sends nothing", (step) =>\n\t\t\tstep.prev.phase === "never"',
			);
			commit("the law looks at a phase that never comes");
			say("promises", promises());
			say("confirm", promises("confirm", "ship-ended-run-sends-nothing"));
		},
	);

	scratch(
		"5b. the planted break removed",
		"pnpm promises shows the plant gave no verdict",
		(say) => {
			edit(CHECK, "\t\t\tactsAfterTheEnd: ship.actsAfterTheEnd,\n", "");
			commit("drop the ship plant from the check");
			say("promises", promises());
		},
	);
} finally {
	run(repo, "git", ["worktree", "remove", "--force", at]);
	run(repo, "git", ["worktree", "prune"]);
}

const out = {
	experiment: 117,
	ran: new Date().toISOString().slice(0, 10),
	base: base.slice(0, 7),
	cases: cases.map((c) => ({
		...c,
		// Timings change from run to run; the rest does not.
		steps: c.steps.map((s) => ({...s, out: s.out.replace(/\(\d+ ms\)/g, "(… ms)")})),
	})),
};
writeFileSync(
	join(repo, "experiments/results/117-promises-stay-in-step.json"),
	`${JSON.stringify(out, null, "\t")}\n`,
);
process.stdout.write("\nwrote experiments/results/117-promises-stay-in-step.json\n");
