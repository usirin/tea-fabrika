// Part 1's driver. Each check returns numbers, and a failure is a finding.
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as RpcClient from "effect/rpc/RpcClient";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as Socket from "effect/socket/Socket";
import * as Stream from "effect/Stream";
import {chromium} from "playwright";
import {bundle, Raw, round, sleep, start, wakes} from "./harness.ts";
import {Group} from "./s1-group.ts";

const IDLE = Number(process.env.IDLE ?? "16000");

const pct = (xs: number[], p: number) => {
	const s = [...xs].sort((a, b) => a - b);
	return round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? Number.NaN, 2);
};

export const main = async () => {
	const worker = await bundle("s1-entry.ts");
	const out: Record<string, unknown> = {
		bundle: {bytes: worker.bytes, gzip: worker.gzip, buildMs: worker.buildMs},
	};
	const mf = await start(worker.code, {DOOR: "DoorObject"});
	const base = (await mf.ready).toString().replace(/^http/, "ws");
	const ws = (name: string, q = "") => `${base}ws?name=${name}${q}`;

	// 1. Does the object sleep at all on Miniflare, and does the control stay awake?
	{
		const a = await Raw.open(ws("sleepy"));
		const b = await Raw.open(ws("awake", "&timer=1"));
		const first = await a.call("append", {base: 0, text: "one"});
		await b.call("append", {base: 0, text: "one"});
		const before = {
			sleepy: (await wakes(mf, "sleepy")).wakes,
			awake: (await wakes(mf, "awake")).wakes,
		};
		await sleep(IDLE);
		const woken = await a.call("read", {after: 0});
		const held = await b.call("read", {after: 0});
		const after = {
			sleepy: (await wakes(mf, "sleepy")).wakes,
			awake: (await wakes(mf, "awake")).wakes,
		};
		const awakeMs: number[] = [];
		for (let i = 0; i < 100; i++) awakeMs.push((await a.call("read", {after: 0})).ms);
		out.sleep = {
			firstFrame: first.frame,
			before,
			after,
			socketStayedOpen: a.closed === undefined,
			wokenCallMs: round(woken.ms, 2),
			heldCallMs: round(held.ms, 2),
			awakeCallP50Ms: pct(awakeMs, 50),
			awakeCallP95Ms: pct(awakeMs, 95),
			wokenFrame: woken.frame,
		};
		a.close();
		b.close();
	}

	// 2. A ping while asleep: answered without waking? Both Effect's own ping and the plan's text one.
	{
		const a = await Raw.open(ws("ping"));
		await a.call("append", {base: 0, text: "x"});
		await sleep(IDLE);
		const before = (await wakes(mf, "ping")).wakes;
		// /wakes itself wakes the object, so sleep again before pinging.
		await sleep(IDLE);
		const ms: number[] = [];
		for (let i = 0; i < 20; i++) {
			a.frames = [];
			const t0 = performance.now();
			a.ws.send(JSON.stringify({jsonrpc: "2.0", method: "@effect/rpc/Ping"}));
			await a.until((f) => f?.method === "@effect/rpc/Pong");
			ms.push(performance.now() - t0);
		}
		// If a ping had woken it, one activation came from the pings. Sleep again so that the next
		// /wakes makes its own: then one new row means pings woke nothing, and two mean they did.
		await sleep(IDLE);
		const after = (await wakes(mf, "ping")).wakes;
		const t = await Raw.open(ws("pingtext", "&ping=text"));
		t.ws.send("ping");
		const text = await t.until((f) => f === "pong");
		// A socket that does nothing but ping, every 5 s like Effect's client: can the object sleep?
		const steady = await Raw.open(ws("pingsteady"));
		await steady.call("append", {base: 0, text: "x"});
		for (let i = 0; i < 4; i++) {
			await sleep(5000);
			steady.ws.send(JSON.stringify({jsonrpc: "2.0", method: "@effect/rpc/Ping"}));
		}
		const steadyWakes = (await wakes(mf, "pingsteady")).wakes;
		steady.close();
		out.ping = {
			wakesBefore: before,
			wakesAfter: after,
			activationsFromPings: after - before - 1,
			steadyPingingWakes: steadyWakes,
			p50Ms: pct(ms, 50),
			answered: ms.length,
			textPairAnswered: text === "pong",
		};
		a.close();
		t.close();
	}

	// 3. A plain Effect stream, held by a fiber, with nothing holding the object.
	{
		const a = await Raw.open(ws("tail-free"));
		const b = await Raw.open(ws("tail-free"));
		a.ws.send(JSON.stringify({jsonrpc: "2.0", id: 9, method: "tail", params: {after: 0}}));
		await sleep(200);
		await b.call("append", {base: 0, text: "before sleep"});
		const got1 = await a.until((f) => f?.id === 9 && f?.chunk === true, 1000);
		// Effect's server waits for this ack before the next chunk. A raw tab must send it too.
		a.ws.send(JSON.stringify({jsonrpc: "2.0", method: "@effect/rpc/Ack", params: {requestId: 9}}));
		const before = (await wakes(mf, "tail-free")).wakes;
		await sleep(IDLE);
		const after = (await wakes(mf, "tail-free")).wakes;
		const closed = a.closed;
		a.frames = [];
		let answer: unknown = "closed";
		if (b.closed === undefined) {
			const w = await b.call("append", {base: 1, text: "after sleep"});
			answer = w.frame;
		}
		const got2 = await a.until((f) => f?.id === 9 && f?.chunk === true, 1500);
		out.tailFree = {
			beforeSleepChunk: got1?.result,
			wakesBefore: before,
			wakesAfterIdle: after,
			closeAfterIdle: closed ?? null,
			closeAtEnd: a.closed ?? null,
			bClose: b.closed ?? null,
			appendAfterSleep: answer,
			chunkAfterSleep: got2?.result ?? null,
		};
		a.close();
		b.close();
	}

	// 4. The same stream with hold on: does the object stay awake, and for how long is it charged?
	{
		const a = await Raw.open(ws("tail-hold", "&hold=1"));
		const b = await Raw.open(ws("tail-hold"));
		a.ws.send(JSON.stringify({jsonrpc: "2.0", id: 9, method: "tail", params: {after: 0}}));
		await sleep(200);
		await b.call("append", {base: 0, text: "before sleep"});
		const got1 = await a.until((f) => f?.id === 9 && f?.chunk === true, 1000);
		a.ws.send(JSON.stringify({jsonrpc: "2.0", method: "@effect/rpc/Ack", params: {requestId: 9}}));
		const before = (await wakes(mf, "tail-hold")).wakes;
		await sleep(IDLE);
		const after = (await wakes(mf, "tail-hold")).wakes;
		a.frames = [];
		const w = await b.call("append", {base: 1, text: "after idle"}, 2000);
		const got2 = await a.until((f) => f?.id === 9 && f?.chunk === true, 1500);
		out.tailHold = {
			beforeSleepChunk: got1?.result,
			wakesBefore: before,
			wakesAfterIdle: after,
			append: w.frame,
			chunkAfterIdle: got2?.result ?? null,
			aClose: a.closed ?? null,
		};
		a.close();
		b.close();
	}

	// 5. The parked stream: only data in the attachment. Raw client first.
	{
		const a = await Raw.open(ws("park"));
		const b = await Raw.open(ws("park"));
		await b.call("append", {base: 0, text: "catch up"});
		a.ws.send(JSON.stringify({jsonrpc: "2.0", id: 9, method: "park", params: {after: 0}}));
		const catchUp = await a.until((f) => f?.id === 9 && f?.chunk === true, 1000);
		await sleep(IDLE);
		const asleepWakes = (await wakes(mf, "park")).wakes;
		await sleep(IDLE);
		a.frames = [];
		const t0 = performance.now();
		const w = await b.call("append", {base: 1, text: "after sleep"});
		const got = await a.until((f) => f?.id === 9 && f?.chunk === true, 2000);
		const pushMs = performance.now() - t0;
		out.parkedRaw = {
			catchUp: catchUp?.result,
			wakesWhileIdle: asleepWakes,
			wakesAfter: (await wakes(mf, "park")).wakes,
			append: w.frame,
			chunkAfterSleep: got?.result ?? null,
			pushMs: round(pushMs, 2),
			aClose: a.closed ?? null,
		};
		a.close();
		b.close();
	}

	// 6. The same parked stream with Effect's own RpcClient on the other end, and a push from an alarm.
	{
		const url = ws("effect-client");
		const clientLayer = RpcClient.layerProtocolSocket({retryTransientErrors: false}).pipe(
			Layer.provide(Socket.layerWebSocket(url)),
			Layer.provide(Socket.layerWebSocketConstructorGlobal),
			Layer.provide(RpcSerialization.layerJsonRpc()),
		);
		const seen: Array<{n: number; text: string}> = [];
		const run = Effect.gen(function* () {
			const client = yield* RpcClient.make(Group);
			const fiber = yield* client.park({after: 0}).pipe(
				Stream.runForEach((row) => Effect.sync(() => seen.push(row))),
				Effect.forkScoped,
			);
			yield* Effect.sleep("200 millis");
			const place = yield* client.append({base: 0, text: "from effect client"});
			yield* Effect.sleep("200 millis");
			const conflict = yield* client.append({base: 0, text: "stale"}).pipe(Effect.flip);
			const before = seen.length;
			yield* Effect.promise(() => sleep(IDLE));
			const during = yield* Effect.promise(() => wakes(mf, "effect-client"));
			yield* Effect.promise(() => sleep(IDLE));
			yield* Effect.promise(() => mf.dispatchFetch("http://x/alarm?name=effect-client&in=50"));
			yield* Effect.promise(() => sleep(IDLE));
			const afterAlarm = seen.length;
			// A foreign notification on the wire: does Effect's client survive it?
			yield* Effect.promise(() => mf.dispatchFetch("http://x/poke?name=effect-client"));
			yield* Effect.sleep("200 millis");
			const stillWorks = yield* client.read({after: 0});
			yield* Fiber.interrupt(fiber);
			return {
				place,
				conflict,
				seenBeforeSleep: before,
				wakesDuring: during.wakes,
				seenAfterAlarm: afterAlarm,
				lastSeen: seen.at(-1),
				rowsRead: stillWorks.length,
			};
		}).pipe(Effect.scoped, Effect.provide(clientLayer));
		out.parkedEffect = await Effect.runPromise(run.pipe(Effect.timeout("90 seconds"))).catch(
			(e) => ({
				failed: String(e),
				seen,
			}),
		);
	}

	// 7. Reconnect: the socket dies, the client asks from its last position, nothing is lost.
	{
		const a = await Raw.open(ws("reconnect"));
		const b = await Raw.open(ws("reconnect"));
		a.ws.send(JSON.stringify({jsonrpc: "2.0", id: 9, method: "park", params: {after: 0}}));
		await b.call("append", {base: 0, text: "one"});
		await a.until((f) => f?.id === 9 && f?.chunk === true, 1000);
		a.close();
		await sleep(100);
		await b.call("append", {base: 1, text: "two"});
		await b.call("append", {base: 2, text: "three"});
		const again = await Raw.open(ws("reconnect"));
		again.ws.send(JSON.stringify({jsonrpc: "2.0", id: 1, method: "park", params: {after: 1}}));
		const got = await again.until((f) => f?.id === 1 && f?.chunk === true, 1000);
		out.reconnect = {caughtUp: got?.result ?? null};
		again.close();
		b.close();
	}

	// 8. Speed: the door's cost per call against a bare object.
	{
		const a = await Raw.open(ws("speed"));
		const ms: number[] = [];
		for (let i = 0; i < 500; i++) ms.push((await a.call("append", {base: i, text: "x"})).ms);
		const bare: number[] = [];
		for (let i = 0; i < 200; i++) {
			const t0 = performance.now();
			await (await mf.dispatchFetch("http://x/plain?name=speed")).text();
			bare.push(performance.now() - t0);
		}
		const noEffect: number[] = [];
		for (let i = 0; i < 500; i++) {
			const t0 = performance.now();
			const id = 100000 + i;
			a.frames = [];
			a.ws.send(JSON.stringify({bare: id, text: "x"}));
			await a.until((f) => f?.id === id);
			noEffect.push(performance.now() - t0);
		}
		out.speed = {
			appendP50Ms: pct(ms, 50),
			appendP95Ms: pct(ms, 95),
			noEffectP50Ms: pct(noEffect, 50),
			noEffectP95Ms: pct(noEffect, 95),
			plainFetchP50Ms: pct(bare, 50),
		};
		a.close();
	}

	// 9. A real browser tab, with nothing installed, on the same door.
	{
		const browser = await chromium.launch({headless: true});
		const page = await browser.newPage();
		// A page from the same origin as the door: a tab that is served by the brain.
		await page.goto(`${base.replace(/^ws/, "http")}page`);
		const url = ws("tab");
		// And a page of no origin, which is what an opaque or foreign page sends.
		const blank = await browser.newPage();
		await blank.goto("about:blank");
		const foreign = await blank.evaluate(
			(url) =>
				new Promise<string>((resolve) => {
					const socket = new WebSocket(url);
					socket.addEventListener("open", () => {
						socket.close();
						resolve("opened");
					});
					socket.addEventListener("error", () => resolve("refused"));
					setTimeout(() => resolve("timed out"), 3000);
				}),
			url,
		);
		out.foreignOrigin = foreign;
		page.setDefaultTimeout(15000);
		const answer = await page.evaluate(async (url) => {
			const socket = new WebSocket(url);
			const seen: unknown[] = [];
			await new Promise((resolve, reject) => {
				socket.addEventListener("open", resolve);
				socket.addEventListener("error", () =>
					reject(new Error("the tab could not open the socket")),
				);
				setTimeout(() => reject(new Error("the tab timed out opening the socket")), 5000);
			});
			const wait = (test: (f: any) => boolean) =>
				new Promise<any>((resolve) => {
					socket.addEventListener("message", (e) => {
						const f = e.data === "pong" ? e.data : JSON.parse(e.data);
						seen.push(f);
						if (test(f)) resolve(f);
					});
				});
			const send = (m: unknown) => socket.send(JSON.stringify(m));
			const first = wait((f) => f.id === 1);
			send({jsonrpc: "2.0", id: 1, method: "append", params: {base: 0, text: "from a tab"}});
			const appended = await first;
			const stale = wait((f) => f.id === 2);
			send({jsonrpc: "2.0", id: 2, method: "append", params: {base: 0, text: "stale"}});
			const refused = await stale;
			const pong = wait((f) => f.method === "@effect/rpc/Pong");
			send({jsonrpc: "2.0", method: "@effect/rpc/Ping"});
			await pong;
			const chunk = wait((f) => f.id === 3 && f.chunk === true);
			send({jsonrpc: "2.0", id: 3, method: "park", params: {after: 0}});
			const parked = await chunk;
			const bad = wait((f) => f.id === 4);
			send({jsonrpc: "2.0", id: 4, method: "nope"});
			const unknown = await Promise.race([
				bad,
				new Promise((r) => setTimeout(() => r("no answer"), 1500)),
			]);
			socket.close();
			return {appended, refused, parked, unknown};
		}, url);
		out.tab = answer;
		await browser.close();
		const clientBundle = await bundle("s1-browser-client.ts", {platform: "browser"});
		out.browserClient = {bytes: clientBundle.bytes, gzip: clientBundle.gzip};
	}

	await mf.dispose();
	return out;
};
