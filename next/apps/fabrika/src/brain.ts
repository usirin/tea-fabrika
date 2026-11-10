import type { Descriptor, Incoming } from "@kampus/libfabrika";
import type { Activity, From, Start } from "@kampus/libfabrika/coordination";
import type { Chain } from "@kampus/libfabrika/data";
import { fetch } from "@kampus/libfabrika/workers";
import { control } from "@kampus/libfabrika/workers/control";
import { GatewayService } from "@kampus/libfabrika/workers/gateway";
import { recordContent, recordDelete, recordRead, recordWrite } from "@kampus/libfabrika/workers/record";
import {
  processRuntime,
  ProcessService,
  ProjectService,
  configureProcess,
  savedAlarm,
  processDescriptor,
  signingReply,
  commitReply,
} from "@kampus/libfabrika/workers/runtime";
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { Effect, Redacted } from "effect";
import { assets, programs } from "virtual:fabrika-built";
import type { ConnectionId } from "./door.ts";
import { gatewayRuntime, projectRuntime, settings, type Env } from "./runtime.ts";

export class Project extends DurableObject<Env> {
  readonly runtime = projectRuntime(this.ctx, this.env);

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

  exit(pid: string, reason: string, from: From) {
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

  inbox(pid: string, input: Incoming) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.inbox(pid, input)));
  }

  publish(client: string, update: unknown) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProjectService.use((p) => p.publish(client, update)));
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

  processExit(pid: string, reason: string, from: From) {
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

export class Process extends DurableObject<Env> {
  readonly runtime = processRuntime(this.ctx, this.env, programs);

  configure(descriptor: Descriptor) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object configuration returns a Promise
    return Effect.runPromise(configureProcess(this.ctx, descriptor));
  }

  descriptor() {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object descriptor lookup returns a Promise
    return Effect.runPromise(processDescriptor(this.ctx));
  }

  msg(input: unknown) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProcessService.use((p) => p.msg(input)));
  }

  open(client: string) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(ProcessService.use((p) => p.open(client)));
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

export class Gateway extends DurableObject<Env> {
  readonly runtime = gatewayRuntime(this.ctx, this.env);

  fetch(request: Request) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: a Worker fetch returns a Promise
    return this.runtime.runPromise(GatewayService.use((g) => g.fetch(request)));
  }

  webSocketMessage(ws: WebSocket, text: string | ArrayBuffer) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the WebSocket event enters Effect
    return this.runtime.runPromise(GatewayService.use((g) => g.message(ws, text)));
  }

  webSocketClose(ws: WebSocket) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the WebSocket event enters Effect
    return this.runtime.runPromise(GatewayService.use((g) => g.close(ws)));
  }

  webSocketError(ws: WebSocket) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the WebSocket event enters Effect
    return this.runtime.runPromise(GatewayService.use((g) => g.close(ws)));
  }

  ring(stream: string, rev: number) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(GatewayService.use((g) => g.ring(stream, rev)));
  }

  probe(session: string) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(GatewayService.use((g) => g.probe(session)));
  }

  notify(client: string, news: unknown) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return this.runtime.runPromise(GatewayService.use((g) => g.notify(client, news)));
  }
}

type Rows = Parameters<typeof recordWrite>[4];

export class RecordPart extends DurableObject<Env> {
  write(chain: Chain, at: number, rows: Rows) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return Effect.runPromise(
      settings(this.env).pipe(Effect.flatMap((s) => recordWrite(this.ctx, s.limits?.recordBytes, chain, at, rows))),
    );
  }

  read(chain: Chain, at: number, after: number) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return Effect.runPromise(
      settings(this.env).pipe(Effect.flatMap((s) => recordRead(this.ctx, s.limits?.recordBytes, chain, at, after))),
    );
  }

  content(chain: Chain, at: number, id: string) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return Effect.runPromise(
      settings(this.env).pipe(Effect.flatMap((s) => recordContent(this.ctx, s.limits?.recordBytes, chain, at, id))),
    );
  }

  deleteContent(chain: Chain, at: number, id: string, by: Parameters<typeof recordDelete>[5]) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
    return Effect.runPromise(
      settings(this.env).pipe(Effect.flatMap((s) => recordDelete(this.ctx, s.limits?.recordBytes, chain, at, id, by))),
    );
  }
}

export class Control extends WorkerEntrypoint<Env, { token: string }> {
  fetch(request: Request) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the private local control socket enters Effect
    return Effect.runPromise(control(request, this.env, Redacted.make(this.ctx.props.token), programs));
  }
}

export default {
  fetch(request: Request, env: Env) {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: a Worker fetch returns a Promise
    return Effect.runPromise(settings(env).pipe(Effect.flatMap((config) => fetch(request, env, config, assets))));
  },
};
