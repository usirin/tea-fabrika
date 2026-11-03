// Part 2's core: the `Process` Durable Object again, now holding a program version as a set of
// modules, each kept once under its content-addressed name. The hands ask which names it lacks
// and send only those. The core also holds the Effect runtime the pure-step sandbox lacks: it
// rebuilds a program's schemas from data and decodes what comes in before the sandbox steps.
//
//   POST /p/<pid>/have     {names}                       which of these the core lacks
//   POST /p/<pid>/install  {main, names, modules}        keep the modules sent; the version is `main`
//   POST /p/<pid>/cold     {ids, call}                   the first call of each version, in ms
//   POST /p/<pid>/schemas  {docs, samples}               rebuild schemas from data, decode samples
//   POST /p/<pid>/trace    {id, msgs}                    a pure program's init, then each step
//   POST /p/<pid>/bench    {id, kind, steps, ...}        steps in a loop, in us per step
import {DurableObject} from "cloudflare:workers";
import {Schema, SchemaRepresentation} from "effect";

const COMPAT = "2026-07-01";

const sha256 = async (text: string): Promise<string> => {
	const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

/** `effect@4.0.6-1a12e33e16e3.js`: the hash is the first 12 hex of the content's sha256. */
const hashIn = (name: string) => name.match(/-([0-9a-f]{12})\.js$/)?.[1];

/** Every reviver Effect ships: a check such as `isMaxLength` comes back from data with its own. */
const isReviver = (v: unknown): v is SchemaRepresentation.AnyReviver =>
	typeof v === "object" && v !== null && "id" in v && "revive" in v;
const revivers = Object.entries(SchemaRepresentation).flatMap(([k, v]) =>
	k.endsWith("Reviver") && isReviver(v) ? [v] : [],
);

const revive = (doc: unknown): Schema.Top =>
	SchemaRepresentation.fromRepresentation(SchemaRepresentation.fromJson(doc as never), {revivers});

const decoderOf = (schema: Schema.Top) =>
	Schema.decodeUnknownSync(schema as never) as (u: unknown) => unknown;

const accepts = (decode: (u: unknown) => unknown, value: unknown) => {
	try {
		decode(value);
		return true;
	} catch {
		return false;
	}
};

/** A loaded program's entrypoint, seen from the core: each call is an RPC across the line. */
interface Loaded {
	readonly [call: string]: (...args: any[]) => Promise<any>;
}

export class Process extends DurableObject<any> {
	decoders = new Map<string, (u: unknown) => unknown>();

	private pid(): string {
		return this.ctx.id.name ?? this.ctx.id.toString();
	}

	/** The isolate for one version. `perProcess`: one isolate for this process alone. */
	worker(id: string, perProcess = false) {
		return this.env.LOADER.get(perProcess ? `${id}:${this.pid()}` : id, async () => {
			const names = this.ctx.storage.kv.get(`ver:${id}`) as string[] | undefined;
			if (!names) throw new Error(`no version ${id}`);
			const modules: Record<string, string> = {};
			for (const n of names) modules[n] = this.ctx.storage.kv.get(`mod:${n}`) as string;
			return {compatibilityDate: COMPAT, mainModule: id, modules, env: {}, globalOutbound: null};
		});
	}

	private entry(id: string, perProcess = false): Loaded {
		return this.worker(id, perProcess).getEntrypoint("Program");
	}

	have(body: {names: string[]}) {
		return {missing: body.names.filter((n) => this.ctx.storage.kv.get(`mod:${n}`) === undefined)};
	}

	async install(body: {main: string; names: string[]; modules: Record<string, string>}) {
		for (const [name, code] of Object.entries(body.modules)) {
			const real = (await sha256(code)).slice(0, 12);
			if (hashIn(name) !== real) return {kept: false, why: "hash_mismatch", name};
			this.ctx.storage.kv.put(`mod:${name}`, code);
		}
		const missing = this.have({names: body.names}).missing;
		if (missing.length > 0) return {kept: false, why: "missing", missing};
		this.ctx.storage.kv.put(`ver:${body.main}`, body.names);
		return {kept: true};
	}

	/** The first call of each version this workerd never loaded. */
	async cold(body: {ids: string[]; call: string}) {
		const ms: number[] = [];
		for (const id of body.ids) {
			const t0 = performance.now();
			await this.entry(id)[body.call]();
			ms.push(performance.now() - t0);
		}
		return {ms};
	}

	which(body: {id: string; perProcess?: boolean}) {
		return this.entry(body.id, body.perProcess).isolate();
	}

	bump(body: {id: string}) {
		return this.entry(body.id).bump();
	}

	effect(body: {id: string}) {
		return this.entry(body.id).effect();
	}

	/** Rebuild each schema from its data; say what the rebuilt one makes of each sample. */
	schemas(body: {docs: Record<string, unknown>; samples: Record<string, unknown[]>}) {
		const out: Record<string, boolean[]> = {};
		for (const [name, doc] of Object.entries(body.docs)) {
			const decode = decoderOf(revive(doc));
			this.decoders.set(name, decode);
			out[name] = (body.samples[name] ?? []).map((v) => accepts(decode, v));
		}
		return out;
	}

	/** A pure program from its init through each Msg: every step's answer, for a parity check. */
	async trace(body: {id: string; msgs: {type: string}[]}) {
		const p = this.entry(body.id);
		try {
			const first = await p.init();
			const steps = [first];
			let state = first.state;
			for (const msg of body.msgs) {
				const out = await p.step(state, msg);
				steps.push(out);
				state = out.state;
			}
			return {steps};
		} catch (e) {
			return {threw: String(e).split("\n")[0]?.slice(0, 200)};
		}
	}

	/**
	 * Steps in a loop. `single` sends the state and gets `model` back (part 1's shape);
	 * `pure` sends the state and gets `state` back. With `decode`, the core first decodes each raw
	 * input with that rebuilt schema, as it would for a Msg from outside, and `as: "type"` makes
	 * the Msg `{type: <decoded>}`. `decodeOnly`: the decode alone, no step.
	 */
	async bench(body: {
		id: string;
		kind: "single" | "pure" | "decodeOnly";
		steps: number;
		state: unknown;
		inputs: unknown[];
		decode?: string;
		as?: "type";
		/** The call that loads the isolate before the clock starts. */
		warm?: string;
	}) {
		const decode = body.decode ? this.decoders.get(body.decode) : undefined;
		if (body.decode && !decode) throw new Error(`no schema ${body.decode}`);
		const msgOf = (i: number) => {
			const raw = body.inputs[i % body.inputs.length];
			const value = decode ? decode(raw) : raw;
			return body.as === "type" ? {type: value} : value;
		};
		let state = body.state;
		const t0 = performance.now();
		if (body.kind === "decodeOnly") {
			for (let i = 0; i < body.steps; i++) state = msgOf(i);
		} else {
			const p = this.entry(body.id);
			await p[body.warm ?? "isolate"]();
			for (let i = 0; i < body.steps; i++) {
				const out = await p.step(state, msgOf(i));
				state = body.kind === "pure" ? out.state : out.model;
			}
		}
		const ms = performance.now() - t0;
		return {perStepUs: (ms * 1000) / body.steps, bytes: JSON.stringify(state).length};
	}

	async fetch(request: Request): Promise<Response> {
		const part = new URL(request.url).pathname.split("/")[3] ?? "";
		const body = await request.json();
		const handlers: Record<string, (b: any) => unknown> = {
			have: (b) => this.have(b),
			install: (b) => this.install(b),
			cold: (b) => this.cold(b),
			which: (b) => this.which(b),
			bump: (b) => this.bump(b),
			effect: (b) => this.effect(b),
			schemas: (b) => this.schemas(b),
			trace: (b) => this.trace(b),
			bench: (b) => this.bench(b),
		};
		const handler = handlers[part];
		if (!handler) return Response.json({error: `no part ${part}`}, {status: 404});
		try {
			return Response.json(await handler(body));
		} catch (e) {
			return Response.json(
				{error: e instanceof Error ? (e.stack ?? e.message) : String(e)},
				{status: 500},
			);
		}
	}
}

export default {
	fetch(request: Request, env: any) {
		const pid = new URL(request.url).pathname.split("/")[2] ?? "";
		return env.PROCESS.getByName(`process:${pid}`).fetch(request);
	},
};
