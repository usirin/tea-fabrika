import {readFlags, Shell} from "@kampus/fabrika-old";
import {describe, expect, it} from "vitest";
import {DEFAULT_SETTINGS} from "../settings.ts";
import {HOLDS_NOTHING, setupOf} from "../setup.ts";
import {defaultConfig} from "./config.ts";
import {programsOf} from "./fabrika-list.ts";

// What the launcher does from the line as typed, with no terminal: Tab
// completion, and which programs the command line lists. The Ctrl-R search
// and how the command line is read name no program of this package's: they
// are the shell's own tests (`@kampus/fabrika-old`'s shell/launch.test.ts).

const {complete, EMPTY} = Shell;
const list = programsOf(defaultConfig("/tsh"));
const JOBS: Shell.Jobs = {
	next: 2,
	jobs: [
		{
			n: 1,
			text: "tally",
			stages: [{program: "tally", flags: {}, run: "tally:0a1b2c3d", wire: null, ended: false}],
			state: "running",
			background: true,
			owner: null,
		},
	],
};
const candidates = (line: string, jobs: Shell.Jobs = EMPTY) =>
	complete(line, list, jobs).candidates;

describe("Tab completion", () => {
	it.each([
		["sh", ["ship"]],
		[
			"",
			[...list.keys(), "jobs", "ps", "tell", "close", "stop", "attach", "programs", "help", "exit"],
		],
		["seq --t", ["--to"]],
		["ship --mode ", ["read", "write"]],
		["ship --mode=", ["--mode=read", "--mode=write"]],
		["review-scripted --effort ", ["low", "medium", "high"]],
		["ship --mode read p", ["pr="]],
		["ship ", ["--mode", "--help", "pr=", "ask=", "forget="]],
		["ship --mode read ", ["pr=", "ask=", "forget="]],
		["ship --mode read --h", ["--help"]],
		["seq -", ["--to", "--help"]],
		["help sh", ["ship"]],
		["seq --to 3 | do", ["double"]],
		["seq --to 3 | ", [...list.keys()]],
		["double n=$(se", ["seq"]],
		["ship >f", [">found", ">forgot"]],
		["ship --help ", ["--mode", "pr", "ask", "forget", ">found", ">outcome", ">answer", ">forgot"]],
		["ship -h >o", [">outcome"]],
		["nope --", []],
		[`say --text "a b`, []],
	])("completes %j", (line, want) => {
		expect(candidates(line)).toEqual(want);
	});

	it("completes jobs from the table, and a job's inputs", () => {
		expect(candidates("tell ", JOBS)).toEqual(["%1", "tally:0a1b2c3d"]);
		expect(candidates("tell %1 ", JOBS)).toEqual(["add"]);
		expect(candidates("close tally:0a1b2c3d a", JOBS)).toEqual(["add"]);
		expect(candidates("stop %1 ", JOBS)).toEqual([]);
	});

	it("names the word it replaces, as typed", () => {
		expect(complete("seq --to 3 | do", list, EMPTY).word).toBe("do");
		expect(complete("ship --mode ", list, EMPTY).word).toBe("");
	});
});

describe("the command line", () => {
	it("lists a live review only when there is a clone to read code from", () => {
		expect(list.has("review")).toBe(false);
		expect(programsOf({...defaultConfig("/tsh"), clone: "/c"}).has("review")).toBe(true);
		expect(list.has("review-scripted")).toBe(true);
		expect(list.has("build") && list.has("operate")).toBe(true);
		expect(list.has("build-scripted")).toBe(false);
		expect(programsOf(defaultConfig("/tsh"), "/s").has("build-scripted")).toBe(true);
	});

	it("lists deliver only with a repository to write to and a check to run", () => {
		const base = defaultConfig("/tsh");
		const repo = {owner: "acme", name: "widgets"};
		const local = {model: null, effort: null, budget: null, rubrics: null};
		const places = {shipped: "/fabrika/rubrics", repo: "/r"};
		// A pnpm lockfile at main: its install is the check every review runs.
		const pnpm = setupOf(
			DEFAULT_SETTINGS,
			{files: new Set(["pnpm-lock.yaml"]), rubrics: {}},
			local,
			places,
		);
		const bare = setupOf(DEFAULT_SETTINGS, HOLDS_NOTHING, local, places);
		const at = (config: typeof base, setup: typeof pnpm) =>
			programsOf(config, undefined, undefined, undefined, setup).has("deliver");
		expect(list.has("deliver")).toBe(false);
		expect(at(base, pnpm)).toBe(false);
		expect(at({...base, repo}, bare)).toBe(false);
		expect(at({...base, repo}, pnpm)).toBe(true);
	});

	it("starts deliver with each step's own agent, as fabrika.toml's [agents.<step>] picked it", () => {
		const local = {model: null, effort: null, budget: null, rubrics: null};
		const settings = {
			...DEFAULT_SETTINGS,
			agents: {
				build: {model: "claude-sonnet-5-5", effort: "low", usd: 0.4},
				review: {model: "haiku", effort: "low", usd: 0.4},
			},
		} as const;
		const setup = setupOf(settings, {files: new Set(["pnpm-lock.yaml"]), rubrics: {}}, local, {
			shipped: "/fabrika/rubrics",
			repo: "/r",
		});
		const config = {...defaultConfig("/tsh"), repo: {owner: "acme", name: "widgets"}};
		const entry = programsOf(config, undefined, undefined, undefined, setup).get("deliver");
		if (entry === undefined) throw new Error("deliver is not listed");
		const read = readFlags(entry.program, {});
		if (read.kind !== "given") throw new Error(read.why);
		expect(read.flags.agents).toEqual({
			build: {model: "claude-sonnet-5-5", effort: "low", budget: 0.4},
			review: {model: "haiku", effort: "low", budget: 0.4},
			// No [agents.plan]: the default pick, said the same way at the start.
			plan: {model: "opus", effort: "medium", budget: 2},
		});
	});
});
