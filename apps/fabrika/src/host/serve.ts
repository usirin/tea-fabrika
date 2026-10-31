import {applyCell} from "@demlik/tea";
import {run} from "@demlik/tea/effect";
import {type Entry, type JobsOnHost, Ledger, Shell} from "@kampus/fabrika";
import {Author, PullRequests} from "@tea-fabrika/tracker";
import {Effect, Queue} from "effect";
import {type Socket, SocketServer} from "effect/socket";
import {
	type AsksMsg,
	asksMachine,
	asksNow,
	asksOptions,
	type Marks,
	marksOf,
	NO_MARKS,
	readMarks,
} from "../asks.ts";
import {BUILD} from "../build-id.ts";
import {
	claims,
	type Desk,
	type DeskCmd,
	type DeskMsg,
	deskMachine,
	refusedOf,
	restore,
	type Saved,
	takenNow,
} from "../desk/desk.ts";
import {BINDINGS, PREFIX, wordOf} from "../desk/keys.ts";
import type {SharedHistory} from "../editor/history.ts";
import {type Down, PROTOCOL, type Up} from "../link.ts";
import {
	type AgentOn,
	type FromPage,
	type LedgerLink,
	readFromPage,
	type ToPage,
} from "../messages.ts";
import {startTiles} from "../tiles.ts";
import {appPrograms, type Screen, tshList} from "../tsh.ts";
import {hostWire} from "../wire.ts";
import {serveAgents} from "./agents.ts";

// The host's server: what the host process does with each app that attaches, as tmux's server
// does with each client. It names no platform: it takes Effect's `SocketServer`, which
// host/main.ts makes on the socket file, and a test makes on one of its own (host.test.ts).
//
// The host holds everything that runs: the tiles (tiles.ts), each with its tsh and programs, the
// one job table every tile's tsh shows, and the desk (desk/desk.ts), stepped here, in one place,
// whoever sends the key. An app is only a client: it shows the desk on its page and relays the
// page's ports.
//
//   app   hello {version: 1}               link.ts: the handshake; another version is refused. The
//                                          host's hello back names its build, for the app to compare
//   app   page                             a page loaded: it is sent the Ctrl-B table, the host's
//                                          own state, the desk, then a port for each tile's
//                                          terminal and each run shown
//   app   on {port: "desk", m: {type: "press", id: 0, key: "<c-b>"}}
//   host  to {port: "desk", m: {type: "desk", desk, takes: {all: true, keys: []}}}   to every page
//   host  to {port: "desk", m: {type: "answer", id: 0, took: true}}                  to that page
//   app   on {port: "tile:t1", m: {type: "keys", data: "l"}}                         to t1's tsh
//   t1    zoom                             a desk word typed in t1's tsh (desk/words.ts): the desk
//                                          steps as on C-b z from t1, and every page is shown it
//   host  to {port: "desk", m: {type: "host", now: {pid, since, build, ledger, agents}}}
//                                          to every page, as an agent attaches on the MCP socket
//                                          or goes: the top bar's agents, sync and host
//   app   away                             the window closed: nothing more is shown to it
//
// Every page attached is shown the same desk, and each tile's screen on all of them, as every
// tmux client attached to a session shows its panes. The desk is stepped by one key at a time,
// in the order the keys came, and its Cmds are carried out in order by one fiber: an open is
// done before the close after it.
//
// A key's time is the host's clock: the repeat window (keys.ts) is the desk's, not a page's.

/** Where the desk is kept between starts of the host: desk.json in the app's home, for now. */
export interface DeskHome {
	/** The desk kept from before, as written, or `null`. */
	readonly kept: unknown;
	readonly save: (saved: Saved) => Effect.Effect<void>;
	/** The last tile closed: nothing is kept, and the next start begins on one fresh tile. */
	readonly forget: Effect.Effect<void>;
}

/** Where the person's marks on the asks are kept between starts of the host: asks.json, beside the desk. */
export interface AsksHome {
	/** The file's text, as written, or `null`: there is none. */
	readonly kept: string | null;
	readonly save: (marks: Marks) => Effect.Effect<void>;
}

/** One app attached. */
interface Client {
	send: (m: Down) => void;
	/** A page is loaded in its window, to be shown everything. */
	page: boolean;
	/** The screens shown on its page, by port name, and how to stop showing each. */
	readonly shown: Map<string, () => void>;
}

