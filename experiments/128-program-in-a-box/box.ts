// Experiment 128, the box tool's part: start a program with stdio in a box, and take it away.
//
// Copied from experiment 127's `boxed()` (../127-agent-in-a-box.ts), not imported: that file
// runs its own main when it is loaded. Four changes, said here:
//   - it hands back a `kill` beside the child, so the host can take the whole box away. none
//     and srt start the child in its own process group and kill the group; docker removes the
//     container by name, since killing the `docker run` client leaves the container running;
//   - docker mounts are a list with a read-only mark, and a named volume can be one of them
//     (experiment 98's Linux node_modules);
//   - docker gets `--network none`. Nothing in the box needs a network: every service call
//     goes out over stdio;
//   - the srt settings and the docker image are made here, for this experiment's runner.
//
// Node at the edge: a box is a child process, and the host writes and reads its pipes.

import {type ChildProcess, execFileSync, spawn} from "node:child_process";

export interface Command {
	readonly command: string;
	readonly args: readonly string[];
	readonly env: Readonly<Record<string, string | undefined>>;
	readonly cwd: string;
}

export interface Mount {
	/** A host folder, or a docker volume's name. */
	readonly from: string;
	readonly to: string;
	readonly readOnly: boolean;
}

export type Box =
	| {readonly kind: "none"}
	| {readonly kind: "srt"; readonly srt: string; readonly settingsFile: string}
	| {
			readonly kind: "docker";
			readonly image: string;
			readonly label: string;
			readonly mounts: readonly Mount[];
	  };

/** A started box: its child, and the way to take the whole box away. Saying it twice is fine. */
export interface Started {
	readonly child: ChildProcess;
	readonly kill: () => void;
	/** The container's name, for docker. */
	readonly name: string | null;
}

const HOST_ONLY = new Set(["PATH", "HOME", "TMPDIR", "USER", "SHELL", "PWD", "LANG", "LC_ALL"]);

const defined = (env: Command["env"]): Record<string, string> =>
	Object.fromEntries(
		Object.entries(env).flatMap(([k, v]) => (v === undefined ? [] : [[k, v] as const])),
	);

/** Experiment 127's hardening, unchanged. */
export const dockerHardening = [
	"--cap-drop",
	"ALL",
	"--security-opt",
	"no-new-privileges",
	"--read-only",
	"--tmpfs",
	"/tmp:rw,nosuid,nodev,size=256m",
	"--tmpfs",
	"/home/node:rw,nosuid,nodev,size=256m,uid=1000,gid=1000,mode=0700",
	"--pids-limit",
	"512",
	"--memory",
	"2g",
	"--cpus",
	"2",
	"--user",
	"node",
] as const;

const group = (child: ChildProcess) => () => {
	if (child.pid === undefined) return;
	try {
		process.kill(-child.pid, "SIGKILL");
	} catch {
		// The group is gone already.
	}
};

let count = 0;

/** Start one program in a box, with its stdin, stdout and stderr piped. */
export const boxed = (box: Box, cmd: Command): Started => {
	const env = defined(cmd.env);
	switch (box.kind) {
		case "none": {
			const child = spawn(cmd.command, [...cmd.args], {
				cwd: cmd.cwd,
				env,
				stdio: "pipe",
				detached: true,
			});
			return {child, kill: group(child), name: null};
		}
		case "srt": {
			// `--` first: without it srt reads the program's own flags as its own.
			const child = spawn(
				box.srt,
				["--settings", box.settingsFile, "--", cmd.command, ...cmd.args],
				{cwd: cmd.cwd, env, stdio: "pipe", detached: true},
			);
			return {child, kill: group(child), name: null};
		}
		case "docker": {
			const name = `${box.label}-${process.pid}-${++count}`;
			// Values reach docker through its own environment; only names are on its command line.
			const names = Object.keys(env).filter((n) => !HOST_ONLY.has(n));
			const own = defined({PATH: process.env.PATH, HOME: process.env.HOME});
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
					...box.mounts.flatMap((m) => ["-v", `${m.from}:${m.to}${m.readOnly ? ":ro" : ""}`]),
					"-w",
					cmd.cwd,
					...names.flatMap((n) => ["-e", n]),
					box.image,
					cmd.command,
					...cmd.args,
				],
				{env: {...own, ...Object.fromEntries(names.map((n) => [n, env[n] ?? ""]))}, stdio: "pipe"},
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
		}
	}
};

