// A stand-in for `claude`, for src/stages/build/guard.test.ts. Like `claude`
// running a Bash command, it starts a child in a session of its own, which
// starts a grandchild, and says every pid on stdout. Then it waits for good
// ("wait"), or ends after three seconds and leaves the two behind ("end").
import {spawn} from "node:child_process";

const mode = process.argv[2] ?? "wait";
const shell = spawn(
	process.execPath,
	[
		"-e",
		"const c = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'ignore'}); console.log(String(c.pid)); setInterval(() => {}, 1000);",
	],
	{detached: true, stdio: ["ignore", "pipe", "ignore"]},
);
shell.stdout.once("data", (data) => {
	console.log(`agent ${process.pid} ${shell.pid} ${String(data).trim()}`);
	if (mode === "end") setTimeout(() => process.exit(0), 3_000);
});
setInterval(() => {}, 1000);
