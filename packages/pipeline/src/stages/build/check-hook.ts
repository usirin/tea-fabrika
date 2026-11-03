// The builder's check as a Claude Code command hook: the ACP path's way to
// run it before every tool call, the calls the CLI never asks about too.
// The CLI starts it once per call, with the call as JSON on stdin:
//
//   node check-hook.ts <tree> <log>     {"tool_name": "Read", "tool_input": {...}} on stdin
//
// It answers with `builderCheck` (./check.ts), the function the SDK path's
// hooks are made of: nothing for a call it allows, and a PreToolUse deny with
// the reason for one it refuses, which the model reads. A hook function cannot
// cross ACP (`_meta` is JSON); a command hook is a line of settings, so it can
// (`hookSettings`, ./builder-acp.ts). Experiment 77.
//
// Each decision is appended to <log> as one JSON line, `{tool, why}`, `why`
// null for an allow: never the call's input. The builder reads it back into
// its `refused` list.
//
// Node at the edge: stdin, stdout and one append, read and written whole.
import {appendFileSync} from "node:fs";
import {temps} from "@kampus/fabrika-old/agents/sandbox";
import {builderCheck, type Checked} from "./check.ts";

// Exit 2 is the CLI's "block this call"; any other failure of a hook lets the
// call through. So every way this script can fail ends in exit 2: it fails closed.
const refuse: (why: string) => never = (why) => {
	process.stderr.write(`${why}\n`);
	process.exit(2);
};
process.on("uncaughtException", () => refuse("The call could not be checked, so it is refused."));

const [tree, log] = process.argv.slice(2);
if (tree === undefined || log === undefined) refuse("usage: check-hook.ts <tree> <log>");
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
// A call that is not JSON, or a log that cannot be written, throws: refused above.
const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
const call: {tool_name?: unknown; tool_input?: unknown} =
	typeof parsed === "object" && parsed !== null ? parsed : {};
const tool = typeof call.tool_name === "string" ? call.tool_name : "unknown";
const input =
	typeof call.tool_input === "object" && call.tool_input !== null
		? (call.tool_input as Record<string, unknown>)
		: {};
const why = builderCheck(tree, temps())(tool, input);
appendFileSync(log, `${JSON.stringify({tool, why} satisfies Checked)}\n`);
if (why !== null)
	process.stdout.write(
		JSON.stringify({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
				permissionDecisionReason: why,
			},
		}),
	);
