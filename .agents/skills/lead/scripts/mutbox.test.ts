import "../../mutation/scripts/run.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/sample.ts?raw";
import {spawnSync} from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import fc from "fast-check";
import {afterAll, describe, expect, it} from "vitest";
import packageJson from "../../../../package.json" with {type: "json"};
import entry from "./mutbox-entry.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import dockerfile from "./mutbox.Dockerfile?raw";
import {
	baseNode,
	exitCode,
	imageTag,
	judge,
	LABEL,
	LIMITS,
	mountable,
	narrowed,
	needsHost,
	OWNER,
	parseRelated,
	pnpmVersion,
	runArgs,
	secondsFor,
	tally,
} from "./mutbox.ts";

// Today's lead tooling. The pure parts are properties. The flow runs the real script against a
// stand-in `docker` on PATH, so no test here needs Docker; the one real run is the labeled
// scenario at the end, which only runs when MUTBOX_DOCKER=1 says a Docker box is free.
const options = {seed: 483, numRuns: 100};
const script = join(import.meta.dirname, "mutbox.ts");
const made: string[] = [];

afterAll(() => {
	for (const dir of made) {
		rmSync(dir, {recursive: true, force: true});
	}
});

const segment = fc.stringMatching(/^[a-z][a-z0-9_-]{0,8}$/);

const testPath = fc
	.tuple(fc.array(segment, {minLength: 0, maxLength: 3}), segment, fc.constantFrom("ts", "tsx"))
	.map(([dirs, name, ext]) => [...dirs, `${name}.test.${ext}`].join("/"));

const row = fc.record({
	file: fc.constantFrom("src/a.ts", "src/b.ts"),
	line: fc.integer({min: 1, max: 9}),
	column: fc.integer({min: 0, max: 9}),
	endLine: fc.integer({min: 1, max: 9}),
	endColumn: fc.integer({min: 0, max: 9}),
	mutator: fc.constantFrom("BooleanLiteral", "EqualityOperator"),
	replacement: fc.constantFrom("true", "false", ""),
	status: fc.constantFrom("Killed", "Survived", "Timeout", "NoCoverage", "CompileError"),
});

