// Experiment 275, lab code. A stdio MCP server between `claude -p` and next/'s door, in one of three
// shapes (EXP_DOOR):
//   A  one tool per input: notes_list, notes_read, notes_save
//   B  one execute tool: the agent's script runs in a Worker Loader isolate (scripts/worker.js, in
//      the same local runtime as the brain) with `globalOutbound: null`, holding only `fabrika`,
//      whose methods are made from the program's input schemas; each call comes back here to the
//      same `call` as A
//   C  query (the same script, with only the read methods) plus flow_start (saves handed over as a
//      list, run in order through the same `call`)
// Every call, whichever door, is one `process.send` or `view.open` on the same WebSocket, with the
// same key, the same letter id and the same refusal. Each is one line in EXP_LOG.
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createInterface } from "node:readline";
import { Schema } from "effect";
import { Door, DoorDown, loadKey } from "./door.ts";
import { inputSchemas, program } from "./notes.ts";

// The program's ports and input schemas, read by name.
type Port = {
  readonly _tag: string;
  readonly description: string;
  readonly answer?: (view: unknown, query: unknown) => unknown;
};

const ports: Readonly<Record<string, Port>> = program.inputs;
const schemas: Readonly<Record<string, Schema.Top>> = inputSchemas;

const env = (name: string) => process.env[name] ?? "";
const shape = env("EXP_DOOR");
const home = env("EXP_HOME");
const logFile = env("EXP_LOG");
const killAfter = Number(env("EXP_KILL_AFTER") || "0");
const url = env("EXP_URL");
const log = (row: object) => appendFileSync(logFile, `${JSON.stringify({ t: Date.now(), ...row })}\n`);

// ---- the door: one socket, redialed when the brain comes back ----
const key = await loadKey(`${home}/client.json`);
let door = await Door.make(url, key, "agent-1");
let pid = "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const dial = async () => {
  for (let tries = 0; tries < 600; tries++) {
    try {
      door = await Door.make(url, key, "agent-1");
      const hello = await door.connect();

      if (hello.error === undefined) {
        const procs = await door.call("ledger.read", { stream: "processes/counter:1", after: 0 });
        pid = procs.result.entries.find((r: any) => r._tag === "started").body.process;
        return;
      }
    } catch {
      /* the brain is not back yet */
    }

    await sleep(200);
  }

  throw new DoorDown("gave up");
};

await dial();

let landed = 0;
// sentAt is kept per letter, so a retry is byte for byte the first send and the door can match it.
const sentFile = `${home}/sent.json`;
const sent: Record<string, string> = existsSync(sentFile) ? JSON.parse(readFileSync(sentFile, "utf8")) : {};

const rpc = async (method: string, params: unknown) => {
  if (!door.open) {
    log({ redial: true });
    const at = Date.now();
    await dial();
    log({ redialed: Date.now() - at });
  }

  return door.call(method, params);
};

const view = async () => (await rpc("view.open", { pid })).result.view;

/** The one way any door reaches the program. */
const call = async (input: string, value: any, via: string): Promise<unknown> => {
  const at = Date.now();
  const decoded = Schema.decodeUnknownExit(schemas[input] ?? Schema.Never)(value);

  if (decoded._tag === "Failure") {
    log({ via, input, value, ok: false, reason: "bad_input" });
    return { _tag: "refused", reason: "bad_input" };
  }

  const port = ports[input];

  if (port?._tag === "read" && port.answer !== undefined) {
    const answer = port.answer(await view(), value);
    log({ via, input, value, ok: true, ms: Date.now() - at });
    return answer;
  }

  const m = { type: input, ...value };
  const letter = createHash("sha256")
    .update(JSON.stringify([m.note, m.base, m.body]))
    .digest("hex")
    .slice(0, 32);
  sent[letter] ??= new Date().toISOString();
  writeFileSync(sentFile, JSON.stringify(sent));
  const reply = await rpc("process.send", { pid, letter, m, sentAt: sent[letter], seen: 0 });
  const r = reply.result ?? { _tag: "error", reason: reply.error?.data?.reason ?? reply.error?.message };
  log({ via, input, value, letter, ok: r._tag === "accepted", result: r, ms: Date.now() - at });

  if (r._tag === "accepted") {
    landed++;

    if (landed === killAfter) {
      // The kill: ask the harness to end the brain, and lose this write's answer on the way back.
      writeFileSync(`${home}/kill.req`, String(Date.now()));

      while (door.open) {
        await sleep(20);
      }

      log({ via, input, lost: letter });
      throw new DoorDown("brain_down: the connection closed before the answer came back");
    }

    return { _tag: "saved", note: m.note, version: m.base + 1 };
  }

  return r;
};

