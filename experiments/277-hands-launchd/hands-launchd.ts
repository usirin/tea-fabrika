// Experiment 277: does a hands resource that installs a launchd entry keep the hands alive?
//
// One made-up resource in one tiny stack, with Alchemy's local state in a temp folder:
// - `HandsService` (made up for this sketch) writes a LaunchAgent plist and bootstraps it into the
//   person's gui domain. launchd, not Alchemy, keeps the heartbeat process alive.
//
// Run from the repo root, one step per call, against the same home:
//   HANDS_HOME=<temp folder> node experiments/277-hands-launchd/hands-launchd.ts print|up|measure|down
// `print` writes only inside HANDS_HOME and changes nothing else: it prints the plist and the
// launchctl commands `up` and `down` would run. `up`, `measure` and `down` change this Mac.
// Env: HANDS_EVERY changes a prop (the heartbeat interval in ms), HANDS_GAP_MS is how long
// `measure` lets each new process run before it kills it (0 by default).
// No account, no network, no key. Nothing here touches a real ledger.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import * as Alchemy from "alchemy";
import { AlchemyContext } from "alchemy/AlchemyContext";
import { ArtifactStore, createArtifactStore } from "alchemy/Artifacts";
import { AuthProvidersLive } from "alchemy/Auth/Registry";
import { applyAndRender } from "alchemy/Deploy";
import { destroy } from "alchemy/Destroy";
import { evalStack } from "alchemy/EvalStack";
import * as Interaction from "alchemy/Interaction";
import * as Plan from "alchemy/Plan";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import { Clock, Console, Effect, FileSystem, Layer, Option, Path, Schema, Stream } from "effect";
import { Digest, SecureRandom } from "effect/crypto";
import { FetchHttpClient } from "effect/http";
import { ChildProcess } from "effect/process";

const home = process.env.HANDS_HOME;
const personHome = process.env.HOME;

if (!home || !personHome) {
  throw new Error("set HANDS_HOME to a temp folder (and HOME must be set)");
}

process.env.DO_NOT_TRACK = "1";
process.env.ALCHEMY_HOME = `${home}/alchemy-home`;

const label = "dev.fabrika.exp277.hands";

// ---- launchctl and kill, through Effect's ChildProcess ----
class LaunchctlError extends Schema.TaggedError<LaunchctlError>()("LaunchctlError", {
  args: Schema.Array(Schema.String),
  exitCode: Schema.Number,
  output: Schema.String,
}) {}

// Runs one command and keeps its exit code and its stdout and stderr together.
const run = Effect.fnUntraced(function* (command: string, args: ReadonlyArray<string>) {
  const child = yield* ChildProcess.make(command, args, { stdin: "ignore" });
  const [output, exitCode] = yield* Effect.all([child.all.pipe(Stream.decodeText(), Stream.mkString), child.exitCode], {
    concurrency: 2,
  });
  return { output, exitCode: Number(exitCode) };
}, Effect.scoped);

const launchctl = Effect.fnUntraced(function* (...args: ReadonlyArray<string>) {
  const result = yield* run("launchctl", args);
  yield* Effect.log(`launchctl ${args.join(" ")} -> ${result.exitCode}`);
  return result;
});

const mustLaunchctl = Effect.fnUntraced(function* (...args: ReadonlyArray<string>) {
  const result = yield* launchctl(...args);

  if (result.exitCode !== 0) {
    return yield* new LaunchctlError({ args, exitCode: result.exitCode, output: result.output });
  }

  return result;
});

// `launchctl print` output "is NOT API" (man launchctl), so this reads only three lines and
// trusts only the exit code for loaded or not.
type Status = {
  readonly loaded: boolean;
  readonly pid?: number | undefined;
  readonly state?: string | undefined;
  readonly runs?: number | undefined;
};

const field = (output: string, name: string) => output.match(new RegExp(`^\\s*${name} = (.+)$`, "m"))?.[1]?.trim();

const status = Effect.fnUntraced(function* (target: string) {
  const { output, exitCode } = yield* launchctl("print", target);

  if (exitCode !== 0) {
    return { loaded: false } satisfies Status;
  }

  const pid = field(output, "pid");
  const runs = field(output, "runs");
  return {
    loaded: true,
    pid: pid === undefined ? undefined : Number(pid),
    state: field(output, "state"),
    runs: runs === undefined ? undefined : Number(runs),
  } satisfies Status;
});

