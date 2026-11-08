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
	failures: number[];
	pending: number;
	answer: "green" | "red" | "event" | "duplicate" | "app" | "ticket" | "trust-red";
	branch: string;
	merge: boolean;
	refused: "none" | "notes" | "branch";
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
  if (args[0] === "pr" && args[1] === "view") key = "head";
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
if (cmd === "date") { console.log("1794096000"); process.exit(0); }
die("unhandled tool: " + cmd);
`;
const run = (setup: Setup) => {
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
		const ran = spawnSync("sh", [script, "900", "520"], {
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
		const calls: Call[] = readFileSync(join(dir, "calls.jsonl"), "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(existsSync(join(dir, "boxes/catchup.lock"))).toBe(false);
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
