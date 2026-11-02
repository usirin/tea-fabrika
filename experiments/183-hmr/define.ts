// Experiment 183: the shape every loaded program version has. The core keeps the model; a
// version only answers four pure calls across the isolate line: init, migrate, step and view.
// `migrate` is the state check from "an old host is named, then restarted": decode the saved
// model with this version's own schema, after an optional upcast, or refuse with a reason.
import {WorkerEntrypoint} from "cloudflare:workers";
import {Schema} from "effect";

type Msg = {type: string};
export type Migrated = {ok: true; model: unknown} | {ok: false; why: string};

export const define = <S>(spec: {
	state: Schema.Codec<S, unknown>;
	upcast?: (raw: unknown) => unknown;
	init: () => S;
	step: (model: S, msg: Msg) => S;
	view: (model: S) => string;
}) => {
	const decode = Schema.decodeUnknownSync(spec.state);
	return class Program extends WorkerEntrypoint {
		init() {
			return spec.init();
		}
		migrate(raw: unknown): Migrated {
			try {
				return {ok: true, model: decode(spec.upcast ? spec.upcast(raw) : raw)};
			} catch (e) {
				const said = e instanceof Error ? e.message : String(e);
				return {ok: false, why: said.replace(/\s+/g, " ").slice(0, 160)};
			}
		}
		step(model: S, msg: Msg) {
			return spec.step(model, msg);
		}
		view(model: S) {
			return spec.view(model);
		}
	};
};
