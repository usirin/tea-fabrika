import { type Brand, type Effect, Schema } from "effect";
import type { BrainEvent } from "../app/brain-event.ts";
import type { Incoming } from "../app/entry.ts";
import type { Descriptor, ProgramRunner } from "../app/runner.ts";
import type { Activity, From, GatewayManager, ProcessManager, Start } from "../coordination/index.ts";
import { ProcessError, Session, SigningRefused } from "../coordination/index.ts";
import type { Letter } from "../coordination/mailbox.ts";
import { Appended, type LedgerCalls, type RecordCalls } from "../data/index.ts";
import type { Answer, checkHello } from "../transport/index.ts";

export type ConnectionId = string & Brand.Brand<"ConnectionId">;

const GrantReply = Schema.TaggedUnion({
  applied: { rev: Schema.Number },
  ignored: { rev: Schema.Number, reason: Schema.String },
  refused: { reason: Schema.String },
});

const refusals = {
  SigningRefused: { reason: SigningRefused.fields.reason },
  NotGranted: {},
};

export const SigningReply = Schema.TaggedUnion({ ok: { value: Session }, ...refusals });
export const CommitReply = Schema.TaggedUnion({ ok: { value: Appended }, ...refusals });

/** A Project process call's answer: its value, or its checked refusal as data across the RPC. The
 *  value's own type comes from the call; the schema checks the refusal. */
export const ProcessReplies = Schema.TaggedUnion({
  ok: { value: Schema.Unknown },
  ProcessError: { reason: ProcessError.fields.reason },
});

export type ProcessReply<A> =
  | (Omit<typeof ProcessReplies.cases.ok.Type, "value"> & { readonly value: A })
  | typeof ProcessReplies.cases.ProcessError.Type;

export interface DoorCalls {
  readonly connect: () => Effect.Effect<ConnectionId>;
  readonly challenge: (client: ConnectionId) => Effect.Effect<string, unknown>;
  readonly initialize: (
    client: ConnectionId,
    input: unknown,
    trusted: { readonly url: string; readonly tab: string; readonly name: string },
  ) => Effect.Effect<Effect.Success<ReturnType<typeof checkHello>>, unknown>;
  readonly target: (
    name: string,
    code: string,
  ) => Effect.Effect<
    {
      key: string;
      for: string;
      to: string;
      code: string;
      label: string;
    } | null,
    unknown
  >;
  readonly route: (
    client: ConnectionId,
    method: string,
    params: unknown,
    reader?: string,
  ) => Effect.Effect<typeof Answer.Type, unknown>;
  readonly knock: (
    client: ConnectionId,
    input: { readonly label: string; readonly pass?: string | null },
  ) => Effect.Effect<typeof Answer.Type, unknown>;
  readonly grant: (input: unknown) => Effect.Effect<typeof GrantReply.Type, unknown>;
  readonly disconnect: (client: ConnectionId) => Effect.Effect<void, unknown>;
  readonly sign: (process: string, id: string, parent: string, kind: string) => Effect.Effect<Session, unknown>;
  readonly append: (input: {
    readonly process: string;
    readonly id: string;
    readonly parent: string;
    readonly kind: string;
    readonly stream: string;
    readonly event: unknown;
  }) => Effect.Effect<Appended, unknown>;
  readonly retire: (process: string) => Effect.Effect<void, unknown>;
  readonly checkDelivery: (process: string, incoming: Incoming) => Effect.Effect<void, unknown>;
}

type RemoteCall<F> = F extends (...args: infer A) => infer B ? (...args: A) => Promise<Effect.Success<B>> : never;

type Remote<S> = { [K in keyof S]: RemoteCall<S[K]> };
type DoorService = DoorCalls;
type Processes = (typeof ProcessManager)["Service"];
type Gateways = (typeof GatewayManager)["Service"];
type Runner = (typeof ProgramRunner)["Service"];

