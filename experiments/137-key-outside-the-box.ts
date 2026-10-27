// Experiment 137: can an agent harness run in a box with no credential inside it, its model
// calls going out through a relay on the host that adds the credential?
//
//   env -u TYPESAFE_API_KEY SRT=<srt bin> node experiments/137-key-outside-the-box.ts wall none|srt|docker
//   env -u TYPESAFE_API_KEY node experiments/137-key-outside-the-box.ts relay
//   env -u TYPESAFE_API_KEY SRT=<srt bin> LOGIN_FILE=<file> node experiments/137-key-outside-the-box.ts turn srt|docker
//   env -u TYPESAFE_API_KEY node experiments/137-key-outside-the-box.ts clean
//
// Two parts, kept apart on purpose.
//
//   wall   Part 1, $0, a fake key only. The host makes a random `fake-key-<32 hex>`, keeps it in a
//          file in the home folder (where a real login sits) and hands it to the relay. The relay's
//          upstream is a stand-in for the Messages API on the host (./137-key-outside-the-box/
//          standin.ts), which asks Claude Code for the probe's tool calls. Claude Code runs in the
//          box with Bash and Read on; its Bash tool runs the probe (probe.mjs), which is handed the
//          key's SHA-256, never the key. The real login is not read in this part at all.
//   relay  The relay's refusals, tried from the host with raw requests: a host in the target, a
//          CONNECT, a path with dots, a credential the box sends, the per-box cap. $0.
//   turn   Part 2, the real login, tools off. One triage turn (the sort stage's own options, brief
//          and answer shape) from inside the box, through the relay to api.anthropic.com. Only the
//          relay holds the login: it reads LOGIN_FILE once into its own memory. It is never put in
//          an environment variable, on a command line or in a file, and never passed into the box.
//
// The boxes: `none` (a plain child, the baseline), `srt` (`@anthropic-ai/sandbox-runtime` 0.0.81,
// installed in a scratch folder outside the repo, as in 127) and `docker` (127's image and
// hardening). none and srt start through 128's `boxed()`; docker through ./137-key-outside-the-box/
// box.ts, 128's start with `--group-add 0` and the forwarder in front.
//
// The way to the relay is the narrowest each box allows:
//   srt     the relay listens on one port of the host's 127.0.0.1, and that IP and port is the
//           only entry in srt's network allow list. srt's own proxy carries the requests: the
//           program starts with NO_PROXY taken away, since srt lists loopback in it.
//   docker  `--network none`, so the container has its own loopback and nothing else. The relay
//           listens on a unix socket, mounted into the container. ./137-key-outside-the-box/fwd.mjs
//           listens on the container's own loopback and pipes each connection to the socket.
//   none    the relay's port, with nothing to stop anything else.
//
// Two settings for looking closer: STDERR_TO=<file> keeps the box's whole stderr, and SRT_DEBUG=1
// makes srt log what its proxy lets through and refuses.
//
// Node at the edge: the relay and the stand-in are HTTP servers, and `spawnClaudeCodeProcess`
// asks for a Node ChildProcess, synchronously.