// ---- tool shapes ----
const jsonSchema = (s: Schema.Top) => {
  const doc: any = Schema.toJsonSchemaDocument(Schema.Struct({ value: s }));
  return {
    ...doc.schema,
    ...(doc.definitions && Object.keys(doc.definitions).length ? { $defs: doc.definitions } : {}),
  };
};

// A TypeScript signature per input, made from its JSON Schema, for the script tools' description.
const tsOf = (s: any): string =>
  s.type === "object"
    ? `{ ${Object.entries(s.properties ?? {})
        .map(([k, v]) => `${k}: ${tsOf(v)}`)
        .join("; ")} }`
    : s.type === "integer" || s.type === "number"
      ? "number"
      : (s.type ?? "{}");

const sig = (name: string) => tsOf(Schema.toJsonSchemaDocument(schemas[name] ?? Schema.Unknown).schema);

const answers: Record<string, string> = {
  list: "Array<{ note: string; version: number; title: string }>",
  read: "{ note: string; body: string; version: number } | null",
  save: '{ _tag: "saved"; note: string; version: number } | { _tag: "refused"; reason: string; now?: number }',
};

const api = (all: ReadonlyArray<string>, names = all.filter((n) => granted.has(n))) =>
  `declare const fabrika: { notes: {\n${names
    .map((n) => `  /** ${ports[n]?.description} */\n  ${n}(value: ${sig(n)}): Promise<${answers[n]}>;`)
    .join("\n")}\n} };`;

// Script limits (owner, round one): a time limit and a cap on calls, each ending the script with a
// named refusal. fabrika holds both here, in the bridge: the local runtime enforces no CPU limit
// (experiment 173). The numbers are guesses for a 5-note job, not measured.
const LIMITS = { ms: Number(env("EXP_SCRIPT_MS") || "30000"), calls: Number(env("EXP_SCRIPT_CALLS") || "60") };
// The inputs this agent's grant allows. The handle holds only these; nothing else is reachable.
const granted = new Set((env("EXP_GRANT") || "list,read,save").split(","));
const scriptsFile = env("EXP_SCRIPTS");
const scriptsUrl = env("EXP_SCRIPTS_URL");

type Run = {
  readonly id: string;
  readonly via: string;
  readonly names: ReadonlySet<string>;
  readonly started: number;
  calls: number;
  refused: string | undefined;
  readonly record: (row: object) => void;
};

const runs = new Map<string, Run>();

// The handle's way back: the isolate's FABRIKA stub posts {run, input, value} here, and the
// answer is the same `call` door A uses. A run id the bridge did not start gets nothing.
const handleCall = async (body: any) => {
  const run = runs.get(String(body.run));

  if (run === undefined) {
    return { refused: "unknown_run" };
  }

  if (!run.names.has(body.input)) {
    return { refused: "not_granted" };
  }

  if (run.refused !== undefined) {
    return { refused: run.refused };
  }

  if (Date.now() - run.started > LIMITS.ms) {
    return { refused: (run.refused = "time_limit") };
  }

  if (run.calls >= LIMITS.calls) {
    return { refused: (run.refused = "call_cap") };
  }

  const seq = run.calls++;
  run.record({ _tag: "script_called", seq, input: body.input, value: body.value ?? {} });

  try {
    const result = await call(body.input, body.value ?? {}, run.via);
    run.record({ _tag: "script_answered", seq, input: body.input, result });
    return { result };
  } catch (e) {
    run.record({ _tag: "script_answered", seq, input: body.input, error: String(e) });
    return { error: String(e) };
  }
};

