import {defineProgram} from "@kampus/fabrika";
import {
	Conversation,
	chat,
	conversationKind,
	flags,
	inputs,
	outputs,
} from "@kampus/fabrika/agents/program";

// Claude Code as a tea program (experiment 169), on the `Agents` service
// (docs/direction/agents-behind-one-service.md): it names the `claude`
// provider row and imports no maker's SDK. Its flags, inputs, outputs and
// main are the ones `codex` has (programs/codex), from
// `@kampus/fabrika/agents/program`; only the provider differs.
//
//   tsh> claude --folder /work/copy prompt="what is 2+3?"     a turn: said, tool, then ended
//   tsh> tell %1 prompt "and times 4?"                        the next turn, on the same session
//   tsh> tell %1 cancel 2                                     turn 2, cancelled: now, or when it comes up
//
// A stage that wants a typed answer passes a JSON Schema on `--schema`, as
// `claude -p --json-schema` takes one, and decodes `ended.answer` with its
// own Effect schema when it arrives (`decoder` in `@kampus/pipeline/decoder`).

export const claude = defineProgram({
	name: "claude",
	description:
		"Claude Code as a program: each prompt is a turn on one session, through the Agents service. Each turn ends with a JSON value, held to --schema when given, or null.",
	flags,
	inputs,
	outputs,
	machines: {conversation: conversationKind},
	view: {machine: "conversation", data: Conversation, of: (s: Conversation) => s},
	main: (io) => chat("claude", io),
});
