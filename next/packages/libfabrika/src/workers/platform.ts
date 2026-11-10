import {Context, Effect} from "effect";
import {LedgerError} from "../data/index.ts";
import type {GatewayBinding, ProcessBinding, ProjectBinding, RecordBinding} from "./bindings.ts";

type Client<S> = {
	readonly [K in keyof S]: S[K] extends (...args: infer A) => infer B
		? (...args: A) => Effect.Effect<Awaited<B>, LedgerError>
		: never;
};

const unreachable = () => new LedgerError({why: "unreachable"});

export class ProjectClient extends Context.Service<
	ProjectClient,
	Client<Omit<ProjectBinding, keyof Rpc.DurableObjectBranded>>
>()("fabrika/ProjectClient") {
	static make(stub: ProjectBinding): ProjectClient["Service"] {
		return {
			clientConnect: () =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Project clientConnect RPC enters Effect
				Effect.tryPromise({try: () => stub.clientConnect(), catch: unreachable}),
			target: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Project target RPC enters Effect
				Effect.tryPromise({try: () => stub.target(...args), catch: unreachable}),
			challenge: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Project challenge RPC enters Effect
				Effect.tryPromise({try: () => stub.challenge(...args), catch: unreachable}),
			initialize: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Project initialize RPC enters Effect
				Effect.tryPromise({try: () => stub.initialize(...args), catch: unreachable}),
			route: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Project route RPC enters Effect
				Effect.tryPromise({try: () => stub.route(...args), catch: unreachable}),
			knock: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Project knock RPC enters Effect
				Effect.tryPromise({try: () => stub.knock(...args), catch: unreachable}),
			grant: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Project grant RPC enters Effect
				Effect.tryPromise({try: () => stub.grant(...args), catch: unreachable}),
			disconnect: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Project disconnect RPC enters Effect
				Effect.tryPromise({try: () => stub.disconnect(...args), catch: unreachable}),
			register: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Project register RPC enters Effect
				Effect.tryPromise({try: () => stub.register(...args), catch: unreachable}),
			join: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Project join RPC enters Effect
				Effect.tryPromise({try: () => stub.join(...args), catch: unreachable}),
			leave: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Project leave RPC enters Effect
				Effect.tryPromise({try: () => stub.leave(...args), catch: unreachable}),
			online: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Project online RPC enters Effect
				Effect.tryPromise({try: () => stub.online(...args), catch: unreachable}),
			info: () =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Project info RPC enters Effect
				Effect.tryPromise({try: () => stub.info(), catch: unreachable}),
			start: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Project start RPC enters Effect
				Effect.tryPromise({try: () => stub.start(...args), catch: unreachable}),
			exit: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Project exit RPC enters Effect
				Effect.tryPromise({try: () => stub.exit(...args), catch: unreachable}),
			sign: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Project sign RPC enters Effect
				Effect.tryPromise({try: () => stub.sign(...args), catch: unreachable}),
			commit: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Project commit RPC enters Effect
				Effect.tryPromise({try: () => stub.commit(...args), catch: unreachable}),
			inbox: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Project inbox RPC enters Effect
				Effect.tryPromise({try: () => stub.inbox(...args), catch: unreachable}),
			own: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Project own RPC enters Effect
				Effect.tryPromise({try: () => stub.own(...args), catch: unreachable}),
			publish: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Project publish RPC enters Effect
				Effect.tryPromise({try: () => stub.publish(...args), catch: unreachable}),
			brain: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Project brain RPC enters Effect
				Effect.tryPromise({try: () => stub.brain(...args), catch: unreachable}),
			append: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Project append RPC enters Effect
				Effect.tryPromise({try: () => stub.append(...args), catch: unreachable}),
			read: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Project read RPC enters Effect
				Effect.tryPromise({try: () => stub.read(...args), catch: unreachable}),
			wait: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Project wait RPC enters Effect
				Effect.tryPromise({try: () => stub.wait(...args), catch: unreachable}),
		};
	}
}

export class ProcessClient extends Context.Service<
	ProcessClient,
	Client<Omit<ProcessBinding, keyof Rpc.DurableObjectBranded>>
