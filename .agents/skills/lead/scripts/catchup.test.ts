import {spawnSync} from "node:child_process";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import fc from "fast-check";
import {describe, expect, it} from "vitest";

// Today's tooling. Every command that can reach GitHub, git or a signing key is a local stub.
const script = join(import.meta.dirname, "catchup.sh");
const tip = "0123456789abcdef0123456789abcdef01234567";
const reads = ["head", "checks", "trust", "apps", "logs"] as const;
const options = {seed: 520, numRuns: 12};
type Call = {cmd: string; args: string[]; key?: string};
type Setup = {
	repo?: string;
	failures: number[];
	pending: number;
	answer: "green" | "red" | "event" | "duplicate" | "app" | "ticket" | "trust-red";
	branch: string;
	merge: boolean;
	refused: "none" | "notes" | "branch";
	// In a gh stack: `gh pr merge` refuses, and the head read again is `moved` or not.
	stack?: "none" | "same" | "moved";
	// Seconds since the start, read by `date` after that many check reads (the last one repeats).
	clock?: number[];
};
const green: Setup = {
	failures: [0, 0, 0, 0, 0],
	pending: 0,
	answer: "green",
	branch: "fabrikalfa/tests-520",
	merge: false,
	refused: "none",
};
// The stub uses the platform's absolute Node executable. Its PATH never contains a real gh,
// node or pnpm, and each write-capable command is refused unless handled here.
const stub = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const dir = process.env.CATCHUP_FIXTURE;
const setup = JSON.parse(fs.readFileSync(path.join(dir, "setup.json"), "utf8"));
const stateFile = path.join(dir, "state.json");
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {};
const cmd = path.basename(process.argv[1]);
const args = process.argv.slice(2);
let key;
if (cmd === "gh") {
  if (args[0] === "pr" && args[1] === "view") key = args.includes("headRefOid") ? "oid" : "head";
  else if (args[0] === "stack" && args[1] === "merge") key = "stack";
  else if (args[0] === "pr" && args[1] === "merge") key = "merge";
  else if (args[0] === "run" && args[1] === "view") key = "logs";
  else if (args[0] === "api" && args[1].includes("check_name=")) key = "apps";
  else if (args[0] === "api" && args[1].includes("check-runs?")) key = "checks";
  else if (args[0] === "api" && args[1].includes("actions/runs?")) key = "trust";
}
fs.appendFileSync(path.join(dir, "calls.jsonl"), JSON.stringify({cmd, args, key}) + "\n");
const die = (text) => { console.error(text); process.exit(1); };
if (cmd === "gh") {
  if (!key) die("unhandled gh command");
  const n = state[key] || 0;
  state[key] = n + 1;
  fs.writeFileSync(stateFile, JSON.stringify(state));
  const index = ["head", "checks", "trust", "apps", "logs"].indexOf(key);
  if (index >= 0 && n < setup.failures[index]) {
    // Failed logs can still print a plausible result. Exit status must win.
    if (key === "logs") console.log("commits\tcheck\t2026-11-08T00:00:00Z commits: 3 commits, ticket 520");
    die("temporary " + key + " read failure");
  }
  if (key === "head") console.log(setup.branch);
  if (key === "oid") console.log(setup.stack === "moved" ? "f".repeat(40) : process.env.CATCHUP_TIP);
  if (key === "merge" && setup.stack && setup.stack !== "none")
    die("This pull request is part of a stack and must be merged using the asynchronous merge REST API");
  if (key === "checks") {
    const pending = n - setup.failures[index] < setup.pending;
    for (const name of ["check", "e2e", "next", "commits"]) {
      const red = setup.answer === "red" && name === "check";
      console.log(name + "\t" + (pending ? "in_progress\t" : "completed\t" + (red ? "failure" : "success")));
    }
  }
  if (key === "trust") {
    const event = setup.answer === "event" ? "push" : "pull_request_target";
    const result = setup.answer === "trust-red" ? "failure" : "success";
    console.log("71\t" + event + "\tcompleted\t" + result + "\t81");
    if (setup.answer === "duplicate") console.log("72\tpull_request_target\tcompleted\tsuccess\t82");
  }
  if (key === "apps") console.log(setup.answer === "app" ? "impostor" : "github-actions");
  if (key === "logs") console.log("commits\tcheck\t2026-11-08T00:00:00Z commits: 3 commits, ticket " + (setup.answer === "ticket" ? "521" : "520"));
  process.exit(0);
}
if (cmd === "git") {
  if (setup.repo && (args.includes("merge-base") || args.includes("merge"))) {
    const at = args.includes("merge-base") ? args.indexOf("merge-base") : args.indexOf("merge");
    const ran = require("node:child_process").spawnSync("/usr/bin/git", ["-C", setup.repo, ...args.slice(at)], {encoding: "utf8"});
    process.stdout.write(ran.stdout || ""); process.stderr.write(ran.stderr || "");
    process.exit(ran.status ?? 1);
  }
  if (args.includes("merge-base")) process.exit(setup.merge ? 1 : 0);
  if (args[0] === "rev-parse") console.log(args.includes("--short") ? process.env.CATCHUP_TIP.slice(0, 7) : process.env.CATCHUP_TIP);
  else if (args[0] === "push" && setup.refused === "branch") die("branch push refused");
  else if (!["fetch", "checkout", "push", "rev-parse"].includes(args[0]) && !args.includes("merge")) die("unhandled git command");
  process.exit(0);
}
if (cmd === "node") {
  if (!args[0].endsWith("/botpush.mjs")) die("unhandled node command");
  if (setup.refused === "notes" || setup.refused === "branch" && setup.branch.startsWith("fabrikalfa/")) die("atomic push refused");
  process.exit(0);
}
if (cmd === "pnpm" || cmd === "nice") process.exit(0);
if (cmd === "sleep") process.exit(0);
if (cmd === "date") {
  const clock = setup.clock || [0];
  console.log(String(1794096000 + clock[Math.min(state.checks || 0, clock.length - 1)]));
  process.exit(0);
}
die("unhandled tool: " + cmd);
`;
const run = (setup: Setup, args: string[] = []) => {
	const dir = mkdtempSync(join(tmpdir(), "cu-"));
	try {
		const bin = join(dir, "bin");
		mkdirSync(bin);
		mkdirSync(join(dir, "home"));
		mkdirSync(join(dir, "boxes/catchup-900/node_modules"), {recursive: true});
		writeFileSync(join(dir, "setup.json"), JSON.stringify(setup));
		for (const cmd of ["gh", "git", "node", "pnpm", "nice", "sleep", "date"]) {
			writeFileSync(join(bin, cmd), `#!${process.execPath}\n${stub}`, {mode: 0o755});
		}
		const ran = spawnSync("sh", [script, "900", "520", ...args], {
			encoding: "utf8",
			timeout: 15_000,
			env: {
				...process.env,
				PATH: `${bin}:/usr/bin:/bin`,
				HOME: join(dir, "home"),
				FABRIKA_HOME: join(dir, "fh"),
				FABRIKA_COAUTHOR: "Fixture <fixture@example.test>",
				MAIN: dir,
				BOXES: join(dir, "boxes"),
				REMOTE: "https://github.com/fixture/repo.git",
				GH_REPO: "fixture/repo",
				CATCHUP_FIXTURE: dir,
				CATCHUP_TIP: tip,
				TYPESAFE_API_KEY: undefined,
			},
		});
		expect(ran.error).toBeUndefined();
		expect(ran.signal).toBeNull();
		const calls: Call[] = (
			existsSync(join(dir, "calls.jsonl")) ? readFileSync(join(dir, "calls.jsonl"), "utf8") : ""
		)
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line));
		expect(existsSync(join(dir, "boxes/catchup.lock"))).toBe(false);
		// Its own checkout is gone once the run passed the usage check, success or failure.
		if (calls.length > 0) expect(existsSync(join(dir, "boxes/catchup-900"))).toBe(false);
		return {code: ran.status, text: ran.stdout + ran.stderr, calls};
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
};
const merges = (calls: Call[]) => calls.filter((c) => c.key === "merge");
const assertHead = (calls: Call[]) => {
	for (const call of merges(calls)) {
		expect(call.args).toContain("--match-head-commit");
		expect(call.args[call.args.indexOf("--match-head-commit") + 1]).toBe(tip);
	}
	for (const call of calls.filter((c) => c.key && ["checks", "trust", "apps"].includes(c.key))) {
		expect(call.args[1]).toContain(tip);
	}
};

