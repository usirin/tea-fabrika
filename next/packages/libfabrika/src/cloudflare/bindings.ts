/**
 * The RPC shapes of the Cloudflare objects: what each Durable Object binding answers, and the reply
 * schemas that carry a refusal across the RPC as data.
 *
 * @stability unstable
 */
import { type Brand, type Effect, Schema } from "effect";
import { Session, SigningRefused } from "../access/SessionManager.ts";
import type { LedgerCalls } from "../ledger/Ledger.ts";
import { Appended, Line } from "../ledger/Log.ts";
import type { Connections } from "../presence/Connections.ts";
import { type Child, ChildrenError, Started } from "../processes/Children.ts";
import type { From, Letter } from "../processes/Mailbox.ts";
import { ProcessError, State, type Activity, type Start } from "../processes/Process.ts";
import type { ProcessManager } from "../processes/ProcessManager.ts";
import { type Delivery, MailRefusal } from "../processes/ProgramMail.ts";
import type { BrainEvent } from "../runtime/BrainEvent.ts";
import type { BuiltProgram } from "../runtime/Built.ts";
import type { CodeEvent, Install, Installed } from "../runtime/Code.ts";
import type { Incoming } from "../runtime/Entry.ts";
import type * as IsolateUsage from "../runtime/IsolateUsage.ts";
import type { Descriptor, ProgramRunner } from "../runtime/Runner.ts";
import type { Publication } from "../runtime/WatcherManager.ts";
import type * as SettingsStart from "../settings/Start.ts";
import type { RecordCalls } from "../telemetry/Records.ts";
import type { checkHello } from "../transport/Hello.ts";
import type { Answer } from "../transport/Wire.ts";

/**
 * Schema for a mail delivery's answer over Project RPC: `ok` with the delivery's receipt, or `refused`
 * with its `MailRefusal`.
 *
 * @stability unstable
 * @category schemas
 */
export const MailReplies = Schema.TaggedUnion({
  ok: {
    receipt: Schema.Struct({
      id: Schema.String,
      command: Schema.String,
      source: Schema.Struct({ name: Schema.String, process: Schema.String }),
      to: Schema.Struct({ name: Schema.String, state: State }),
      m: Schema.Json,
      ref: Schema.NullOr(Schema.String),
      grant: Schema.Struct({ source: Schema.String, to: Schema.String }),
      from: Line.mapFields(({ _tag, body, ...fields }) => fields),
      arrivedAt: Schema.Number,
      rev: Schema.Number,
      pos: Schema.Number,
    }),
  },
  refused: { reason: MailRefusal },
});

/**
 * The type a `MailReplies` answer decodes to.
 *
 * @stability unstable
 * @category models
 */
export type MailReply = typeof MailReplies.Type;

/**
 * The branded string that names one client's connection at the door.
 *
 * @stability unstable
 * @category models
 */
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

/**
 * Schema for a signing request's answer over Project RPC: `ok` with the `Session`, `SigningRefused`
 * with its reason, or `NotGranted`.
 *
 * @stability unstable
 * @category schemas
 */
export const SigningReply = Schema.TaggedUnion({ ok: { value: Session }, ...refusals });
/**
 * Schema for a commit's answer over Project RPC: `ok` with the `Appended` entry, `SigningRefused`
 * with its reason, or `NotGranted`.
 *
 * @stability unstable
 * @category schemas
 */
export const CommitReply = Schema.TaggedUnion({ ok: { value: Appended }, ...refusals });

/**
 * Schema for a Project process call's answer: its value, or its checked refusal as data across the
 * RPC. The value's own type comes from the call; the schema checks the refusal.
 *
 * @stability unstable
 * @category schemas
 */
export const ProcessReplies = Schema.TaggedUnion({
  ok: { value: Schema.Unknown },
  ProcessError: { reason: ProcessError.fields.reason },
});

/**
 * The type of a `ProcessReplies` answer whose `ok` value is `A`.
 *
 * @stability unstable
 * @category models
 */
export type ProcessReply<A> =
  | (Omit<typeof ProcessReplies.cases.ok.Type, "value"> & { readonly value: A })
  | typeof ProcessReplies.cases.ProcessError.Type;

/**
 * Schema for a child start's answer over Project RPC: `Started`, or its `ChildrenError` refusal as
 * data. A storage failure fails the call itself.
 *
 * @stability unstable
 * @category schemas
 */
