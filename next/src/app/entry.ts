import {WorkerEntrypoint} from "cloudflare:workers";
import {applyCell} from "@demlik/tea";
import {Schema} from "effect";
import type {Program} from "./program.ts";

// The loaded side of a program: what the hands bundle and the brain hands to Worker Loader, with no
// network (A4). The brain keeps the state and sends it with each Msg: Elm's update across the line
// (experiment 173's `Program`). The model goes to the isolate and back as plain data.
//
//   export const Program = entrypoint(counter);

/** A model and what a window gets from it. */
export type Stepped = {readonly model: unknown; readonly view: unknown};

/** What the brain can call on a loaded program. `step` throws on a Msg the program refuses. */
export type ProgramCalls = {
	init(): Promise<Stepped>;
	step(model: unknown, m: unknown): Promise<Stepped>;
};

export const entrypoint = <S, M extends {readonly type: string}, V>(program: Program<S, M, V>) => {
	const decodeMsg = Schema.decodeUnknownSync(program.msg);
	const encodeView = Schema.encodeSync(program.view.data);
	const stepped = (state: S): Stepped => ({
		model: state,
		view: encodeView(program.view.select(state)),
	});
	return class extends WorkerEntrypoint<unknown> implements ProgramCalls {
		async init(): Promise<Stepped> {
			const [state] = program.machine.init(null, undefined);
			return stepped(state);
		}
		// The model comes back from the brain as the same plain data it left as.
		async step(model: unknown, m: unknown): Promise<Stepped> {
			const [state] = applyCell<S, M, never>(program.machine, model as S, decodeMsg(m));
			return stepped(state);
		}
	};
};