describe("mutbox, the pure parts", () => {
	// Plants: accept a path that climbs out, an absolute one, an option, or a file that is no test.
	it("related paths are plain test files inside the repo, or the whole list is refused", () => {
		fc.assert(
			fc.property(fc.array(testPath, {minLength: 1, maxLength: 5}), (paths) => {
				expect(parseRelated(paths.join(","))).toEqual(paths);
				expect(parseRelated(` ${paths.join(" , ")} ,`)).toEqual(paths);

				for (const bad of [
					"../x.test.ts",
					"/etc/x.test.ts",
					"-x.test.ts",
					"src/a.ts",
					"a/../b.test.ts",
				]) {
					expect(parseRelated([...paths, bad].join(","))).toBeNull();
				}
			}),
			options,
		);
		expect(parseRelated("")).toBeNull();
		expect(parseRelated(",,")).toBeNull();
	});

	// Plants: drop `--network none`, add a volume, mount the output read-write over the input.
	it("the docker run line fences every run the same way, whatever it is asked", () => {
		fc.assert(
			fc.property(
				fc.record({
					name: segment,
					image: segment,
					input: fc.string(),
					output: fc.string(),
					ticket: fc.stringMatching(/^[0-9]{1,5}$/),
					build: fc.stringMatching(/^[0-9a-f]{40}$/),
					related: fc.array(testPath, {minLength: 1, maxLength: 3}),
					lock: fc.string(),
				}),
				(ask) => {
					const args = runArgs(ask);
					const pair = (flag: string) =>
						args.flatMap((a, i) => (a === flag ? [args[i + 1] ?? ""] : []));
					expect(pair("--network")).toEqual(["none"]);
					expect(pair("--cap-drop")).toEqual(["ALL"]);
					expect(pair("--security-opt")).toEqual(["no-new-privileges"]);
					expect(pair("--user")).toEqual(["node"]);
					expect(pair("--cpus")).toEqual([String(LIMITS.cpus)]);
					expect(pair("--memory")).toEqual([LIMITS.memory]);
					expect(pair("--memory-swap")).toEqual([LIMITS.memory]);
					expect(pair("--pids-limit")).toEqual([String(LIMITS.pids)]);
					expect(pair("--label")).toEqual([LABEL, `${OWNER}=${ask.lock}`]);
					expect(args).toContain("--rm");
					expect(pair("--mount")).toEqual([
						`type=bind,src=${ask.input},dst=/in,readonly`,
						`type=bind,src=${ask.output},dst=/out`,
					]);
					// Nothing else crosses: no volume, no host network, no extra right, no device.
					const flags = args.slice(0, args.indexOf(ask.image)).filter((a) => a.startsWith("-"));
					expect(new Set(flags)).toEqual(
						new Set([
							"--rm",
							"--init",
							"--platform",
							"--network",
							"--cap-drop",
							"--security-opt",
							"--user",
							"--cpus",
							"--memory",
							"--memory-swap",
							"--pids-limit",
							"--name",
							"--label",
							"--mount",
							"--env",
						]),
					);
					expect(pair("--env").map((e) => e.split("=")[0])).toEqual(["T", "BUILD", "RELATED"]);
				},
			),
			options,
		);
	});

	// Plant: let a comma through, so `--mount` reads the rest of the path as its own options.
	it("a path docker --mount cannot take is refused, and a path with spaces is fine", () => {
		fc.assert(
			fc.property(
				fc.array(segment, {minLength: 1, maxLength: 4}),
				fc.constantFrom(",", '"', "\n"),
				(parts, bad) => {
					const path = `/${parts.join("/ with spaces/")}`;
					expect(mountable(path)).toBe(true);
					expect(mountable(`${path}${bad}x`)).toBe(false);
					expect(mountable(path.slice(1))).toBe(false);
				},
			),
			options,
		);
	});

	// Plant: answer null for every source, so a window test is counted as run.
	it("a test that imports Electron or a browser driver needs the host; no other test does", () => {
		fc.assert(
			fc.property(
				fc.constantFrom("electron", "playwright", "@playwright/test"),
				fc.constantFrom('"', "'"),
				fc.constantFrom("vitest", "./electron.ts", "effect", "node:net"),
				(name, quote, other) => {
					expect(needsHost(`import {x} from ${quote}${name}${quote};\n`)).toMatch(/no display/);
					expect(needsHost(`import {x} from ${quote}${other}${quote};\n`)).toBeNull();
				},
			),
			options,
		);
	});

	// format: the real Dockerfile's base is pinned by digest, and is the Node this repo runs.
	it("format: the image's base is pinned by digest at the repo's own Node version", () => {
		expect(baseNode(dockerfile)).toBe(packageJson.engines.node);
		expect(baseNode("FROM node:26.13.0-bookworm\n")).toBeNull();
		expect(baseNode(`FROM node:26-bookworm@sha256:${"a".repeat(64)}`)).toBeNull();
		expect(pnpmVersion(packageJson.packageManager)).not.toBeNull();
		expect(pnpmVersion("pnpm@^12.0.0")).toBeNull();
		expect(pnpmVersion("pnpm@latest")).toBeNull();
		expect(imageTag("0123456789abcdef0123")).toBe("fabrika-mutbox:0123456789abcdef");
		// The entry never asks for a network or a key, and the Dockerfile copies only what it names.
		expect(dockerfile.match(/^COPY .*$/gm)).toEqual([
			"COPY mutbox-entry.sh /usr/local/bin/mutbox-entry",
			"COPY --chown=node:node pnpm-lock.yaml pnpm-workspace.yaml ./",
			"COPY --chown=node:node patches ./patches",
		]);
		expect(entry).toContain("pnpm install --offline --frozen-lockfile");
		expect(secondsFor(true)).toBeGreaterThan(secondsFor(false));
	});

	// Plants: count NoCoverage as tested; report a mutant arm a also lets live as narrowing.
	it("an arm's counts add up, and narrowing is exactly what arm a kills and arm b lets live", () => {
		fc.assert(
			fc.property(
				fc.array(row, {maxLength: 30}),
				fc.array(row, {maxLength: 30}),
				fc.nat({max: 40}),
				(a, b, selected) => {
					const arm = tally(0, "report", b, selected);
					expect(Object.values(arm.counts).reduce((x, y) => x + y, 0)).toBe(b.length);
					expect(arm.tested).toBe(
						b.filter((r) => ["Killed", "Survived", "Timeout"].includes(r.status)).length,
					);
					expect(arm.survivors).toEqual(b.filter((r) => r.status === "Survived"));
					expect(arm.unreached).toBe(Math.max(0, selected - b.length));
					const same = (x: object, y: object) =>
						JSON.stringify({...x, status: ""}) === JSON.stringify({...y, status: ""});
					const list = narrowed(a, b);

					for (const r of b) {
						const lives = r.status === "Survived" || r.status === "NoCoverage";
						const killedInA = a.some(
							(x) => same(x, r) && (x.status === "Killed" || x.status === "Timeout"),
						);
						expect(list.includes(r)).toBe(lives && killedInA);
					}
				},
			),
			options,
		);
	});

	// Plants: call a run with no tested mutant done; call a missing report done.
	it("only a run with a real test result is done, and every other end is skip or stuck", () => {
		fc.assert(
			fc.property(
				fc.constantFrom(0, 1, 70, 71, 124, 137),
				fc.option(fc.array(fc.constant("src/a.ts:1:0-1:5"), {maxLength: 2}), {nil: null}),
				fc.option(fc.array(row, {maxLength: 6}), {nil: null}),
				(exit, ranges, rows) => {
					const sample =
						ranges === null ? null : {seed: 119120, ranges, total: 2, selected: 2, left: 0};
					const b = rows === null ? null : tally(exit, "report", rows, 2);
					const got = judge({exit, sample, b, failed: ["a.test.ts: fails"]});
					expect(exitCode(got.outcome)).toBe({done: 0, skip: 40, stuck: 30}[got.outcome]);

					if (got.outcome === "done") {
						expect(b?.tested).toBeGreaterThan(0);
						expect(sample?.ranges.length).toBeGreaterThan(0);
						expect([0, 124]).toContain(exit);
					}

					if (got.outcome === "skip") {
						expect(sample?.ranges).toEqual([]);
					}

					if ([70, 71, 137].includes(exit)) {
						expect(got.outcome).toBe("stuck");
					}

					if (got.outcome !== "done" || got.reason !== "") {
						expect(got.reason).not.toBe("");
						expect(got.detail).not.toBe("");
					}
				},
			),
			options,
		);
	});
});

