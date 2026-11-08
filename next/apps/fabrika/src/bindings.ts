import type {Descriptor, Incoming, ProgramRunner} from "@kampus/libfabrika";
import type {
	Activity,
	From,
	GatewayManager,
	ProcessManager,
	Start,
} from "@kampus/libfabrika/coordination";
import type {Appended, LedgerCalls, RecordCalls} from "@kampus/libfabrika/data";
import type {Effect} from "effect";
import type {Door} from "./door.ts";
import type {BrainFact} from "./local-stage.ts";

type RemoteCall<F> = F extends (...args: infer A) => infer B
	? (...args: A) => Promise<Effect.Success<B>>
	: never;
type Remote<S> = {[K in keyof S]: RemoteCall<S[K]>};
type DoorService = (typeof Door)["Service"];
type Processes = (typeof ProcessManager)["Service"];
type Gateways = (typeof GatewayManager)["Service"];
type Runner = (typeof ProgramRunner)["Service"];

export type ProjectBinding = Rpc.DurableObjectBranded &
	LedgerCalls &
	Remote<
		Pick<
			DoorService,
			"target" | "challenge" | "initialize" | "route" | "knock" | "grant" | "disconnect" | "sign"
		>
	> & {
		clientConnect: RemoteCall<DoorService["connect"]>;
		register: RemoteCall<(client: string, gateway: string, session: string) => Effect.Effect<void>>;
		join: RemoteCall<Gateways["join"]>;
		leave: RemoteCall<Gateways["leave"]>;
		online: RemoteCall<Gateways["online"]>;
		info: RemoteCall<() => Processes["info"]>;
		start: RemoteCall<(request: Start, from: From) => ReturnType<Processes["start"]>>;
		exit: RemoteCall<Processes["exit"]>;
		commit: RemoteCall<
			(
				pid: string,
				input: Omit<Parameters<DoorService["append"]>[0], "process">,
			) => ReturnType<DoorService["append"]>
		>;
		inbox: RemoteCall<(pid: string, input: Incoming) => Effect.Effect<Appended>>;
		own: RemoteCall<
			(pid: string, id: string, stream: string, fact: unknown) => Effect.Effect<Appended>
		>;
		publish: RemoteCall<(client: string, update: unknown) => Effect.Effect<void>>;
		brain: RemoteCall<(fact: typeof BrainFact.Type) => Effect.Effect<Appended>>;
	};
export type ProcessBinding = Rpc.DurableObjectBranded &
	Remote<Pick<Runner, "msg" | "open" | "due">> & {
		configure: RemoteCall<(descriptor: Descriptor) => Effect.Effect<void>>;
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
