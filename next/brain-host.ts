import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {Miniflare} from "miniflare";

// The brain's process: Miniflare, holding one workerd, on workerd's own socket (the direct socket
// the local host talks to). `dev.ts` runs this in a process group of its own and restarts it when
// it ends. It ends when its workerd dies, so `kill -9` on either one brings the whole brain back.
//
// Env: PORT, PERSIST, BUNDLES (a file with what build.ts made). Prints one JSON line when ready:
// {node, workerd, ms}.

const env = (name: string): string => {
	const value = process.env[name];
	if (value === undefined) throw new Error(`${name} is not set`);
	return value;
};

const t0 = performance.now();
const bundles = JSON.parse(readFileSync(env("BUNDLES"), "utf8"));

const mf = new Miniflare({
	modules: [{type: "ESModule", path: "brain.js", contents: bundles.brain}],
	compatibilityDate: "2026-07-01",
	unsafeDirectSockets: [{host: "127.0.0.1", port: Number(env("PORT"))}],
	durableObjects: {
		GATEWAY: {className: "Gateway", useSQLite: true},
		PROJECT: {className: "Project", useSQLite: true},
		PROCESS: {className: "Process", useSQLite: true},
	},
	durableObjectsPersist: env("PERSIST"),
	workerLoaders: {LOADER: {}},
	bindings: {
		PROGRAMS: bundles.programs,
		WINDOW_JS: bundles.window,
		HOST: `127.0.0.1:${env("PORT")}`,
	},
});

await mf.ready;

/** workerd is this process's child; Miniflare does not hand out its pid. */
const workerdPid = (): number => {
	const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid=,comm="], {encoding: "utf8"})
		.split("\n")
		.map((line) => line.trim().split(/\s+/));
	const row = rows.find(
		([, ppid, ...comm]) => ppid === String(process.pid) && comm.join(" ").includes("workerd"),
	);
	if (row?.[0] === undefined) throw new Error("no workerd under this process");
	return Number(row[0]);
};

const workerd = workerdPid();
process.stdout.write(
	`${JSON.stringify({node: process.pid, workerd, ms: Math.round(performance.now() - t0)})}\n`,
);

const isAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

const parent = process.ppid;

setInterval(() => {
	// workerd died, or dev.ts did: end the whole group, workerd too, so no copy stays on the port.
	if (!isAlive(workerd) || process.ppid !== parent) process.kill(-process.pid, "SIGKILL");
}, 100);