describe("catchup, today's tooling", () => {
	// Plants: merge without --squash; omit the head pin; do work after extra options; skip the head
	// read before a stack merge; stack-merge a PR whose head moved.
	it("T300 squash only, pinned to the checked head, and a stack lands by gh stack merge", () => {
		fc.assert(
			fc.property(
				fc.record({
					merge: fc.boolean(),
					answer: fc.constantFrom<Setup["answer"]>("green", "red", "ticket"),
					pending: fc.integer({min: 0, max: 1}),
					stack: fc.constantFrom<NonNullable<Setup["stack"]>>("none", "same", "moved"),
				}),
				({merge, answer: outcome, pending, stack}) => {
					for (const answer of new Set<Setup["answer"]>(["green", outcome])) {
						const got = run({...green, merge, answer, pending, stack});
						const reached = answer === "green";
						const lands = reached && stack !== "moved";
						expect(got.code, got.text).toBe(lands ? 0 : 1);
						const tried = merges(got.calls);
						expect(tried).toHaveLength(reached ? 1 : 0);
						for (const call of tried) {
							expect(
								call.args.filter((a) => a.startsWith("--") && a !== "--match-head-commit"),
							).toEqual(["--squash"]);
						}
						const stacked = got.calls.filter((c) => c.key === "stack");
						expect(stacked.map((c) => c.args)).toEqual(
							reached && stack === "same" ? [["stack", "merge", "900", "--squash", "--yes"]] : [],
						);
						expect(got.calls.filter((c) => c.key === "oid")).toHaveLength(
							reached && stack !== "none" ? 1 : 0,
						);
						assertHead(got.calls);
					}
					for (const args of [
						["--merge-method", "squash"],
						["--merge-method", "merge"],
						["--unknown"],
					]) {
						const got = run(green, args);
						expect(got.code, got.text).toBe(1);
						expect(got.calls).toEqual([]);
					}
				},
			),
			{seed: 300, numRuns: 5},
		);
	});

	// Plants: remove union; retain one side; deduplicate IDs. Plain conflicts must still abort.
	it("T300 real git preserves both field logs and aborts other conflicts without a push", () => {
		fc.assert(
			fc.property(
				fc.array(
					fc.record({
						id: fc.integer({min: 0, max: 2}),
						text: fc.stringMatching(/^[a-z]{1,8}$/),
					}),
					{minLength: 1, maxLength: 3},
				),
				(rows) => {
					for (const conflict of [false, true]) {
						const dir = mkdtempSync(join(tmpdir(), "cu-log-"));
						const git = (...args: string[]) => {
							const ran = spawnSync("/usr/bin/git", ["-C", dir, ...args], {
								encoding: "utf8",
								timeout: 5_000,
								env: {
									...process.env,
									GIT_CONFIG_NOSYSTEM: "1",
									GIT_CONFIG_GLOBAL: "/dev/null",
									GIT_ATTR_NOSYSTEM: "1",
									GIT_TERMINAL_PROMPT: "0",
								},
							});
							expect(ran.error).toBeUndefined();
							expect(ran.status, ran.stderr).toBe(0);
							return ran.stdout.trim();
						};
						try {
							git("init", "-q", "--initial-branch=main");
							git("config", "user.name", "Fixture");
							git("config", "user.email", "fixture@example.test");
							git("config", "core.attributesFile", "/dev/null");
							expect(git("remote")).toBe("");
							mkdirSync(join(dir, "field"));
							writeFileSync(
								join(dir, ".gitattributes"),
								readFileSync(join(import.meta.dirname, "../../../../.gitattributes")),
							);
							const prefix = rows.map((r) => JSON.stringify({...r, side: "base"}));
							const tails = ["ours", "theirs"].map((side) =>
								rows.map((r) => JSON.stringify({...r, side})),
							);
							const logs = ["runs", "notes"].map((name) => join(dir, `field/${name}.jsonl`));
							for (const log of logs) writeFileSync(log, `${prefix.join("\n")}\n`);
							writeFileSync(join(dir, "ordinary.txt"), "base\n");
							git("add", ".");
							git("commit", "-qm", "base");
							git("branch", "peer");
							for (const [i, branch] of ["main", "peer"].entries()) {
								git("checkout", "-q", branch);
								for (const log of logs)
									writeFileSync(log, `${[...prefix, ...tails[i]!].join("\n")}\n`);
								if (conflict) writeFileSync(join(dir, "ordinary.txt"), `${branch}\n`);
								git("add", ".");
								git("commit", "-qm", branch);
							}
							git("update-ref", "refs/remotes/origin/main", "peer");
							git("checkout", "-q", "main");
							const before = git("rev-parse", "HEAD");
							const got = run({...green, merge: true, repo: dir});
							expect(got.code, got.text).toBe(conflict ? 1 : 0);
							if (conflict) {
								expect(git("rev-parse", "HEAD")).toBe(before);
								expect(git("status", "--porcelain")).toBe("");
								expect(
									got.calls.some(
										(c) =>
											c.cmd === "node" ||
											c.cmd === "pnpm" ||
											c.args[0] === "push" ||
											c.key === "merge",
									),
								).toBe(false);
							} else
								for (const log of logs) {
									const actual = readFileSync(log, "utf8").trimEnd().split("\n");
									expect(actual.sort()).toEqual([...prefix, ...tails.flat()].sort());
									for (const line of actual) expect(() => JSON.parse(line)).not.toThrow();
								}
						} finally {
							rmSync(dir, {recursive: true, force: true});
						}
					}
				},
			),
			{seed: 300, numRuns: 5},
		);
	});
	// Plant: exit on the first read failure, or allow a fourth attempt.
	it("brief read failures recover within the three-attempt budget", () => {
		fc.assert(
			fc.property(
				fc.array(fc.integer({min: 0, max: 4}), {minLength: 5, maxLength: 5}),
				(failures) => {
					const got = run({...green, failures});
					const stopped = failures.findIndex((n) => n >= 3);
					expect(got.code, got.text).toBe(stopped < 0 ? 0 : 1);
					for (const [i, key] of reads.entries()) {
						const expected = stopped >= 0 && i > stopped ? 0 : Math.min(failures[i]! + 1, 3);
						expect(got.calls.filter((c) => c.key === key).length, key).toBe(expected);
					}
					const waits = failures
						.slice(0, stopped < 0 ? 5 : stopped + 1)
						.flatMap((n) => (n === 0 ? [] : n === 1 ? ["1"] : ["1", "2"]));
					expect(got.calls.filter((c) => c.cmd === "sleep").map((c) => c.args[0])).toEqual(waits);
					expect(merges(got.calls)).toHaveLength(stopped < 0 ? 1 : 0);
					if (stopped > 0) expect(got.text).toContain(tip);
					if (stopped >= 0) expect(got.text).toContain("gh");
					assertHead(got.calls);
				},
			),
			options,
		);
	});

	// Plant: retry a successful red answer, mask failed logs, or use a different merge head.
	it("red and untrusted answers never merge or get retried as transport failures", () => {
		fc.assert(
			fc.property(
				fc.record({
					answer: fc.constantFrom<Setup["answer"]>(
						"green",
						"red",
						"event",
						"duplicate",
						"app",
						"ticket",
						"trust-red",
					),
					pending: fc.integer({min: 0, max: 2}),
					logFailures: fc.integer({min: 3, max: 4}),
					failures: fc.array(fc.integer({min: 0, max: 2}), {minLength: 5, maxLength: 5}),
				}),
				({answer, pending, failures, logFailures}) => {
					const failedLogs = run({...green, failures: [0, 0, 0, 0, logFailures]});
					expect(failedLogs.code, failedLogs.text).toBe(1);
					expect(merges(failedLogs.calls)).toHaveLength(0);
					expect(failedLogs.calls.filter((c) => c.key === "logs")).toHaveLength(3);
					const got = run({...green, answer, pending, failures});
					const stop = {
						green: 5,
						red: 1,
						event: 2,
						duplicate: 2,
						app: 3,
						ticket: 4,
						"trust-red": 2,
					}[answer];
					expect(got.code, got.text).toBe(answer === "green" ? 0 : 1);
					expect(merges(got.calls)).toHaveLength(answer === "green" ? 1 : 0);
					for (const [i, key] of reads.entries()) {
						const count = i > stop ? 0 : failures[i]! + 1 + (key === "checks" ? pending : 0);
						expect(got.calls.filter((c) => c.key === key).length, key).toBe(count);
					}
					assertHead(got.calls);
				},
			),
			options,
		);
	});

	// Plant: test the deadline only after the green-and-complete break, as review round 4 found.
	// The clock moves with each check read, so the law holds wherever the script reads `date`.
	it("no merge once the clock is past the hour, and a green answer in time still merges", () => {
		fc.assert(
			fc.property(
				fc.record({
					pending: fc.integer({min: 0, max: 3}),
					// One step per check read. 3,600 itself is left out: the law is about either side.
					steps: fc.array(fc.integer({min: 0, max: 2500}), {minLength: 4, maxLength: 4}),
				}),
				({pending, steps}) => {
					const clock = [0];
					for (const step of steps) clock.push(clock.at(-1)! + step);
					const seconds = clock.map((t) => (t === 3600 ? 3601 : t));
					// The green answer is the check read after the pending ones.
					const late = seconds[pending + 1]! >= 3600;
					const got = run({...green, pending, clock: seconds});
					expect(got.code, got.text).toBe(late ? 1 : 0);
					expect(merges(got.calls)).toHaveLength(late ? 0 : 1);
					if (late) expect(got.text).toMatch(/not done .* after an hour/);
					else expect(got.text).not.toContain("after an hour");
					assertHead(got.calls);
				},
			),
			{
				...options,
				// pinned: ticket 520 review round 4, a green answer at 3,601 seconds still merged.
				examples: [[{pending: 0, steps: [3601, 0, 0, 0]}]],
			},
		);
	});

	// Plant: push a branch twice, or continue after either push is refused.
	it("each push sends its intended refs once and refusal stops", () => {
		fc.assert(
			fc.property(
				fc.record({
					bot: fc.boolean(),
					suffix: fc.nat({max: 99}),
					merge: fc.boolean(),
					refused: fc.constantFrom<Setup["refused"]>("none", "notes", "branch"),
				}),
				({bot, suffix, merge, refused: outcome}) => {
					for (const refused of new Set<Setup["refused"]>(["none", outcome])) {
						const branch = `${bot ? "fabrikalfa" : "person"}/tests-${suffix}`;
						const got = run({...green, branch, merge, refused});
						const denied = merge && refused !== "none";
						expect(got.code, got.text).toBe(denied ? 1 : 0);
						const botpush = got.calls.filter((c) => c.cmd === "node");
						expect(botpush.map((c) => c.args.slice(1))).toEqual(
							!merge ? [] : bot ? [[".", branch, tip]] : [[".", "-"]],
						);
						const pushes = got.calls.filter((c) => c.cmd === "git" && c.args[0] === "push");
						expect(pushes.map((c) => c.args)).toEqual(
							merge && !bot && refused !== "notes"
								? [["push", "-q", "origin", `${tip}:refs/heads/${branch}`]]
								: [],
						);
						expect(merges(got.calls)).toHaveLength(denied ? 0 : 1);
						assertHead(got.calls);
					}
				},
			),
			{...options, numRuns: 8},
		);
	});
});
