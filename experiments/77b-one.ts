// Experiment 77b, one command: run one Bash command through the builder's SDK
// options and print what the tool answered. `old` puts back the fence before
// 77b (only the login files unreadable), to compare.
//
//   node experiments/77b-one.ts <folder> new|old '<command>'
//
// Only for commands whose output holds no secret: it is printed.
import {homedir} from "node:os";
import {join} from "node:path";
import {query, type SDKMessage} from "@anthropic-ai/claude-agent-sdk";
import {builderOptions} from "../wip/src/stages/build/builder.ts";
import {temps} from "../wip/src/stages/build/check.ts";

const [folder = "", fence = "new", command = ""] = process.argv.slice(2);
const LOGIN = [".git-credentials", ".config/gh", ".ssh", ".netrc", ".npmrc", ".aws"];
const {effort: _effort, ...options} = builderOptions(
	{model: "haiku", effort: "low", budget: 0.3},
	folder,
	() => {},
);
const sandbox = options.sandbox as Record<string, unknown>;
const old = {allowWrite: [folder, ...temps()], denyRead: LOGIN.map((f) => join(homedir(), f))};
const q = query({
	prompt: `This is a sandbox test. Make exactly one tool call: use the Bash tool to run exactly this command and nothing else: ${command}\nThen stop.`,
	options: {
		...options,
		persistSession: false,
		sandbox: {...sandbox, ...(fence === "old" ? {filesystem: old} : {})} as never,
	},
});
for await (const m of q as AsyncIterable<SDKMessage>) {
	if (m.type === "assistant")
		for (const b of m.message.content)
			if (b.type === "tool_use") console.log("call:", JSON.stringify(b.input));
	if (m.type === "user" && Array.isArray(m.message.content))
		for (const b of m.message.content)
			if (typeof b === "object" && b.type === "tool_result")
				console.log("out:", JSON.stringify(b.content).slice(0, 1500));
	if (m.type === "result") console.log("cost:", m.total_cost_usd.toFixed(4));
}
