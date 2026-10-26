// Every outbound connection this Node process opens, by host name, seen through Node's own
// diagnostics channels. Child processes (workerd, the bundler) are not seen here; the driver
// samples their sockets with `lsof` for that. It starts watching when this module loads, so
// `run.ts` imports it before anything else.
//
//   import {watch} from "./net-watch.ts";
//   watch.hosts();   // ["fetch http://localhost:1337", "localhost -> 127.0.0.1", ...]
import {subscribe} from "node:diagnostics_channel";
import type {Socket} from "node:net";

const seen = new Set<string>();

const isSocket = (m: unknown): m is {socket: Socket} =>
	typeof m === "object" && m !== null && "socket" in m;
const originOf = (m: unknown) => {
	const request = typeof m === "object" && m !== null ? Reflect.get(m, "request") : undefined;
	const origin =
		typeof request === "object" && request !== null ? Reflect.get(request, "origin") : undefined;
	const host =
		typeof request === "object" && request !== null ? Reflect.get(request, "host") : undefined;
	return typeof origin === "string" ? origin : typeof host === "string" ? host : "?";
};

subscribe("net.client.socket", (message) => {
	if (!isSocket(message)) return;
	const socket = message.socket;
	// `lookup` fires with the host name before the address is known; `connect` with the address.
	socket.on("lookup", (_err: unknown, address: string, _family: unknown, host: string) => {
		seen.add(`${host} -> ${address}`);
	});
	socket.on("connect", () => {
		seen.add(
			socket.remoteAddress === undefined
				? "a unix socket"
				: `${socket.remoteAddress}:${socket.remotePort}`,
		);
	});
});
subscribe("undici:request:create", (message) => {
	seen.add(`fetch ${originOf(message)}`);
});
subscribe("http.client.request.start", (message) => {
	seen.add(`http ${originOf(message)}`);
});

export const watch = {hosts: () => [...seen].sort()};