import {execFileSync} from "node:child_process";
import {createHash, randomBytes} from "node:crypto";
import {
	appendFileSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import {connect} from "node:net";
import {homedir, tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {
	type Options,
	query,
	type SDKMessage,
	type SpawnedProcess,
	type SpawnOptions,
} from "@anthropic-ai/claude-agent-sdk";
import {agentEnv, MAKE_EMPTY_FOLDER, toolchain} from "@kampus/fabrika/agents/sandbox";
import {promptOf} from "@kampus/pipeline/stages/sort/brief";
import {sortDraft} from "@kampus/pipeline/stages/sort/machine";
import {sorterOptions} from "@kampus/pipeline/stages/sort/sorter";
import {boxed, dockerBoxed, type Started} from "./137-key-outside-the-box/box.ts";
import {type Relay, type RelayConfig, startRelay} from "./137-key-outside-the-box/relay.ts";
import {type StandIn, startStandIn} from "./137-key-outside-the-box/standin.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PARTS = join(HERE, "137-key-outside-the-box");
const RESULTS = join(HERE, "results", "137-key-outside-the-box.json");
const LABEL = "exp137";
const IMAGE = "exp137-claude:local";
const SDK_VERSION = "0.3.296";
const MODEL = "claude-haiku-4-5";
/** The models the relay lets a box ask for: haiku, by its short and its dated name. */
const MODELS = ["claude-haiku-4-5", "claude-haiku-4-5-20251001"];
/** The port fwd.mjs listens on inside a Docker box. The container's own loopback, not the host's. */
const INSIDE_PORT = 8137;
/** What the box holds where a login would be: a fixed word, not a secret. */
const PLACEHOLDER = "box-holds-no-key";
const STOP_AT = 1;

const BOXES = ["none", "srt", "docker"] as const;
type BoxName = (typeof BOXES)[number];

// Nothing real is handed on by accident: the host's own environment holds no login and no key.
for (const name of [
	"ANTHROPIC_API_KEY",
	"CLAUDE_CODE_OAUTH_TOKEN",
	"ANTHROPIC_AUTH_TOKEN",
	"TYPESAFE_API_KEY",
])
	if (process.env[name] !== undefined) throw new Error(`${name} is set: unset it and run again`);

// ---------------------------------------------------------------- one job

interface Job {
	readonly dir: string;
	readonly copy: string;
	readonly tmp: string;
	readonly config: string;
	/** The relay's socket, for docker. Short: a unix socket's path has at most 104 bytes on a Mac. */
	readonly sock: string;
}

const prepareJob = (): Job => {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "e137-")));
	const job = {
		dir,
		copy: join(dir, "copy"),
		tmp: join(dir, "tmp"),
		config: join(dir, "config"),
		sock: join(dir, "r.sock"),
	};
	for (const d of [job.copy, job.tmp, job.config]) mkdirSync(d);
	copyFileSync(join(PARTS, "probe.mjs"), join(job.copy, "probe.mjs"));
	return job;
};

/** No path of this machine goes into the results file or the log. */
const scrub = (text: string, job: Job | null) => {
	let t = text;
	if (job !== null) t = t.replaceAll(job.dir, "<job>");
	return t.replaceAll(realpathSync(tmpdir()), "<tmp>").replaceAll(homedir(), "~");
};

// ---------------------------------------------------------------- the boxes

/** What Claude Code's process is given: a program's few names, its own folders, the relay, and no login. */
const boxEnv = (name: BoxName, job: Job, relay: Relay): Record<string, string> => ({
	...agentEnv(),
	TMPDIR: job.tmp,
	CLAUDE_CODE_TMPDIR: job.tmp,
	CLAUDE_CONFIG_DIR: job.config,
	CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
	ANTHROPIC_BASE_URL:
		name === "docker"
			? `http://127.0.0.1:${INSIDE_PORT}`
			: `http://127.0.0.1:${relay.where.kind === "port" ? relay.where.port : 0}`,
	CLAUDE_CODE_OAUTH_TOKEN: PLACEHOLDER,
	...(name === "srt" && process.env.SRT_DEBUG === "1" ? {SRT_DEBUG: "1"} : {}),
});

/** srt for one job: read and write the job's own folders, read the toolchain, reach the relay's port. */
const srtSettings = (job: Job, relayPort: number, claudeBin: string) => ({
	network: {allowedDomains: [`127.0.0.1:${relayPort}`], deniedDomains: []},
	filesystem: {
		denyRead: [homedir(), job.dir],
		allowRead: [job.copy, job.tmp, job.config, dirname(realpathSync(claudeBin)), ...toolchain()],
		allowWrite: [job.copy, job.tmp, job.config],
		denyWrite: [],
	},
});

let stderrTail = "";
const started: Started[] = [];

