/**
 * The app's brain Worker: its Durable Object classes, the private control entrypoint and the default
 * `fetch`, each a thin handoff into libfabrika's Cloudflare runtime.
 *
 * @stability unstable
 */
import { makeDurableObjectBridge, makeWorkerBridge } from "@alchemy.run/cloudflare/Bridge";
import type { SettingsStart } from "@kampus/libfabrika";
import { type Descriptor, type Incoming } from "@kampus/libfabrika";
import type { Child } from "@kampus/libfabrika/processes/Children";
import type { ExitReason } from "@kampus/libfabrika/processes/ExitReason";
import type { From } from "@kampus/libfabrika/processes/Mailbox";
import type { Activity, Start } from "@kampus/libfabrika/processes/Process";
import { fetch } from "@kampus/libfabrika/workers";
import { control } from "@kampus/libfabrika/workers/control";
import { ConnectionService } from "@kampus/libfabrika/workers/gateway";
import {
  processRuntime,
  ProcessService,
  ProjectService,
  configureProcess,
  savedAlarm,
  processDescriptor,
  signingReply,
  commitReply,
  settingsWire,
} from "@kampus/libfabrika/workers/runtime";
import { DurableObject, WorkerEntrypoint, env } from "cloudflare:workers";
import { Effect, Redacted, Schema } from "effect";
import { assets, programs } from "virtual:fabrika-built";
import type { ConnectionId } from "./door.ts";
import { Objects } from "./objects.ts";
import { connectionRuntime, projectRuntime, type Env } from "./runtime.ts";

/**
 * Durable Object for the Project: each RPC method runs the matching `ProjectService` call, and
 * `settingsStart` and `settingsRead` run on the runtime's settings calls.
 *
 * @stability unstable
 * @category objects
 */
export class Project extends DurableObject<Env> {
  readonly owner = projectRuntime(this.ctx, this.env);
  readonly runtime = settingsWire(this.owner.contextEffect);

  settingsStart(input: SettingsStart.Input) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the trusted Project settings endpoint returns a Promise
    return Effect.runPromise(this.owner.settingsStart(input));
  }

  settingsRead(start: string) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the trusted Project settings endpoint returns a Promise
    return Effect.runPromise(this.owner.settingsRead(start));
  }

  target(name: string, code: string) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.target(name, code)));
  }

  clientConnect() {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.connect()));
  }

  challenge(client: ConnectionId) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.challenge(client)));
  }

  initialize(client: ConnectionId, input: unknown, trusted: { url: string; tab: string; name: string }) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.initialize(client, input, trusted)));
  }

  route(client: ConnectionId, method: string, params: unknown, reader?: string) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.route(client, method, params, reader)));
  }

  knock(client: ConnectionId, input: { label: string }) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.knock(client, input)));
  }

  grant(input: unknown) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.grant(input)));
  }

  disconnect(client: ConnectionId) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.disconnect(client)));
  }

  register(client: string, gateway: string, session: string) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.register(client, gateway, session)));
  }

  join(row: Parameters<ContextProject["join"]>[0]) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.join(row)));
  }

  leave(client: string, session: string) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.leave(client, session)));
  }

  online(key: string) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.online(key)));
  }

  info() {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.info));
  }

  start(request: Start, from: From) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.start(request, from)));
  }

  exit(pid: string, reason: ExitReason, from: From) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.exit(pid, reason, from)));
  }

  read(stream: string, after: number, reader: string) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.read(stream, after, reader)));
  }

  wait(stream: string, after: number, reader: string) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.wait(stream, after, reader)));
  }

  append(stream: string, id: string, line: unknown) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.append(stream, id, line)));
  }

  sign(pid: string, id: string, parent: string, kind: string) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => signingReply(p.sign(pid, id, parent, kind))));
  }

  commit(pid: string, input: Parameters<ContextProject["commit"]>[1]) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => commitReply(p.commit(pid, input))));
  }

  own(pid: string, id: string, stream: string, event: unknown, trace?: { traceId: string; spanId: string }) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.own(pid, id, stream, event, trace)));
  }

  mail(...args: Parameters<ContextProject["mail"]>) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.mail(...args)));
  }

  inbox(pid: string, input: Incoming) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.inbox(pid, input)));
  }

  publish(client: string, update: unknown) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.publish(client, update)));
  }

  code(hash: string) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.code(hash)));
  }

  codeInstall(input: Parameters<ContextProject["codeInstall"]>[0]) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.codeInstall(input)));
  }

  codeFailed(input: Parameters<ContextProject["codeFailed"]>[0]) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.codeFailed(input)));
  }

  brain(event: Parameters<ContextProject["brain"]>[0]) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.brain(event)));
  }

  processObject(pid: string) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.processObject(pid)));
  }

  processStart(request: Start, from: From) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.processStart(request, from)));
  }

  processChild(child: Child, from: From) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.processChild(child, from)));
  }

  processExit(pid: string, reason: ExitReason, from: From) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.processExit(pid, reason, from)));
  }

  processStatus(name: string) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.processStatus(name)));
  }

  processResolve(pid: string) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.processResolve(pid)));
  }

  processDead(pid: string, dead: Parameters<ContextProject["processDead"]>[1], from: From) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.processDead(pid, dead, from)));
  }

  processIsLive(pid: string) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.processIsLive(pid)));
  }

  processMonitor(ref: string, pid: string, from: From) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.processMonitor(ref, pid, from)));
  }

  processDemonitor(ref: string, from: From) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.processDemonitor(ref, from)));
  }

  processDown(pid: string, policy: Parameters<ContextProject["processDown"]>[1], from: From) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.processDown(pid, policy, from)));
  }

  processReceive(pid: string, after: number) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.processReceive(pid, after)));
  }
}

