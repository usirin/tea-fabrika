import {type ChildProcess, spawn} from "node:child_process";
import {mkdirSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {buildAll} from "./build.ts";

// The one command: `node next/dev.ts`. It bundles everything, starts the brain in its own process
// group, prints the URL, and starts the brain again whenever it dies. Its data stays in
// `runs/next/`, which git ignores, until you delete it.
//
//   node next/dev.ts [--port=8377] [--data=<folder>]

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const flag = (name: string, fallback: string): string => {
	const found = process.argv.find((arg) => arg.startsWith(`--${name}=`));
	return found === undefined ? fallback : found.slice(name.length + 3);
};

const port = Number(flag("port", "8377"));
const data = resolve(flag("data", here("../runs/next")));
const url = `http://127.0.0.1:${port}/`;

mkdirSync(data, {recursive: true});
const bundlesFile = join(data, "bundles.json");
writeFileSync(bundlesFile, JSON.stringify(await buildAll()));

let brain: ChildProcess | undefined;
let stopping = false;
let announced = false;

/** A killed Node leaves workerd serving: the group is what dies (the five layers' local host). */
const killGroup = (pid: number) => {
	try {
		process.kill(-pid, "SIGKILL");
	} catch {
		// The group is already gone.
	}
};

const start = () => {
	const child = spawn(process.execPath, ["--no-warnings", here("brain-host.ts")], {
		env: {...process.env, PORT: String(port), PERSIST: join(data, "objects"), BUNDLES: bundlesFile},
		detached: true,
		stdio: ["ignore", "pipe", "inherit"],
	});
	brain = child;
	const pid = child.pid;
	child.stdout?.on("data", (chunk: Buffer) => {
		process.stdout.write(`brain up: ${chunk.toString("utf8")}`);
		if (announced) return;
		announced = true;
		process.stdout.write(`open ${url} in two browser windows\n`);
	});
	child.on("exit", () => {
		if (pid !== undefined) killGroup(pid);
		if (stopping) return;
		process.stdout.write("brain down: starting it again\n");
		setTimeout(start, 50);
	});
};

const stop = () => {
	stopping = true;
	if (brain?.pid !== undefined) killGroup(brain.pid);
	process.exit(0);
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

start();
