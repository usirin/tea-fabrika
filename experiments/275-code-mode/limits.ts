// Experiment 275, lab code. Provokes each script limit once per script door (B's execute, C's
// query) on a fresh local instance: a script over the call cap, a script that waits too long, and
// a script that spins. No model is called. Rows go to runs/exp-275/limits-<time>/.
// Usage: node limits.ts
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Door, grant, loadKey } from "./door.ts";

const REPO = resolve(import.meta.dirname, "../..");
const home = join(REPO, "runs/exp-275", `limits-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(home, { recursive: true });

const PORT = 18911,
  SCRIPTS = 18912;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "exp-275", "-f", join(home, "founder")]);

let brain: ChildProcess | undefined;

const startBrain = async () => {
  brain = spawn(
    "nice",
    [
      "-n",
      "19",
      process.execPath,
      "brain.ts",
      String(PORT),
      String(SCRIPTS),
      readFileSync(join(home, "founder.pub"), "utf8").trim(),
    ],
    {
      cwd: import.meta.dirname,
      env: { ...process.env, FABRIKA_HOME: home },
      detached: true,
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  let text = "";
  brain.stdout.on("data", (b) => (text += b));

  for (let n = 0; n < 900 && !text.includes('"ready"'); n++) {
    await sleep(100);
  }
};

const stopBrain = async () => {
  if (brain?.pid !== undefined) {
    process.kill(-brain.pid, "SIGKILL");
  }

  await sleep(1000);
};

const workerdCpu = () =>
  execFileSync("ps", ["-ax", "-o", "%cpu=,command="], { encoding: "utf8" })
    .split("\n")
    .filter((l) => l.includes("workerd-darwin"))
    .map((l) => Number(l.trim().split(/\s+/)[0]));

const bridge = (shape: string) => {
  const child = spawn(process.execPath, [join(import.meta.dirname, "bridge.ts")], {
    env: {
      ...process.env,
      EXP_DOOR: shape,
      EXP_HOME: home,
      EXP_LOG: join(home, "log.jsonl"),
      EXP_SCRIPTS: join(home, "scripts.jsonl"),
      EXP_URL: `http://127.0.0.1:${PORT}`,
      EXP_SCRIPTS_URL: `http://127.0.0.1:${SCRIPTS}/`,
      EXP_SCRIPT_MS: "3000",
      EXP_SCRIPT_CALLS: "20",
    },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const waiting = new Map<number, (r: any) => void>();
  createInterface({ input: child.stdout }).on("line", (l) => {
    const m = JSON.parse(l);
    waiting.get(m.id)?.(m);
  });
  let id = 0;
  const ask = (method: string, params: object) =>
    new Promise<any>((done) => {
      const n = ++id;
      waiting.set(n, done);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: n, method, params })}\n`);
    });
  return { ask, close: () => child.kill() };
};

const cases = [
  { name: "call_cap", code: "for (;;) { await fabrika.notes.list({}); }" },
  { name: "slow", code: "await new Promise((r) => setTimeout(r, 10000)); return await fabrika.notes.list({});" },
  { name: "spin", code: "await fabrika.notes.list({}); for (;;) {}" },
];

const out: Array<object> = [];
let granted = false;

for (const [shape, tool] of [
  ["B", "execute"],
  ["C", "query"],
] as const) {
  for (const c of cases) {
    await startBrain();

    if (!granted) {
      const door = await Door.make(`http://127.0.0.1:${PORT}`, await loadKey(join(home, "client.json")), "agent-1");
      await grant(door, join(home, "founder"), REPO);
      door.close();
      granted = true;
    }

    const b = bridge(shape);
    await b.ask("initialize", {});
    const at = Date.now();
    const answer = await b.ask("tools/call", { name: tool, arguments: { code: c.code } });
    const ms = Date.now() - at;
    await sleep(2000);
    const cpu = workerdCpu();
    // Does a fresh script still run after this one?
    const next = await Promise.race([
      b.ask("tools/call", { name: tool, arguments: { code: "return 1" } }).then((r) => r.result.content[0].text),
      sleep(5000).then(() => "no answer in 5 s"),
    ]);
    const brainUp = await fetch(`http://127.0.0.1:${PORT}/`).then(
      (r) => r.status,
      () => 0,
    );
    const row = {
      door: shape,
      tool,
      case: c.name,
      answer: answer.result.content[0].text,
      ms,
      workerdCpu: cpu,
      next,
      brainUp,
    };
    out.push(row);
    appendFileSync(join(home, "limits.jsonl"), `${JSON.stringify(row)}\n`);
    console.log(JSON.stringify(row));
    b.close();
    await stopBrain();
  }
}

process.exit(0);
