// Experiment 289, part 2: a desk key over one WebSocket to one Durable Object in local workerd.
// usage: node experiments/289-desk-move-first/desk-latency.mjs <package folder whose node_modules has miniflare> [rtt ms] [seconds]
// e.g. packages/fabrika 20 60. Loopback only, no key. Prints JSON with the numbers.
import { createRequire } from "node:module";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const req = createRequire(join(process.argv[2], "package.json"));
const RTT = Number(process.argv[3] ?? 0); // simulated network round trip, ms, half each way
const SECONDS = Number(process.argv[4] ?? 60);
const later = (f) => (RTT > 0 ? setTimeout(f, RTT / 2) : f());
const { Miniflare } = req("miniflare");

// The Worker: one route upgrades to a WebSocket on the desk's Durable Object. The DO keeps the desk
// state { focus, rev, tiles } and answers each key with the new state. JSON-RPC 2.0 over text frames.
const script = `
export class Desk {
  constructor(state) { this.state = state; this.desk = { focus: "t1", rev: 0, tiles: ["t1","t2","t3","t4"] }; }
  async fetch(request) {
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  webSocketMessage(ws, text) {
    if (text === "ping") { ws.send("pong"); return; }
    const msg = JSON.parse(text);
    const key = msg.params;
    const check = msg.method === "desk.key.checked";
    if (check && key.base !== this.desk.rev) {
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: 409, message: "stale", data: this.desk } }));
      return;
    }
    if (key._tag === "focus" && this.desk.tiles.includes(key.tile)) {
      this.desk = { ...this.desk, focus: key.tile, rev: this.desk.rev + 1 };
    }
    ws.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: this.desk }));
    for (const other of this.state.getWebSockets()) {
      if (other !== ws) other.send(JSON.stringify({ jsonrpc: "2.0", method: "desk.state", params: { ...this.desk, by: key.by } }));
    }
  }
}
export default {
  fetch(request, env) {
    return env.DESK.get(env.DESK.idFromName("desk")).fetch(request);
  },
};
`;

const mf = new Miniflare({
  modules: true,
  script,
  compatibilityDate: "2026-07-30",
  durableObjects: { DESK: "Desk" },
  host: "127.0.0.1",
  port: 0,
});
const url = await mf.ready;
const wsUrl = url.href.replace(/^http/, "ws");

const open = () =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = reject;
  });

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const round = (x) => Math.round(x * 1000) / 1000;

// --- 1,000 keys, one client, one at a time --------------------------------------------------------
const one = await open();
let pending = null;
one.onmessage = (e) => {
  if (e.data === "pong") return;
  const m = JSON.parse(e.data);
  if (m.id !== undefined && pending?.id === m.id) pending.done(m);
};
const call = (ws, method, params, id) =>
  new Promise((done) => {
    pending = { id, done };
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  });
const tiles = ["t1", "t2", "t3", "t4"];
for (let i = 0; i < 50; i++) await call(one, "desk.key", { _tag: "focus", tile: tiles[i % 4], by: "a" }, `w${i}`);
const rtt = [];
for (let i = 0; i < 1000; i++) {
  const t0 = performance.now();
  await call(one, "desk.key", { _tag: "focus", tile: tiles[i % 4], by: "a" }, `k${i}`);
  rtt.push(performance.now() - t0);
}
one.close();
const latency = { keys: rtt.length, warmup: 50, p50: round(pct(rtt, 50)), p95: round(pct(rtt, 95)), p99: round(pct(rtt, 99)), max: round(Math.max(...rtt)) };

// --- two clients at a typing rate ----------------------------------------------------------------
// Each client is a move-first window: it applies its key at once, then the brain's answer confirms
// it. Counted per key:
//   overwritten: before this key's answer came, a desk.state from the other client arrived (the
//                window had shown its own focus, then must show the other's: a visible snap).
//   refused:     in the checked run the brain refuses a key whose base rev is stale (409).
const typing = async (checked, seconds, rate) => {
  const clients = [await open(), await open()];
  const stats = clients.map(() => ({ sent: 0, overwritten: 0, refused: 0, otherStates: 0 }));
  const views = clients.map(() => ({ rev: 0, inflight: new Map() }));
  clients.forEach((ws, c) => {
    ws.onmessage = (e) => later(() => {
      const m = JSON.parse(e.data);
      const v = views[c];
      if (m.method === "desk.state") {
        stats[c].otherStates++;
        if (v.inflight.size > 0) {
          for (const id of v.inflight.keys()) v.inflight.set(id, true);
        }
        v.rev = m.params.rev;
        return;
      }
      const hit = v.inflight.get(m.id);
      v.inflight.delete(m.id);
      if (m.error !== undefined) {
        stats[c].refused++;
        v.rev = m.error.data.rev;
      } else {
        if (hit === true) stats[c].overwritten++;
        v.rev = m.result.rev;
      }
    });
  });
  const end = performance.now() + seconds * 1000;
  const gap = 1000 / rate;
  await Promise.all(
    clients.map(async (ws, c) => {
      let n = 0;
      // a person's keys are not a metronome: jitter each gap by +-50%
      while (performance.now() < end) {
        const id = `${c}-${n++}`;
        views[c].inflight.set(id, false);
        const frame = JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: checked ? "desk.key.checked" : "desk.key",
          params: { _tag: "focus", tile: tiles[Math.floor(Math.random() * 4)], by: c, base: views[c].rev },
        });
        later(() => ws.send(frame));
        stats[c].sent++;
        await new Promise((r) => setTimeout(r, gap * (0.5 + Math.random())));
      }
    }),
  );
  await new Promise((r) => setTimeout(r, 500 + RTT));
  clients.forEach((ws) => ws.close());
  return stats;
};

const lastWriterWins = await typing(false, SECONDS, 8);
const checkedRev = await typing(true, SECONDS, 8);
await mf.dispose();
console.log(JSON.stringify({ rttSimulatedMs: RTT, seconds: SECONDS, miniflare: req("miniflare/package.json").version, latency, lastWriterWins, checkedRev }, null, 1));