/** The box as the Agent SDK's `spawnClaudeCodeProcess`. */
const claudeIn =
	(name: BoxName, job: Job, relay: Relay) =>
	(o: SpawnOptions): SpawnedProcess => {
		const cmd = {command: o.command, args: o.args, env: o.env, cwd: job.copy};
		let box: Started;
		if (name === "none") box = boxed({kind: "none"}, cmd);
		else if (name === "srt") {
			const srt = process.env.SRT;
			if (srt === undefined) throw new Error("set SRT to the srt CLI");
			if (relay.where.kind !== "port") throw new Error("srt reaches the relay by a port");
			const settingsFile = join(job.dir, "srt.json");
			writeFileSync(
				settingsFile,
				JSON.stringify(srtSettings(job, relay.where.port, o.command), null, 2),
			);
			// srt names loopback in NO_PROXY, so a client goes to the relay's port straight, and
			// Seatbelt lets the box reach srt's own proxy only. Without NO_PROXY the request goes
			// through srt's proxy, which lets the relay's IP and port through and nothing else.
			box = boxed(
				{kind: "srt", srt, settingsFile},
				{
					...cmd,
					command: "/usr/bin/env",
					args: ["-u", "NO_PROXY", "-u", "no_proxy", o.command, ...o.args],
				},
			);
		} else {
			if (relay.where.kind !== "socket") throw new Error("docker reaches the relay by a socket");
			box = dockerBoxed(
				{image: IMAGE, label: LABEL, mounts: [{from: job.copy, to: job.copy, readOnly: false}]},
				{socket: relay.where.path, fwd: join(PARTS, "fwd.mjs"), port: INSIDE_PORT},
				// In the container, `claude` is the image's own Linux build.
				{...cmd, command: "claude"},
			);
		}
		started.push(box);
		o.signal.addEventListener("abort", () => box.kill(), {once: true});
		// STDERR_TO=<file>: keep the box's whole stderr there (with SRT_DEBUG=1, srt's refusals too).
		const keep = process.env.STDERR_TO;
		box.child.stderr?.on("data", (chunk: Buffer) => {
			stderrTail = (stderrTail + chunk.toString("utf8")).slice(-2_000);
			if (keep !== undefined) appendFileSync(keep, chunk);
		});
		return box.child as SpawnedProcess;
	};

const relayFor = (
	name: BoxName,
	job: Job,
	upstream: string,
	credential: RelayConfig["credential"],
) =>
	startRelay({
		listen: name === "docker" ? {kind: "socket", path: job.sock} : {kind: "port"},
		upstream,
		credential,
		models: MODELS,
		cap: {requests: 12, tokens: 300_000, maxTokens: 64_000},
	});

/** A subscription login, as Claude Code sends one: a bearer token and the OAuth beta. */
const bearer = (token: string) => (betas: readonly string[]) => ({
	authorization: `Bearer ${token}`,
	"anthropic-beta": [...new Set([...betas, "oauth-2025-04-20"])].join(","),
});

/** Run one query to its end. */
const drive = async (prompt: string, options: Options) => {
	let result: Extract<SDKMessage, {type: "result"}> | null = null;
	let error: string | null = null;
	const t0 = performance.now();
	try {
		for await (const msg of query({prompt, options}) as AsyncIterable<SDKMessage>)
			if (msg.type === "result") result = msg;
	} catch (e) {
		error = `${e instanceof Error ? e.message : String(e)} | ${stderrTail.trim()}`;
	}
	return {result, error, ms: Math.round(performance.now() - t0)};
};

const stopBoxes = () => {
	for (const b of started.splice(0)) b.kill();
};

// ---------------------------------------------------------------- part 1: the wall, a fake key

