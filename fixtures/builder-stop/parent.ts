// A stand-in for the run's process (tsh), for wip/src/stages/build/guard.test.ts.
// It starts the stand-in agent the way the Agent SDK starts `claude` when the
// builder hands it `guarded(lock).spawn`, and passes the agent's stdout on.
//
//   node parent.ts <lock> <wait seconds> <agent mode>
import {fileURLToPath} from "node:url";
import {guarded} from "../../wip/src/stages/build/guarded.ts";

const [lock = "", wait = "30", mode = "wait"] = process.argv.slice(2);
const agent = fileURLToPath(new URL("./agent.mjs", import.meta.url));
const guard = guarded(lock, Number(wait));
const child = guard.spawn({
	command: process.execPath,
	args: [agent, mode],
	env: {PATH: process.env.PATH ?? "/usr/bin:/bin"},
	signal: new AbortController().signal,
});
console.log(`parent ${process.pid}`);
child.stdout.pipe(process.stdout);
child.on("exit", (code) => {
	console.log(`guard-exit ${code} ${guard.refused() ?? ""}`);
});
process.on("SIGTERM", () => child.kill("SIGTERM"));
