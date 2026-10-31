// Experiment 154's Cloudflare path: the box as a container, one per sign-in, started by its own
// Durable Object, with experiment 148's shape (worker.ts's JobBox) and the same ledger object.
//
//   POST /start {box, who}  ──▶ SignInBox "<box>" ──start──▶ container (box/Dockerfile's image)
//                                     │                        ├─ http://ledger.internal ─▶ LedgerDoor ─▶ Ledger
//                                     │                        └─ https://auth.openai.com, https://api.openai.com:
//                                     │                           straight out, TLS end to end
//
// What differs from 148, and why:
//   - The box's network is open (`enableInternet: true`). 148 found that the only Cloudflare lock
//     on HTTPS ends TLS in our Worker, which would put the person's pass in the shared side's
//     hands. So the pass goes to OpenAI with no Worker of ours in the middle, and the box is not
//     locked to two hosts. What the agent's commands may reach is then the box's own rule.
//   - The box holds no ledger credential. Its calls to http://ledger.internal are caught outside
//     it, by `LedgerDoor`, whose props say which box and which person it is: it may register its
//     own name, read its own inbox and write to its person's inbox, and nothing else.
//   - Nothing secret is in the box's start environment: BOX, WHO, the sign-in's public endpoints.
//
// Not deployed. `wrangler deploy --dry-run` bundles it (experiments/154-sign-in-remote.md says how).
import {DurableObject, WorkerEntrypoint} from "cloudflare:workers";

export {Ledger} from "../../../packages/fabrika/src/host/durable-object.ts";

interface LedgerRpc {
	call(method: string, args: unknown[]): Promise<string>;
}

interface Env {
	readonly BOXES: DurableObjectNamespace<SignInBox>;
	readonly LEDGER: DurableObjectNamespace & {getByName(name: string): LedgerRpc};
	/** The project's ledger: one Durable Object by this name. */
	readonly LEDGER_NAME: string;
	/** The sign-in's public endpoints, as JSON (wire.ts's `Auth`). */
	readonly AUTH: string;
	/** The model to ask; "" picks one from the account's catalog. */
	readonly MODEL: string;
}

interface BoxProps {
	readonly box: string;
	readonly who: string;
}

/** The test's job knobs: how long to hold the pass, and whether the agent probe runs. */
interface Job {
	readonly holdMs?: number;
	readonly agent?: boolean;
	/** Way (b): no offline_access. */
	readonly renew?: "ask";
	/** Way (c): the person's app lends passes. */
	readonly passFrom?: "app";
}

const person = (who: string) => `signin/person/${who}`;
const own = (box: string) => `signin/box/${box}`;

/** Which ledger calls a box may make: its own lane, nothing else. */
export const allowed = (p: BoxProps, method: string, args: readonly unknown[]): boolean => {
	const [stream] = args;
	switch (method) {
		case "register":
			return stream === own(p.box);
		case "readStream":
			return stream === `${own(p.box)}/inbox`;
		case "append":
			return stream === `${person(p.who)}/inbox` && args[1] === "any";
		default:
			return false;
	}
};

/** The box's only way to the ledger, outside it. The writer is stamped here, never by the box. */
export class LedgerDoor extends WorkerEntrypoint<Env, BoxProps> {
	override async fetch(req: Request): Promise<Response> {
		const p = this.ctx.props;
		const method = new URL(req.url).pathname.split("/")[2] ?? "";
		const args = (await req.json()) as unknown[];
		if (!Array.isArray(args) || !allowed(p, method, args))
			return new Response("not yours", {status: 403});
		const writer = `agent:box/${p.box} for:${p.who}`;
		const stamped =
			method === "register"
				? [args[0], writer]
				: method === "append"
					? [args[0], args[1], {...(args[2] as object), writer}, null]
					: args;
		const out = await this.env.LEDGER.getByName(this.env.LEDGER_NAME).call(method, stamped);
		return new Response(out, {headers: {"content-type": "application/json"}});
	}
}

/** One sign-in's box: started once, gone when the box process ends. */
export class SignInBox extends DurableObject<Env> {
	private get box() {
		// oxlint-disable-next-line typescript/no-non-null-assertion -- a Durable Object with a container always has one.
		return this.ctx.container!;
	}

	async begin(p: BoxProps & Job): Promise<{started: boolean}> {
		if (this.box.running) return {started: false};
		const props: BoxProps = {box: p.box, who: p.who};
		this.box.start({
			enableInternet: true,
			env: {
				BOX: p.box,
				WHO: p.who,
				AUTH: this.env.AUTH,
				MODEL: this.env.MODEL,
				LEDGER_URL: "http://ledger.internal",
				LEDGER_NAME: this.env.LEDGER_NAME,
				// Not a credential: LedgerDoor ignores it. layerHttp sends one on every call.
				LEDGER_TOKEN: "none",
				HOLD_MS: String(p.holdMs ?? 0),
				RENEW: p.renew === "ask" ? "ask" : "refresh",
				PASS_FROM: p.passFrom === "app" ? "app" : "self",
				...(p.agent === true
					? {
							AGENT_CMD: JSON.stringify(["node", "/app/agent-probe.mjs"]),
							AGENT_DIR: "/work/agent",
							AGENT_USER: "agent",
						}
					: {}),
			},
		});
		await this.box.interceptOutboundHttp("ledger.internal", this.ctx.exports.LedgerDoor({props}));
		return {started: true};
	}
}

export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		const url = new URL(req.url);
		if (req.method === "POST" && url.pathname === "/start") {
			// A stand-in: who may start a box for whom is the ledger's door's job (PR 92), not built here.
			const p = (await req.json()) as BoxProps & Job;
			if (!/^[a-z0-9-]{1,40}$/.test(p.box) || !/^[a-z0-9:-]{1,40}$/.test(p.who))
				return new Response("bad names", {status: 400});
			return Response.json(await env.BOXES.getByName(p.box).begin(p));
		}
		// Everything else is the ledger's own HTTP face, its door in front (the person's app uses it).
		const name = url.pathname.split("/")[1] ?? "";
		if (name !== env.LEDGER_NAME) return new Response("not found", {status: 404});
		return env.LEDGER.get(env.LEDGER.idFromName(name)).fetch(req);
	},
};
