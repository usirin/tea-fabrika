// Docker for experiment 101: 98's image (its Dockerfile and install.sh, unchanged) under this
// experiment's own names, so nothing of 98's is touched. Every container carries the label
// `exp101` and is removed on exit, whatever happened.
//
// A container that runs a real agent gets CLAUDE_CODE_OAUTH_TOKEN by name only: `-e NAME` makes
// docker read the value from this process's environment, so it is never on a command line.
//
// Node at the edge: `docker`, through 98's harness helpers.

import {execFileSync} from "node:child_process";
import {join} from "node:path";
import {type Child, here, spawnChild, until} from "../98-tea-host-package/harness.ts";

export const DOCKER101 = {
	label: "exp101",
	image: "exp101-host:local",
	volume: "exp101-node-modules",
} as const;
export const REPO = here("..");
const DIR98 = here("98-tea-host-package/");

export const docker = (args: readonly string[]) =>
	execFileSync("docker", args, {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
export const dockerQuiet = (args: readonly string[]) => {
	try {
		return docker(args);
	} catch {
		return "";
	}
};

export const removeContainers = () => {
	const ids = dockerQuiet(["ps", "-aq", "--filter", `label=${DOCKER101.label}`])
		.split("\n")
		.filter(Boolean);
	if (ids.length > 0) dockerQuiet(["rm", "-f", ...ids]);
	return ids.length;
};
let used = false;
process.on("exit", () => {
	if (used) removeContainers();
});

export const prepare = () => {
	used = true;
	const t0 = Date.now();
	docker(["build", "-q", "-t", DOCKER101.image, "-f", join(DIR98, "Dockerfile"), DIR98]);
	const built = Date.now();
	docker([
		"run",
		"--rm",
		"--user",
		"root",
		"--label",
		DOCKER101.label,
		"-v",
		`${REPO}:/repo:ro`,
		"-v",
		`${DOCKER101.volume}:/ws/node_modules`,
		"--entrypoint",
		"sh",
		DOCKER101.image,
		"/repo/experiments/98-tea-host-package/install.sh",
	]);
	return {buildMs: built - t0, installMs: Date.now() - built};
};

export const unprepare = () => {
	const left = removeContainers();
	if (process.env.KEEP_IMAGE === "1") return {containers: left, removed: false};
	dockerQuiet(["volume", "rm", DOCKER101.volume]);
	dockerQuiet(["image", "rm", DOCKER101.image]);
	return {containers: left, removed: true};
};

/** `docker run` of one script from the read-only repo, with the agent's login passed by name. */
export const runContainer = (
	name: string,
	script: string,
	env: Readonly<Record<string, string>>,
	o: {readonly rm?: boolean; readonly mounts?: readonly string[]} = {},
): Child => {
	used = true;
	const flags = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
	const mounts = (o.mounts ?? []).flatMap((m) => ["-v", m]);
	return spawnChild(
		"docker",
		[
			"run",
			"--name",
			name,
			"--init",
			"--label",
			DOCKER101.label,
			...(o.rm === true ? ["--rm"] : []),
			"--add-host",
			"host.docker.internal:host-gateway",
			"-v",
			`${REPO}:/repo:ro`,
			"-v",
			`${DOCKER101.volume}:/repo/node_modules:ro`,
			...mounts,
			...flags,
			// The name only: docker reads the value from this process's environment.
			"-e",
			"CLAUDE_CODE_OAUTH_TOKEN",
			DOCKER101.image,
			script,
		],
		{},
	);
};

/** The probe (./probe.ts) in one container; its JSON lines. */
export const probe = async (model: string) => {
	const c = runContainer(
		"exp101-probe",
		"experiments/101-real-agents-faults/probe.ts",
		{MODEL: model},
		{rm: true},
	);
	await until("the probe", () => c.proc.exitCode !== null, 300_000);
	const err = c.err.join("");
	if (err.trim() !== "") console.log(`probe stderr: ${err.slice(0, 400)}`);
	return c.lines;
};