// bootout can return before launchd has let the label go; a bootstrap right after can then fail.
// So wait, up to 5 s, until `launchctl print` no longer finds it.
const waitGone = Effect.fnUntraced(function* (target: string) {
  for (let i = 0; i < 50; i++) {
    if (!(yield* status(target)).loaded) {
      return;
    }

    yield* Effect.sleep("100 millis");
  }

  return yield* new LaunchctlError({ args: ["print", target], exitCode: 0, output: "still loaded 5 s after bootout" });
});

const uid = run("id", ["-u"]).pipe(Effect.map(({ output }) => output.trim()));

// ---- What the service runs ----
type ServiceProps = { readonly label: string; readonly home: string; readonly node: string; readonly every: number };
type ServiceAttrs = { readonly plist: string; readonly target: string };

// The child: a tiny node script that writes its pid and the time to a file every `every` ms, by
// write-then-rename so a reader never sees half a file. It stands in for hands that would dial
// the brain and call jobs.take.
const heartbeatScript = `const fs = require("fs");
const file = process.argv[2];
const every = Number(process.argv[3]);
const beat = () => {
  fs.writeFileSync(file + ".tmp", JSON.stringify({ pid: process.pid, at: Date.now() }));
  fs.renameSync(file + ".tmp", file);
};
console.log("start pid " + process.pid + " at " + new Date().toISOString());
beat();
setInterval(beat, every);
`;

const filesFor = (path: Path.Path, props: ServiceProps) => ({
  plist: path.join(personHome, "Library", "LaunchAgents", `${props.label}.plist`),
  script: path.join(props.home, "heartbeat.cjs"),
  beat: path.join(props.home, "heartbeat.json"),
  stdout: path.join(props.home, "stdout.log"),
  stderr: path.join(props.home, "stderr.log"),
});

const xml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// ThrottleInterval is left out on purpose: we measure launchd's default (10 s, man launchd.plist).
const plistText = (props: ServiceProps, files: ReturnType<typeof filesFor>) => {
  const args = [props.node, files.script, files.beat, String(props.every)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(props.label)}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((arg) => `    <string>${xml(arg)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(props.home)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>Nice</key>
  <integer>15</integer>
  <key>StandardOutPath</key>
  <string>${xml(files.stdout)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(files.stderr)}</string>
</dict>
</plist>
`;
};

// ---- HandsService (made up for this sketch) ----
type HandsService = Alchemy.Resource<"Fabrika.HandsService", ServiceProps, ServiceAttrs>;
const HandsService = Resource<HandsService>("Fabrika.HandsService");

const HandsServiceProvider = Provider.effect(
  HandsService,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const domain = `gui/${yield* Effect.orDie(uid)}`;
    const readIfThere = (file: string) => fs.readFileString(file).pipe(Effect.option);

    const unload = Effect.fnUntraced(function* (attrs: ServiceAttrs) {
      if ((yield* status(attrs.target)).loaded) {
        yield* mustLaunchctl("bootout", attrs.target);
        yield* waitGone(attrs.target);
      }

      yield* fs.remove(attrs.plist, { force: true });
    });

    return {
      // Asks launchd by name. The pid is logged, never stored: a stored pid goes stale (264).
      read: Effect.fn(function* ({ fqn, olds, output }) {
        const target = output?.target ?? `${domain}/${olds.label}`;
        const now = yield* status(target);
        yield* Effect.log(`service.read ${fqn}: ${now.loaded ? `loaded, pid ${now.pid ?? "none"}` : "not loaded"}`);
        return now.loaded ? { plist: filesFor(path, olds).plist, target } : undefined;
      }),
      diff: ({ olds, news }) =>
        Effect.succeed(
          Alchemy.isResolved(news) &&
            (olds.label !== news.label ||
              olds.home !== news.home ||
              olds.node !== news.node ||
              olds.every !== news.every)
            ? { action: "update" as const }
            : undefined,
        ),
      reconcile: Effect.fn(function* ({ fqn, news, output }) {
        const files = filesFor(path, news);
        const attrs = { plist: files.plist, target: `${domain}/${news.label}` };

        // A new label is a new launchd job, so the old one goes first.
        if (output && output.target !== attrs.target) {
          yield* Effect.log(`service.reconcile ${fqn}: label changed, unloading ${output.target}`);
          yield* unload(output);
        }

        const want = plistText(news, files);
        const same =
          Option.getOrUndefined(yield* readIfThere(files.plist)) === want &&
          Option.getOrUndefined(yield* readIfThere(files.script)) === heartbeatScript;
        const loaded = (yield* status(attrs.target)).loaded;

        if (loaded && same) {
          yield* Effect.log(`service.reconcile ${fqn}: loaded with the same plist, nothing to do`);
          return attrs;
        }

        if (loaded) {
          yield* Effect.log(`service.reconcile ${fqn}: plist changed, bootout then bootstrap`);
          yield* mustLaunchctl("bootout", attrs.target);
          yield* waitGone(attrs.target);
        }

        yield* fs.makeDirectory(news.home, { recursive: true });
        yield* fs.makeDirectory(path.dirname(files.plist), { recursive: true });
        yield* fs.writeFileString(files.script, heartbeatScript);
        yield* fs.writeFileString(files.plist, want);
        yield* mustLaunchctl("bootstrap", domain, files.plist);
        yield* Effect.log(`service.reconcile ${fqn}: bootstrapped ${attrs.target}`);
        return attrs;
      }),
      delete: Effect.fn(function* ({ fqn, output }) {
        yield* unload(output);
        yield* Effect.log(`service.delete ${fqn}: ${output.target} booted out, plist removed`);
      }),
    };
  }),
);