const server = createServer((req, res) => {
  let text = "";
  req.on("data", (c) => (text += c));
  req.on("end", async () => {
    const answer = await handleCall(JSON.parse(text || "{}")).catch((e) => ({ error: String(e) }));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(answer));
  });
});

await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const callback = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

const runScript = async (code: string, all: ReadonlyArray<string>, via: string) => {
  const id = randomUUID();
  const names = new Set(all.filter((n) => granted.has(n)));
  // The record of every script: its hash, who sent it, and each call in order, written as it happens.
  const record = (row: object) =>
    appendFileSync(scriptsFile, `${JSON.stringify({ script: id, t: Date.now(), ...row })}\n`);
  record({
    _tag: "script_started",
    via,
    hash: createHash("sha256").update(code).digest("hex"),
    by: door.fingerprint,
    tab: door.tab,
    grant: [...names],
    limits: LIMITS,
    code,
  });
  const run: Run = { id, via, names, started: Date.now(), calls: 0, refused: undefined, record };
  runs.set(id, run);
  const end = (row: object, answer: object) => {
    record({ _tag: "script_ended", calls: run.calls, ms: Date.now() - run.started, ...row });
    log({ script: via, calls: run.calls, ms: Date.now() - run.started, bytes: code.length, ...row });
    runs.delete(id);
    return JSON.stringify(answer);
  };
  const posted = fetch(scriptsUrl, {
    method: "POST",
    body: JSON.stringify({ run: id, code, names: [...names], callback }),
  }).then((r) => r.json() as Promise<any>);
  const timer = sleep(LIMITS.ms).then(() => "time_limit" as const);
  const out = await Promise.race([posted, timer]).catch((e) => ({ error: `scripts: ${String(e)}` }));

  if (out === "time_limit") {
    // The isolate may still be running: workerd has no CPU wall locally. It can make no more calls.
    run.refused = "time_limit";
    return end({ ok: false, refused: "time_limit" }, { refused: { reason: "time_limit", most: LIMITS.ms } });
  }

  const answer: any = out;

  if (run.refused !== undefined) {
    return end(
      { ok: false, refused: run.refused },
      {
        refused: { reason: run.refused, most: run.refused === "call_cap" ? LIMITS.calls : LIMITS.ms },
        printed: answer.printed ?? [],
      },
    );
  }

  return end(
    { ok: answer.error === undefined, ...(answer.error === undefined ? {} : { error: answer.error }) },
    answer,
  );
};

type Tool = { name: string; description: string; inputSchema: object; run: (args: any) => Promise<string> };
const plain = (s: object) => ({ type: "object", properties: s, required: Object.keys(s), additionalProperties: false });

const doorA: Array<Tool> = (["list", "read", "save"] as const)
  .filter((n) => granted.has(n))
  .map((n) => ({
    name: `notes_${n}`,
    description: ports[n]?.description,
    inputSchema: jsonSchema(inputSchemas[n]),
    run: async (args) => JSON.stringify(await call(n, args.value, "A")),
  }));

const doorB: Array<Tool> = [
  {
    name: "execute",
    description: `Run a JavaScript async function body. It may await calls on \`fabrika\` and return a JSON value; console.log lines come back too. It runs in its own isolate with no network and no files. Each call goes through the same door as a single tool call, with your grant, and a save on an old base is refused.\n\n${api(["list", "read", "save"])}`,
    inputSchema: plain({ code: { type: "string", description: "The body of an async function" } }),
    run: (args) => runScript(String(args.code), ["list", "read", "save"], "B"),
  },
];

