import {Schema} from "effect";

const Life = {
	id: Schema.NonEmptyString,
	start: Schema.NonEmptyString,
	at: Schema.Number,
};
const Reason = Schema.Literals(["open", "crash", "memory", "core"]);
const Exit = {
	exitCode: Schema.optionalKey(Schema.NullOr(Schema.Int)),
	signal: Schema.optionalKey(Schema.NullOr(Schema.String)),
	bytes: Schema.optionalKey(Schema.Int),
	backoff: Schema.optionalKey(Schema.Number),
};
export const BrainFact = Schema.TaggedUnion({
	started: {
		...Life,
		after: Schema.NullOr(Schema.String),
		build: Schema.String,
		why: Reason,
		pid: Schema.Int,
		...Exit,
	},
	exited: {...Life, why: Reason, ...Exit},
	restarting: {...Life, why: Reason, ...Exit, backoff: Schema.Number},
	braked: {...Life, why: Schema.Literals(["intensity", "restart_failed"]), ...Exit},
	stopped: {...Life, why: Schema.Literal("stop"), ...Exit},
});
