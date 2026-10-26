// Experiment 148's job runner: the box's one process. It runs the job's command with sh, keeps
// what it printed, and tells the host it ended, through the only door it has out:
//
//   JOB_CMD="node /app/ask.mjs hello" node run.mjs
//   POST http://host.internal/done {said, code}       caught outside the box, by its JobBox
//
// It holds nothing secret: JOB_CMD and JOB, the job's id, are all its environment adds.
import {spawn} from "node:child_process";

const cmd = process.env.JOB_CMD ?? "true";
const MAX = 64 * 1024;
let said = "";
const child = spawn("sh", ["-c", cmd], {stdio: ["ignore", "pipe", "pipe"]});
const keep = (chunk) => {
	if (said.length < MAX) said += chunk.toString("utf8");
};
child.stdout.on("data", keep);
child.stderr.on("data", keep);
const code = await new Promise((r) => child.on("close", (c) => r(c ?? -1)));

for (let i = 0; i < 40; i++) {
	try {
		const res = await fetch("http://host.internal/done", {
			method: "POST",
			headers: {"content-type": "application/json"},
			body: JSON.stringify({said: said.slice(0, MAX), code}),
		});
		if (res.ok) break;
	} catch {
		// the catch is not set yet, in the first moment of the box
	}
	await new Promise((r) => setTimeout(r, 250));
}
