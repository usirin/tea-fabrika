import {generateKeyPairSync, sign} from "node:crypto";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {join, resolve} from "node:path";
import {NodeServices} from "@effect/platform-node";
import {grantText, Grant} from "@kampus/libfabrika/coordination";
import {KeyLine, writeSshsig} from "@kampus/libfabrika/transport";
import {Effect, Schema, type Scope} from "effect";
import {build as bundle} from "esbuild";
import {chromium, type Page} from "playwright";
import {check, compile} from "../src/exam/compiler.ts";

export class StageTestDown extends Schema.TaggedError<StageTestDown>()("StageTestDown", {
	message: Schema.String,
}) {}
const failure = (error: unknown) => new StageTestDown({message: String(error)});
// oxlint-disable-next-line fabrika/no-promises -- edge: Node loads P12 only after the test home is set
const loadBuild = () => import("../src/build.ts");
// oxlint-disable-next-line fabrika/no-promises -- edge: Node loads Alchemy after telemetry is disabled
const loadStage = () => import("../src/local-stage.ts");
// oxlint-disable-next-line fabrika/no-promises -- edge: Node loads public schemas for checked fixture declarations
const loadClient = () => import("@kampus/libfabrika");

export interface P18Stage {
	readonly url: string;
	readonly exit: (process: string, why: string) => Effect.Effect<void, StageTestDown>;
	readonly stop: Effect.Effect<void, StageTestDown>;
	readonly grant: (fingerprint: string) => Effect.Effect<void, StageTestDown>;
	readonly sleep: (client: {
		readonly client: string;
		readonly session: string;
	}) => Effect.Effect<void, StageTestDown>;
	readonly windowHash: string;
}

// P12's plan names build/localStage but leaves their argument and result types open.
// These calls make the fixture's required contract explicit. They start the actual Alchemy
// stack, compiled app and workerd. There is no HTTP or in-memory gateway substitute.
export const startP18Stage = Effect.fn("test.p18.stage")(function* (options: {
	readonly home: string;
	readonly port: number;
}) {
	const previousHome = process.env.FABRIKA_HOME;
	const previousTracking = process.env.DO_NOT_TRACK;
	yield* Effect.acquireRelease(
		Effect.sync(() => {
			process.env.FABRIKA_HOME = options.home;
			process.env.DO_NOT_TRACK = "1";
		}),
		() =>
			Effect.sync(() => {
				if (previousHome === undefined) delete process.env.FABRIKA_HOME;
				else process.env.FABRIKA_HOME = previousHome;
				if (previousTracking === undefined) delete process.env.DO_NOT_TRACK;
				else process.env.DO_NOT_TRACK = previousTracking;
			}),
	);
	const {build} = yield* browserStep(loadBuild);
	const {localStage} = yield* browserStep(loadStage);
	const {TileId} = yield* browserStep(loadClient);
	// Fresh in-memory owner key. No private key file is created, read or copied.
	const owner = generateKeyPairSync("ed25519");
	const length = (n: number) => {
		const bytes = Buffer.alloc(4);
		bytes.writeUInt32BE(n);
		return bytes;
	};
	const raw = owner.publicKey.export({format: "der", type: "spki"}).subarray(-32);
	const line = KeyLine.make(
		`ssh-ed25519 ${Buffer.concat([length(11), Buffer.from("ssh-ed25519"), length(32), raw]).toString("base64")}`,
	);
	const root = resolve(import.meta.dirname, "../../../..");
	const built = yield* build({
		root,
		out: join(options.home, "built"),
		brain: join(root, "fixtures/next/p18/control.ts"),
		browser: join(root, "next/apps/fabrika/src/entry/browser.tsx"),
		// The fixture has its own fixed registrations, leaving production's counter names alone.
		registrations: Array.from({length: 16}, (_, n) => ({
			tile: Schema.decodeUnknownSync(TileId)(
				`tile_0000000000e0080000000000${n.toString(32).padStart(2, "0")}`,
			),
			name: `p18counter:${n + 1}`,
			program: "counter",
		})),
	}).pipe(Effect.provide(NodeServices.layer));
	const stage = yield* Effect.acquireRelease(
		localStage(built, {
			home: options.home,
			port: options.port,
			name: "p18",
			person: "person_p18-test",
			founder: line,
			build: "p18-test",
		}).pipe(Effect.provide(NodeServices.layer)),
		(stage) => stage.stop.pipe(Effect.orDie),
	);
	// Only the local test fixture sees this binding. No public exit or append route exists.
	const project = stage.bindings.PROJECT.getByName("p18");
	// oxlint-disable-next-line fabrika/no-promises -- edge: a test-only binding starts real counter processes
	yield* Effect.tryPromise({
		try: () => project.p18StartCounters(built.programs.counter.hash),
		catch: failure,
	});
	return {
		url: stage.url,
		windowHash: built.windows.counter.hash,
		exit: (process: string, why: string) =>
			// oxlint-disable-next-line fabrika/no-promises -- edge: a trusted object call ends a process
			Effect.tryPromise({try: () => project.p18Exit(process, why), catch: failure}),
		sleep: Effect.fn("test.p18.sleep")(function* (client: {
			readonly client: string;
			readonly session: string;
		}) {
			const Snapshot = Schema.Struct({
				connections: Schema.Array(Schema.Struct({gateway: Schema.String})),
				rings: Schema.Array(
					Schema.Struct({to: Schema.String, stream: Schema.String, after: Schema.Int}),
				),
			});
			while (true) {
				const snapshot = yield* Schema.decodeUnknownEffect(Snapshot)(
					yield* browserStep(() => project.p18Wait(client.client, client.session)),
				).pipe(Effect.mapError(failure));
				const connection = snapshot.connections[0];
				if (connection === undefined)
					return yield* new StageTestDown({message: "no checked gateway for this client session"});
				if (snapshot.rings.length > 0) {
					if (!snapshot.rings.every((ring) => ring.to === connection.gateway))
						return yield* new StageTestDown({
							message: "inbox wait registered under the wrong reader",
						});
					// P12's local provider must hibernate the real gateway without closing its socket.
					// A Project abort alone cannot prove that gateway attachments survive sleep.
					yield* stage
						.sleep({gateway: connection.gateway, project: "p18"})
						.pipe(Effect.mapError(failure));
					return;
				}
				yield* Effect.yieldNow;
			}
		}),
		grant: Effect.fn("test.p18.grant")(function* (fingerprint: string) {
			const grant = Grant.make({
				id: `grant-${fingerprint}`,
				key: fingerprint,
				for: "person_p18-test",
				to: "p18",
				as: "window",
				saw: {
					code: "p18",
					label: "P18 test client",
					where: stage.url,
					how: "command",
					check: "none",
					has: [],
				},
				sentAt: "2026-11-08T00:00:00Z",
			});
			const text = grantText(grant);
			const armored = yield* writeSshsig({
				text,
				line,
				space: "fabrika-client",
				sign: (bytes) => Effect.sync(() => new Uint8Array(sign(null, bytes, owner.privateKey))),
			});
			yield* stage.grant({text, armored, signer: line}).pipe(Effect.mapError(failure));
		}),
		stop: stage.stop.pipe(Effect.mapError(failure)),
	} satisfies P18Stage;
});