const wall = async (name: BoxName) => {
	const job = prepareJob();
	const key = `fake-key-${randomBytes(16).toString("hex")}`;
	const keyHash = createHash("sha256").update(key).digest("hex");
	const keyFile = join(homedir(), `.exp137-key-${randomBytes(4).toString("hex")}`);
	writeFileSync(keyFile, `${key}\n`, {mode: 0o600});
	let standIn: StandIn | null = null;
	let relay: Relay | null = null;
	try {
		// The relay reads the key from its file, as part 2's reads the login.
		const held = readFileSync(keyFile, "utf8").trim();
		// Two tool calls: the probe by Bash, then the key file by the Read tool. The probe's "another
		// local port" is the stand-in's own: on the host, but not the relay.
		standIn = await startStandIn(held, (port) => [
			{
				tool: "Bash",
				input: {
					command: `node probe.mjs ${keyHash} ${keyFile} ${port}`,
					description: "Run the probe",
				},
			},
			{tool: "Read", input: {file_path: keyFile}},
		]);
		relay = await relayFor(name, job, `http://127.0.0.1:${standIn.port}`, bearer(held));
		stderrTail = "";
		const options: Options = {
			cwd: job.copy,
			env: boxEnv(name, job, relay),
			model: MODEL,
			effort: "low",
			settingSources: [],
			strictMcpConfig: true,
			mcpServers: {},
			settings: {disableClaudeAiConnectors: true},
			permissionMode: "dontAsk",
			tools: ["Bash", "Read"],
			allowedTools: ["Bash", "Read"],
			persistSession: false,
			maxBudgetUsd: 0.05,
			// Inside a box the SDK's own per-command sandbox is off: the two do not nest (127).
			sandbox: {enabled: false},
			spawnClaudeCodeProcess: claudeIn(name, job, relay),
		};
		const run = await drive("Run the steps you are given, one tool call each.", options);
		const probeText = standIn.results.get(0)?.text ?? "";
		const line = probeText.split("\n").find((l) => l.startsWith("PROBE "));
		const read = standIn.results.get(1);
		const arrived = standIn.arrived;
		return {
			box: name,
			finished: run.result?.subtype === "success" && !run.result.is_error,
			error: run.error === null ? null : scrub(run.error, job).slice(0, 600),
			ms: run.ms,
			turns: run.result?.num_turns ?? 0,
			probe:
				line === undefined
					? {missing: scrub(probeText, job).slice(0, 300)}
					: JSON.parse(line.slice(6)),
			readTool: read === undefined ? null : {error: read.error, gotKey: read.text.includes(held)},
			upstream: {
				requests: arrived.length,
				allKeyed: arrived.every((a) => a.keyed),
				stray: arrived.filter((a) => a.stray).length,
				keyInBody: arrived.filter((a) => a.keyInBody).length,
				mainLoop: arrived.filter((a) => a.step !== null).length,
				paths: [...new Set(arrived.map((a) => a.path))],
			},
			relay: relay.seen.map((s) => ({...s, target: scrub(s.target, job)})),
			spent: relay.spent(),
		};
	} finally {
		stopBoxes();
		await relay?.close();
		await standIn?.close();
		rmSync(keyFile, {force: true});
		rmSync(job.dir, {recursive: true, force: true});
	}
};

// ---------------------------------------------------------------- the relay's refusals, from the host

/** One raw HTTP request to the relay's port: its status line's code. */
const raw = (port: number, text: string) =>
	new Promise<string>((resolve) => {
		const s = connect(port, "127.0.0.1");
		let got = "";
		s.on("data", (c) => {
			got += c.toString("utf8");
		});
		s.on("close", () => resolve(got.split(" ")[1] ?? "none"));
		s.on("error", () => resolve("failed"));
		s.write(text);
		setTimeout(() => s.destroy(), 3_000);
	});

