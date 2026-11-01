import {createServer} from "node:http";
import type * as acp from "@agentclientprotocol/sdk/unstable";
import {layer as nodeHttpServer} from "@effect/platform-node/NodeHttpServer";
import {Context, Effect, Layer, Option, Schema, type Scope} from "effect";
import {McpProtocol, McpServer, Tool, Toolkit} from "effect/ai";
import {HttpRouter, HttpServer} from "effect/http";
import {Built} from "./form.ts";

// The builder's form over ACP: one MCP tool, `report_build`, that the client
// lends the session in `session/new`'s `mcpServers`. ACP's prompt response has
// no field for a typed answer (experiment 76), so the answer comes back the
// way a reviewer's notes do on the SDK path: as a call to a tool the machine
// opened, whose input is the form.
//
//   const report = yield* reportServer()            // served on 127.0.0.1, a fresh port, until the scope closes
//   yield* c.open("new", null, tree, meta, [report.server])
//   ...the turn...
//   report.form()                                    // the last form it handed in, or null
//
// The server is Effect's own MCP server (`effect/ai`) over its HTTP router,
// on loopback only. Its path holds a random id, so only who was handed the
// url can call it: the session's CLI, which the adapter gives the url to.
// The tool's input is the builder's form schema (./form.ts), checked again
// when it comes in: a call that does not fit is answered as an error and
// nothing is kept.
//
// Node at the edge: `node:http`'s server, which Effect's Node layer wraps,
// and `crypto.randomUUID` for the path.

/** The name the server is lent under: the agent sees the tool as `mcp__report__report_build`. */
export const SERVER = "report";
export const TOOL = "report_build";
/** The tool as the agent sees it. */
export const REPORT_TOOL = `mcp__${SERVER}__${TOOL}`;

const ReportBuild = Tool.make(TOOL, {
	description:
		"Hand in your form, once, at the very end of your work: what the change does, where it differs from the ticket, the checks you ran, and what you could not do. Calling it ends nothing by itself: end your turn after it.",
	parameters: Built,
	success: Schema.String,
});
const kit = Toolkit.make(ReportBuild);

export interface Report {
	/** For `session/new`'s `mcpServers`. */
	readonly server: acp.McpServer;
	/** The last form handed in, or `null`. */
	readonly form: () => Built | null;
	/** How many calls came, fitting or not. */
	readonly calls: () => number;
}

/** Serve `report_build` until the scope closes. */
export const reportServer = (): Effect.Effect<Report, never, Scope.Scope> =>
	Effect.gen(function* () {
		let form: Built | null = null;
		let calls = 0;
		const path = `/mcp/${crypto.randomUUID()}` as const;
		const handlers = kit.toLayer({
			report_build: (given) =>
				Effect.sync(() => {
					calls += 1;
					const fits = Schema.decodeUnknownOption(Built)(given);
					if (Option.isNone(fits)) return "Refused: that form does not fit its shape.";
					form = fits.value;
					return "Taken. End your turn now.";
				}),
		});
		const app = McpServer.toolkit(kit).pipe(
			Layer.provide(handlers),
			Layer.provideMerge(
				McpServer.layerHttp({
					name: SERVER,
					version: "1",
					path,
					protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2025_03_26],
				}),
			),
		);
		const served = HttpRouter.serve(app, {disableLogger: true, disableListenLog: true}).pipe(
			Layer.provideMerge(nodeHttpServer(() => createServer(), {port: 0, host: "127.0.0.1"})),
		);
		// No spans: a builder's trace is its turn, not this server's HTTP and MCP calls.
		const context = yield* Layer.build(served).pipe(Effect.withTracerEnabled(false), Effect.orDie);
		const address = Context.get(context, HttpServer.HttpServer).address;
		if (address._tag !== "InetAddressV4") return yield* Effect.die("the report server has no port");
		return {
			server: {
				type: "http",
				name: SERVER,
				url: `http://127.0.0.1:${address.port}${path}`,
				headers: [],
			},
			form: () => form,
			calls: () => calls,
		};
	});
