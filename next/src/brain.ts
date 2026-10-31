import {Option, Schema} from "effect";
import {
	objectName,
	type ProcessCalls,
	type ProcessEnv,
	Process as ProcessObject,
} from "./app/process.ts";
import type {Ledger} from "./data/project.ts";
import {Project as ProjectObject} from "./data/project.ts";
import {type Answer, Gateway as GatewayObject} from "./transport/gateway.ts";
import {PAGE} from "./window/page.ts";

// The brain: the Worker that wires the five layers together, and the only file that knows them all.
// Locally it runs in Miniflare; the same bundle is what Cloudflare would run.
//
//   /                the window's page
//   /window.js       the window's script
//   /peer/<id>       one peer's WebSocket, to its own gateway (T1, T2)

type Env = ProcessEnv & {
	readonly PROCESS: ObjectSpace<ProcessCalls>;
	readonly WINDOW_JS: string;
	/** The one Host this brain answers: a site that points its name here gets nothing (T3). */
	readonly HOST: string;
};

const Open = Schema.Struct({pid: Schema.String});
const Letter = Schema.Struct({
	pid: Schema.String,
	id: Schema.String,
	m: Schema.Unknown,
	said: Schema.String,
});
const Reading = Schema.Struct({stream: Schema.String, after: Schema.Int});

const refused = (): Answer => ({why: "bad_params"});

/** A process's answer as a wire answer: a reason stays a reason. */
const answered = <A extends object>(value: A | {readonly why: string}): Answer =>
	"why" in value && typeof value.why === "string" ? {why: value.why} : {ok: value};

export class Gateway extends GatewayObject<Env> {
	/** Each method is a Cmd (T8). A Msg's `by` is stamped here, not sent by the peer (D3). */
	protected async route(method: string, params: unknown, peer: string): Promise<Answer> {
		const ledger: Ledger = this.env.PROJECT.getByName("project");
		switch (method) {
			case "view.open":
				return Option.match(Schema.decodeUnknownOption(Open)(params), {
					onNone: async () => refused(),
					onSome: async ({pid}) =>
						answered(await this.env.PROCESS.getByName(objectName(pid)).open(peer)),
				});
			case "window.msg":
				return Option.match(Schema.decodeUnknownOption(Letter)(params), {
					onNone: async () => refused(),
					onSome: async ({pid, id, m, said}) =>
						answered(
							await this.env.PROCESS.getByName(objectName(pid)).msg({id, m, by: peer, said}),
						),
				});
			case "ledger.read":
				return Option.match(Schema.decodeUnknownOption(Reading)(params), {
					onNone: async () => refused(),
					onSome: async ({stream, after}) => ({ok: await ledger.read(stream, after)}),
				});
			case "ledger.wait":
				return Option.match(Schema.decodeUnknownOption(Reading)(params), {
					onNone: async () => refused(),
					onSome: async ({stream, after}) => ({ok: await ledger.wait(stream, after)}),
				});
			default:
				return {why: "no_method"};
		}
	}
}

export class Project extends ProjectObject<Env> {}

export class Process extends ProcessObject<Env> {}

export default {
	fetch(request: Request, env: Env): Response | Promise<Response> {
		if (request.headers.get("host") !== env.HOST) {
			return new Response("not this host", {status: 421});
		}
		const {pathname} = new URL(request.url);
		if (pathname === "/") {
			return new Response(PAGE, {
				headers: {"content-type": "text/html; charset=utf-8", "cache-control": "no-store"},
			});
		}
		if (pathname === "/window.js") {
			return new Response(env.WINDOW_JS, {
				headers: {"content-type": "text/javascript; charset=utf-8", "cache-control": "no-store"},
			});
		}
		const peer = /^\/peer\/([\w-]+)$/.exec(pathname)?.[1];
		if (peer !== undefined) return env.GATEWAY.getByName(`gateway:${peer}`).fetch(request);
		return new Response("not here", {status: 404});
	},
};
