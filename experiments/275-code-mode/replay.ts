// Experiment 275, lab code. The repeat, measured without a model: a save lands, the brain is
// killed with SIGKILL before anyone reads the answer, the brain starts again, and the same save is
// sent again two ways: byte for byte (same letter id), and as a fresh letter on the old base.
// Neither may write. Rows go to runs/exp-275/replay-<time>/.
// Usage: node replay.ts
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Door, grant, loadKey } from "./door.ts";

const REPO = resolve(import.meta.dirname, "../..");
const home = join(REPO, "runs/exp-275", `replay-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(home, { recursive: true });
const PORT = 18911;
const url = `http://127.0.0.1:${PORT}`;
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
      "18912",
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
    await sleep(50);
  }
};

const key = await loadKey(join(home, "client.json"));

const open = async () => {
  const door = await Door.make(url, key, "agent-1");
  await door.connect();
  const procs = await door.call("ledger.read", { stream: "processes/counter:1", after: 0 });
  return { door, pid: procs.result.entries.find((r: any) => r._tag === "started").body.process };
};

const inbox = async (door: Door) =>
  (await door.call("ledger.read", { stream: "counter:1/inbox", after: 0 })).result.entries.length;

await startBrain();
const first = await Door.make(url, key, "agent-1");
await grant(first, join(home, "founder"), REPO);
first.close();
let { door, pid } = await open();

const send = (letter: string, m: object, sentAt: string) =>
  door.call("process.send", { pid, letter, m, sentAt, seen: 0 });

await send("seed", { type: "save", note: "n1", base: 0, body: "the widget" }, new Date().toISOString());
const save = { type: "save", note: "n1", base: 1, body: "the gizmo" };
const sentAt = new Date().toISOString();
const landed = await send("save-1", save, sentAt);
const before = await inbox(door);
const at = Date.now();

if (brain?.pid !== undefined) {
  process.kill(-brain.pid, "SIGKILL");
}

await sleep(500);
await startBrain();
({ door, pid } = await open());
const back = Date.now() - at;
const same = await send("save-1", save, sentAt);
const fresh = await send("save-2", save, new Date().toISOString());
const after = await inbox(door);
const view = (await door.call("view.open", { pid })).result.view;

const row = {
  landed: landed.result,
  backMs: back,
  sameLetter: same.result,
  freshLetterOldBase: fresh.result,
  inboxBefore: before,
  inboxAfter: after,
  view,
};

appendFileSync(join(home, "replay.jsonl"), `${JSON.stringify(row)}\n`);
console.log(JSON.stringify(row));
door.close();

if (brain?.pid !== undefined) {
  process.kill(-brain.pid, "SIGKILL");
}

process.exit(0);