>()("fabrika/ProcessClient") {
	static make(stub: ProcessBinding): ProcessClient["Service"] {
		return {
			configure: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Process configure RPC enters Effect
				Effect.tryPromise({try: () => stub.configure(...args), catch: unreachable}),
			descriptor: () =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Process descriptor RPC enters Effect
				Effect.tryPromise({try: () => stub.descriptor(), catch: unreachable}),
			msg: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Process msg RPC enters Effect
				Effect.tryPromise({try: () => stub.msg(...args), catch: unreachable}),
			open: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Process open RPC enters Effect
				Effect.tryPromise({try: () => stub.open(...args), catch: unreachable}),
			due: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Process due RPC enters Effect
				Effect.tryPromise({try: () => stub.due(...args), catch: unreachable}),
			activity: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Process activity RPC enters Effect
				Effect.tryPromise({try: () => stub.activity(...args), catch: unreachable}),
			recover: () =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Process recover RPC enters Effect
				Effect.tryPromise({try: () => stub.recover(), catch: unreachable}),
			savedAlarm: () =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Process savedAlarm RPC enters Effect
				Effect.tryPromise({try: () => stub.savedAlarm(), catch: unreachable}),
			abort: () =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Process abort RPC enters Effect
				Effect.tryPromise({try: () => stub.abort(), catch: unreachable}),
		};
	}
}

export class GatewayClient extends Context.Service<
	GatewayClient,
	Client<Omit<GatewayBinding, keyof Rpc.DurableObjectBranded>>
>()("fabrika/GatewayClient") {
	static make(stub: GatewayBinding): GatewayClient["Service"] {
		return {
			fetch: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Gateway fetch RPC enters Effect
				Effect.tryPromise({try: () => stub.fetch(...args), catch: unreachable}),
			ring: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Gateway ring RPC enters Effect
				Effect.tryPromise({try: () => stub.ring(...args), catch: unreachable}),
			notify: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Gateway notify RPC enters Effect
				Effect.tryPromise({try: () => stub.notify(...args), catch: unreachable}),
			probe: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Gateway probe RPC enters Effect
				Effect.tryPromise({try: () => stub.probe(...args), catch: unreachable}),
		};
	}
}

export class RecordClient extends Context.Service<
	RecordClient,
	Client<Omit<RecordBinding, keyof Rpc.DurableObjectBranded>>
>()("fabrika/RecordClient") {
	static make(stub: RecordBinding): RecordClient["Service"] {
		return {
			write: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Record write RPC enters Effect
				Effect.tryPromise({try: () => stub.write(...args), catch: unreachable}),
			read: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Record read RPC enters Effect
				Effect.tryPromise({try: () => stub.read(...args), catch: unreachable}),
			content: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Record content RPC enters Effect
				Effect.tryPromise({try: () => stub.content(...args), catch: unreachable}),
			deleteContent: (...args) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Record deleteContent RPC enters Effect
				Effect.tryPromise({try: () => stub.deleteContent(...args), catch: unreachable}),
		};
	}
}

export class StorageClient extends Context.Service<
	StorageClient,
	{
		readonly get: <A>(key: string) => Effect.Effect<A | undefined, LedgerError>;
		readonly put: (key: string, value: unknown) => Effect.Effect<void, LedgerError>;
		readonly delete: (key: string) => Effect.Effect<boolean, LedgerError>;
		readonly sync: () => Effect.Effect<void, LedgerError>;
		readonly setAlarm: (at: number) => Effect.Effect<void, LedgerError>;
		readonly deleteAlarm: () => Effect.Effect<void, LedgerError>;
	}
>()("fabrika/StorageClient") {
	static make(storage: DurableObjectStorage): StorageClient["Service"] {
		return {
			get: <A>(key: string) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Durable Object storage get enters Effect
				Effect.tryPromise({try: () => storage.get<A>(key), catch: unreachable}),
			put: (key, value) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Durable Object storage put enters Effect
				Effect.tryPromise({try: () => storage.put(key, value), catch: unreachable}),
			delete: (key) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Durable Object storage delete enters Effect
				Effect.tryPromise({try: () => storage.delete(key), catch: unreachable}),
			sync: () =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Durable Object storage sync enters Effect
				Effect.tryPromise({try: () => storage.sync(), catch: unreachable}),
			setAlarm: (at) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Durable Object alarm set enters Effect
				Effect.tryPromise({try: () => storage.setAlarm(at), catch: unreachable}),
			deleteAlarm: () =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Durable Object alarm delete enters Effect
				Effect.tryPromise({try: () => storage.deleteAlarm(), catch: unreachable}),
		};
	}
}

export class BucketClient extends Context.Service<
	BucketClient,
	{
		readonly put: (
			key: string,
			body: Uint8Array,
			sha256: string,
		) => Effect.Effect<unknown, LedgerError>;
		readonly head: (key: string) => Effect.Effect<R2Object | null, LedgerError>;
	}
>()("fabrika/BucketClient") {
	static make(bucket: R2Bucket): BucketClient["Service"] {
		return {
			put: (key, body, sha256) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: R2 put enters Effect
				Effect.tryPromise({try: () => bucket.put(key, body, {sha256}), catch: unreachable}),
			head: (key) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: R2 head enters Effect
				Effect.tryPromise({try: () => bucket.head(key), catch: unreachable}),
		};
	}
}
