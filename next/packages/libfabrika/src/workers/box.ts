import {WorkerEntrypoint} from "cloudflare:workers";
import {Effect} from "effect";
import {Declaration, nodeExecution} from "../app/execution.ts";
import {stepper} from "../app/program.ts";

export const programBox = (declared: unknown, build: string) => {
	const pure = stepper(declared);
	const execution = nodeExecution(declared, build);
	const declaration = Declaration.make({
		name: pure.program.name,
		v: pure.program.state.v,
		writes: Object.fromEntries(
			Object.entries(pure.program.writes).map(([name, p]) => [name, {personOnly: p.personOnly}]),
		),
		inputs: Object.fromEntries(
			Object.entries(pure.program.inputs).map(([name, p]) => [
				name,
				{write: p._tag === "write", personOnly: p._tag === "write" && p.personOnly},
			]),
		),
		cmds: (pure.program.machine.cmds ?? []).map((d) => d.cmdType),
	});
	return class ProgramBox extends WorkerEntrypoint {
		describe() {
			return declaration;
		}
		init(saved: unknown) {
			// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Worker Loader RPC must answer a Promise
			return Effect.runPromise(execution.init(saved));
		}
		step(model: unknown, msg: unknown) {
			// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Worker Loader RPC must answer a Promise
			return Effect.runPromise(execution.step(model, msg));
		}
		fold(model: unknown, msg: unknown) {
			// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Worker Loader RPC must answer a Promise
			return Effect.runPromise(execution.fold(model, msg));
		}
		upgrade(saved: unknown) {
			// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Worker Loader RPC must answer a Promise
			return Effect.runPromise(execution.upgrade(saved));
		}
		reply(cmd: unknown, outcome: unknown) {
			// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Worker Loader RPC must answer a Promise
			return Effect.runPromise(execution.reply(cmd, outcome));
		}
		check(kind: string, fact: unknown) {
			// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Worker Loader RPC must answer a Promise
			return Effect.runPromise(execution.check(kind, fact));
		}
		admit(m: unknown) {
			// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Worker Loader RPC must answer a Promise
			return Effect.runPromise(execution.admit(m));
		}
	};
};
