import {applyCell} from "@demlik/tea";
import {Effect, Exit, Layer} from "effect";
import type {Result} from "../../controls.ts";
import {mutationInterpret} from "./handlers.ts";
import {MOST, type Mutation, type MutationAsk, type MutationCmd, mutation} from "./machine.ts";
import {idOf, type Lived} from "./mutant.ts";
import type {Scope} from "./scope.ts";
import {MutationRunner, MutationScope, type Ran} from "./services.ts";

// The mutation step with no repository and no Stryker: fakes of its two
// services say what each read and run answers. For tests. `drive` steps the
// machine from `start` until it is over, the way the engine would, and
// answers each Cmd through the real handlers (./handlers.ts) over the fakes.

export const BASE = "b".repeat(40);
export const HEAD = "h".repeat(40);

export const ASK: MutationAsk = {
	ticket: "acme/widgets#7",
	base: BASE,
	head: HEAD,
	kept: [{file: "src/clamp.ts", name: "clamp"}],
	exam: ["packages/pipeline/src/stages/mutation/skip-list.ts"],
	allowed: [],
	seed: 49,
	most: MOST,
};

/** The build added two lines of `clamp`, and its test file. The kept Property's code is lines 9 to 14. */
export const SCOPE: Scope = {
	diff: {
		files: ["src/clamp.ts", "src/clamp.test.ts"],
		added: [
			{file: "src/clamp.ts", line: 12, text: "\tif (n > high) return high;"},
			{file: "src/clamp.ts", line: 13, text: "\treturn n;"},
			{file: "src/clamp.test.ts", line: 4, text: 'it("keeps a number inside", () => {'},
		],
	},
	kept: [{file: "src/clamp.ts", from: 9, to: 14}],
};

/** The planted weak test lets this mutant live: nothing checks a number above `high`. */
export const LIVED: Lived = {
	mutant: idOf({
		file: "src/clamp.ts",
		line: 12,
		column: 6,
		mutator: "EqualityOperator",
		replacement: "n >= high",
	}),
	mutator: "EqualityOperator",
	original: "n > high",
	replacement: "n >= high",
};

export const KILLED_ALL: Ran = {found: 12, ran: 12, skipped: 1, refused: 2, killed: 10, lived: []};
export const ONE_LIVED: Ran = {...KILLED_ALL, killed: 9, lived: [LIVED]};

/** What each outside thing answers. `undefined` on a slot: the default, which goes well. */
export interface Script {
	readonly scope?: Scope | "fail";
	readonly tests?: Result | "fail";
	readonly run?: Ran | "fail";
	/** Restart the process once, at this phase, before answering what is in flight. */
	readonly restartAt?: Mutation["phase"];
}

const fail = Effect.fail({_tag: "could_not_run" as const});

/** The two services, faked from a script. */
export const fakes = (script: Script) =>
	Layer.mergeAll(
		Layer.succeed(MutationScope, {
			read: () =>
				script.scope === "fail"
					? Effect.fail({_tag: "unknown" as const})
					: Effect.succeed(script.scope ?? SCOPE),
		}),
		Layer.succeed(MutationRunner, {
			tests: () => (script.tests === "fail" ? fail : Effect.succeed(script.tests ?? "green")),
			run: () => (script.run === "fail" ? fail : Effect.succeed(script.run ?? KILLED_ALL)),
		}),
	);

type AnyMsg = {readonly type: string; readonly [field: string]: unknown};
const step = (s: Mutation, msg: AnyMsg) =>
	applyCell<Mutation, AnyMsg, MutationCmd>(mutation, s, msg);

/** One Cmd, answered by its handler over the fakes, as the Msg the engine would send. */
function answer(cmd: MutationCmd, layer: Layer.Layer<MutationScope | MutationRunner>): AnyMsg {
	const run = (): Effect.Effect<
		unknown,
		{readonly _tag: string},
		MutationScope | MutationRunner
	> => {
		switch (cmd.type) {
			case "mutation_scope":
				return mutationInterpret.mutation_scope(cmd);
			case "mutation_tests":
				return mutationInterpret.mutation_tests(cmd);
			case "mutation_run":
				return mutationInterpret.mutation_run(cmd);
		}
	};
	const exit = Effect.runSyncExit(run().pipe(Effect.provide(layer)));
	if (Exit.isSuccess(exit)) return {type: `${cmd.type}_ok`, cmd, value: exit.value};
	const error = Exit.findErrorOption(exit);
	return {
		type: `${cmd.type}_err`,
		cmd,
		error: error._tag === "Some" ? error.value : {_tag: "unknown"},
	};
}

/** Run the machine from `start` to `over`. Every Cmd sent, in order. */
export function drive(script: Script, ask: MutationAsk = ASK) {
	const layer = fakes(script);
	const cmds: MutationCmd[] = [];
	let restarted = false;
	let [s, out] = step({phase: "idle"}, {type: "start", ask});
	for (let n = 0; n < 20 && s.phase !== "over"; n++) {
		cmds.push(...out);
		if (!restarted && script.restartAt === s.phase) {
			restarted = true;
			[s, out] = step(s, {type: "resume"});
			continue;
		}
		const cmd = out[0];
		if (cmd === undefined) throw new Error(`nothing in flight in ${s.phase}`);
		[s, out] = step(s, answer(cmd, layer));
	}
	if (s.phase !== "over") throw new Error(`still ${s.phase}`);
	return {over: s, cmds};
}
