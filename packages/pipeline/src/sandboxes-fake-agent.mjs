// The fake agent for sandboxes.test.ts: no model, no key. It reads a ticket on
// stdin and does what a steered agent with a shell would do: it runs every
// line of the form "run `<command>`" with sh, and prints what each printed.
//
// Plain Node: it runs inside a sandbox, as the program a stage would start there.
import {spawnSync} from "node:child_process";

let ticket = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) ticket += chunk;

for (const [, command] of ticket.matchAll(/^run `(.+)`$/gm)) {
	const done = spawnSync("/bin/sh", ["-c", command], {encoding: "utf8"});
	process.stdout.write(`ran ${done.status}\n${done.stdout}${done.stderr}`);
}
