// Experiment 148's egress Worker: does Cloudflare's own allow list lock a box to
// api.anthropic.com with no TLS opened on the way? Three boxes, the same image (box/egress.mjs),
// set up only through `@cloudflare/containers`, as its docs say:
//
//   /locked   enableInternet false, allowedHosts ["api.anthropic.com"], interceptHttps false
//   /opened   the same, interceptHttps true: the library's HTTPS path, for comparison
//   /open     enableInternet true, nothing else: the control, what the open internet shows
//
//   /raw      the same platform calls as /locked or /opened, made by hand (see Raw)
//
// No outbound handler in any. No token, no key, no model: the box only knocks on each door.

import {DurableObject} from "cloudflare:workers";
import {Container, ContainerProxy, getContainer} from "@cloudflare/containers";

export {ContainerProxy};

const ANTHROPIC = ["api.anthropic.com"];
/** Where Cloudflare puts the CA its HTTPS catch signs with, when there is one. */
const CA = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";

/**
 * The one thing added to the library: the image. Alchemy keeps each Container's image in
 * `ctx.container.images` under its id, and wants it named at `start()`, which the library does not
 * do. So `start` gets `image` and nothing else; every network setting is the library's own.
 */
const withImage = (box: Container, ctx: DurableObjectState, key: string) => {
	// biome-ignore lint/style/noNonNullAssertion: a Durable Object with a container always has one.
	const c = ctx.container!;
	const image = c.images[key];
	// `container` is the library's private field: replaced with the same object, image added.
	Object.assign(box, {
		container: new Proxy(c, {
			get(t, p) {
				if (p === "start" && image !== undefined)
					return (o: ContainerStartupOptions) => t.start({...o, image});
				const v = Reflect.get(t, p);
				return typeof v === "function" ? v.bind(t) : v;
			},
		}),
	});
};

export class Locked extends Container {
	constructor(ctx: DurableObjectState, env: unknown) {
		super(ctx, env);
		withImage(this, ctx, "Locked");
	}
	defaultPort = 8080;
	entrypoint = ["node", "/app/egress.mjs"];
	enableInternet = false;
	allowedHosts = ANTHROPIC;
	interceptHttps = false;
}

export class Opened extends Container {
	constructor(ctx: DurableObjectState, env: unknown) {
		super(ctx, env);
		withImage(this, ctx, "Opened");
	}
	defaultPort = 8080;
	entrypoint = ["node", "/app/egress.mjs"];
	enableInternet = false;
	allowedHosts = ANTHROPIC;
	interceptHttps = true;
	// The box trusts the catch's CA, as the docs say, so its calls get through the Worker.
	envVars = {NODE_EXTRA_CA_CERTS: CA};
}

export class Open extends Container {
	constructor(ctx: DurableObjectState, env: unknown) {
		super(ctx, env);
		withImage(this, ctx, "Open");
	}
	defaultPort = 8080;
	entrypoint = ["node", "/app/egress.mjs"];
	enableInternet = true;
}

/**
 * What `Locked` and `Opened` ask of the platform, made by hand: the library's own `ContainerProxy`
 * with the props it would give, set as the catch for all HTTP, and with `https`, for all HTTPS
 * too. `early` sets the catches before `start()`, as the library does; without it, after, as
 * worker.ts does. On Cloudflare the library's boxes never started (see the write-up), so this
 * says whether that was the order or the allow list.
 */
export class Raw extends DurableObject {
	async run(o: {https: boolean; early: boolean; ip: string}) {
		// biome-ignore lint/style/noNonNullAssertion: a Durable Object with a container always has one.
		const c = this.ctx.container!;
		const image = c.images.Raw;
		const proxy = this.ctx.exports.ContainerProxy({
			props: {
				className: "Raw",
				containerId: this.ctx.id.toString(),
				enableInternet: false,
				allowedHosts: ANTHROPIC,
				interceptAll: true,
			},
		});
		const catches = async () => {
			await c.interceptAllOutboundHttp(proxy);
			if (o.https) await c.interceptOutboundHttps("*", proxy);
		};
		const t0 = Date.now();
		if (o.early) await catches();
		c.start({
			...(image === undefined ? {} : {image}),
			enableInternet: false,
			entrypoint: ["node", "/app/egress.mjs"],
			...(o.https ? {env: {NODE_EXTRA_CA_CERTS: CA}} : {}),
		} as ContainerStartupOptions);
		if (!o.early) await catches();
		let status = 0;
		let tries = "";
		for (let i = 0; i < 120 && status === 0; i++) {
			try {
				const res = await c.getTcpPort(8080).fetch(`http://box/?ip=${o.ip}`);
				status = res.status;
				tries = await res.text();
			} catch (e) {
				tries = String(e);
				await new Promise((r) => setTimeout(r, 1000));
			}
		}
		if (c.running) await c.destroy();
		return {status, ms: Date.now() - t0, tries};
	}
}

interface Env {
	readonly LOCKED: DurableObjectNamespace<Locked>;
	readonly OPENED: DurableObjectNamespace<Opened>;
	readonly OPEN: DurableObjectNamespace<Open>;
	readonly RAW: DurableObjectNamespace<Raw>;
	/** The stand-in door: a made-up token per run, from the driver. */
	readonly SESSION: string;
}

export default {
	async fetch(req: Request, env: Env) {
		if (req.headers.get("authorization") !== `Bearer ${env.SESSION}`)
			return new Response("no", {status: 401});
		const url = new URL(req.url);
		const q = (k: string) => url.searchParams.get(k) ?? "";
		if (url.pathname === "/raw")
			return Response.json(
				await env.RAW.getByName(q("run")).run({
					https: q("https") === "1",
					early: q("early") === "1",
					ip: q("ip"),
				}),
			);
		const ns = {"/locked": env.LOCKED, "/opened": env.OPENED, "/open": env.OPEN}[url.pathname];
		if (ns === undefined) return new Response("not found", {status: 404});
		const box = getContainer(ns, url.searchParams.get("run") ?? "one");
		const t0 = Date.now();
		const res = await box.fetch(new Request(`http://box/?ip=${url.searchParams.get("ip") ?? ""}`));
		const tries = await res.text();
		// Gone at once: one box per try.
		await box.destroy();
		return Response.json({status: res.status, ms: Date.now() - t0, tries});
	},
};