// The stand-in docker: it writes every call to calls.log and plays the container from container.sh.
const DOCKER = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE/calls.log"
case "$1 $2" in
"version "*) [ -z "\${DOWN:-}" ] || exit 1; echo "\${SERVER:-linux/arm64}" ;;
"ps "*) cat "$FAKE/leftover" 2>/dev/null || : ;;
"rm "*|"kill "*) : ;;
"image inspect") [ -e "$FAKE/image" ] || exit 1; echo id ;;
"image prune") echo "untagged: fabrika-mutbox:old" ;;
"build "*) for a; do last=$a; done; (cd "$last" && find . -type f | sort) > "$FAKE/context.txt"; touch "$FAKE/image" ;;
"run "*)
	for a; do case $a in type=bind,src=*,dst=/out) out=\${a#type=bind,src=}; out=\${out%,dst=/out} ;; esac; done
	for a; do case $a in type=bind,src=*,dst=/in,readonly) in=\${a#type=bind,src=}; in=\${in%,dst=/in,readonly} ;; esac; done
	export OUT="$out" IN="$in"
	exec sh "$FAKE/container.sh" ;;
esac
`;

const mutant = (status: string, line: number) => ({
	id: String(line),
	mutatorName: "BooleanLiteral",
	replacement: "false",
	status,
	location: {start: {line, column: 0}, end: {line, column: 4}},
});

const DONE = `
mkdir -p "$OUT/b"
echo 0 > "$OUT/b/exit"
echo '${JSON.stringify({seed: 119120, ranges: ["src/a.ts:1:0-1:4"], total: 2, selected: 2, left: 0})}' > "$OUT/b/sample.json"
echo '${JSON.stringify({files: {"src/a.ts": {mutants: [mutant("Killed", 1), mutant("Survived", 2)]}}})}' > "$OUT/b/report.json"
echo '${JSON.stringify({
	testResults: [
		{
			name: "/repo/src/a.test.ts",
			assertionResults: [
				{fullName: "adds", status: "passed"},
				{fullName: "on a Mac only", status: "skipped"},
			],
		},
	],
})}' > "$OUT/baseline.json"
echo 1000 > "$OUT/memory.peak"
echo 'usage_usec 2500000' > "$OUT/cpu.stat"
git --git-dir "$IN/repo.git" log --format=%s refs/heads/build > "$FAKE/commits.txt"
`;

type Setup = {
	run?: string;
	image?: boolean;
	env?: Record<string, string>;
	docker?: boolean;
	lockPid?: number;
	leftover?: string;
	related?: string;
	node?: string;
	seconds?: number;
	lockfile?: string;
	outName?: string;
};

/** A real git checkout with two commits, a stand-in docker, and one run of the real script. */
const run = (setup: Setup = {}) => {
	// A folder with a space in its name: every path the script handles has one.
	const dir = join(realpathSync(mkdtempSync(join(tmpdir(), "mutbox-"))), "with space");
	made.push(join(dir, ".."));
	const repo = join(dir, "repo"),
		fake = join(dir, "fake"),
		bin = join(dir, "bin"),
		out = join(dir, setup.outName ?? "out"),
		lock = join(dir, "docker.lock");

	for (const d of [join(repo, "src"), join(repo, "patches"), fake, bin]) {
		mkdirSync(d, {recursive: true});
	}

	const git = (...args: string[]) => {
		const ran = spawnSync(
			"/usr/bin/git",
			["-C", repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", ...args],
			{encoding: "utf8"},
		);
		expect(ran.status, ran.stderr).toBe(0);
		return ran.stdout.trim();
	};
	git("init", "-q");
	writeFileSync(
		join(repo, "package.json"),
		JSON.stringify({
			packageManager: "pnpm@12.16.1",
			engines: {node: setup.node ?? baseNode(dockerfile)},
		}),
	);
	writeFileSync(join(repo, "pnpm-lock.yaml"), setup.lockfile ?? "lockfileVersion: '9.0'\n");
	writeFileSync(join(repo, "pnpm-workspace.yaml"), "packages: []\n");
	writeFileSync(join(repo, "patches/x@1.0.0.patch"), "diff\n");
	writeFileSync(join(repo, "src/a.ts"), "export const a = true;\n");
	writeFileSync(join(repo, "src/a.test.ts"), 'import {it} from "vitest";\n');
	writeFileSync(join(repo, "src/win.test.ts"), 'import {_electron} from "playwright";\n');
	git("add", ".");
	git("commit", "-qm", "parent");
	writeFileSync(join(repo, "src/a.ts"), "export const a = false;\n");
	writeFileSync(join(repo, "secret.txt"), "never committed\n");
	git("commit", "-qam", "build");
	const build = git("rev-parse", "HEAD");
	// The build commit is not a branch tip, as on a lane whose later steps moved on.
	writeFileSync(join(repo, "src/a.ts"), "export const a = null;\n");
	git("commit", "-qam", "later");

	if (setup.docker !== false) {
		writeFileSync(join(bin, "docker"), DOCKER, {mode: 0o755});
	}

	writeFileSync(join(fake, "container.sh"), setup.run ?? DONE);

	if (setup.image !== false) {
		writeFileSync(join(fake, "image"), "");
	}

	if (setup.lockPid !== undefined) {
		writeFileSync(lock, String(setup.lockPid));
	}

	if (setup.leftover !== undefined) {
		writeFileSync(join(fake, "leftover"), `${setup.leftover}\n`);
	}

	const started = Date.now();
	const ran = spawnSync(
		process.execPath,
		[
			script,
			"run",
			"--checkout",
			repo,
			"--ticket",
			"483",
			"--build",
			build,
			"--related",
			setup.related ?? "src/a.test.ts",
			"--out",
			out,
			"--lock",
			lock,
			...(setup.seconds === undefined ? [] : ["--seconds", String(setup.seconds)]),
		],
		{
			encoding: "utf8",
			timeout: 30_000,
			env: {
				// With no stand-in, no docker at all: a CI machine has a real one in /usr/bin.
				PATH: setup.docker === false ? bin : `${bin}:/usr/bin:/bin`,
				HOME: dir,
				FAKE: fake,
				...setup.env,
			},
		},
	);
	const calls = existsSync(join(fake, "calls.log"))
		? readFileSync(join(fake, "calls.log"), "utf8").trim().split("\n")
		: [];
	const line = ran.stdout.trim().split("\n").at(-1) ?? "";
	return {
		code: ran.status,
		text: ran.stdout + ran.stderr,
		summary: line.startsWith("{") ? JSON.parse(line) : null,
		saved: existsSync(join(out, "mutbox.json"))
			? readFileSync(join(out, "mutbox.json"), "utf8").trim()
			: null,
		line,
		calls,
		ranContainer: calls.some((c) => c.startsWith("run ")),
		context: existsSync(join(fake, "context.txt"))
			? readFileSync(join(fake, "context.txt"), "utf8").trim().split("\n")
			: null,
		commits: existsSync(join(fake, "commits.txt"))
			? readFileSync(join(fake, "commits.txt"), "utf8").trim().split("\n")
			: null,
		lockLeft: existsSync(lock),
		inputLeft: existsSync(join(out, "in")),
		ms: Date.now() - started,
		fake,
		dir,
		build,
	};
};

describe("mutbox, the run against a stand-in docker", () => {
	// scenario: the happy path once, end to end, since every later case is one change to it.
	// Plant: read the report without mounting the output, or leave the lock or the input behind.
	it("scenario: a path with spaces runs, reports, and leaves no lock, input or container", () => {
		const got = run();
		expect(got.code, got.text).toBe(0);
		expect(got.summary).toMatchObject({
			outcome: "done",
			ticket: "483",
			build: got.build,
			network: "none",
			related: ["src/a.test.ts"],
			excluded: [],
			skipped: ["src/a.test.ts: on a Mac only (skipped)"],
			usage: {memoryPeakBytes: 1000, cpuSeconds: 2.5},
			b: {exit: 0, from: "report", tested: 2, counts: {Killed: 1, Survived: 1}},
			a: null,
			narrowing: null,
		});
		expect(got.summary.b.survivors).toEqual([
			{
				file: "src/a.ts",
				line: 2,
				column: 0,
				endLine: 2,
				endColumn: 4,
				mutator: "BooleanLiteral",
				replacement: "false",
				status: "Survived",
			},
		]);
		expect(got.saved).toBe(got.line);
		// The copy that went in holds the build commit and its parent, and nothing later.
		expect(got.commits).toEqual(["build", "parent"]);
		expect(got.lockLeft).toBe(false);
		expect(got.inputLeft).toBe(false);
		const runCall = got.calls.find((c) => c.startsWith("run "))!;
		expect(runCall).toContain("--network none");
		expect(runCall).toContain(`src=${join(got.dir, "out", "box")},dst=/out`);
		expect(got.calls.at(-1)).toMatch(/^rm -f fabrika-mutbox-483-\d+$/);
		expect(got.calls.some((c) => c.startsWith("build "))).toBe(false);
	});

	// Plant: run the sample on the host when docker is missing.
	it("with Docker missing, stopped or on another platform the step is stuck and nothing runs", () => {
		for (const [setup, reason] of [
			[{docker: false}, "docker_down"],
			[{env: {DOWN: "1"}}, "docker_down"],
			[{env: {SERVER: "linux/amd64"}}, "not_arm64"],
		] as const) {
			const got = run(setup);
			expect(got.code, got.text).toBe(30);
			expect(got.summary).toMatchObject({outcome: "stuck", reason});
			expect(got.ranContainer).toBe(false);
			expect(got.saved).toBe(got.line);
			expect(got.lockLeft).toBe(false);
		}
	});

	// Plants: reuse any image; copy the whole checkout into the build; keep the tag when the lockfile changes.
	it("a missing image is built from the commit's own lockfile, and a changed lockfile is a new image", () => {
		const first = run({image: false});
		expect(first.code, first.text).toBe(0);
		const built = first.calls.find((c) => c.startsWith("build "))!;
		expect(built).toContain("--build-arg PNPM=12.16.1");
		expect(built).toContain(`--label ${LABEL}`);
		// The build's folder holds the lockfile, workspace file, patches and our two files only.
		expect(first.context).toEqual([
			"./Dockerfile",
			"./mutbox-entry.sh",
			"./patches/x@1.0.0.patch",
			"./pnpm-lock.yaml",
			"./pnpm-workspace.yaml",
		]);
		const tag = (calls: string[]) =>
			/--tag (fabrika-mutbox:[0-9a-f]{16})/.exec(calls.find((c) => c.startsWith("build "))!)?.[1];
		const again = run({image: false});
		const other = run({image: false, lockfile: "lockfileVersion: '9.0'\n# changed\n"});
		expect(tag(again.calls)).toBe(tag(first.calls));
		expect(tag(other.calls)).not.toBe(tag(first.calls));
		expect(first.calls.find((c) => c.startsWith("run "))).toContain(tag(first.calls));
	});

	// Plant: build an image for a Node the commit does not run.
	it("a commit that runs another Node than the image's base is stuck before any build", () => {
		const got = run({node: "20.0.0", image: false});
		expect(got.code, got.text).toBe(30);
		expect(got.summary).toMatchObject({outcome: "stuck", reason: "node_mismatch"});
		expect(got.calls.some((c) => c.startsWith("build ") || c.startsWith("run "))).toBe(false);
	});

	// Plant: wait for the container for ever, or leave it running after the limit.
	it("at the time limit the container is killed and removed, and the step is stuck", () => {
		const got = run({run: "exec sleep 20\n", seconds: 1});
		expect(got.code, got.text).toBe(30);
		expect(got.summary).toMatchObject({outcome: "stuck", reason: "time_limit"});
		expect(got.ms).toBeLessThan(15_000);
		const name = /--name (fabrika-mutbox-483-\d+)/.exec(
			got.calls.find((c) => c.startsWith("run "))!,
		)![1];
		expect(got.calls).toContain(`kill ${name}`);
		expect(got.calls.at(-1)).toBe(`rm -f ${name}`);
		expect(got.lockLeft).toBe(false);
		expect(got.inputLeft).toBe(false);
	});

	// Plant: read a half-written report after a kill and call it done.
	it("a container killed mid-run is stuck, whatever it left, and is removed", () => {
		const got = run({run: `${DONE}\nexit 137\n`});
		expect(got.code, got.text).toBe(30);
		expect(got.summary).toMatchObject({outcome: "stuck", reason: "killed"});
		expect(got.calls.at(-1)).toMatch(/^rm -f fabrika-mutbox-483-/);
	});

	// Plants: start a second container beside a live one; wait on a lock whose owner is dead.
	it("a second run is stuck while one is live, and a dead run's lock and container are cleared", () => {
		const busy = run({lockPid: process.pid});
		expect(busy.code, busy.text).toBe(30);
		expect(busy.summary).toMatchObject({outcome: "stuck", reason: "docker_busy"});
		expect(busy.ranContainer).toBe(false);
		// The live run's lock is not ours to remove.
		expect(busy.lockLeft).toBe(true);

		const dead = spawnSync(process.execPath, ["-e", ""]).pid!;
		const taken = run({lockPid: dead, leftover: "abc123"});
		expect(taken.code, taken.text).toBe(0);
		expect(taken.calls).toContain("rm -f abc123");
		expect(taken.calls.indexOf("rm -f abc123")).toBeLessThan(
			taken.calls.findIndex((c) => c.startsWith("run ")),
		);
		expect(taken.lockLeft).toBe(false);
	});

	// Plant: hand docker a path whose comma it reads as a mount option.
	it("an output path docker --mount cannot take is stuck before Docker is asked", () => {
		const got = run({outName: "out,ro"});
		expect(got.code, got.text).toBe(30);
		expect(got.summary).toMatchObject({outcome: "stuck", reason: "bad_path"});
		expect(got.calls).toEqual([]);
	});

	// Plants: run a window test and count it; pass an option or an outside path to the test runner.
	it("a related test that needs a window is left out by name, and a bad path stops the run", () => {
		const got = run({related: "src/a.test.ts,src/win.test.ts,src/gone.test.ts"});
		expect(got.code, got.text).toBe(0);
		expect(got.summary.related).toEqual(["src/a.test.ts"]);
		expect(got.summary.excluded).toEqual([
			{path: "src/win.test.ts", reason: expect.stringContaining("no display")},
			{path: "src/gone.test.ts", reason: "the build commit has no such file"},
		]);
		expect(got.calls.find((c) => c.startsWith("run "))).toContain("RELATED=src/a.test.ts ");

		const none = run({related: "src/win.test.ts"});
		expect(none.code, none.text).toBe(30);
		expect(none.summary).toMatchObject({outcome: "stuck", reason: "no_tests"});
		expect(none.ranContainer).toBe(false);

		for (const related of ["--config=/x.test.ts", "../a.test.ts", "src/a.ts", ""]) {
			const bad = run({related});
			expect(bad.code, bad.text).not.toBe(0);
			expect(bad.calls).toEqual([]);
		}
	});

	// Plant: follow a link the container planted, and read a file from outside the output folder.
	it("a link planted in the output is never read through", () => {
		const got = run({
			run: `mkdir -p "$OUT/b"\necho 0 > "$OUT/b/exit"\necho 'PLANTED-SECRET' > "$FAKE/outside.json"\nln -s "$FAKE/outside.json" "$OUT/b/sample.json"\n`,
		});
		expect(got.code, got.text).toBe(30);
		expect(got.summary).toMatchObject({outcome: "stuck", reason: "bad_output"});
		expect(got.text).not.toContain("PLANTED-SECRET");
	});

	// Plants: call an empty sample done; call a failed baseline or an untested sample done.
	it("no range is a skip, and a failed baseline, a dry run or no report is stuck", () => {
		const sample = (ranges: string[]) =>
			JSON.stringify({seed: 119120, ranges, total: 0, selected: ranges.length, left: 0});
		const skip = run({
			run: `mkdir -p "$OUT/b"\necho 1 > "$OUT/b/exit"\necho '${sample([])}' > "$OUT/b/sample.json"\nexit 1\n`,
		});
		expect(skip.code, skip.text).toBe(40);
		expect(skip.summary).toMatchObject({outcome: "skip", reason: "no_ranges"});

		const baseline = JSON.stringify({
			testResults: [
				{name: "/repo/src/a.test.ts", assertionResults: [{fullName: "adds", status: "failed"}]},
			],
		});
		const failed = run({run: `echo '${baseline}' > "$OUT/baseline.json"\nexit 71\n`});
		expect(failed.code, failed.text).toBe(30);
		expect(failed.summary).toMatchObject({outcome: "stuck", reason: "baseline_failed"});
		expect(failed.summary.detail).toContain("src/a.test.ts: adds");

		const report = JSON.stringify({files: {"src/a.ts": {mutants: [mutant("NoCoverage", 1)]}}});
		const dry = run({
			run: `mkdir -p "$OUT/b"\necho 0 > "$OUT/b/exit"\necho '${sample(["src/a.ts:1:0-1:4"])}' > "$OUT/b/sample.json"\necho '${report}' > "$OUT/b/report.json"\n`,
		});
		expect(dry.code, dry.text).toBe(30);
		expect(dry.summary).toMatchObject({outcome: "stuck", reason: "no_tested_mutant"});

		const nothing = run({run: "exit 1\n"});
		expect(nothing.code, nothing.text).toBe(30);
		expect(nothing.summary).toMatchObject({outcome: "stuck", reason: "no_report"});

		const install = run({run: "exit 70\n"});
		expect(install.summary).toMatchObject({outcome: "stuck", reason: "install_failed"});
	});

	// Plant: drop the events fallback, so a capped run reports nothing.
	it("when the five minutes ran out, what Stryker kept in its events is the report", () => {
		const tested = (n: number, status: string) =>
			JSON.stringify({...mutant(status, n), fileName: "/repo/src/a.ts"});
		const got = run({
			run: `mkdir -p "$OUT/b/events"\necho 124 > "$OUT/b/exit"\necho '${JSON.stringify({seed: 119120, ranges: ["src/a.ts:1:0-9:4"], total: 5, selected: 5, left: 0})}' > "$OUT/b/sample.json"\necho '${tested(1, "Killed")}' > "$OUT/b/events/00002-onMutantTested.json"\necho '${tested(2, "Survived")}' > "$OUT/b/events/00003-onMutantTested.json"\necho '{}' > "$OUT/b/events/00000-onDryRunCompleted.json"\nexit 124\n`,
		});
		expect(got.code, got.text).toBe(0);
		expect(got.summary).toMatchObject({
			outcome: "done",
			reason: "capped",
			b: {exit: 124, from: "events", tested: 2, unreached: 3},
		});
		expect(got.summary.b.survivors).toHaveLength(1);
	});
});

describe("mutbox gc against a stand-in docker", () => {
	const gc = (setup: {lockPid?: number; leftover?: string; down?: boolean}) => {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "mutbox-gc-")));
		made.push(dir);
		mkdirSync(join(dir, "bin"));
		writeFileSync(join(dir, "bin/docker"), DOCKER, {mode: 0o755});

		if (setup.lockPid !== undefined) {
			writeFileSync(join(dir, "docker.lock"), String(setup.lockPid));
		}

		if (setup.leftover !== undefined) {
			writeFileSync(join(dir, "leftover"), `${setup.leftover}\n`);
		}

		const ran = spawnSync(process.execPath, [script, "gc", "--lock", join(dir, "docker.lock")], {
			encoding: "utf8",
			timeout: 30_000,
			env: {
				PATH: `${join(dir, "bin")}:/usr/bin:/bin`,
				HOME: dir,
				FAKE: dir,
				...(setup.down ? {DOWN: "1"} : {}),
			},
		});
		const log = join(dir, "calls.log");
		return {
			code: ran.status,
			text: ran.stdout + ran.stderr,
			calls: existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [],
		};
	};

	// Plants: remove a live run's container; prune images without our label.
	it("gc removes leftover containers and week-old images, and never touches a live run", () => {
		const swept = gc({leftover: "abc123", lockPid: spawnSync(process.execPath, ["-e", ""]).pid!});
		expect(swept.code, swept.text).toBe(0);
		expect(swept.calls).toContain("rm -f abc123");
		expect(swept.calls).toContain(
			`image prune --all --force --filter label=${LABEL} --filter until=168h`,
		);
		expect(swept.text).toContain("removed 1 containers and 1 images");

		const live = gc({leftover: "abc123", lockPid: process.pid});
		expect(live.code, live.text).toBe(0);
		expect(live.text).toContain("keep mutbox");
		expect(live.calls.some((c) => c.startsWith("rm ") || c.startsWith("image prune"))).toBe(false);

		const down = gc({down: true});
		expect(down.code, down.text).toBe(0);
		expect(down.text).toContain("Docker is not running");
	});
});

// scenario: the real fence, once, on a laptop with a free Docker box (MUTBOX_DOCKER=1). It is
// skipped in CI, whose Docker is linux/amd64, and by default, since it holds the one Docker box.
// Only a real container shows that a listener works on its own loopback and that nothing outside
// is reachable. Plant: change `--network none` to `--network bridge`, and the fetch succeeds.
describe.skipIf(process.env.MUTBOX_DOCKER !== "1")("mutbox, a real container", () => {
	it("scenario: inside the fence a port listens on loopback and nothing outside is reachable", () => {
		const probe = `