const relayChecks = async () => {
	const key = `fake-key-${randomBytes(16).toString("hex")}`;
	const standIn = await startStandIn(key, () => []);
	const relay = await startRelay({
		listen: {kind: "port"},
		upstream: `http://127.0.0.1:${standIn.port}`,
		credential: bearer(key),
		models: MODELS,
		cap: {requests: 2, tokens: 1_000_000, maxTokens: 64_000},
	});
	if (relay.where.kind !== "port") throw new Error("port");
	const port = relay.where.port;
	const body = JSON.stringify({
		model: MODEL,
		max_tokens: 5,
		stream: true,
		messages: [{role: "user", content: "hi"}],
	});
	const post = (path: string, headers = "") =>
		`POST ${path} HTTP/1.1\r\nhost: 127.0.0.1\r\ncontent-type: application/json\r\n${headers}content-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`;
	try {
		const out = {
			hostInTarget: await raw(
				port,
				`GET http://example.com/ HTTP/1.1\r\nhost: example.com\r\nconnection: close\r\n\r\n`,
			),
			connect: await raw(port, `CONNECT example.com:443 HTTP/1.1\r\nhost: example.com:443\r\n\r\n`),
			dotsToModels: await raw(port, post("/v1/messages/../models")),
			otherQuery: await raw(port, post("/v1/messages?x=1")),
			// The box sends a credential of its own: the relay drops it and adds the key.
			withBoxCredential: await raw(
				port,
				post(
					"/v1/messages",
					`x-api-key: ${PLACEHOLDER}\r\nauthorization: Bearer ${PLACEHOLDER}\r\n`,
				),
			),
			second: await raw(port, post("/v1/messages?beta=true")),
			// The cap is two requests: the third is refused before it leaves.
			third: await raw(port, post("/v1/messages")),
		};
		return {
			statuses: out,
			upstreamSaw: standIn.arrived.length,
			upstreamAllKeyed: standIn.arrived.every((a) => a.keyed),
			upstreamStray: standIn.arrived.filter((a) => a.stray).length,
			relay: relay.seen,
		};
	} finally {
		await relay.close();
		await standIn.close();
	}
};

// ---------------------------------------------------------------- part 2: one triage turn, the real login

const NOTE =
	"A small JavaScript library, `format-bytes`: one function, `formatBytes(n)`, that turns a number of bytes into a short label for people to read.";

const ticket = {
	url: "https://example.invalid/format-bytes/issues/7",
	number: 7,
	state: "open" as const,
	title: "formatBytes(2048) prints 2048 B, not 2.0 KB",
	body: "Calling `formatBytes(2048)` gives `2048 B`. Anything of 1024 bytes or more should be shown in KB with one decimal, so 2048 should be `2.0 KB`.",
};

/** Does any file the box could write hold `secret`? Looked at on the host, after the box is gone. */
const leftIn = (roots: readonly string[], secret: string) => {
	let files = 0;
	let hits = 0;
	const go = (dir: string) => {
		for (const n of existsSync(dir) ? readdirSync(dir) : []) {
			const p = join(dir, n);
			const s = statSync(p);
			if (s.isDirectory()) go(p);
			else if (s.isFile() && s.size < 5_000_000) {
				files++;
				if (readFileSync(p, "utf8").includes(secret)) hits++;
			}
		}
	};
	for (const r of roots) go(r);
	return {files, hits};
};

const turn = async (name: BoxName) => {
	const file = process.env.LOGIN_FILE;
	if (file === undefined) throw new Error("set LOGIN_FILE to the file that holds the login");
	// Read once, into the relay's memory. Never printed, never written, never in an environment.
	const login = readFileSync(file, "utf8").trim();
	const hide = (t: string) => t.replaceAll(login, "<login>");
	const job = prepareJob();
	let relay: Relay | null = null;
	try {
		relay = await relayFor(name, job, "https://api.anthropic.com", bearer(login));
		stderrTail = "";
		const settings = {model: MODEL, effort: "low" as const, budget: 0.1, note: NOTE};
		const base = sorterOptions(settings, job.copy);
		const options: Options = {
			...base,
			env: boxEnv(name, job, relay),
			spawnClaudeCodeProcess: claudeIn(name, job, relay),
			// As the sort stage's runner asks for it (sdkRunner): the answer's shape.
			outputFormat: {type: "json_schema", schema: sortDraft.schema},
		};
		const prompt = promptOf({ticket, context: {earlier: [], plans: []}, note: NOTE});
		const run = await drive(prompt, options);
		stopBoxes();
		const r = run.result;
		return {
			box: name,
			finished: r?.subtype === "success" && !r.is_error,
			error: run.error === null ? null : hide(scrub(run.error, job)).slice(0, 600),
			resultError: r !== null && r.subtype !== "success" ? r.subtype : null,
			ms: run.ms,
			usd: r?.total_cost_usd ?? 0,
			turns: r?.num_turns ?? 0,
			usage: r?.usage ?? null,
			answer:
				r !== null && r.subtype === "success"
					? (r.structured_output ?? hide(r.result).slice(0, 400))
					: null,
			relay: relay.seen,
			spent: relay.spent(),
			loginLeftInBox: leftIn([job.copy, job.tmp, job.config], login),
		};
	} finally {
		stopBoxes();
		await relay?.close();
		rmSync(job.dir, {recursive: true, force: true});
	}
};