export type Reading = {
	readonly id: string;
	readonly commits: number;
	readonly effects: number;
	readonly text: string;
};
export interface P18Probe {
	readonly identity: {readonly key: string; readonly fingerprint: string; readonly tab: string};
	readonly request: (method: string, params: Schema.Json) => Promise<Schema.Json>;
	readonly state: () => Schema.Json;
	readonly send: (msg: Schema.Json) => Promise<void>;
	readonly ping: () => Promise<void>;
	readonly reconnect: () => Promise<void>;
	readonly screenObservers: () => {readonly active: number; readonly disconnects: number};
	readonly readings: () => ReadonlyArray<Reading>;
	readonly reset: () => void;
	readonly ready: () => Promise<void>;
	readonly close: () => Promise<void>;
	readonly keySafety: () => Promise<{exported: boolean; wrapped: boolean; privateGetter: boolean}>;
}
declare global {
	interface Window {
		p18: P18Probe;
	}
}

// Test-only React instrumentation wraps the real counter registration. A body's useId
// identifies commits after Strict Mode's setup cycle. Counters never enter product code.
const browserSource = `
import {Effect, Scope, Exit, Layer, Stream} from "effect";
import {ClientKey, ClientConnection, IdGenerator, Layout, startWindow} from "@kampus/libfabrika";
import {browserLayer, browserConnection} from "@kampus/libfabrika/browser";
import {Window} from "@kampus/tuval";
import {counterWindow} from "@kampus/counter/window";
import {createElement as h, Profiler, StrictMode, useId, useLayoutEffect} from "react";
import {createRoot} from "react-dom/client";
const counts = new Map();
const InstrumentedCounter = props => {
  const id = useId();
  useLayoutEffect(() => { const c = counts.get(id) ?? {commits:0,effects:0}; c.effects++; counts.set(id,c); });
  return h(Profiler, {id, onRender: id => { const c = counts.get(id) ?? {commits:0,effects:0}; c.commits++; counts.set(id,c); }},
    h("section", {"data-p18-body":id}, counterWindow.render(props), h("input", {"aria-label":"Local note", defaultValue:""})));
};
const registration = {...counterWindow, render: props => h(InstrumentedCounter, props)};
const mount = document.body.appendChild(document.createElement("main"));
mount.id="p18-root";
mount.style.cssText="width:100vw;height:100vh;box-sizing:border-box";
document.body.style.margin="0";
const NativeObserver=globalThis.ResizeObserver;
const observers=new Set(); let disconnects=0;
globalThis.ResizeObserver=class extends NativeObserver {
 observe(element,options){if(element===mount)observers.add(this);super.observe(element,options);}
 disconnect(){if(observers.delete(this))disconnects++;super.disconnect();}
};
const scope = Effect.runSync(Scope.make());
const service = await Effect.runPromise(Effect.gen(function* () {
  const layer = browserLayer({root: mount, database:"p18-browser", os:"unknown"}).pipe(Layer.provideMerge(IdGenerator.layer));
  const context = yield* Layer.build(layer);
  return context;
}).pipe(Scope.provide(scope)));
const key = await Effect.runPromise(ClientKey.pipe(Effect.provideContext(service)));
const identity = await Effect.runPromise(key.identity);
const connection = await Effect.runPromise(ClientConnection.pipe(Effect.provide(browserConnection(location.origin.replace(/^http/,"ws"))), Effect.provideContext(service), Scope.provide(scope)));
const events=[];
await Effect.runPromise(Stream.runForEach(connection.events,event=>Effect.sync(()=>{events.push(event);})).pipe(Effect.forkIn(scope)));
const tile = n => "tile_0000000000e0080000000000" + n.toString(32).padStart(2,"0");
const layout = Layout.cases.split.make({dir:"row",parts:Array.from({length:16},(_,n)=>({percent:6.25,inner:Layout.cases.tile.make({id:tile(n),name:"p18counter:"+(n+1),keep:globalThis.p18Keep ?? "failed"})}))});
const run = await Effect.runPromise(startWindow({url:location.origin,layout,views:{counter:counterWindow.contract},identity}).pipe(
 Effect.provideService(ClientConnection,connection), Effect.provideContext(service), Scope.provide(scope)));
await Effect.runPromise(run.ready);
const root = createRoot(mount);
root.render(h(StrictMode,null,h(Window,{run,views:{counter:{[globalThis.p18WindowHash]:registration}}})));
window.p18 = {
 identity,
 request: (method,params) => Effect.runPromise(connection.request(method,params)),
 state: () => run.getState(),
 send: msg => Effect.runPromise(run.dispatch(msg)),
 ping: () => Effect.runPromise(Effect.gen(function*(){
   const before=events.length; yield* connection.ping(run.getState().link.dial);
   while(!events.slice(before).some(e=>e._tag==="pong"))yield* Effect.yieldNow;
 })),
 reconnect: () => Effect.runPromise(Effect.gen(function*(){
   const before=run.getState().session; yield* connection.close;
   while(run.getState().session===null || run.getState().session.session===before?.session)yield* Effect.yieldNow;
 })),
 screenObservers: () => ({active:observers.size,disconnects}),
 ready: async () => { await Effect.runPromise(run.ready); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); },
 readings: () => [...document.querySelectorAll("[data-p18-body]")].map(node=>({id:node.dataset.p18Body,...(counts.get(node.dataset.p18Body)??{commits:0,effects:0}),text:node.textContent})),
 reset: () => { for(const c of counts.values()){c.commits=0;c.effects=0;} },
 close: async () => {root.unmount(); await Effect.runPromise(Scope.close(scope,Exit.void));},
 keySafety: async () => {
   const keys = Object.keys(key); let exported=false,wrapped=false;
   // Inspect the actual IndexedDB CryptoKey, never a service substitute or a fallback string.
   const db = await new Promise((ok,no)=>{const r=indexedDB.open("p18-browser");r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});
   const stored=[];
   for(const name of db.objectStoreNames){const rows=await new Promise((ok,no)=>{const r=db.transaction(name).objectStore(name).getAll();r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});stored.push(...rows);}
   db.close();
   const found=[]; const visit=x=>{if(x instanceof CryptoKey)found.push(x);else if(x&&typeof x==="object")for(const v of Object.values(x))visit(v);};stored.forEach(visit);
   const privateKeys=found.filter(k=>k.type==="private"); if(privateKeys.length!==1)throw new Error("expected one actual stored private CryptoKey");
   const privateKey=privateKeys[0];
   if(privateKey.extractable)throw new Error("stored private key is extractable");
   try{await crypto.subtle.exportKey("pkcs8",privateKey);exported=true;}catch(e){if(e.name!=="InvalidAccessException")throw e;}
   const wrap=await crypto.subtle.generateKey({name:"AES-KW",length:256},false,["wrapKey"]);
   try{await crypto.subtle.wrapKey("pkcs8",privateKey,wrap,"AES-KW");wrapped=true;}catch(e){if(e.name!=="InvalidAccessException")throw e;}
   return {exported,wrapped,privateGetter:keys.some(k=>/private|export|pair/i.test(k))};
 }
};
`;

