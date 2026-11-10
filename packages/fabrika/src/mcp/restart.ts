import { Schema } from "effect";
import { jsonSchemaOf } from "../program/shape.ts";
import { Why } from "./stop.ts";
import type { Tool } from "./tools.ts";

// The `restart` tool, beside `runs`, `job` and `stop`: an agent restarts the host, and must say why
// (tracker 185b, PR 5). The host answers first, then ends as SIGTERM ends it: every tile's tsh
// stops, and every job stays in the table, detached. The app attached sees its link end and starts
// a host of its own build, which is how "pick up the new build" works. So a restart with no app
// attached is refused: the host would stay down. It writes, so the read-only door never lists it;
// a second restart is a second restart, so it is not idempotent; it reaches nothing outside the
// host. MCP's four hints say so (spec 2025-11-25, "Tools"), and a client treats them as hints only.
//
//   agent     restart {why: "pick up the new build"}
//   //        {_tag: "restarting", detached: [12]}
//   host/log  message=host_restart "by=agent:claude for:owner" "why=pick up the new build" detached=12 ...
//   agent     restart {why: "..."}    no app attached: refused, "no app is attached to start a new host"
//   agent     restart {}              refused by the schema: the error names `why`
//
// Who restarted is the agent its handshake named, never a field it sends: the tool takes only `why`.
// The host does the restart (apps/fabrika, host/serve.ts and host/restart.ts).

/** The tool's name. A host tool's name has no `_`, so it is never a `<program>_<input>` name. */
export const RESTART = "restart";

/** What the tool takes: why, in the agent's words, on one line (./stop.ts's `Why`). */
export const RestartAsk = Schema.Struct({ why: Why });
export type RestartAsk = typeof RestartAsk.Type;

/** The host will end now, and these jobs wait, detached, for the next host. */
export const RestartAnswer = Schema.TaggedStruct("restarting", {
  detached: Schema.Array(Schema.Int),
});
export type RestartAnswer = typeof RestartAnswer.Type;

/** The host would not restart, and why, in words for the agent: no app is attached to start the next. */
export class RestartRefused extends Schema.TaggedError<RestartRefused>()("RestartRefused", {
  why: Schema.String,
}) {}

export const RESTART_TOOL: Tool = {
  name: RESTART,
  description:
    "Restart the host: it ends now, and the app the person has open starts a new host of its own build, so the host picks up a new build. Every job stays in the table, detached, as the job tool then shows it. why: what made you restart it, 1 to 500 characters on one line; the person's top bar and tiles show it once. Refused when no app is attached, since nothing would start the new host. Answers restarting, with the jobs left detached. While the host is down, a call is answered with an error that says so: call again.",
  inputSchema: { ...jsonSchemaOf(RestartAsk), type: "object" },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
};
