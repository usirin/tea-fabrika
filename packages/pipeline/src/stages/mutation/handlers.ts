import {Effect} from "effect";
import type {readScope, runMutants, runTests} from "./machine.ts";
import {MutationRunner, MutationScope} from "./services.ts";

// What answers the mutation step's Cmds. All three only read or run code;
// the machine writes nothing.

export const mutationInterpret = {
	mutation_scope: (cmd: ReturnType<typeof readScope>) =>
		Effect.gen(function* () {
			return yield* (yield* MutationScope).read(cmd.base, cmd.head, cmd.kept, cmd.exam);
		}),
	mutation_tests: (cmd: ReturnType<typeof runTests>) =>
		Effect.gen(function* () {
			return yield* (yield* MutationRunner).tests(cmd.head);
		}),
	mutation_run: (cmd: ReturnType<typeof runMutants>) =>
		Effect.gen(function* () {
			const {head, spans, seed, most} = cmd;
			return yield* (yield* MutationRunner).run({head, spans, seed, most});
		}),
};
