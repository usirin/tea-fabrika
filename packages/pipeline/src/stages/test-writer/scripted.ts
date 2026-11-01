import {applyCell} from "@demlik/tea";
import {noSpend} from "@kampus/fabrika-old/agents/claude";
import type {Result} from "../../controls.ts";
import {make} from "../../entity.ts";
import {type Property, PropertyId} from "./brief.ts";
import type {Checked} from "./checked.ts";
import {runSub, type TestsAsk, type TestWriter, type TestWriterCmd, testWriter} from "./machine.ts";
import {DEFAULT_INCLUDES, type Written} from "./written.ts";

// The test writer with no agent, no box and no test runner: a script says
// what the writer hands back on each try and what each Cmd answers. For
// tests. `drive` steps the machine from `start` until it is over, the way the
// engine would, and keeps every Cmd and prompt in order.

export const pid = make(PropertyId);

/** A new Property: its test must be red on the base. */
export const P1: Property = {
	id: pid("p1"),
	when: "a child exits with no outcome row",
	result: "the lane ends that child as stuck:no_outcome within 5 s",
	why: "today the lane waits for that row for good",
	behavior: "new",
	tool: "test",
	code: [],
};

/** An existing Property: its test must be green on the base. */
export const P2: Property = {
	id: pid("p2"),
	when: "a child writes a done row and exits",
	result: "the lane reads that row and moves on",
	why: "the fix must not end a healthy child as stuck",
	behavior: "existing",
	tool: "test",
	code: [{file: "packages/pipeline/src/hosted/lane.ts", name: "handlers"}],
};

export const BASE = "b".repeat(40);
export const COMMIT = "c".repeat(40);

export const ASK: TestsAsk = {
	ticket: "acme/widgets#7",
	plan: {version: 1, summary: "The hosted lane ends a child that exits with no row."},
	base: BASE,
	properties: [P1, P2],
	pointers: [
		{at: "packages/pipeline/src/hosted/lane-ends.ts", why: "a property test of this hang"},
	],
	includes: [...DEFAULT_INCLUDES],
	tries: 3,
};

export const TAKEN = ["packages/pipeline/src/hosted/lane.test.ts"];

/** A good answer: one new test file, one test per Property. */
export const GOOD: Written = {
	files: [{path: "packages/pipeline/src/hosted/lane-ends.test.ts", text: "// two tests"}],
	answers: [
		{
			property: pid("p1"),
			kind: "test",
			file: "packages/pipeline/src/hosted/lane-ends.test.ts",
			name: "ends a child with no row",
		},
		{
			property: pid("p2"),
			kind: "test",
			file: "packages/pipeline/src/hosted/lane-ends.test.ts",
			name: "reads a done row",
		},
	],
};

/** What each outside thing answers. `undefined` on a slot: the default, which goes well. */
export interface Script {
	/** The writer's answer on each try, in order: an answer, `null` (it does not fit), or a failure. */
	readonly drafts: readonly (Written | null | {readonly error: string})[];
	readonly taken?: readonly string[] | "fail";
	readonly commit?: string | "fail";
	/** The run on the base: a result per Property, or a failure. */
	readonly run?: Readonly<Record<string, Result>> | "fail";
	readonly record?: "ok" | "fail";
	/** What the ledger shows after the write. Default: what was written. */
	readonly back?: (wrote: readonly Checked[]) => readonly Checked[];
	/** Restart the process once, at this phase, before answering what is in flight. */
	readonly restartAt?: TestWriter["phase"];
}

type AnyMsg = {readonly type: string; readonly [field: string]: unknown};
const step = (s: TestWriter, msg: AnyMsg) =>
	applyCell<TestWriter, AnyMsg, TestWriterCmd>(testWriter, s, msg);

const ok = (cmd: TestWriterCmd, value: unknown): AnyMsg => ({type: `${cmd.type}_ok`, cmd, value});
const err = (cmd: TestWriterCmd): AnyMsg => ({
	type: `${cmd.type}_err`,
	cmd,
	error: {_tag: cmd.type === "tests_on_base" ? "could_not_run" : "unknown"},
});

/** `wrote`: the `checked` facts the last record wrote, which the read after it shows by default. */
function answer(cmd: TestWriterCmd, script: Script, wrote: readonly Checked[]): AnyMsg {
	switch (cmd.type) {
		case "tests_taken":
			return script.taken === "fail" ? err(cmd) : ok(cmd, script.taken ?? TAKEN);
		case "tests_commit":
			return script.commit === "fail" ? err(cmd) : ok(cmd, script.commit ?? COMMIT);
		case "tests_on_base": {
			if (script.run === "fail") return err(cmd);
			const run = script.run ?? {p1: "red", p2: "green"};
			return ok(
				cmd,
				cmd.tests.flatMap((t) => {
					const result = run[t.property];
					return result === undefined ? [] : [{property: t.property, result}];
				}),
			);
		}
		case "tests_record":
			return script.record === "fail" ? err(cmd) : ok(cmd, null);
		case "tests_checked":
			return ok(cmd, script.back === undefined ? wrote : script.back(wrote));
	}
}

/** Run the machine from `start` to `over`. Every Cmd sent and every prompt the writer saw, in order. */
export function drive(script: Script, ask: TestsAsk = ASK) {
	const cmds: TestWriterCmd[] = [];
	const prompts: string[] = [];
	let restarted = false;
	let wrote: readonly Checked[] = [];
	let [s, out] = step({phase: "idle"}, {type: "start", ask, key: "k"});
	let drafts = 0;
	for (let n = 0; n < 50 && s.phase !== "over"; n++) {
		cmds.push(...out);
		if (!restarted && script.restartAt === s.phase) {
			restarted = true;
			[s, out] = step(s, {type: "resume"});
			continue;
		}
		const cmd = out[0];
		if (cmd !== undefined) {
			if (cmd.type === "tests_record") wrote = cmd.checked;
			[s, out] = step(s, answer(cmd, script, wrote));
			continue;
		}
		const run = runSub.deps(s);
		if (run === null || run === undefined) throw new Error(`nothing in flight in ${s.phase}`);
		prompts.push(run.prompt);
		const said = script.drafts[drafts++];
		if (said === undefined) throw new Error("the script has no more drafts");
		const msg =
			said !== null && "error" in said
				? {type: "tests_write_failed", key: run.key, id: run.id, error: said.error, spend: noSpend}
				: {
						type: "tests_write_finished",
						key: run.key,
						id: run.id,
						output: said,
						session: "s",
						spend: {...noSpend, costUsd: 0.25},
					};
		[s, out] = step(s, msg);
	}
	if (s.phase !== "over") throw new Error(`still ${s.phase}`);
	return {over: s, cmds, prompts};
}
