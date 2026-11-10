import { Duration, Schema } from "effect";
import { jsonSchemaOf } from "../program/shape.ts";
import { isOneLine } from "../shell/one-line.ts";
import { JobAnswer } from "./job.ts";
import type { Tool } from "./tools.ts";

// The `stop` tool, beside `runs` and `job`: an agent stops job n of the host's table, and must say
// why (tracker 185b). The host keeps the agent as the one who stopped it, in the job's record and
// its log, and the tile the job ran in says who and why. It writes, so the read-only door never
// lists it; a second stop of one job is the same as the first; it reaches nothing outside the host.
// MCP's four hints say so (spec 2025-11-25, "Tools"), and a client treats them as hints only.
//
//   tile t1   tsh$ counter &                     job %1, the person's
//   agent     stop {n: 1, why: "wrong ticket"}
//   //        {_tag: "stopped", job: {n: 1, text: "counter &", tile: "t1",
//   //         state: {_tag: "ended", how: "stopped"}, lines: [...]}}
//   tile t1   [1] stopped by agent:claude for:owner: wrong ticket
//   agent     stop {n: 2, why: "an old run"}      a detached job: {_tag: "dropped", n: 2, text: "..."}
//   agent     stop {n: 3, why: "..."}             asked, and not ended within 10 s: {_tag: "asked", n: 3}
//   agent     stop {n: 99, why: "..."}            refused: "there is no job 99 ..."
//   agent     stop {n: 1}                         refused by the schema: the error names `why`
//
// The host does the stop (apps/fabrika, host/serve.ts): only the tsh that started a job holds its
// runs, so the host says the stop first, then tells that tsh to stop it, as `stop %n` does.

/** The tool's name. A host tool's name has no `_`, so it is never a `<program>_<input>` name. */
export const STOP = "stop";

/**
 * How long a stopped job is given to end before the tool answers `asked`: the wait the window's
 * restart gives a host to exit (host/stop.ts in apps/fabrika). Our own number, reused.
 */
export const EXIT_WITHIN = Duration.seconds(10);

/**
 * Why a stop was asked, in the agent's words: 1 to 500 characters on one line, never none. The
 * person's tile shows it and the host's log writes it, so it holds no control character: no
 * newline or carriage return could start a line of its own there (../shell/one-line.ts).
 */
export const Why = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(500),
  Schema.makeFilter((why) => isOneLine(why) || "one line, with no newline, tab or other control character"),
);

/** What the tool takes: the job's number, `%n` on a line, and why. */
export const StopAsk = Schema.Struct({ n: Schema.Int, why: Why });
export type StopAsk = typeof StopAsk.Type;

/**
 * What a stop came to. `stopped`: it ran, and ended stopped, as the `job` tool shows it.
 * `dropped`: it was detached, so nothing of it ran; it left the table, as `stop %n` drops one.
 * `asked`: it was asked, and had not ended `EXIT_WITHIN` on; the `job` tool reads it later.
 */
export const StopAnswer = Schema.TaggedUnion({
  stopped: { job: JobAnswer },
  dropped: { n: Schema.Int, text: Schema.String },
  asked: { n: Schema.Int },
});
export type StopAnswer = typeof StopAnswer.Type;

/** The host would not stop the job, and why, in words for the agent: no job n, or one that ended. */
export class StopRefused extends Schema.TaggedError<StopRefused>()("StopRefused", {
  why: Schema.String,
}) {}

export const STOP_TOOL: Tool = {
  name: STOP,
  description: `Stop one job of the host's table, by its number (%n on a line, as jobs and runs show it), the person's or yours. why: what made you stop it, 1 to 500 characters on one line; the tile it ran in shows it to the person, and the job's record keeps it. A detached job (from before the host started again) is dropped. Answers stopped, with the job as the job tool shows it; dropped; or asked, when it has not ended ${Duration.toSeconds(EXIT_WITHIN)} s on: read it with job.`,
  inputSchema: { ...jsonSchemaOf(StopAsk), type: "object" },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
};