// ---------------------------------------------------------------- srt

/** The srt settings for one box: read the repo and the toolchain, write a temp folder, no network. */
export const srtSettings = (o: {
	readonly deny: readonly string[];
	readonly read: readonly string[];
	readonly write: readonly string[];
}) => ({
	network: {allowedDomains: [], deniedDomains: []},
	filesystem: {
		denyRead: [...o.deny],
		allowRead: [...o.read, ...o.write],
		allowWrite: [...o.write],
		denyWrite: [],
	},
});

// ---------------------------------------------------------------- docker

/** Node and pnpm only, as experiment 98's image. No source and no secret goes in. */
export const dockerfile = `FROM node:26.12.0-slim
RUN npm install --global pnpm@10.27.0 && npm cache clean --force
USER node
WORKDIR /repo
`;

const docker = (args: readonly string[], input?: string) =>
	execFileSync("docker", args, {
		encoding: "utf8",
		input,
		stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
	}).trim();

/**
 * Build the image and fill the Linux node_modules volume, with experiment 98's install script
 * (`experiments/98-tea-host-package/install.sh`), run once with the repo mounted read-only.
 */
export const prepareDocker = (repo: string, o: {image: string; volume: string; label: string}) => {
	const t0 = performance.now();
	docker(["build", "-q", "--label", o.label, "-t", o.image, "-"], dockerfile);
	const built = performance.now();
	docker(["volume", "create", "--label", o.label, o.volume]);
	docker([
		"run",
		"--rm",
		"--user",
		"root",
		"--label",
		o.label,
		"-v",
		`${repo}:/repo:ro`,
		"-v",
		`${o.volume}:/ws/node_modules`,
		"--entrypoint",
		"sh",
		o.image,
		"/repo/experiments/98-tea-host-package/install.sh",
	]);
	return {buildMs: Math.round(built - t0), installMs: Math.round(performance.now() - built)};
};

/** Remove every container, image and volume carrying the label. What was left is counted. */
export const cleanDocker = (o: {image: string; volume: string; label: string}) => {
	const q = (args: readonly string[]) => {
		try {
			return docker(args);
		} catch {
			return "";
		}
	};
	const list = (args: readonly string[]) => q(args).split("\n").filter(Boolean);
	const containers = list(["ps", "-aq", "--filter", `label=${o.label}`]);
	if (containers.length > 0) q(["rm", "-f", ...containers]);
	q(["volume", "rm", o.volume]);
	const volumes = list(["volume", "ls", "-q", "--filter", `label=${o.label}`]);
	if (volumes.length > 0) q(["volume", "rm", ...volumes]);
	q(["image", "rm", o.image]);
	const images = list(["images", "-aq", "--filter", `label=${o.label}`]);
	if (images.length > 0) q(["image", "rm", "-f", ...images]);
	return {
		containers: containers.length,
		left: {
			containers: list(["ps", "-aq", "--filter", `label=${o.label}`]).length,
			volumes: list(["volume", "ls", "-q", "--filter", `label=${o.label}`]).length,
			images: list(["images", "-aq", "--filter", `label=${o.label}`]).length,
		},
	};
};

/** Is a container of this name still there? */
export const containerThere = (name: string) => {
	try {
		return docker(["ps", "-aq", "--filter", `name=^${name}$`]) !== "";
	} catch {
		return false;
	}
};