const Step = Schema.Struct({
  _tag: Schema.Literal("act"),
  input: Schema.Literal("notes_save"),
  value: inputSchemas.save,
});

const doorC: Array<Tool> = [
  {
    name: "query",
    description: `Run a read-only JavaScript async function body and return a JSON value. It may only read: \`fabrika\` has no write method. It runs in its own isolate with no network and no files.\n\n${api(["list", "read"])}`,
    inputSchema: plain({ code: { type: "string", description: "The body of an async function" } }),
    run: (args) => runScript(String(args.code), ["list", "read"], "C"),
  },
  {
    name: "flow_start",
    description:
      "Hand over writes as data. Each step is checked against notes_save's schema before any runs, then they run in order through the same door; each answer is returned. A save on an old base is refused and the flow goes on.",
    inputSchema: {
      type: "object",
      properties: { steps: { type: "array", items: jsonSchemaStep() } },
      required: ["steps"],
      additionalProperties: false,
    },
    run: async (args) => {
      const steps = Schema.decodeUnknownExit(Schema.Array(Step))(args.steps);

      if (steps._tag === "Failure") {
        return JSON.stringify({ refused: "bad_flow", cause: String(steps.cause) });
      }

      if (!granted.has("save")) {
        return JSON.stringify({ refused: "not_granted" });
      }

      if (steps.value.length > LIMITS.calls) {
        return JSON.stringify({ refused: "call_cap", most: LIMITS.calls });
      }

      appendFileSync(
        scriptsFile,
        `${JSON.stringify({ _tag: "flow_started", t: Date.now(), by: door.fingerprint, hash: createHash("sha256").update(JSON.stringify(steps.value)).digest("hex"), steps: steps.value })}\n`,
      );
      const results: Array<unknown> = [];

      for (const s of steps.value) {
        try {
          results.push(await call("save", s.value, "C"));
        } catch (e) {
          results.push({ _tag: "error", reason: String(e) });
        }
      }

      return JSON.stringify({ results });
    },
  },
];

function jsonSchemaStep() {
  return {
    type: "object",
    properties: {
      _tag: { const: "act" },
      input: { const: "notes_save" },
      value: Schema.toJsonSchemaDocument(inputSchemas.save).schema,
    },
    required: ["_tag", "input", "value"],
    additionalProperties: false,
  };
}

const tools = shape === "A" ? doorA : shape === "B" ? doorB : doorC;

// ---- MCP over stdio: newline-delimited JSON-RPC ----
const send = (msg: object) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
const lines = createInterface({ input: process.stdin });

lines.on("line", async (line) => {
  if (line.trim() === "") {
    return;
  }

  const msg = JSON.parse(line);

  if (msg.method === "initialize") {
    send({
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "door", version: "0.0.0" },
      },
    });
  } else if (msg.method === "tools/list") {
    send({ id: msg.id, result: { tools: tools.map(({ run: _run, ...t }) => t) } });
  } else if (msg.method === "tools/call") {
    const tool = tools.find((t) => t.name === msg.params.name);
    const at = Date.now();

    try {
      const text = tool === undefined ? "unknown tool" : await tool.run(msg.params.arguments ?? {});
      log({
        mcp: msg.params.name,
        ok: true,
        ms: Date.now() - at,
        in: JSON.stringify(msg.params.arguments).length,
        out: text.length,
      });
      send({ id: msg.id, result: { content: [{ type: "text", text }] } });
    } catch (e) {
      log({ mcp: msg.params.name, ok: false, ms: Date.now() - at, error: String(e) });
      send({ id: msg.id, result: { content: [{ type: "text", text: String(e) }], isError: true } });
    }
  } else if (msg.id !== undefined) {
    send({ id: msg.id, result: {} });
  }
});

lines.on("close", () => process.exit(0));