// ---- The stack ----
// The node binary is the real one this script runs on, not a version manager's shim on PATH:
// launchd's PATH is short, and a shim would put a second process between launchd and the beat.
const props: ServiceProps = {
  label,
  home: `${home}/hands`,
  node: process.execPath,
  every: Number(process.env.HANDS_EVERY ?? "500"),
};

const stack = Alchemy.Stack(
  "hands-launchd-exp",
  { providers: HandsServiceProvider, state: Alchemy.localState() },
  Effect.gen(function* () {
    const hands = yield* HandsService("LaptopHands", props);
    return { target: hands.target, plist: hands.plist };
  }),
);

const engine = Layer.mergeAll(
  Layer.succeed(AlchemyContext, { dotAlchemy: `${home}/.alchemy`, dev: false, adopt: false }),
  Layer.succeed(ArtifactStore, createArtifactStore()),
  Interaction.layerNonInteractive(),
  AuthProvidersLive,
).pipe(
  Layer.provideMerge(
    Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer, SecureRandom.layerWebCrypto, Digest.layerWebCrypto),
  ),
);

const stage = "local";

// A deploy that also says what its plan was, so "no change" is read from the plan, not guessed.
const deployAndReport = evalStack(
  stack,
  (compiled) =>
    Effect.gen(function* () {
      const plan = yield* Plan.make(compiled);
      const rows = Plan.describePlan(plan).resources.map((row) => ({ id: row.logicalId, action: row.action }));
      const noChange = rows.every((row) => row.action === "noop");
      yield* Effect.log(`plan: ${JSON.stringify(rows)}${noChange ? " (no change)" : ""}`);
      const output = yield* applyAndRender(plan);
      return { rows, noChange, output };
    }),
  { stage },
);

// ---- Heartbeats ----
const Beat = Schema.Struct({ pid: Schema.Number, at: Schema.Number });
const decodeBeat = Schema.decodeUnknownOption(Schema.fromJsonString(Beat));

const readBeat = Effect.fnUntraced(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(file).pipe(Effect.option);
  return Option.flatMap(text, decodeBeat);
});

// Waits for a beat from any pid but `notPid`, checking every 50 ms, for at most 30 s.
const waitBeat = Effect.fnUntraced(function* (file: string, notPid: number | undefined) {
  for (;;) {
    const beat = yield* readBeat(file);

    if (Option.isSome(beat) && beat.value.pid !== notPid) {
      return { pid: beat.value.pid, seenAt: yield* Clock.currentTimeMillis };
    }

    yield* Effect.sleep("50 millis");
  }
}, Effect.timeoutOption("30 seconds"));

const kill9 = (pid: number) => run("kill", ["-KILL", String(pid)]);

// ---- The four steps ----
const where = Effect.gen(function* () {
  const path = yield* Path.Path;
  const domain = `gui/${yield* uid}`;
  return { path, domain, target: `${domain}/${label}`, files: filesFor(path, props) };
});