// ---------------------------------------------------------------- docker image

const dockerfile = `FROM node:26.12.0-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install --global @anthropic-ai/claude-agent-sdk-linux-${process.arch}@${SDK_VERSION} && npm cache clean --force \\
 && ln -s /usr/local/lib/node_modules/@anthropic-ai/claude-agent-sdk-linux-${process.arch}/claude /usr/local/bin/claude
# The empty folder a run reads project settings from (ownRules, experiment 155). Debian ships none; made by root, read-only.
RUN ${MAKE_EMPTY_FOLDER}
USER node
WORKDIR /home/node
`;

const buildImage = () => {
	const t0 = performance.now();
	execFileSync("docker", ["build", "-q", "--label", LABEL, "-t", IMAGE, "-"], {
		input: dockerfile,
		stdio: ["pipe", "ignore", "inherit"],
	});
	return Math.round(performance.now() - t0);
};

const clean = () => {
	const q = (args: string[]) => {
		try {
			return execFileSync("docker", args, {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();
		} catch {
			return "";
		}
	};
	const list = (args: string[]) => q(args).split("\n").filter(Boolean);
	const containers = list(["ps", "-aq", "--filter", `label=${LABEL}`]);
	if (containers.length > 0) q(["rm", "-f", ...containers]);
	q(["image", "rm", IMAGE]);
	const images = list(["images", "-aq", "--filter", `label=${LABEL}`]);
	if (images.length > 0) q(["image", "rm", "-f", ...images]);
	const keys = readdirSync(homedir()).filter((n) => n.startsWith(".exp137-"));
	for (const n of keys) rmSync(join(homedir(), n), {force: true});
	const temps = readdirSync(tmpdir()).filter((n) => n.startsWith("e137-"));
	for (const n of temps) rmSync(join(tmpdir(), n), {recursive: true, force: true});
	return {
		containers: containers.length,
		keyFiles: keys.length,
		tempFolders: temps.length,
		left: {
			containers: list(["ps", "-aq", "--filter", `label=${LABEL}`]).length,
			images: list(["images", "-aq", "--filter", `label=${LABEL}`]).length,
		},
	};
};

// ---------------------------------------------------------------- main

type Data = {
	wall: Record<string, unknown>;
	relay: unknown;
	turn: Record<string, unknown>;
	notes: Record<string, unknown>;
};

const load = (): Data =>
	existsSync(RESULTS)
		? JSON.parse(readFileSync(RESULTS, "utf8"))
		: {wall: {}, relay: null, turn: {}, notes: {}};

const save = (d: Data) =>
	writeFileSync(RESULTS, `${JSON.stringify({experiment: 137, ...d}, null, "\t")}\n`);

const main = async () => {
	const [mode, which] = process.argv.slice(2);
	if (mode === "clean") return console.log(clean());
	const data = load();
	if (mode === "relay") {
		data.relay = await relayChecks();
		save(data);
		return console.log(JSON.stringify(data.relay, null, 2));
	}
	const known = (w: string | undefined): w is BoxName => BOXES.some((b) => b === w);
	if (!known(which) || (mode !== "wall" && mode !== "turn"))
		throw new Error(`usage: wall ${BOXES.join("|")} | relay | turn srt|docker | clean`);
	if (which === "docker") data.notes.dockerBuildMs = buildImage();
	if (mode === "wall") {
		const r = await wall(which);
		data.wall[which] = r;
		save(data);
		return console.log(JSON.stringify(r, null, 2));
	}
	if (which === "none") throw new Error("the real login goes through a box only");
	const r = await turn(which);
	data.turn[which] = r;
	save(data);
	console.log(JSON.stringify(r, null, 2));
	if (r.usd > STOP_AT) throw new Error(`spent $${r.usd}, over $${STOP_AT}`);
};

await main();
