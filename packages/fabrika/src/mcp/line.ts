import { Schema } from "effect";
import { jsonSchemaOf } from "../program/shape.ts";
import { isOneLine } from "../shell/one-line.ts";
import { JobAnswer } from "./job.ts";
import type { Tool } from "./tools.ts";

// The `line` tool, beside `runs`, `job` and `stop`: an agent runs one line in its own tile, as a
// person types one there (tracker 185b). The agent's first line opens that tile, folded beside the
// person's, and its tsh runs as the agent: every job it starts is the agent's, by name. It never
// reaches a person's tile. A line can do what a person's line can, and that cannot be proven less,
// so it is destructive; `pipeline` reaches GitHub, so it is open-world; two of one line are two
// jobs, so it is not idempotent. MCP's four hints say so (spec 2025-11-25, "Tools"), and a client
// treats them as hints only.
//
//   agent   line {line: "pipeline --ticket 117 &"}
//   //      {_tag: "job", job: {n: 12, text: "pipeline --ticket 117 &", tile: "t2", state: {_tag: "running"}, lines: []}}
//   agent   line {line: "jobs"}
//   //      {_tag: "said", lines: ["[12] running   pipeline --ticket 117"], status: 0}
//   agent   line {line: "counter"}             while %12 runs in the foreground there:
//   //      refused: "claude's tile runs %12 in the foreground: stop it, or end the line with &"
//   agent   line {line: "a\nb"}                refused by the schema: the error names `line`
//
// There is no `background` flag: `&` in the line is the one way to say it, so a flag and an `&` can
// never disagree. The host runs the line (apps/fabrika, host/serve.ts).

/** The tool's name. A host tool's name has no `_`, so it is never a `<program>_<input>` name. */
export const LINE = "line";

/**
 * One line of tsh, as the agent would type it: 1 to 4096 characters, the most Linux's terminal
 * takes on one typed line (`N_TTY_BUF_SIZE`, drivers/tty/n_tty.c). The tile shows it as `$ <line>`
 * before it runs, so it holds no control character and no line separator: nothing in it can move
 * the cursor or start a row of its own there (../shell/one-line.ts).
 */
const Text = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(4096),
  Schema.makeFilter((line) => isOneLine(line) || "one line, with no newline, tab or other control character"),
);

/** What the tool takes: the line, and nothing else. */
export const LineAsk = Schema.Struct({ line: Text });
export type LineAsk = typeof LineAsk.Type;

/**
 * What a line came to. `job`: it started a job, the first one it started, as the `job` tool shows
 * it; `job` reads it on. `said`: it started none, and ended: what it printed, and its status.
 */
export const LineAnswer = Schema.TaggedUnion({
  job: { job: JobAnswer },
  said: { lines: Schema.Array(Schema.String), status: Schema.Int },
});
export type LineAnswer = typeof LineAnswer.Type;

/** The host would not run the line, and why, in words for the agent. */
export class LineRefused extends Schema.TaggedError<LineRefused>()("LineRefused", {
  why: Schema.String,
}) {}

export const LINE_TOOL: Tool = {
  name: LINE,
  description:
    "Run one line of tsh in your own tile, as a person types one: the programs, pipes and words a person's tile has, but no desk words. Your first line opens your tile beside the person's; every job a line starts there is yours. End the line with & to run it in the background, as in bash; a line without & runs in the foreground, and while one runs there, only a line with & is taken. Answers job, with the first job the line started, as the job tool shows it (read it on with job); or said, with what the line printed and its status, when it started none.",
  inputSchema: { ...jsonSchemaOf(LineAsk), type: "object" },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
};