// Writes the plist and the script under HANDS_HOME/print only, for a person and `plutil -lint`.
const printStep = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const { path, domain, target, files } = yield* where;
  const text = plistText(props, files);
  const out = path.join(home, "print");
  yield* fs.makeDirectory(out, { recursive: true });
  yield* fs.writeFileString(path.join(out, `${label}.plist`), text);
  yield* fs.writeFileString(path.join(out, "heartbeat.cjs"), heartbeatScript);
  yield* Console.log(`# The plist \`up\` writes to ${files.plist}\n\n${text}`);
  yield* Console.log(`# The script \`up\` writes to ${files.script}\n\n${heartbeatScript}`);
  yield* Console.log(
    [
      "# What `up` runs",
      `launchctl print ${target}            # loaded? (exit code only)`,
      `launchctl bootout ${target}          # only if loaded and the plist or script changed`,
      `launchctl bootstrap ${domain} ${files.plist}   # if not loaded, or after that bootout`,
      "",
      "# What `measure` runs, 5 times",
      `launchctl print ${target}            # launchd's pid, to compare with the heartbeat's`,
      "kill -KILL <heartbeat pid>",
      "# then one more deploy, which should plan no change",
      "",
      "# What `down` runs",
      `launchctl print ${target}            # loaded?`,
      `launchctl bootout ${target}          # only if loaded`,
      `rm -f ${files.plist}`,
      `launchctl print ${target}            # must now fail`,
      "",
      `# Wrote ${out}/${label}.plist and ${out}/heartbeat.cjs, nothing else.`,
    ].join("\n"),
  );
});

const upStep = Effect.gen(function* () {
  const { target, files } = yield* where;
  const { noChange } = yield* deployAndReport;
  const beat = yield* waitBeat(files.beat, undefined);
  const now = yield* status(target);
  yield* Effect.log(
    `up: ${noChange ? "no change" : "changed"}; heartbeat pid ${Option.match(beat, {
      onNone: () => "none within 30 s",
      onSome: (b) => String(b.pid),
    })}; launchd pid ${now.pid ?? "none"}`,
  );
});

const measureStep = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const { target, files } = yield* where;
  const gap = Number(process.env.HANDS_GAP_MS ?? "0");
  const first = yield* waitBeat(files.beat, undefined);

  if (Option.isNone(first)) {
    return yield* Effect.die(new Error("no heartbeat within 30 s; run `up` first"));
  }

  let pid = first.value.pid;
  const kills: Array<{
    readonly kill: number;
    readonly killed: number;
    readonly launchdPid: number | undefined;
    readonly next: number | undefined;
    readonly ms: number | undefined;
    readonly runs: number | undefined;
  }> = [];

  for (let kill = 1; kill <= 5; kill++) {
    yield* Effect.sleep(gap);
    const before = yield* status(target);
    const killedAt = yield* Clock.currentTimeMillis;
    yield* kill9(pid);
    const next = yield* waitBeat(files.beat, pid);
    const after = yield* status(target);
    const row = {
      kill,
      killed: pid,
      launchdPid: before.pid,
      next: Option.getOrUndefined(Option.map(next, (b) => b.pid)),
      ms: Option.getOrUndefined(Option.map(next, (b) => b.seenAt - killedAt)),
      runs: after.runs,
    };
    kills.push(row);
    yield* Effect.log(`measure: ${JSON.stringify(row)}`);

    if (Option.isNone(next)) {
      break;
    }

    pid = next.value.pid;
  }

  const second = yield* deployAndReport;
  const result = { gapMs: gap, kills, secondDeploy: { noChange: second.noChange, rows: second.rows } };
  yield* fs.writeFileString(`${home}/measure-gap-${gap}.json`, `${JSON.stringify(result, null, 2)}\n`);
  yield* Effect.log(`measure: ${JSON.stringify(result)}`);
});

const downStep = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const { target, files } = yield* where;
  yield* destroy({ stack, stage });
  const plistThere = yield* fs.exists(files.plist);
  const now = yield* status(target);
  yield* Effect.log(
    `down: plist ${plistThere ? "STILL THERE" : "gone"}; launchctl print ${now.loaded ? "STILL FINDS IT" : "fails"}`,
  );
});

const name = process.argv[2];

const withEngine = Effect.provide(
  Layer.mergeAll(stack.providers, Alchemy.localState()).pipe(Layer.provideMerge(engine)),
);

const program =
  name === "print"
    ? printStep.pipe(Effect.provide(NodeServices.layer))
    : name === "up"
      ? upStep.pipe(withEngine)
      : name === "measure"
        ? measureStep.pipe(withEngine)
        : name === "down"
          ? downStep.pipe(withEngine)
          : Effect.die(new Error(`unknown step ${name}; use print, up, measure or down`));

NodeRuntime.runMain(program as Effect.Effect<unknown>);
