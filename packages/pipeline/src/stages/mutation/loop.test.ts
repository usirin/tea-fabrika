import {noSpend} from "@kampus/fabrika-old/agents/claude";
import {describe, expect, it} from "vitest";
import type {Result} from "../../controls.ts";
import {nameOf} from "../outcome.ts";
import {mutantsWriter} from "../test-writer/brief.ts";
import {
	type Answered,
	answering,
	killRan,
	type MutantAnswer,
	outcomeOf,
	startKills,
} from "../test-writer/mutants.ts";
import {DEFAULT_INCLUDES} from "../test-writer/written.ts";
import type {Survived} from "./mutant.ts";
import {ASK, drive, HEAD, ONE_SURVIVED, SCOPE, SURVIVED} from "./scripted.ts";

// The loop the plan names (docs/direction/a-ticket-runs-from-the-app.md,
// slice 5), on fakes: a planted weak test lets a mutant survive, the mutant
// goes back to the test writer's mutants job (its Draft, on a scripted
// writer), and a disable comment asks the owner.

const TEST_FILE = "src/clamp-above.test.ts";
const SURVIVED_ONLY = [SURVIVED];

/** The scripted writer's answer to one try, as the agent's run would send it. */
const said = (run: {readonly key: string; readonly id: string}, output: Answered) => ({
	type: "mutants_answer_finished" as const,
	key: run.key,
	id: run.id,
	output,
	session: "s",
	spend: noSpend,
});

/** The mutation step's report, handed to the writer as its brief. */
function briefFrom(survived: readonly Survived[]) {
	return mutantsWriter.fill({
		ticket: ASK.ticket,
		head: HEAD,
		survived,
		includes: [...DEFAULT_INCLUDES],
		taken: ["src/clamp.test.ts"],
	});
}

/** The writer answers through the refine combo: each try's problems go back to it. */
function answer(survived: readonly Survived[], tries: readonly Answered[]) {
	let s = answering.start("k", briefFrom(survived), 3);
	const prompts: string[] = [];
	for (const output of tries) {
		const run = answering.runOf(s);
		if (run === null) break;
		prompts.push(run.prompt);
		s = answering.update(s, said(run, output));
	}
	return {s, prompts};
}

describe("a mutant that survives goes back to the writer", () => {
	it("from the planted weak test to a test that kills it", () => {
		const {over} = drive({run: ONE_SURVIVED});
		if (over.phase !== "over" || over.report.ran === null) throw new Error("ran");
		expect(nameOf(over.outcome)).toBe("send:test_writer:mutant_survived");
		const survived = over.report.ran.survived;

		const kill: MutantAnswer = {
			mutant: SURVIVED.mutant,
			answer: "test",
			test: "holds a number above high",
			file: TEST_FILE,
		};
		const {s, prompts} = answer(survived, [
			{files: [], answers: []},
			{files: [{path: TEST_FILE, text: "// a test"}], answers: [kill]},
		]);
		// The first prompt names the mutant; the second is only what the Check found.
		expect(prompts[0]).toContain(
			`${SURVIVED.mutant} (EqualityOperator): \`n > high\` made \`n >= high\``,
		);
		expect(prompts[1]).toContain(`${SURVIVED.mutant} has no answer`);
		if (s.phase !== "done") throw new Error(s.phase);

		// Code checks the new test on both sides: red with the mutant in, green without.
		const [killing, cmds] = startKills("c".repeat(40), s.output.answers);
		const results: Record<string, Result> = {bad: "red", good: "green"};
		const after = cmds.reduce((k, cmd) => killRan(k, cmd, results[cmd.side] ?? null), killing);
		expect(outcomeOf(s.output.answers, after)).toEqual({kind: "done", part: false, findings: []});
	});

	it("refuses a writer that changes the existing test instead of adding one", () => {
		const {prompts} = answer(SURVIVED_ONLY, [
			{
				files: [{path: "src/clamp.test.ts", text: "// changed"}],
				answers: [{mutant: SURVIVED.mutant, answer: "test", test: "t", file: "src/clamp.test.ts"}],
			},
			{files: [], answers: [{mutant: SURVIVED.mutant, answer: "noise", why: "x"}]},
		]);
		expect(prompts[1]).toContain("`src/clamp.test.ts` exists already");
	});
});

describe("a disable comment asks the owner", () => {
	const COMMENT =
		"\t// Stryker disable next-line EqualityOperator: n equal to low returns low either way";

	it("the writer's `cannot` asks for one, the diff that adds it asks the owner, and the owner's approval lets it run", () => {
		const cannot: MutantAnswer = {
			mutant: SURVIVED.mutant,
			answer: "cannot",
			why: "n equal to low returns low either way",
		};
		const {s} = answer(SURVIVED_ONLY, [{files: [], answers: [cannot]}]);
		if (s.phase !== "done") throw new Error(s.phase);
		expect(outcomeOf(s.output.answers, {})).toEqual({kind: "ask", who: "owner", for: "disable"});

		const added = {file: "src/clamp.ts", line: 11, text: COMMENT};
		const scope = {...SCOPE, diff: {...SCOPE.diff, added: [...SCOPE.diff.added, added]}};
		const asked = drive({scope}).over;
		if (asked.phase !== "over") throw new Error("over");
		expect(nameOf(asked.outcome)).toBe("ask:owner:check_change");
		expect(asked.report.changes).toEqual([{kind: "disable", ...added, text: COMMENT.trim()}]);
		expect(asked.report.ran).toBeNull();

		const approved = drive({scope}, {...ASK, allowed: asked.report.changes}).over;
		expect(approved.phase === "over" && nameOf(approved.outcome)).toBe("done");
	});
});