/** What the page is sent first: the desk's Ctrl-B table, each key with its name and its tsh word. */
const KEYS: ToPage = {
	type: "keys",
	prefix: PREFIX,
	table: BINDINGS.map((b) => ({key: b.key, repeats: b.repeats, name: b.name, tsh: wordOf(b.does)})),
};

/**
 * Each of the app's programs, with the inputs a pipe can feed and the outputs it sends, for the
 * frame's bottom line (`takes ticket · sends ticket`). What it takes is tsh's own rule for a pipe
 * (`Shell.fedBy`), over the list a tile's tsh has: its commands (`close`, `quit`) are not data a
 * pipe brings, and the line and the frame never disagree.
 */
const programsOf = (apps: readonly Entry[]): ToPage => ({
	type: "programs",
	programs: apps.map(({program}) => ({
		name: program.name,
		takes: Shell.fedBy(program, tshList(apps)),
		sends: Object.keys(program.outputs),
	})),
});

/** The same value, said once: the clock's tick changes no asks, and is not sent again. */
const same = (a: ToPage, b: ToPage): boolean => JSON.stringify(a) === JSON.stringify(b);

export const serve = (options: {
	readonly history: SharedHistory;
	/** The host's one job table (`openJobs`), handed to every tile's tsh. */
	readonly jobs: JobsOnHost;
	readonly desk: DeskHome;
	readonly asks: AsksHome;
	/** The link's version this host speaks: `PROTOCOL`, but in a test of an old host. */
	readonly ours?: number | undefined;
	/**
	 * The build this host's hello names: `BUILD` (build-id.ts), but in a test of an older host.
	 * `null` names none, as a host built before builds were named.
	 */
	readonly build?: string | null | undefined;
	/** The agents' socket (host/agents.ts), on a home that keeps its own ledger; none elsewhere. */
	readonly agents?: SocketServer.SocketServer["Service"] | undefined;
	/** The host's process id, for the host's lines in the top bar. */
	readonly pid: number;
	/** Which ledger the home reads and writes, for the sync lines (host/connection.ts). */
	readonly ledger: LedgerLink;
}) =>
	Effect.gen(function* () {
		const {
			history,
			jobs,
			desk: home,
			asks: asksHome,
			ours = PROTOCOL,
			build = BUILD,
			agents,
		} = options;
		const server = yield* SocketServer.SocketServer;
		const services = yield* Effect.context<never>();
		const clock = yield* Effect.clockWith(Effect.succeed);
		const since = clock.currentTimeMillisUnsafe();
		const warn = (what: string) => {
			Effect.runForkWith(services)(Effect.logWarning(`fabrika host: ${what}`));
		};

		const clients = new Set<Client>();
		/** Every screen there is, by its port's name: each tile's terminal, and each run's view in a tile. */
		const screens = new Map<string, Screen<unknown>>();

		const showTo = (client: Client, name: string, screen: Screen<unknown>) => {
			client.shown.get(name)?.();
			client.send({type: "port", port: name});
			client.shown.set(
				name,
				screen.show((m) => client.send({type: "to", port: name, m})),
			);
		};
		const hide = (client: Client) => {
			for (const stop of client.shown.values()) stop();
			client.shown.clear();
		};
		const toPage = (client: Client, m: ToPage) => client.send({type: "to", port: "desk", m});

		// The desk, and its Cmds, carried out one after another.
		const queue = yield* Queue.unbounded<DeskCmd>();
		let desk: Desk = {at: "over"};
		const deskNow = (): ToPage => ({
			type: "desk",
			desk,
			takes: takenNow(desk, clock.currentTimeMillisUnsafe()),
		});
		const shout = () => {
			const now = deskNow();
			for (const client of clients) if (client.page) toPage(client, now);
		};
		/**
		 * Step the desk. A `show` is said to the page whose key asked for it (`from`), at once, as
		 * tmux's `list-keys` shows on the client that pressed: it changes nothing on the host. A
		 * desk word typed in a tile's tsh has no page of its own, so it is said to `every` page.
		 */
		const step = (msg: DeskMsg, from?: Client | "every") => {
			const [next, cmds] = applyCell<Desk, DeskMsg, DeskCmd>(deskMachine, desk, msg);
			const changed = next !== desk;
			desk = next;
			for (const c of cmds) {
				if (c.type !== "show") Queue.offerUnsafe(queue, c);
				else
					for (const to of from === "every" ? clients : from === undefined ? [] : [from])
						if (to.page) toPage(to, {type: "show", what: c.what});
			}
			return changed;
		};
		const begin = (kept: unknown) => {
			const [first, cmds] = deskMachine.init(restore(kept), undefined);
			desk = first;
			for (const c of cmds) Queue.offerUnsafe(queue, c);
		};

		// The asks (asks.ts): one count, read off the ledger, said to every app, page or not, so
		// the app's Dock badge counts the same as the window's top bar. It starts on the person's
		// marks kept from before; a file that does not read is said in the log, and none are kept.
		const read = readMarks(asksHome.kept);
		if (read.kind === "refused")
			yield* Effect.logWarning(
				`fabrika host: the asks' later and seen did not read back, so every ask counts and is new: ${read.why}`,
			);
		const marks = read.kind === "read" ? read.marks : NO_MARKS;
		const asks = yield* (yield* run(asksMachine, asksOptions(marks))).ready;
		const asksNowMsg = (): ToPage => ({type: "asks", now: asksNow(asks.getState())});
		let saidAsks = asksNowMsg();
		// The marks, written after each change that moves them, one write after another, so the
		// file ends on the last change.
		const writes = yield* Queue.unbounded<Marks>();
		yield* Queue.take(writes).pipe(
			Effect.flatMap(asksHome.save),
			Effect.forever,
			Effect.forkScoped,
		);
		let keptMarks = JSON.stringify(marks);
		const keep = () => {
			const now = marksOf(asks.getState());
			const text = JSON.stringify(now);
			if (text === keptMarks) return;
			keptMarks = text;
			Queue.offerUnsafe(writes, now);
		};
		// The first read may be in already: what it dropped is kept now, not at the next change.
		keep();
		asks.observe(() => {
			keep();
			const now = asksNowMsg();
			if (same(now, saidAsks)) return;
			saidAsks = now;
			for (const client of clients) toPage(client, now);
		});
		const toAsks = (msg: AsksMsg) => {
			Effect.runForkWith(services)(asks.dispatch(msg).pipe(Effect.ignore));
		};
		const ledger = yield* Ledger;
		const programs = programsOf(appPrograms(ledger, yield* Author, yield* PullRequests));

		// The host as it says of itself, for the top bar's host, sync and agents: said as a page
		// loads, and to every page as an agent attaches or goes. Each agent on the socket is one
		// entry, by a number of its own, so two of one name are two.
		const attached = new Map<number, AgentOn>();
		let nextAgent = 0;
		const hostNow = (): ToPage => ({
			type: "host",
			now: {
				pid: options.pid,
				since,
				build,
				ledger: options.ledger,
				agents:
					agents === undefined ? null : [...attached.values()].sort((a, b) => a.since - b.since),
			},
		});
		const tellHost = () => {
			const now = hostNow();
			for (const client of clients) if (client.page) toPage(client, now);
		};
		const agentCame = (name: string) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					const n = nextAgent++;
					attached.set(n, {name, since: clock.currentTimeMillisUnsafe()});
					tellHost();
					return n;
				}),
				(n) =>
					Effect.sync(() => {
						attached.delete(n);
						tellHost();
					}),
			).pipe(Effect.asVoid);

		/** A screen to show: on every page now, and on each page that loads after. The same screen again changes nothing. */
		const add = (name: string, screen: Screen<unknown>) => {
			if (screens.get(name) === screen) return;
			screens.set(name, screen);
			for (const client of clients) if (client.page) showTo(client, name, screen);
		};
		/** A screen goes: its tile closed, or its run ended. Every page shown it loses its port. */
		const gone = (name: string) => {
			screens.delete(name);
			for (const client of clients) {
				const shown = client.shown.get(name);
				if (shown === undefined) continue;
				shown();
				client.shown.delete(name);
				client.send({type: "gone", port: name});
			}
		};

		const tiles = yield* startTiles({
			history,
			jobs,
			edge: {
				tell: (m) => {
					if (step(m)) shout();
				},
				said: (tile, does) => {
					const why = refusedOf(desk, tile, does);
					if (why !== null) return why;
					if (step({type: "typed", tile, does}, "every")) shout();
					return null;
				},
				terminal: (tile, screen) => add(`tile:${tile}`, screen),
				view: (run, screen) => add(`run:${run}`, screen),
				gone,
			},
		});

		const carry = (c: DeskCmd): Effect.Effect<void> => {
			switch (c.type) {
				case "open":
					return tiles.open(c.tile);
				case "close":
					return tiles.close(c.tile);
				case "stop":
					return tiles.stop(c.tile);
				case "end":
					return tiles.end(c.process);
				case "kill":
					return tiles.kill(c.process);
				case "send":
					return Effect.sync(() => {
						const heard = screens.get(`tile:${c.tile}`)?.heard({type: "keys", data: c.data});
						if (heard?.kind === "refused") warn(`the desk's keys for ${c.tile}: ${heard.why}`);
					});
				case "save":
					return home.save(c.desk);
				case "show":
					// Said to the page that pressed, in `step`: never queued.
					return Effect.void;
				case "empty":
					// The last tile closed: every window closes, and the desk begins again on one fresh tile.
					return home.forget.pipe(
						Effect.andThen(
							Effect.sync(() => {
								for (const client of clients) client.send({type: "close"});
								begin(null);
								shout();
							}),
						),
					);
			}
		};
		begin(home.kept);
		yield* Queue.take(queue).pipe(Effect.flatMap(carry), Effect.forever, Effect.forkScoped);
		if (agents !== undefined)
			yield* serveAgents(agents, () => screens.keys(), agentCame).pipe(
				Effect.catchCause((cause) =>
					Effect.logError("fabrika host: the agents' socket failed", cause),
				),
				Effect.forkScoped,
			);

		/** What the page sent on the desk's port. */
		const fromPage = (client: Client, m: FromPage) => {
			switch (m.type) {
				case "press": {
					const at = clock.currentTimeMillisUnsafe();
					const took = claims(desk, m.key, at);
					if (took) step({type: "key", key: m.key, at}, client);
					// The desk first, so the page knows what the desk takes before it lets the next key go.
					shout();
					toPage(client, {type: "answer", id: m.id, took});
					return;
				}
				case "click":
					if (step({type: "click", tile: m.tile})) shout();
					return;
				case "resize":
					if (step({type: "resize", container: m.container, sizes: m.sizes})) shout();
					return;
				case "fold":
					if (step({type: "fold", tile: m.tile})) shout();
					return;
				case "unfold":
					if (step({type: "unfold", node: m.node})) shout();
					return;
				case "area":
					// Nothing to draw: the size only says where the next line's windows fit.
					step({type: "area", width: m.width, height: m.height});
					return;
				case "go":
					if (step({type: "go", tile: m.tile})) shout();
					return;
				case "pick":
					if (step({type: "pick", workspace: m.workspace})) shout();
					return;
				case "run":
					if (step({type: "run", key: m.key}, client)) shout();
					return;
				case "later":
				case "back":
					toAsks({type: m.type, key: m.key});
					return;
				case "seen":
					toAsks({type: "seen"});
					return;
			}
		};

		/** A line from an app, once its link is up. */
		const fromApp = (client: Client, m: Up) => {
			switch (m.type) {
				case "hello":
					return;
				case "page":
					hide(client);
					client.page = true;
					toPage(client, KEYS);
					toPage(client, programs);
					toPage(client, hostNow());
					toPage(client, saidAsks);
					toPage(client, deskNow());
					for (const [name, screen] of screens) showTo(client, name, screen);
					return;
				case "away":
					hide(client);
					client.page = false;
					return;
				case "on": {
					if (m.port === "desk") {
						const read = readFromPage(m.m);
						if (read.kind === "read") fromPage(client, read.msg);
						else warn(`refused a message from a page: ${read.why}`);
						return;
					}
					const heard = screens.get(m.port)?.heard(m.m);
					if (heard?.kind === "refused") warn(`refused a message on ${m.port}: ${heard.why}`);
					return;
				}
			}
		};

		const attach = (socket: Socket.Socket) =>
			Effect.gen(function* () {
				const client: Client = {send: () => {}, page: false, shown: new Map()};
				const wire = yield* hostWire(socket, (m) => fromApp(client, m), ours, build);
				client.send = wire.send;
				clients.add(client);
				const why = yield* wire.ended;
				hide(client);
				clients.delete(client);
				yield* Effect.logDebug(`fabrika host: an app went: ${why}`);
			}).pipe(Effect.scoped);

		return yield* server.run(attach);
	});
