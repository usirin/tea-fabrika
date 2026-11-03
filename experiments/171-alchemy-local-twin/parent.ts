// Experiment 171: a stand-in for the app host, the twin's parent. It starts the twin as its child
// (in a process group of its own when PARENT_GROUP=1, as `local.ts` starts today's twin), passes
// the twin's lines through, and lives until it is killed. The driver kills it with SIGKILL and
// looks at what is left.
//
//   PARENT_RUN="<execPath> <twin.ts or dist/twin.mjs>" PARENT_GROUP=1 node parent.ts
import {spawn} from "node:child_process";

const [cmd = process.execPath, ...args] = (process.env.PARENT_RUN ?? "").split(" ");
const child = spawn(cmd, args, {
	stdio: ["ignore", "pipe", "pipe"],
	detached: process.env.PARENT_GROUP === "1",
	env: process.env,
});
child.stdout.on("data", (b: Buffer) => process.stdout.write(b));
child.stderr.on("data", (b: Buffer) => process.stderr.write(b));
process.stdout.write(`${JSON.stringify({parent: process.pid, child: child.pid})}\n`);
setInterval(() => undefined, 1 << 30);