type ContextProject = (typeof ProjectService)["Service"];

/**
 * Durable Object for one registered name's processes: each RPC method runs the matching
 * `ProcessService` call, or its configuration, descriptor or alarm call.
 *
 * @stability unstable
 * @category objects
 */
export class Process extends DurableObject<Env> {
  readonly runtime = settingsWire(processRuntime(this.ctx, this.env, programs).contextEffect);

  usage(rows: unknown) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object usage delivery returns a Promise
    return this.runtime.runPromise(ProcessService.use((p) => p.usage(rows)));
  }

  configure(descriptor: Descriptor, drain?: boolean) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object configuration returns a Promise
    return Effect.runPromise(configureProcess(this.ctx, descriptor, this.runtime, drain));
  }

  descriptor(process?: string) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object descriptor lookup returns a Promise
    return Effect.runPromise(processDescriptor(this.ctx, process));
  }

  msg(input: unknown) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProcessService.use((p) => p.msg(input)));
  }

  open(client: string) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProcessService.use((p) => p.open(client)));
  }

  swap(request: Parameters<ProcessService["Service"]["swap"]>[0]) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProcessService.use((p) => p.swap(request)));
  }

  mailed(trace?: { traceId: string; spanId: string }) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProcessService.use((p) => p.mailed(trace)));
  }

  due(at: number) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProcessService.use((p) => p.due(at)));
  }

  restart(request: { id: string; build: string }) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProcessService.use((p) => p.restart(request)));
  }

  alarm() {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the platform alarm enters the runner
    return this.runtime.runPromise(ProcessService.use((p) => p.alarm()));
  }

  activity(value: typeof Activity.Type) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProcessService.use((p) => p.activity(value)));
  }

  recover() {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProcessService.use((p) => p.recover()));
  }

  savedAlarm() {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object alarm inspection returns a Promise
    return Effect.runPromise(savedAlarm(this.ctx));
  }

  abort() {
    this.ctx.abort("storage wake");
  }
}

/**
 * Durable Object for one connection at the door: its `fetch`, WebSocket events, `ring`, `probe` and
 * `notify` run the matching `ConnectionService` call.
 *
 * @stability unstable
 * @category objects
 */
export class Connection extends DurableObject<Env> {
  readonly runtime = settingsWire(connectionRuntime(this.ctx, this.env).contextEffect);

  fetch(request: Request) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: a Worker fetch returns a Promise
    return this.runtime.runPromise(ConnectionService.use((g) => g.fetch(request)));
  }

  webSocketMessage(ws: WebSocket, text: string | ArrayBuffer) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the WebSocket event enters Effect
    return this.runtime.runPromise(ConnectionService.use((g) => g.message(ws, text)));
  }

  webSocketClose(ws: WebSocket, code: number) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the WebSocket event enters Effect
    return this.runtime.runPromise(ConnectionService.use((g) => g.close(ws, code)));
  }

  webSocketError(ws: WebSocket) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the WebSocket event enters Effect
    return this.runtime.runPromise(ConnectionService.use((g) => g.close(ws)));
  }

  ring(stream: string, rev: number) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ConnectionService.use((g) => g.ring(stream, rev)));
  }

  probe(session: string) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ConnectionService.use((g) => g.probe(session)));
  }

  notify(client: string, news: unknown) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ConnectionService.use((g) => g.notify(client, news)));
  }
}

const deployment = Schema.decodeUnknownSync(
  // oxlint-disable-next-line fabrika/no-stage-word -- edge: these are Alchemy's own runtime binding names
  Schema.Struct({ ALCHEMY_STACK_NAME: Schema.NonEmptyString, ALCHEMY_STAGE: Schema.NonEmptyString }),
)(env);

const meta = {
  // oxlint-disable-next-line fabrika/no-type-assertions -- edge: Alchemy's generated entry passes the Worker.make export here (Sources/Rolldown.ts); makeDurableObjectBridge's type names an Effect
  entrypoint: Objects as unknown as Effect.Effect<Record<string, unknown>>,
  // oxlint-disable-next-line fabrika/no-stage-word -- Alchemy's own key picks its deployment state
  stack: { name: deployment.ALCHEMY_STACK_NAME, stage: deployment.ALCHEMY_STAGE },
};

const Bridge = makeDurableObjectBridge(DurableObject, meta);

/**
 * Durable Object for the Record, bridged to Alchemy's object of that name.
 *
 * @stability unstable
 * @category objects
 */
export class RecordPart extends Bridge("RecordPart") {}

/**
 * Worker entrypoint that receives the program isolates' tail events, bridged to Alchemy's Worker.
 *
 * @stability unstable
 * @category objects
 */
export class IsolateTail extends makeWorkerBridge(WorkerEntrypoint, meta) {}

/**
 * Worker entrypoint for the private local control socket: each request runs `control` with the
 * token from its props.
 *
 * @stability unstable
 * @category objects
 */
export class Control extends WorkerEntrypoint<Env, { token: string }> {
  fetch(request: Request) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the private local control socket enters Effect
    return Effect.runPromise(control(request, this.env, Redacted.make(this.ctx.props.token), programs));
  }
}

// oxlint-disable-next-line import/no-default-export -- edge: Cloudflare loads a Worker from its default export
export default {
  fetch(request: Request, env: Env) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: a Worker fetch returns a Promise
    return Effect.runPromise(
      fetch(request, env, undefined, assets).pipe(
        Effect.catchCause(() => Effect.succeed(new Response("Settings unavailable", { status: 503 }))),
      ),
    );
  },
};
