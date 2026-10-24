// Experiment 137, the box tool's part: 128's `boxed()` for none and srt, as it is, and its
// Docker start with two changes, said here:
//   - `--group-add 0`. Docker Desktop shows a unix socket mounted from the Mac as `root:root`,
//     mode 0660, whatever its mode on the Mac, so the container's user `node` could not use the
//     relay's socket (EACCES). The root group lets it. The root folder is read-only, and home and
//     /tmp are tmpfs of the user's own, so the group opens little else;
//   - the program is `node fwd.mjs <port> /relay.sock <program> ...`, so the relay's socket is a
//     port on the container's own loopback. The container still has `--network none`.
//
// Node at the edge: a box is a child process.

import {execFileSync, spawn} from "node:child_process";
import {
	boxed,
	type Command,
	dockerHardening,
	type Mount,
	type Started,
} from "../128-program-in-a-box/box.ts";

export type {Command, Started};
export {boxed};

/** Names that describe the Mac, never handed into a container. */
const HOST_ONLY = new Set([
	"PATH",
	"HOME",
	"TMPDIR",
	"USER",
	"SHELL",
	"PWD",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"TZ",
	"CLAUDE_CONFIG_DIR",
	"CLAUDE_CODE_TMPDIR",
]);

let count = 0;

/** Start one program in a fresh container that has no network, with the relay's socket as its one way out. */
export const dockerBoxed = (
	box: {readonly image: string; readonly label: string; readonly mounts: readonly Mount[]},
	relay: {readonly socket: string; readonly fwd: string; readonly port: number},
	cmd: Command,
): Started => {
	const name = `${box.label}-${process.pid}-${++count}`;
	const env = Object.fromEntries(
		Object.entries(cmd.env).flatMap(([k, v]) =>
			v === undefined || HOST_ONLY.has(k) ? [] : [[k, v]],
		),
	);
	const mounts = [
		...box.mounts,
		{from: relay.socket, to: "/relay.sock", readOnly: false},
		{from: relay.fwd, to: "/exp137/fwd.mjs", readOnly: true},
	];
	// Values reach docker through its own environment; only names are on its command line.
	const child = spawn(
		"docker",
		[
			"run",
			"-i",
			"--rm",
			"--init",
			"--name",
			name,
			"--label",
			box.label,
			"--network",
			"none",
			...dockerHardening,
			"--group-add",
			"0",
			...mounts.flatMap((m) => ["-v", `${m.from}:${m.to}${m.readOnly ? ":ro" : ""}`]),
			"-w",
			cmd.cwd,
			...Object.keys(env).flatMap((n) => ["-e", n]),
			box.image,
			"node",
			"/exp137/fwd.mjs",
			String(relay.port),
			"/relay.sock",
			cmd.command,
			...cmd.args,
		],
		{env: {PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env}, stdio: "pipe"},
	);
	const kill = () => {
		try {
			execFileSync("docker", ["rm", "-f", name], {stdio: "ignore"});
		} catch {
			// Gone already.
		}
		child.kill("SIGKILL");
	};
	return {child, kill, name};
};