/** One ProcessManager call over Project RPC: a refusal comes back as reply data. */
type ProcessCall<F> = F extends (...args: infer A) => Effect.Effect<infer B, unknown>
  ? RemoteCall<(...args: A) => Effect.Effect<ProcessReply<B>>>
  : never;

export type ProjectBinding = Rpc.DurableObjectBranded &
  LedgerCalls &
  Remote<Pick<DoorService, "target" | "challenge" | "initialize" | "route" | "knock" | "grant" | "disconnect">> & {
    clientConnect: RemoteCall<DoorService["connect"]>;
    register: RemoteCall<(client: string, gateway: string, session: string) => Effect.Effect<void>>;
    join: RemoteCall<Gateways["join"]>;
    leave: RemoteCall<Gateways["leave"]>;
    online: RemoteCall<Gateways["online"]>;
    info: RemoteCall<() => Processes["info"]>;
    start: RemoteCall<(request: Start, from: From) => ReturnType<Processes["start"]>>;
    exit: RemoteCall<Processes["exit"]>;
    sign: RemoteCall<
      (process: string, id: string, parent: string, kind: string) => Effect.Effect<typeof SigningReply.Type>
    >;
    commit: RemoteCall<
      (
        pid: string,
        input: Omit<Parameters<DoorService["append"]>[0], "process">,
      ) => Effect.Effect<typeof CommitReply.Type>
    >;
    inbox: RemoteCall<(pid: string, input: Incoming) => Effect.Effect<Appended>>;
    own: RemoteCall<
      (
        pid: string,
        id: string,
        stream: string,
        event: unknown,
        trace?: { traceId: string; spanId: string },
      ) => Effect.Effect<Appended>
    >;
    publish: RemoteCall<(client: string, update: unknown) => Effect.Effect<void>>;
    brain: RemoteCall<(event: typeof BrainEvent.Type) => Effect.Effect<Appended>>;
    /** The registered name whose Process object holds this process ID's storage. */
    processObject: RemoteCall<(pid: string) => Effect.Effect<string>>;
    processStart: ProcessCall<(request: Start, from: From) => ReturnType<Processes["start"]>>;
    processExit: ProcessCall<Processes["exit"]>;
    processStatus: ProcessCall<Processes["status"]>;
    processResolve: ProcessCall<Processes["resolve"]>;
    processDead: ProcessCall<Processes["dead"]>;
    processIsLive: RemoteCall<Processes["isLive"]>;
    processMonitor: ProcessCall<Processes["monitor"]>;
    processDemonitor: ProcessCall<Processes["demonitor"]>;
    processDown: ProcessCall<Processes["down"]>;
    processReceive: ProcessCall<(process: string, after: number) => Effect.Effect<ReadonlyArray<Letter>, ProcessError>>;
  };

export type ProcessBinding = Rpc.DurableObjectBranded &
  Remote<Pick<Runner, "msg" | "open" | "due" | "restart">> & {
    configure: RemoteCall<(descriptor: Descriptor) => Effect.Effect<void>>;
    descriptor: RemoteCall<() => Effect.Effect<Descriptor>>;
    activity: RemoteCall<(value: typeof Activity.Type) => Effect.Effect<void>>;
    recover: RemoteCall<() => Effect.Effect<unknown>>;
    savedAlarm: RemoteCall<() => Effect.Effect<number | null>>;
    abort: RemoteCall<() => Effect.Effect<void>>;
  };

export type GatewayBinding = Rpc.DurableObjectBranded &
  Remote<{
    fetch: (request: Request) => Effect.Effect<Response>;
    ring: (stream: string, rev: number) => Effect.Effect<void>;
    notify: (client: string, news: unknown) => Effect.Effect<void>;
    probe: (session: string) => Effect.Effect<number | null>;
  }>;

export type RecordBinding = Rpc.DurableObjectBranded & RecordCalls;