export const openP18Browser = Effect.fn("test.p18.browser")(function* (
	stage: P18Stage,
	options: {readonly keep?: string} = {},
) {
	const browser = yield* Effect.acquireRelease(
		// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright launches Chromium
		Effect.tryPromise({try: () => chromium.launch({headless: true}), catch: failure}),
		// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright closes Chromium
		(browser) => Effect.tryPromise({try: () => browser.close(), catch: failure}).pipe(Effect.orDie),
	);
	// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright opens a browser tab
	const page = yield* Effect.tryPromise({
		try: () => browser.newPage({viewport: {width: 4096, height: 900}}),
		catch: failure,
	});
	const errors: Array<string> = [];
	page.on("pageerror", (error) => errors.push(error.message));
	// oxlint-disable-next-line fabrika/no-promises -- edge: esbuild bundles the browser test wrapper
	const compiled = yield* Effect.tryPromise({
		try: () =>
			bundle({
				stdin: {
					contents: browserSource,
					resolveDir: resolve(import.meta.dirname, ".."),
					sourcefile: "p18-probe.js",
				},
				bundle: true,
				outdir: "p18-probe",
				platform: "browser",
				format: "esm",
				write: false,
				plugins: [
					{
						name: "p18-real-compiler",
						setup(build) {
							build.onLoad({filter: /\.tsx$/}, (args) => {
								const text = readFileSync(args.path, "utf8");
								const findings = check(new Map([[args.path, text]]), []);
								if (findings.length > 0)
									return {
										errors: findings.map((finding) => ({text: `${finding.fn}: ${finding.why}`})),
									};
								return {contents: compile(args.path, text).code, loader: "js"};
							});
						},
					},
				],
			}),
		catch: failure,
	});
	const contents = compiled.outputFiles?.find((file) => file.path.endsWith(".js"))?.text;
	if (contents === undefined)
		return yield* new StageTestDown({message: "browser probe bundle is missing"});
	// The real product TSX passes the Compiler above. Only test instrumentation is added.
	yield* browserStep(() =>
		page.route(stage.url, (route) =>
			route.fulfill({contentType: "text/html", body: "<!doctype html><html><body></body></html>"}),
		),
	);
	yield* browserStep(() => page.goto(stage.url));
	for (const css of compiled.outputFiles?.filter((file) => file.path.endsWith(".css")) ?? [])
		yield* browserStep(() => page.addStyleTag({content: css.text}));
	yield* browserStep(() =>
		page.evaluate((keep) => {
			Reflect.set(globalThis, "p18Keep", keep);
		}, options.keep ?? "failed"),
	);
	yield* browserStep(() =>
		page.evaluate((hash) => {
			Reflect.set(globalThis, "p18WindowHash", hash);
		}, stage.windowHash),
	);
	yield* browserStep(() => page.addScriptTag({type: "module", content: contents}));
	yield* browserStep(() => page.waitForFunction(() => window.p18 !== undefined));
	// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright reads the public browser identity
	const identity = yield* Effect.tryPromise({
		try: () => page.evaluate(() => window.p18.identity),
		catch: failure,
	});
	yield* stage.grant(identity.fingerprint);
	yield* browserStep(() =>
		page.waitForFunction(() => {
			const state = window.p18.state();
			return (
				typeof state === "object" && state !== null && "session" in state && state.session !== null
			);
		}),
	);
	yield* browserStep(() => page.evaluate(() => window.p18.ready()));
	yield* browserStep(() => page.waitForFunction(() => window.p18.readings().length === 16));
	return {browser, page, errors};
});

export const withP18Stage = Effect.fn("test.p18.home")(function* <A, E>(
	body: (stage: P18Stage) => Effect.Effect<A, E, Scope.Scope>,
) {
	const home = yield* Effect.acquireRelease(
		Effect.sync(() => mkdtempSync("/tmp/fh.")),
		(home) => Effect.sync(() => rmSync(home, {recursive: true, force: true})),
	);
	const previous = process.env.FABRIKA_HOME;
	yield* Effect.acquireRelease(
		Effect.sync(() => {
			process.env.FABRIKA_HOME = home;
		}),
		() =>
			Effect.sync(() => {
				if (previous === undefined) delete process.env.FABRIKA_HOME;
				else process.env.FABRIKA_HOME = previous;
			}),
	);
	return yield* body(yield* startP18Stage({home, port: 19118}));
});

export const readBrowser = Effect.fn("test.p18.read")((page: Page) =>
	// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright reads browser measurements
	Effect.tryPromise({try: () => page.evaluate(() => window.p18.readings()), catch: failure}),
);
export const browserStep = Effect.fn("test.p18.step")(<A>(body: () => Promise<A>) =>
	// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright runs one browser operation
	Effect.tryPromise({try: body, catch: failure}),
);
