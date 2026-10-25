// Experiment 146: can Alchemy v2 be the one way fabrika spins up infrastructure?
//
//   (cd experiments/146-alchemy-everywhere && pnpm install --ignore-workspace)   # once
//   env -u TYPESAFE_API_KEY node experiments/146-alchemy-everywhere.ts host     # spike 1
//   env -u TYPESAFE_API_KEY node experiments/146-alchemy-everywhere.ts docker   # spike 2
//   env -u TYPESAFE_API_KEY node experiments/146-alchemy-everywhere.ts local    # spike 3
//   env -u TYPESAFE_API_KEY node experiments/146-alchemy-everywhere.ts effect   # spike 4
//   env -u TYPESAFE_API_KEY node experiments/146-alchemy-everywhere.ts clean    # leftovers
//
// Each step runs Alchemy's own CLI (alchemy@2.0.0-beta.84, pinned in
// 146-alchemy-everywhere/package.json, outside the workspace on purpose) on a stack file in
// experiments/146-alchemy-everywhere/, in a fresh temp folder: Alchemy keeps its state in
// `<cwd>/.alchemy/state/`, and `ALCHEMY_HOME` moves its user folder (profiles, logs, an id) there
// too. `DO_NOT_TRACK=1` turns off its telemetry, which is on by default. No CLOUDFLARE_* variable
// reaches it, and nothing is deployed to any cloud: $0.
//
// Every CLI run goes through `nice -n 15`, because experiment 143 measures typing latency on
// this laptop at the same time. The temp folder is removed at the end of each step, after its
// state files are copied (paths scrubbed) into results/146-alchemy-everywhere.json.
import {type ChildProcess, execFileSync, spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {request} from "node:http";
import {createRequire} from "node:module";
import {homedir, tmpdir} from "node:os";
import {dirname, join, relative} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const spike = join(here, "146-alchemy-everywhere");
const bin = join(spike, "node_modules", ".bin", "alchemy");
const resultsFile = join(here, "results", "146-alchemy-everywhere.json");
const LABEL = "exp146";

type Json = null | boolean | number | string | Json[] | {[k: string]: Json};

interface Work {
	readonly dir: string;
	readonly env: NodeJS.ProcessEnv;
	readonly scrub: (s: string) => string;
}

const makeWork = (): Work => {
	const dir = mkdtempSync(join(tmpdir(), `${LABEL}-`));
	const env: NodeJS.ProcessEnv = {};
	for (const [k, v] of Object.entries(process.env)) {
		if (k === "TYPESAFE_API_KEY" || k.startsWith("CLOUDFLARE_") || k.startsWith("ALCHEMY_"))
			continue;
		env[k] = v;
	}
	env.DO_NOT_TRACK = "1";
	env.ALCHEMY_HOME = join(dir, "alchemy-home");
	env.NO_COLOR = "1";
	env.CI = "1";
	// macOS hands out a /var/folders/... temp folder that is also reachable as /private/var/...
	const scrub = (s: string) =>
		s
			.split(`/private${dir}`)
			.join("<tmp>")
			.split(dir)
			.join("<tmp>")
			.split(spike)
			.join("<exp>")
			.split(tmpdir())
			.join("<tmpdir>")
			.split(process.execPath)
			.join("<node>")
			.split(homedir())
			.join("~")
			// Alchemy writes "fail <long dash> why"; this repo's text keeps a plain dash.
			.split(String.fromCharCode(0x2014))
			.join("-");
	return {dir, env, scrub};
};

interface Step {
	readonly name: string;
	/** Wall time of the whole CLI run: Node start, module load, plan, apply. */
	readonly ms: number;
	/** The plan, as Alchemy reports it ("Plan ready (38ms)"). */
	readonly planMs: number | null;
	/** The apply alone, as Alchemy reports it ("Done: 1 succeeded (64ms)"). */
	readonly applyMs: number | null;
	readonly plan: string | null;
	readonly ok: boolean;
	readonly tail: string;
}

/** Alchemy prints "64ms" or "10.4s". In ms. */
const numberAfter = (out: string, re: RegExp) => {
	const m = out.match(re);
	if (m?.[1] === undefined) return null;
	return m[2] === "s" ? Math.round(Number(m[1]) * 1000) : Number(m[1]);
};

/** One Alchemy CLI run, timed, with the end of its output kept (scrubbed). */
const alchemy = (w: Work, name: string, args: string[], env: NodeJS.ProcessEnv = {}): Step => {
	const t0 = performance.now();
	let out = "";
	let ok = true;
	try {
		out = execFileSync("nice", ["-n", "15", bin, ...args], {
			cwd: w.dir,
			env: {...w.env, ...env},
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 600_000,
		});
	} catch (e) {
		ok = false;
		const err = e as {stdout?: string; stderr?: string};
		out = `${err.stdout ?? ""}\n${err.stderr ?? ""}`;
	}
	const ms = Math.round(performance.now() - t0);
	const clean = w.scrub(out);
	const tail = clean
		.trim()
		.split("\n")
		.filter((l) => !/^\s+at /.test(l))
		.slice(-30)
		.join("\n");
	const step: Step = {
		name,
		ms,
		planMs: numberAfter(clean, /(?:Plan ready|Drift check complete) \(([\d.]+)(ms|s)\)/),
		applyMs: numberAfter(clean, /(?:Done|Failed): [^(]*\(([\d.]+)(ms|s)\)/),
		plan: clean.match(/Plan: ([^\n]+)/)?.[1] ?? null,
		ok,
		tail,
	};
	console.log(
		`-- ${name}: ${ok ? "ok" : "FAILED"} in ${ms} ms (plan ${step.planMs}, apply ${step.applyMs})\n${tail}\n`,
	);
	return step;
};

/** Every state file Alchemy wrote for one stack and stage, parsed, paths scrubbed. */
const stateOf = (w: Work, stack: string, stage: string): Record<string, Json> => {
	const dir = join(w.dir, ".alchemy", "state", stack, stage);
	if (!existsSync(dir)) return {};
	const files: Record<string, Json> = {};
	for (const f of readdirSync(dir)) {
		files[f] = JSON.parse(w.scrub(readFileSync(join(dir, f), "utf8")));
	}
	return files;
};

/** One resource's state row, or undefined. */
const rowOf = (
	w: Work,
	stack: string,
	stage: string,
	fqn: string,
): Record<string, Json> | undefined => {
	const f = join(w.dir, ".alchemy", "state", stack, stage, `${fqn}.json`);
	return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : undefined;
};

const listFiles = (dir: string, root = dir): string[] =>
	existsSync(dir)
		? readdirSync(dir, {withFileTypes: true}).flatMap((d) =>
				d.isDirectory()
					? listFiles(join(dir, d.name), root)
					: [join(dir, d.name).slice(root.length + 1)],
			)
		: [];

const sh = (cmd: string, args: string[]): string => {
	try {
		return execFileSync(cmd, args, {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
	} catch (e) {
		const err = e as {stdout?: string; stderr?: string};
		return `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
	}
};

const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

const save = (key: string, value: Json) => {
	const all: Record<string, Json> = existsSync(resultsFile)
		? JSON.parse(readFileSync(resultsFile, "utf8"))
		: {};
	all[key] = value;
	writeFileSync(resultsFile, `${JSON.stringify(all, null, "\t")}\n`);
};

const outputOf = (w: Work, stack: string, stage: string): Record<string, Json> => {
	const f = join(w.dir, ".alchemy", "state", stack, stage, "__stack_output__.json");
	return existsSync(f) ? JSON.parse(w.scrub(readFileSync(f, "utf8"))) : {};
};

const stepsJson = (steps: Step[]): Json => steps.map((s) => ({...s}));

// ---------------------------------------------------------------------------------------------
// Spike 1: Fabrika.Host, our own resource (146-alchemy-everywhere/host.ts).

const hostSpike = () => {
	const w = makeWork();
	const file = join(spike, "host.run.ts");
	const stack = "exp146-host";
	const stage = "s146";
	const home = join(w.dir, "host");
	const inputs = (programs: string, ledger = "memory") => ({
		HOST_HOME: home,
		HOST_PROGRAMS: programs,
		HOST_LEDGER: ledger,
	});
	const steps: Step[] = [];
	const seen: Record<string, Json> = {};
	const deploy = (name: string, programs: string, ledger?: string) =>
		steps.push(
			alchemy(w, name, ["deploy", file, "--stage", stage, "--yes"], inputs(programs, ledger)),
		);
	/** The pid in the resource's own state row, and whether that process is running. */
	const host = () => {
		const attr = rowOf(w, stack, stage, "laptop")?.attr;
		const pid = attr && typeof attr === "object" && !Array.isArray(attr) ? attr.pid : undefined;
		const p = typeof pid === "number" ? pid : -1;
		return {pid: p, alive: p > 0 && alive(p), files: listFiles(home)};
	};

	try {
		deploy("create", "counter");
		seen.afterCreate = {...host(), state: stateOf(w, stack, stage)};
		deploy("same inputs", "counter");
		deploy("update programs (in place)", "counter,tracker");
		seen.afterUpdate = {...host(), state: stateOf(w, stack, stage)};
		deploy("change ledger (replace)", "counter,tracker", "local");
		seen.afterReplace = {...host(), state: stateOf(w, stack, stage)};

		// Kill the host behind Alchemy's back: does a plain deploy notice, and does drift?
		const killed = host().pid;
		if (killed > 0) process.kill(killed, "SIGKILL");
		deploy("deploy after a kill", "counter,tracker", "local");
		seen.afterKillDeploy = {killed, ...host()};
		steps.push(
			alchemy(
				w,
				"drift after a kill",
				["drift", "--config", file, "--stage", stage, "--repair"],
				inputs("counter,tracker", "local"),
			),
		);
		seen.afterDrift = {...host(), state: stateOf(w, stack, stage)};

		const before = host().pid;
		steps.push(
			alchemy(
				w,
				"destroy",
				["destroy", file, "--stage", stage, "--yes"],
				inputs("counter,tracker", "local"),
			),
		);
		seen.afterDestroy = {
			pidBefore: before,
			stillAlive: before > 0 && alive(before),
			ps: before > 0 ? sh("ps", ["-p", String(before), "-o", "pid=,command="]) : "",
			homeFiles: listFiles(home),
			state: stateOf(w, stack, stage),
			alchemyHome: listFiles(join(w.dir, "alchemy-home")).map(w.scrub),
			dotAlchemy: listFiles(join(w.dir, ".alchemy")),
		};
	} finally {
		const left = host();
		if (left.alive) process.kill(left.pid, "SIGTERM");
		save("host", {steps: stepsJson(steps), seen});
		rmSync(w.dir, {recursive: true, force: true});
	}
};

// ---------------------------------------------------------------------------------------------
// Spike 2: a box through @alchemy.run/docker (146-alchemy-everywhere/box.run.ts).

const docker = (args: string[]) => sh("nice", ["-n", "15", "docker", ...args]);
const ours = (run: string) => {
	const containers = docker([
		"ps",
		"-a",
		"--filter",
		`label=${LABEL}=${run}`,
		"--format",
		"{{.ID}} {{.Image}} {{.Status}} {{.Names}}",
	]);
	const images = docker([
		"images",
		"--filter",
		`label=${LABEL}=${run}`,
		"--format",
		"{{.Repository}}:{{.Tag}} {{.ID}} {{.Size}}",
	]);
	const lines = (s: string) => s.split("\n").filter((l) => l.length > 0);
	return {containers: lines(containers), images: lines(images)};
};

const dockerSpike = () => {
	const w = makeWork();
	const file = join(spike, "box.run.ts");
	const stack = "exp146-box";
	const stage = "s146";
	const run = w.dir.slice(w.dir.lastIndexOf("-") + 1).toLowerCase();
	const steps: Step[] = [];
	const seen: Record<string, Json> = {run};
	// A fake key, never a real one: is a Redacted value kept in state, and in what form?
	const fakeKey = `fake-key-${randomBytes(16).toString("hex")}`;
	const env = (task: string) => ({BOX_RUN: run, BOX_TASK: task, BOX_FAKE_KEY: fakeKey});
	const keyInState = () => {
		const dir = join(w.dir, ".alchemy", "state", stack, stage);
		return existsSync(dir)
			? readdirSync(dir).filter((f) => readFileSync(join(dir, f), "utf8").includes(fakeKey))
			: [];
	};
	const taskInBox = () => {
		const out = outputOf(w, stack, stage);
		const id = typeof out.id === "string" ? out.id : "";
		return id === "" ? "" : docker(["exec", id, "sh", "-c", "echo $TASK; id -un"]);
	};
	try {
		steps.push(alchemy(w, "create", ["deploy", file, "--stage", stage, "--yes"], env("triage-1")));
		seen.afterCreate = {
			...ours(run),
			inBox: taskInBox(),
			fakeKeyInClearIn: keyInState(),
			state: JSON.parse(
				w
					.scrub(JSON.stringify(stateOf(w, stack, stage)))
					.split(fakeKey)
					.join("<fake key>"),
			),
		};
		steps.push(
			alchemy(w, "same inputs", ["deploy", file, "--stage", stage, "--yes"], env("triage-1")),
		);
		steps.push(
			alchemy(w, "new task (replace)", ["deploy", file, "--stage", stage, "--yes"], env("build-2")),
		);
		seen.afterChange = {...ours(run), inBox: taskInBox()};
		steps.push(alchemy(w, "destroy", ["destroy", file, "--stage", stage, "--yes"], env("build-2")));
		seen.afterDestroy = {...ours(run), state: stateOf(w, stack, stage)};
	} finally {
		const left = ours(run);
		for (const c of left.containers) docker(["rm", "-f", c.split(" ")[0] ?? ""]);
		for (const i of left.images) docker(["rmi", "-f", i.split(" ")[0] ?? ""]);
		seen.leftAfterCleanup = ours(run);
		const out = JSON.stringify({steps: stepsJson(steps), seen});
		save("docker", JSON.parse(out.split(fakeKey).join("<fake key>")));
		rmSync(w.dir, {recursive: true, force: true});
	}
};

// ---------------------------------------------------------------------------------------------
// Spike 3: one program, a Worker and a Host, under `alchemy dev` (146-alchemy-everywhere/local.run.ts).

/** Every process below `root`, from one `ps` read: pid and command. */
const descendants = (root: number) => {
	const rows = sh("ps", ["-axo", "pid=,ppid=,command="])
		.split("\n")
		.map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
		.flatMap((m) => (m ? [{pid: Number(m[1]), ppid: Number(m[2]), command: m[3] ?? ""}] : []));
	const found: {pid: number; command: string}[] = [];
	const walk = (p: number) => {
		for (const r of rows.filter((x) => x.ppid === p)) {
			found.push({pid: r.pid, command: r.command});
			walk(r.pid);
		}
	};
	walk(root);
	return found;
};

/** GET a local URL. `*.localhost` names go to 127.0.0.1 with the name in the Host header. */
const get = (url: string) =>
	new Promise<{status: number; body: string; ms: number}>((resolve) => {
		const u = new URL(url);
		const t0 = performance.now();
		const req = request(
			{host: "127.0.0.1", port: u.port, path: u.pathname, headers: {host: u.host}, timeout: 5000},
			(res) => {
				let body = "";
				res.on("data", (b) => {
					body += b.toString();
				});
				res.on("end", () =>
					resolve({status: res.statusCode ?? 0, body, ms: Math.round(performance.now() - t0)}),
				);
			},
		);
		req.on("error", (e) =>
			resolve({status: 0, body: String(e), ms: Math.round(performance.now() - t0)}),
		);
		req.end();
	});

const waitUntil = async (ok: () => boolean, ms: number) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (ok()) return true;
		await new Promise((r) => setTimeout(r, 100));
	}
	return ok();
};

const localSpike = async () => {
	const w = makeWork();
	const file = join(spike, "local.run.ts");
	const stack = "exp146-local";
	const stage = "s146";
	const home = join(w.dir, "host");
	const steps: Step[] = [];
	const run = w.dir.slice(w.dir.lastIndexOf("-") + 1).toLowerCase();
	const seen: Record<string, Json> = {run};
	const env = {HOST_HOME: home, BOX_RUN: run};
	let dev: ChildProcess | undefined;
	let devTree: {pid: number; command: string}[] = [];
	try {
		// `alchemy dev` stays up and serves; the driver reads its output until the apply is done.
		const t0 = performance.now();
		let out = "";
		const child = spawn("nice", ["-n", "15", bin, "dev", file, "--stage", stage], {
			cwd: w.dir,
			env: {...w.env, ...env},
			stdio: ["ignore", "pipe", "pipe"],
			detached: true,
		});
		dev = child;
		child.stdout.on("data", (b) => {
			out += b.toString();
		});
		child.stderr.on("data", (b) => {
			out += b.toString();
		});
		const up = await waitUntil(() => /Done: |Failed: /.test(out), 120_000);
		const upMs = Math.round(performance.now() - t0);
		const clean = w.scrub(out);
		const url = clean.match(/Started in [^\n]*?(https?:\/\/[^\s)]+)/)?.[1] ?? null;
		devTree = descendants(child.pid ?? -1);
		const answer = url === null ? null : await get(url);
		const again = url === null ? null : await get(url);
		const row = rowOf(w, stack, stage, "laptop");
		const attr = row?.attr;
		const pid = attr && typeof attr === "object" && !Array.isArray(attr) ? attr.pid : undefined;
		const workerRow = rowOf(w, stack, stage, "hello");
		seen.dev = {
			up,
			upMs,
			url,
			firstGet: answer,
			secondGet: again,
			hostPid: typeof pid === "number" ? pid : null,
			hostAlive: typeof pid === "number" && alive(pid),
			box: ours(run),
			processes: devTree.map((p) => ({pid: p.pid, command: w.scrub(p.command).slice(0, 160)})),
			output: clean
				.split("\n")
				.filter((l) => !/^\s+at /.test(l))
				.slice(-40)
				.join("\n"),
			workerRow: workerRow ? JSON.parse(w.scrub(JSON.stringify(workerRow))) : null,
			stateFiles: listFiles(join(w.dir, ".alchemy")),
		};
		console.log(JSON.stringify(seen.dev, null, 2));

		// Ctrl-C, as a person would: what stops, and what is left running?
		const t1 = performance.now();
		if (child.pid !== undefined) process.kill(-child.pid, "SIGINT");
		const stopped = await waitUntil(
			() => child.exitCode !== null || child.signalCode !== null,
			30_000,
		);
		await new Promise((r) => setTimeout(r, 500));
		seen.afterCtrlC = {
			stopped,
			stopMs: Math.round(performance.now() - t1),
			devTreeStillAlive: devTree
				.filter((p) => alive(p.pid))
				.map((p) => w.scrub(p.command).slice(0, 160)),
			hostAlive: typeof pid === "number" && alive(pid),
			box: ours(run),
			state: Object.keys(stateOf(w, stack, stage)),
		};
		console.log(JSON.stringify(seen.afterCtrlC, null, 2));

		// The rows dev left behind are taken down by a plain destroy, through each provider's own variant.
		steps.push(alchemy(w, "destroy after dev", ["destroy", file, "--stage", stage, "--yes"], env));
		seen.afterDestroy = {
			hostAlive: typeof pid === "number" && alive(pid),
			box: ours(run),
			devTreeStillAlive: devTree
				.filter((p) => alive(p.pid))
				.map((p) => w.scrub(p.command).slice(0, 160)),
			state: stateOf(w, stack, stage),
		};
	} finally {
		if (dev?.pid !== undefined && dev.exitCode === null) process.kill(-dev.pid, "SIGKILL");
		for (const p of devTree) if (alive(p.pid)) process.kill(p.pid, "SIGKILL");
		for (const c of ours(run).containers) docker(["rm", "-f", c.split(" ")[0] ?? ""]);
		seen.leftAfterCleanup = {...ours(run), devTree: devTree.filter((p) => alive(p.pid)).length};
		save("local", {steps: stepsJson(steps), seen});
		rmSync(w.dir, {recursive: true, force: true});
	}
};

// ---------------------------------------------------------------------------------------------
// Spike 4: the repo's own Ledger service inside a provider (146-alchemy-everywhere/ledger.run.ts).

/** Where `effect` resolves from a folder, as a repo-relative real path, and its version. */
const effectFrom = (dir: string) => {
	const req = createRequire(join(dir, "x.js"));
	const pkg = realpathSync(req.resolve("effect/package.json"));
	const root = dirname(here);
	const {version} = JSON.parse(readFileSync(pkg, "utf8"));
	return {path: relative(root, dirname(pkg)), version: typeof version === "string" ? version : "?"};
};

const effectSpike = () => {
	const w = makeWork();
	const file = join(spike, "ledger.run.ts");
	const stack = "exp146-ledger";
	const stage = "s146";
	const ledgerFile = join(w.dir, "ledger.db");
	const steps: Step[] = [];
	const seen: Record<string, Json> = {};
	const env = (writer: string) => ({LEDGER_FILE: ledgerFile, LEDGER_WRITER: writer});
	const deploy = (name: string, writer: string) => {
		steps.push(alchemy(w, name, ["deploy", file, "--stage", stage, "--yes"], env(writer)));
		return outputOf(w, stack, stage);
	};
	try {
		const alchemyCopy = effectFrom(join(spike, "node_modules", "alchemy"));
		const fabrikaCopy = effectFrom(join(dirname(here), "packages", "fabrika"));
		seen.copies = {
			alchemy: alchemyCopy,
			fabrika: fabrikaCopy,
			sameFile: alchemyCopy.path === fabrikaCopy.path,
		};
		console.log(JSON.stringify(seen.copies));
		seen.create = deploy("create", "exp146");
		seen.same = deploy("same inputs", "exp146");
		seen.newWriter = deploy("new writer (update)", "exp146-b");
		steps.push(
			alchemy(w, "destroy", ["destroy", file, "--stage", stage, "--yes"], env("exp146-b")),
		);
		seen.afterDestroy = {state: stateOf(w, stack, stage), ledgerFileKept: existsSync(ledgerFile)};
		// A ledger forgets nothing: deploy again over the same file, and the name is there already.
		seen.again = deploy("create again, same ledger file", "exp146");
		// "inbox" is a name the ledger refuses. Its Denied comes from the workspace's Effect copy;
		// the provider's catchTag, on this folder's copy, turns it into "denied on inbox".
		steps.push(
			alchemy(w, "a name the ledger denies", ["deploy", file, "--stage", stage, "--yes"], {
				...env("exp146"),
				LEDGER_STREAM: "inbox",
			}),
		);
		seen.denied = {
			caughtByTag: steps.at(-1)?.tail.includes("denied on inbox") ?? false,
			row: rowOf(w, stack, stage, "triage")?.status ?? null,
		};
		steps.push(
			alchemy(w, "destroy again", ["destroy", file, "--stage", stage, "--yes"], env("exp146")),
		);
		seen.row = stateOf(w, stack, stage);
	} finally {
		save("effect", {steps: stepsJson(steps), seen});
		rmSync(w.dir, {recursive: true, force: true});
	}
};

// ---------------------------------------------------------------------------------------------

const clean = () => {
	const containers = docker(["ps", "-a", "--filter", `label=${LABEL}`, "--format", "{{.ID}}"]);
	for (const id of containers.split("\n").filter((l) => l.length > 0)) docker(["rm", "-f", id]);
	const images = docker(["images", "--filter", `label=${LABEL}`, "--format", "{{.ID}}"]);
	for (const id of images.split("\n").filter((l) => l.length > 0)) docker(["rmi", "-f", id]);
	// A host started by spike 1 has its home in a temp folder named exp146-*: its own label.
	const ps = sh("ps", ["-axo", "pid=,command="]);
	for (const line of ps.split("\n")) {
		const [pid, ...cmd] = line.trim().split(/\s+/);
		const command = cmd.join(" ");
		if (command.includes("host-process.ts") && command.includes(`${LABEL}-`)) {
			process.kill(Number(pid), "SIGTERM");
			console.log(`stopped ${pid}`);
		}
	}
	for (const d of readdirSync(tmpdir())) {
		if (d.startsWith(`${LABEL}-`)) rmSync(join(tmpdir(), d), {recursive: true, force: true});
	}
	console.log(ours("").containers.length, "containers labelled", LABEL);
};

const main = () => {
	const which = process.argv[2];
	if (which === "host") return hostSpike();
	if (which === "docker") return dockerSpike();
	if (which === "local") return void localSpike();
	if (which === "effect") return effectSpike();
	if (which === "clean") return clean();
	console.error("usage: 146-alchemy-everywhere.ts host|docker|local|effect|clean");
	process.exit(2);
};

main();