const net = require("node:net");
const server = net.createServer((s) => s.end("hello")).listen(() => {
  net.connect(server.address().port, "localhost", function () {
    this.on("data", (d) => {
      console.log("loopback:" + d);
      server.close();
      fetch("https://registry.npmjs.org/").then(() => console.log("outside:reached"), () => console.log("outside:refused"));
    });
  });
});`;
		const args = runArgs({
			name: `fabrika-mutbox-probe-${process.pid}`,
			image: "",
			input: tmpdir(),
			output: tmpdir(),
			ticket: "0",
			build: "0",
			related: [],
			lock: "probe",
		});
		const from = /^FROM (\S+)$/m.exec(dockerfile)?.[1] ?? "";
		// The same fence, on the pinned base image alone, with the probe in place of the entry.
		const fenced = [...args.slice(0, args.indexOf("")), from, "node", "-e", probe].filter(
			(a, i, all) => !(a === "--mount" || all[i - 1] === "--mount"),
		);
		const ran = spawnSync("docker", fenced, {encoding: "utf8", timeout: 120_000});
		expect(ran.stdout, ran.stderr).toContain("loopback:hello");
		expect(ran.stdout, ran.stderr).toContain("outside:refused");
		const left = spawnSync(
			"docker",
			["ps", "-aq", "--filter", `name=fabrika-mutbox-probe-${process.pid}`],
			{encoding: "utf8"},
		);
		expect(left.stdout.trim()).toBe("");
	});
});
