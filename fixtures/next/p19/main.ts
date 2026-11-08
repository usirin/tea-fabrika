// P19's Electron fixture entry (plan "Tests before implementation"): the same libfabrika entry the
// app's `electron-main.ts` runs, `desktopApp`, composed with test Layers. The e2e support bundles
// it beside the app's build and starts it with Playwright. Switches come from the environment the
// support sets; the product has no such switch.
//
//   P19_SEAL   stand-in | real       the stand-in seal, or Electron's safeStorage (one law only)
//   P19_BRAIN  stand-in | launchd    launchctl's stand-in running p19-brain.js as a child, or
//                                    real launchd running the build's P12 brain.js
//   P19_LABEL                        the test label, `dev.fabrika.test.p19.<hex>`
//   P19_BUILT                        the folder this bundle and the app's build sit in
//   P19_CORRUPT                      one top-level option key to hand in broken, to see a refusal
//   P19_SEAL_AVAILABLE               0 makes the stand-in seal report it cannot seal
//
// The stand-ins answer for outside effects only (launchctl, P12's readiness, P37's journal). Every
// decision stays in libfabrika.
import {spawn} from "node:child_process";
import {connect} from "node:net";
import {join} from "node:path";
import {NodeServices} from "@effect/platform-node";
import {IdGenerator} from "@kampus/libfabrika";
import {
	BrainProbe,
	DesktopDown,
	DesktopRecording,
	LaunchControl,
	Seal,
	ServiceState,
} from "@kampus/libfabrika/desktop";
import {desktopApp, electronPlatform, electronSeal} from "@kampus/libfabrika/electron";
import {fileDesktopStore} from "@kampus/libfabrika/node/desktop-store";
import {launchControl} from "@kampus/libfabrika/node/launchd";
import {Effect, Layer, Ref} from "effect";
import {testSeal} from "../../../next/packages/libfabrika/src/electron/keys.test-support.ts";

const env = (name: string): string => {
	const value = process.env[name];
	if (value === undefined || value === "") throw new Error(`p19 fixture: ${name} is required`);
	return value;
};
const home = env("FABRIKA_HOME");
const label = env("P19_LABEL");
const built = env("P19_BUILT");
const brainMode = env("P19_BRAIN");
const sealMode = env("P19_SEAL");

// One fixed loopback port per test label, so a reopen dials the same origin (experiment 215).
const port = 40_000 + ([...label].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7) % 20_000);

const raw: Record<string, unknown> = {
	home,
	pages: {
		founding: join(built, "founding.html"),
		foundingPreload: join(built, "preload-founding.js"),
		windowPreload: join(built, "preload-window.js"),
	},
	localBrain: {
		label,
		executable: process.execPath,
		entry: join(built, brainMode === "launchd" ? "brain.js" : "p19-brain.js"),
		port,
		throttle: 1,
	},
	window: {layout: "single", views: []},
};
const corrupt = process.env["P19_CORRUPT"];
if (corrupt !== undefined && corrupt !== "") raw[corrupt] = {broken: true};

const seal =
	sealMode === "real"
		? electronSeal
		: Layer.effect(
				Seal,
				testSeal(DesktopDown, {available: process.env["P19_SEAL_AVAILABLE"] !== "0"}).pipe(Effect.map((s) => s.impl)),
			);

// launchctl's stand-in: the plist's program runs as a child process group of this app instead.
const childLaunch = Layer.effect(
	LaunchControl,
	Effect.gen(function* () {
		const job = yield* Ref.make<{pid: number; executable: string; args: Array<string>} | null>(null);
		const running = (pid: number) => {
			try {
				process.kill(pid, 0);
				return true;
			} catch {
				return false;
			}
		};
		return {
			print: () =>
				Ref.get(job).pipe(
					Effect.map((j) =>
						j !== null && running(j.pid)
							? ServiceState.cases.loaded.make({pid: j.pid, executable: j.executable, args: j.args})
							: ServiceState.cases.absent.make({}),
					),
				),
			bootstrap: (spec) =>
				Effect.sync(() => {
					const child = spawn(spec.executable, [spec.entry, "--port", String(spec.port)], {
						env: {ELECTRON_RUN_AS_NODE: "1", FABRIKA_HOME: spec.home, PATH: process.env["PATH"] ?? ""},
						detached: true,
						stdio: "ignore",
					});
					child.unref();
					return {pid: child.pid ?? 0, executable: spec.executable, args: [spec.executable, spec.entry]};
				}).pipe(Effect.flatMap((j) => Ref.set(job, j))),
			bootout: () =>
				Ref.get(job).pipe(
					Effect.flatMap((j) =>
						Effect.sync(() => {
							if (j !== null && running(j.pid)) process.kill(-j.pid, "SIGTERM");
						}),
					),
				),
		};
	}),
);

// P12's readiness stand-in: the fixed address answers, or it refuses connections.
const answers = (p: number) =>
	Effect.callback<boolean>((resume) => {
		const socket = connect({host: "127.0.0.1", port: p});
		socket.once("connect", () => (socket.destroy(), resume(Effect.succeed(true))));
		socket.once("error", () => resume(Effect.succeed(false)));
	});
const probe = Layer.succeed(BrainProbe, {
	ready: (spec) => answers(spec.port),
	stopped: (spec) => answers(spec.port).pipe(Effect.map((up) => !up)),
});
const records = Layer.succeed(DesktopRecording, {put: () => Effect.void, flush: Effect.void});

const services = Layer.mergeAll(
	fileDesktopStore({home}).pipe(Layer.provide(Layer.mergeAll(seal, IdGenerator.layer, NodeServices.layer))),
	brainMode === "launchd" ? launchControl.pipe(Layer.provide(NodeServices.layer)) : childLaunch,
	probe,
	records,
	seal,
);

Effect.runFork(
	Effect.scoped(desktopApp(raw as never)).pipe(Effect.provide(services), Effect.provide(electronPlatform)),
);