export const ChildReplies = Schema.TaggedUnion({
  ok: { value: Started },
  ChildrenError: { reason: ChildrenError.fields.reason },
});

/**
 * The door's calls on the Project, as Effects: connecting a client, its hello, routing its calls,
 * knocks and grants, and the signing and appends a process asks for.
 *
 * @stability unstable
 * @category models
 */
export interface GatewayCalls {
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
    input: { readonly label: string; readonly pass?: string | null; readonly as?: "window" | "agent" | "hands" },
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
type DoorService = GatewayCalls;
type Processes = (typeof ProcessManager)["Service"];
type Gateways = (typeof Connections)["Service"];
type Runner = (typeof ProgramRunner)["Service"];

/** One ProcessManager call over Project RPC: a refusal comes back as reply data. */
type ProcessCall<F> = F extends (...args: infer A) => Effect.Effect<infer B, unknown>
  ? RemoteCall<(...args: A) => Effect.Effect<ProcessReply<B>>>
  : never;

/**
 * The Project Durable Object's RPC binding: the ledger's calls, the door's calls, code install and
 * lookup, settings, processes and mail. A process call answers its refusal as `ProcessReply` data.
 *
 * @stability unstable
 * @category models
 */
export type ProjectBinding = Rpc.DurableObjectBranded &
  LedgerCalls &
  Remote<Pick<DoorService, "target" | "challenge" | "initialize" | "route" | "knock" | "grant" | "disconnect">> & {
    code: RemoteCall<(hash: string) => Effect.Effect<BuiltProgram | null>>;
    codeInstall: RemoteCall<(input: Install) => Effect.Effect<Installed>>;
    codeFailed: RemoteCall<(input: (typeof CodeEvent.cases)["code.failed"]["Type"]) => Effect.Effect<void>>;
    settingsStart: RemoteCall<(input: SettingsStart.Input) => Effect.Effect<typeof SettingsStart.Reply.Type>>;
    settingsRead: RemoteCall<(start: string) => Effect.Effect<typeof SettingsStart.Reply.Type>>;
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
    mail: RemoteCall<(delivery: Delivery, trace?: { traceId: string; spanId: string }) => Effect.Effect<MailReply>>;
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
    publish: RemoteCall<(client: string, update: unknown) => Effect.Effect<typeof Publication.Type>>;
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
    processChild: RemoteCall<(child: Child, from: From) => Effect.Effect<typeof ChildReplies.Encoded>>;
  };

/**
 * A Process Durable Object's RPC binding: the runner's `msg`, `open`, `due`, `restart` and `swap`,
 * plus its configuration, usage, alarm and abort calls.
 *
 * @stability unstable
 * @category models
 */
export type ProcessBinding = Rpc.DurableObjectBranded &
  Remote<Pick<Runner, "msg" | "open" | "due" | "restart" | "swap">> & {
    mailed: RemoteCall<(trace?: { traceId: string; spanId: string }) => Runner["mailed"]>;
    configure: RemoteCall<(descriptor: Descriptor, drain?: boolean) => Effect.Effect<void>>;
    usage: RemoteCall<typeof IsolateUsage.record>;
    descriptor: RemoteCall<(process?: string) => Effect.Effect<Descriptor>>;
    activity: RemoteCall<(value: typeof Activity.Type) => Effect.Effect<void>>;
    recover: RemoteCall<() => Effect.Effect<unknown>>;
    savedAlarm: RemoteCall<() => Effect.Effect<number | null>>;
    abort: RemoteCall<() => Effect.Effect<void>>;
  };

/**
 * A Connection Durable Object's RPC binding: `fetch`, `ring`, `notify` and `probe`.
 *
 * @stability unstable
 * @category models
 */
export type ConnectionBinding = Rpc.DurableObjectBranded &
  Remote<{
    fetch: (request: Request) => Effect.Effect<Response>;
    ring: (stream: string, rev: number) => Effect.Effect<void>;
    notify: (client: string, news: unknown) => Effect.Effect<void>;
    probe: (session: string) => Effect.Effect<number | null>;
  }>;

/**
 * The Record Durable Object's RPC binding: the calls of `RecordCalls`.
 *
 * @stability unstable
 * @category models
 */
export type RecordBinding = Rpc.DurableObjectBranded & Remote<RecordCalls>;
