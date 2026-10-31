import {defineProgram} from "@kampus/fabrika";
import {
	Conversation,
	chat,
	conversationKind,
	flags,
	inputs,
	outputs,
} from "@kampus/fabrika/agents/program";

// Codex as a tea program (experiment 169), on the `Agents` service
// (docs/direction/agents-behind-one-service.md): it names the `codex`
// provider row and imports no maker's SDK. Its flags, inputs, outputs and
// main are the ones `claude` has (programs/claude), from
// `@kampus/fabrika/agents/program`; only the provider differs.
//
//   tsh> codex --folder /work/copy prompt="what is 2+3?"      a turn: said, tool, then ended
//   tsh> tell %1 prompt "and times 4?"                        the next turn, on the same session
//   tsh> tell %1 cancel 2                                     turn 2, cancelled: now, or when it comes up
//
// A stage that wants a typed answer passes a JSON Schema on `--schema`, as
// `codex exec --output-schema` takes one, and decodes `ended.answer` with its
// own Effect schema when it arrives (`decoder` in `@kampus/pipeline/decoder`).

export const codex = defineProgram({
	name: "codex",
	description:
		"Codex as a program: each prompt is a turn on one session, through the Agents service. Each turn ends with a JSON value, held to --schema when given, or null.",
	flags,
	inputs,
	outputs,
	machines: {conversation: conversationKind},
	view: {machine: "conversation", data: Conversation, of: (s: Conversation) => s},
	main: (io) => chat("codex", io),
});
