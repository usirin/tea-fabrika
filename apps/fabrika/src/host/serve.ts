import {applyCell} from "@demlik/tea";
import {run} from "@demlik/tea/effect";
import {
	type Entry,
	type JobsOnHost,
	Ledger,
	memoryStorage,
	type RunningOf,
	Shell,
	start,
	tell,
	Traces,
	writerText,
	RoomManager,
	readInput,
	commandsOf,
	CommandVia,
	viewOf,
	glanceOf,
	type AnyRunning,
	type Storage,
} from "@kampus/fabrika-old";
import {SummonedNow} from "@kampus/fabrika-old/agents/summon";
import {
	type AgentOptions,
	EXIT_WITHIN,
	LineRefused,
	RestartAnswer,
	RestartRefused,
	StopAnswer,
	StopRefused,
} from "@kampus/fabrika-old/mcp";
import {inbox as inboxProgram} from "@tea-fabrika/inbox";
import {InboxRow, InboxState, inboxMachine, type InboxMsg} from "@tea-fabrika/inbox/model";
import {InboxRuntime} from "@tea-fabrika/inbox/runtime";
import {Author, PullRequests, RepoTree, saveCell, tracker} from "@tea-fabrika/tracker";
import {Data, Deferred, Duration, Effect, Option, Queue, Ref, Stream, Scope} from "effect";
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
	activeOf,
	type Desk,
	type DeskCmd,
	type DeskMsg,
	deskMachine,
	forPage,
	type Open,
	refusedOf,
	agentOf,
	restore,
	route,
	type Saved,
	takenNow,
	tilesOf,
	type ProgramOpen,
} from "../desk/desk.ts";
import {
	commandFor,
	type Does as Command,
	defaults,
	File,
	type Keys,
	spell,
} from "../desk/keymap.ts";
import type {SharedHistory} from "../editor/history.ts";
import {jobLines} from "../job-lines.ts";
import {keysProgram, type Snapshot} from "../keys/program.ts";
import {type Down, PROTOCOL, type Up} from "../link.ts";
import {
	type AgentOn,
	type FromPage,
	type LedgerLink,
	readFromPage,
	type ToPage,
} from "../messages.ts";
import {startTiles} from "../tiles.ts";
import {appPrograms, type Screen, tshList, type WindowScreen} from "../tsh.ts";
import {hostWire} from "../wire.ts";
import type {AgentSessions} from "./agent-session.ts";
import {serveAgents} from "./agents.ts";
import {KeybindingManager} from "./keybindings.ts";
import type {RestartNote} from "./restart.ts";
import type {Setting, GlanceSettings} from "./settings.ts";

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
//   app   page                             a page loaded: it is sent the keys table, the host's
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
//   agent stop {n: 1, why: "wrong ticket"} on the agents' socket: the host says the agent's stop
//                                          in the table, then tells t1's tsh to stop %1 (`stopFor`)
//   agent restart {why: "..."}             an app is attached: the host leaves its note for the
//                                          next host, answers, and ends a moment on, as SIGTERM
//                                          ends it; the app starts the next (`restartFor`)
//   agent line {line: "tally &"}           on the agents' socket: the agent's first line has the
//                                          desk open its tile (`launch`), folded beside the focused
//                                          one; once the tile's tsh is open, it runs the line there
//                                          as the agent (`lineFor`)
//   app   away                             the window closed: nothing more is shown to it
//
// Every page attached is shown the same desk, and each tile's screen on all of them, as every
// tmux client attached to a session shows its panes. The desk is stepped by one key at a time,
// in the order the keys came, and its Cmds are carried out in order by one fiber: an open is
// done before the close after it.
//
// A key's time is the host's clock: the repeat window (keys.ts) is the desk's, not a page's.
//
// The keys file (desk/keymap.ts, read by host/settings.ts) is heard here: each answer is logged
// (`keys file=read yours=2`), swapped into the desk and sent to every page. A file that does not
// read keeps the last table that did, and every page is told the line and why. Each desk command
// run is logged with its word and how it was reached, by key, palette, tsh word or click:
//
//   did does=tezgah.zoom via={"_tag":"key","keys":"ctrl+b z"}
//   did does=tezgah.split via={"_tag":"palette"}

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

/** The desk's Cmds as the one fiber carries them, and a fence: done once every Cmd before it is. */
type Carried = DeskCmd | {readonly type: "fence"; readonly done: Deferred.Deferred<void>};

/**
 * Where a restart is kept between hosts (host/restart.ts): the note the host before this one left,
 * if any, and how an agent's restart leaves one for the next. A host handed none has no `restart`
 * tool.
 */
export interface Restarts {
	readonly before: RestartNote | null;
	readonly leave: (note: RestartNote) => Effect.Effect<void, RestartRefused>;
}

/**
 * How long the host runs on after it answered a restart, so the answer goes out on the agent's
 * socket before the host closes it. A local socket's write is well under a millisecond; this is
 * room for a loaded laptop. Our own number.
 */
const ANSWER_FIRST = Duration.millis(250);

/** One app attached. */
interface Client {
	readonly id: string;
	editor: RunningOf<typeof keysProgram> | null;
	send: (m: Down) => void;
	/** Its link is up: it said hello with our version, so it is an app that will start a host again. */
	up: () => boolean;
	/** A page is loaded in its window, to be shown everything. */
	page: boolean;
	/** The screens shown on its page, by port name, and how to stop showing each. */
	readonly shown: Map<string, () => void>;
}

/** How a desk command was reached, for the `did` log: a key, as the file spells it, the palette, a tsh word, a click. */
type Via = Data.TaggedEnum<{
	key: {readonly keys: string};
	palette: Record<never, never>;
	word: Record<never, never>;
	click: Record<never, never>;
}>;
const Via = Data.taggedEnum<Via>();

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
	readonly inboxStorage?: Storage;
	readonly roomStorage?: Storage;
	readonly glance?: GlanceSettings;
	readonly history: SharedHistory;
	/** The host's one job table (`openJobs`), handed to every tile's tsh. */
	readonly jobs: JobsOnHost;
	readonly desk: DeskHome;
	readonly asks: AsksHome;
	/**
	 * The keys file (host/keybindings.ts): a snapshot as the host starts, then one each save. The
	 * host serves no page before the first.
	 */
	readonly keybindings: KeybindingManager;
	/** The link's version this host speaks: `PROTOCOL`, but in a test of an old host. */
	readonly ours?: number | undefined;
	/**
	 * The build this host's hello names: `BUILD` (build-id.ts), but in a test of an older host.
	 * `null` names none, as a host built before builds were named.
	 */
	readonly build?: string | null | undefined;
	/** The agents' socket (host/agents.ts). */
	readonly agents?: {readonly server: SocketServer.SocketServer["Service"]} | undefined;
	/** The host's process id, for the host's lines in the top bar. */
	readonly pid: number;
	/**
	 * Which ledger the home reads and writes, for the sync lines (host/connection.ts). A ledger
	 * server comes with each agent's own session there (host/agent-session.ts), so there is no
	 * server ledger without them, and no agent can write on the person's session. The sessions stay
	 * in the host; the page is told the link only.
	 */
	readonly ledger:
		| Extract<LedgerLink, {kind: "own"}>
		| (Extract<LedgerLink, {kind: "server"}> & {readonly sessionFor: AgentSessions});
	/** The restart before this host, and where the next is left; none, no `restart` tool. */
	readonly restarts?: Restarts | undefined;
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
			restarts,
		} = options;
		/** The ledger as the page is told it: the agents' sessions stay in the host. */
		const link: LedgerLink =
			options.ledger.kind === "server"
				? {kind: "server", address: options.ledger.address, login: options.ledger.login}
				: {kind: "own"};
		const server = yield* SocketServer.SocketServer;
		const scope = yield* Effect.scope;
		const services = yield* Effect.context<never>();
		const author = yield* Author;
		const clock = yield* Effect.clockWith(Effect.succeed);
		const since = clock.currentTimeMillisUnsafe();
		const warn = (what: string) => {
			Effect.runForkWith(services)(Effect.logWarning(`fabrika host: ${what}`));
		};

		const clients = new Set<Client>();
		/** Every screen there is, by its port's name: each tile's terminal, and each run's view in a tile. */
		const screens = new Map<string, Screen<unknown>>();
		const shownTickets = new Map<string, number>();

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
		const queue = yield* Queue.unbounded<Carried>();
		let desk: Desk = {at: "over"};
		const deskNow = (): ToPage => ({
			type: "desk",
			desk: forPage(desk),
			takes: takenNow(desk, clock.currentTimeMillisUnsafe()),
		});
		/** The keys file's table: the last that read, or the defaults, with what came of the file now. */
		let table: Keys = defaults;
		let snapshot: Snapshot | null = null;
		const keysNow = (): ToPage => ({
			type: "keys",
			...table,
			...(snapshot === null ? {} : {version: snapshot.version, changes: snapshot.changes}),
		});
		/** A desk command ran: its word, and how it was reached. */
		const did = (does: Command, via: Via) => {
			Effect.runForkWith(services)(
				Effect.logInfo("did").pipe(Effect.annotateLogs({does, via: JSON.stringify(via)})),
			);
		};
		/** Each agent's own tile, as the desk keeps it. */
		const agentsOf = (d: Desk): Open["agents"] => (d.at === "open" ? d.agents : {});
		/**
		 * The agents' tiles launched and not yet seen by the person, and when each was launched: once
		 * the person unfolds or focuses one, the log says how long that took, once.
		 */
		const launched = new Map<string, {readonly agent: string; readonly at: number}>();
		const seenNow = () => {
			if (desk.at !== "open" || launched.size === 0) return;
			const open = desk;
			const active = open.workspaces.find((ws) => ws.id === open.active);
			for (const [tile, {agent, at}] of launched) {
				const found = open.workspaces.flatMap((ws) => tilesOf(ws).filter((t) => t.id === tile))[0];
				if (found === undefined) {
					launched.delete(tile);
					continue;
				}
				if (found.folded && active?.focused !== tile) continue;
				launched.delete(tile);
				Effect.runForkWith(services)(
					Effect.logInfo("agent_tile_opened").pipe(
						Effect.annotateLogs({agent, tile, after_ms: clock.currentTimeMillisUnsafe() - at}),
					),
				);
			}
		};
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
			const agentsBefore = agentsOf(desk);
			desk = next;
			for (const c of cmds) {
				if (c.type !== "show") Queue.offerUnsafe(queue, c);
				else
					for (const to of from === "every" ? clients : from === undefined ? [] : [from])
						if (to.page) toPage(to, {type: "show", what: c.what});
			}
			if (changed) {
				if (JSON.stringify(agentsOf(desk)) !== JSON.stringify(agentsBefore)) tellHost();
				seenNow();
			}
			return changed;
		};
		const begin = (kept: unknown) => {
			const [first, cmds] = deskMachine.init(restore(kept), undefined);
			// A desk read back, or begun again, is on the keys file's table too.
			desk = applyCell<Desk, DeskMsg, DeskCmd>(deskMachine, first, {type: "keys", keys: table})[0];
			for (const c of cmds) Queue.offerUnsafe(queue, c);
		};
		const requestOpen = (request: typeof ProgramOpen.Type, looked = false) => {
			const prior =
				desk.at === "open"
					? tilesOf(activeOf(desk)).find((tile) => tile.shows.run?.program === request.program)
					: undefined;
			step({type: "open_program", ...request});
			const tile =
				desk.at === "open"
					? tilesOf(activeOf(desk)).find((one) => one.shows.run?.program === request.program)
					: undefined;
			Effect.runForkWith(services)(
				Effect.logInfo("program_open").pipe(
					Effect.annotateLogs({
						program: request.program,
						from: request.from,
						via: JSON.stringify(request.via),
						how: tile === undefined ? "refused" : prior === undefined ? "new" : "focused",
						tile: tile?.id ?? null,
						location: JSON.stringify(request.location),
						looked,
					}),
				),
			);
			shout();
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
		const rooms = yield* RoomManager.make({storage: options.roomStorage ?? memoryStorage()});
		const recipient = rooms.for(author);
		const inboxHandle = yield* (options.inboxStorage ?? memoryStorage()).open("inbox", {});
		const savedInbox = yield* inboxHandle.read("inbox", "recipient", InboxState);
		const inboxStore = inboxHandle.store("inbox", "recipient", InboxState);
		const initialInbox = {...inboxMachine.init(null, undefined)[0], marks};
		const leaveInbox = Effect.sync(() => {
			if (step({type: "run", does: 'tezgah."focus --to last"'})) shout();
		});
		const inbox = yield* (yield* run(inboxMachine, {
			ctx: undefined,
			store: {...inboxStore, load: () => Promise.resolve(savedInbox ?? initialInbox)},
			interpret: {
				reply_send: (cmd) =>
					recipient
						.send(cmd)
						.pipe(Effect.mapError((error) => ({_tag: error._tag, why: error.why}))),
				open: (cmd) =>
					Effect.sync(() => {
						if (desk.at !== "open") return null;
						requestOpen(
							{
								program: "inbox",
								location: {row: cmd.row},
								from: activeOf(desk).focused,
								via: CommandVia.cases.word.make({}),
							},
							cmd.looked,
						);
						return null;
					}),
				leave: () => leaveInbox.pipe(Effect.as(null)),
			},
		})).ready;
		const inboxNow = (): ToPage => ({type: "inbox", now: inbox.getState()});
		const syncAsks = () => {
			const now = asksNow(asks.getState());
			const rows = [...now.asks, ...now.later].flatMap((item): InboxRow[] =>
				item.kind === "stuck"
					? [
							InboxRow.cases.stop.make({
								key: item.key,
								stop: {
									ticket: item.ticket,
									why: item.why ?? item.what,
									...(item.resume === undefined ? {} : {resume: item.resume}),
									at: item.at,
								},
							}),
						]
					: item.sealed === undefined
						? []
						: [
								InboxRow.cases.ask.make({
									key: item.key,
									ask: {
										key: item.key,
										ticket: item.ticket,
										shows: item.sealed.shows,
										saw: item.sealed.saw,
										editor: {_tag: "reading"},
										failure: null,
										busy: false,
										at: item.at,
										sealed: item.sealed,
									},
								}),
							],
			);
			Effect.runForkWith(services)(inbox.dispatch({type: "sync", rows}).pipe(Effect.ignore));
		};
		asks.observe(syncAsks);
		syncAsks();
		let inboxMarks = inbox.getState().marks;
		inbox.observe(() => {
			const state = inbox.getState();
			for (const key of state.marks.later)
				if (!inboxMarks.later.includes(key)) toAsks({type: "later", key});
			for (const key of inboxMarks.later)
				if (!state.marks.later.includes(key)) toAsks({type: "back", key});
			if (state.marks.seen.length !== inboxMarks.seen.length) toAsks({type: "seen"});
			inboxMarks = state.marks;
			for (const client of clients) if (client.page) toPage(client, inboxNow());
		});
		const arrived = (message: import("@kampus/fabrika-old").DirectMessage) => {
			if (writerText(message.to) !== writerText(author)) return;
			const {to: _to, pos: _pos, ...content} = message;
			Effect.runForkWith(services)(
				inbox
					.dispatch({
						type: "arrive",
						row: InboxRow.cases.message.make({
							key: `${writerText(content.by)}/${content.id}`,
							message: content,
						}),
					})
					.pipe(Effect.ignore),
			);
		};
		const unfollowRooms = rooms.follow(arrived);
		yield* Effect.addFinalizer(() => Effect.sync(unfollowRooms));
		const unfollowReceipts = rooms.followReceipt((by, id) => {
			if (writerText(by) !== writerText(author)) return;
			const value = recipient.receipt(id);
			if (value !== null)
				Effect.runForkWith(services)(
					inbox.dispatch({type: "receipt", id, value}).pipe(Effect.ignore),
				);
		});
		yield* Effect.addFinalizer(() => Effect.sync(unfollowReceipts));
		for (const reply of [inbox.getState().reply, ...Object.values(inbox.getState().drafts)])
			if ("id" in reply) {
				const value = recipient.receipt(reply.id);
				if (value !== null) yield* inbox.dispatch({type: "receipt", id: reply.id, value});
			}
		let messageAfter = 0;
		while (true) {
			const page = yield* recipient.read({after: messageAfter, limit: 1000});
			for (const message of page) arrived(message);
			if (page.length < 1000) break;
			const last = page.at(-1);
			if (last === undefined) break;
			messageAfter = last.pos;
		}
		const runtime: InboxRuntime["Service"] = {
			getState: inbox.getState,
			subscribe: (listener) => inbox.subscribe(listener),
			send: (msg) => inbox.dispatch(msg).pipe(Effect.asVoid, Effect.orDie),
			deliver: recipient.send,
			open: (row) =>
				Effect.gen(function* () {
					if (row !== null) yield* inbox.dispatch({type: "select", value: row});
					yield* inbox.dispatch({type: "open", value: null});
				}).pipe(Effect.orDie),
			leave: leaveInbox,
		};
		const inboxTiles = new Map<string, AnyRunning>();
		const glanceProviders = new Map<
			string,
			{program: string; last: import("../messages.ts").ToWindow | null; stop: () => void}
		>();
		const inboxOffers = () => [
			...new Set(["inbox", ...[...glanceProviders.values()].map((p) => p.program)]),
		];
		const glanceNow = (): ToPage => ({
			type: "glance",
			...(options.glance?.get() ?? {choice: "inbox", effective: "inbox", why: null}),
			offers: inboxOffers(),
		});
		const glanceView = (): ToPage => {
			const effective = options.glance?.get().effective ?? "inbox";
			const provider = [...glanceProviders.values()].find((p) => p.program === effective);
			return {
				type: "glance_view",
				program: effective,
				data: effective === "inbox" ? inbox.getState() : (provider?.last?.data ?? null),
			};
		};
		const tellGlance = () => {
			for (const client of clients)
				if (client.page) {
					toPage(client, glanceNow());
					toPage(client, glanceView());
				}
		};
		options.glance?.follow(tellGlance);
		const sendInbox = (
			raw: unknown,
			from: string,
			via: CommandVia = CommandVia.cases.click.make({}),
		) => {
			const read = readInput(inboxProgram, raw);
			if (read.kind !== "read") {
				warn(read.why);
				return;
			}
			const msg = read.msg;
			Effect.runForkWith(services)(
				Effect.logInfo("inbox_command").pipe(
					Effect.annotateLogs({
						command: msg.type,
						from,
						via: JSON.stringify(via),
						row: inbox.getState().selected,
					}),
				),
			);
			if (msg.type === "open") {
				requestOpen(
					{
						program: "inbox",
						location: {row: inbox.getState().selected},
						from,
						via,
					},
					inbox.getState().look,
				);
				return;
			}
			if (msg.type === "enter") {
				const state = inbox.getState();
				const row = state.rows.find((r) => r.key === state.selected);
				const ticket =
					row?._tag === "ask"
						? row.ask.ticket
						: row?._tag === "stop"
							? row.stop.ticket
							: row?._tag === "message"
								? row.message.ticket
								: null;
				if (ticket !== null && ticket !== undefined) {
					const existing =
						desk.at === "open"
							? desk.workspaces
									.flatMap(tilesOf)
									.find(
										(tile) =>
											tile.shows.run !== null && shownTickets.get(tile.shows.run.id) === ticket,
									)
							: undefined;
					if (existing !== undefined) {
						step({type: "go", tile: existing.id});
						shout();
					} else requestOpen({program: "tracker", location: {ticket}, from, via}, state.look);
				}
				return;
			}
			Effect.runForkWith(services)(runtime.send(msg as InboxMsg));
		};
		const ledger = yield* Ledger;
		/** The agents the person summoned here, when the host keeps any (its repository is known). */
		const summons = Option.getOrUndefined(yield* Effect.serviceOption(Shell.SummonManager));
		const apps = appPrograms(
			ledger,
			author,
			yield* PullRequests,
			yield* Traces,
			yield* RepoTree,
			summons,
			runtime,
		);
		const programs = programsOf(apps);

		// The host as it says of itself, for the top bar's host, sync and agents: said as a page
		// loads, and to every page as an agent attaches or goes, or its tile comes or goes. Each
		// agent on the socket is one entry, by a number of its own, so two of one name are two.
		const attached = new Map<number, Omit<AgentOn, "tile">>();
		/** The agents summoned here now, as the manager last said them. */
		let summoned: readonly Shell.Summoned[] = [];
		let nextAgent = 0;
		/** Who restarted the host before this one, said once: in its log, here, and in each tile's tsh. */
		const before = restarts?.before ?? null;
		const hostNow = (): ToPage => ({
			type: "host",
			now: {
				pid: options.pid,
				since,
				build,
				ledger: link,
				agents:
					agents === undefined
						? null
						: [...attached.values()]
								.sort((a, b) => a.since - b.since)
								.map((a) => ({...a, tile: agentsOf(desk)[a.name] ?? null})),
				restarted: before === null ? null : {by: before.by, why: before.why, at: before.at},
				summoned: summoned.map((a) => ({
					name: a.name,
					agent: a.agent,
					model: a.model.resolved ?? a.model.typed,
					effort: a.effort.set ?? a.effort.typed,
					state: a.state,
					since: a.since,
				})),
			},
		});
		const tellHost = () => {
			const now = hostNow();
			for (const client of clients) if (client.page) toPage(client, now);
		};
		// Each summon, dismiss and change of state, to every page: the top bar counts them.
		const summonedNow = yield* Effect.serviceOption(SummonedNow);
		if (Option.isSome(summonedNow))
			yield* summonedNow.value.changes.pipe(
				Stream.runForEach((all) =>
					Effect.sync(() => {
						summoned = all;
						tellHost();
					}),
				),
				Effect.forkScoped,
			);
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
		/**
		 * Each tsh `keys` waiting on an editor, and the windows whose editor it waits on: those open
		 * when it asked, and those that open after. It ends when the last of them closes, so one
		 * window closing its editor leaves another window's request waiting.
		 */
		const keyRequests = new Map<
			string,
			{readonly screen: WindowScreen; readonly waiting: Set<Client>}
		>();
		const keyWatches = new Map<string, () => void>();
		/** A screen goes: its tile closed, or its run ended. Every page shown it loses its port. */
		const gone = (name: string) => {
			if (name.startsWith("run:")) shownTickets.delete(name.slice(4));
			if (name.startsWith("run:")) {
				glanceProviders.get(name.slice(4))?.stop();
				glanceProviders.delete(name.slice(4));
			}
			keyRequests.delete(name);
			keyWatches.get(name)?.();
			keyWatches.delete(name);
			screens.delete(name);
			options.glance?.providers(inboxOffers());
			tellGlance();
			for (const client of clients) {
				const shown = client.shown.get(name);
				if (shown === undefined) continue;
				shown();
				client.shown.delete(name);
				client.send({type: "gone", port: name});
			}
		};

		/** When the person last pressed a key, on the desk or in a tile, by the host's clock; `null`: none yet. */
		let lastKey: number | null = null;
		const idle = () => (lastKey === null ? null : clock.currentTimeMillisUnsafe() - lastKey);

		// Each job's lines and end, beside the table, for the agents' `job` tool and the host's log.
		const lines = yield* jobLines(jobs.table, idle);
		const tiles = yield* startTiles({
			history,
			jobs,
			lines,
			edge: {
				provider: (run, screen) => {
					glanceProviders.get(run)?.stop();
					glanceProviders.delete(run);
					if (screen?.glance !== undefined) {
						const provider = {
							program: run.split(":")[0] ?? run,
							last: null as import("../messages.ts").ToWindow | null,
							stop: () => {},
						};
						glanceProviders.set(run, provider);
						provider.stop = screen.glance.show((view) => {
							provider.last = view;
							tellGlance();
						});
					}
					options.glance?.providers(inboxOffers());
					tellGlance();
				},
				tell: (m) => {
					if (step(m)) shout();
				},
				said: (tile, does) => {
					const why = refusedOf(desk, tile, does);
					if (why !== null) return why;
					const word = commandFor(does);
					if (word !== undefined) did(word, Via.word());
					if (step({type: "typed", tile, does}, "every")) shout();
					return null;
				},
				terminal: (tile, screen) => add(`tile:${tile}`, screen),
				view: (run, screen) => {
					const name = `run:${run}`;
					keyWatches.get(name)?.();
					keyWatches.set(
						name,
						screen.show((view) => {
							if (view.program === "ticket") {
								const number = Reflect.get(Object(view.data), "number");
								if (typeof number === "number") shownTickets.set(run, number);
								else shownTickets.delete(run);
							}
							if (view.program === "keys" && !keyRequests.has(name))
								keyRequests.set(name, {
									screen,
									waiting: new Set([...clients].filter((client) => client.editor !== null)),
								});
						}),
					);
					add(name, screen);
				},
				gone,
				// The person's line is theirs: the log says one came, never what it said.
				typed: (tile) => {
					const agent = desk.at === "open" ? agentOf(desk, tile) : null;
					Effect.runForkWith(services)(
						Effect.logInfo("agent_tile_typed").pipe(Effect.annotateLogs({agent, tile})),
					);
				},
			},
			sessionFor: options.ledger.kind === "server" ? options.ledger.sessionFor : undefined,
		}).pipe(Effect.provideService(InboxRuntime, runtime));

		/**
		 * Stop job n of the table for agent `who`, and why: the `stop` tool's host side. Its stop is
		 * said first, and kept once, so the tsh's own ask after it changes nothing and the job's record
		 * keeps the agent. A job that runs in an open tile is stopped by that tile's tsh, which alone
		 * holds its runs; one that runs nowhere is dropped, as `stop %n` drops it.
		 */
		const stopFor: NonNullable<AgentOptions["stop"]> = (who, ask) =>
			Effect.gen(function* () {
				const {n, why} = ask;
				const job = jobs.table.getState().jobs.find((one) => one.n === n);
				if (job === undefined) {
					const known = lines.job(n);
					return yield* new StopRefused({
						why:
							known?.state._tag === "ended"
								? `job ${n} ended already (${known.state.how}): there is nothing to stop`
								: `there is no job ${n}: the host's table does not hold it, and no end of it is kept`,
					});
				}
				const say = (msg: Shell.JobsMsg) => jobs.table.dispatch(msg).pipe(Effect.ignore);
				yield* say({type: "stopping", n, by: writerText(who), why});
				const told =
					job.state === "running" && job.owner !== null && (yield* tiles.stopJob(job.owner, n));
				if (!told) {
					yield* say({type: "detached", n});
					yield* say({type: "dropped", n});
					return StopAnswer.cases.dropped.make({n, text: job.text});
				}
				return yield* lines.ended(n).pipe(
					Effect.map((ended) => StopAnswer.cases.stopped.make({job: ended})),
					Effect.timeoutOrElse({
						duration: EXIT_WITHIN,
						orElse: () => Effect.succeed(StopAnswer.cases.asked.make({n})),
					}),
				);
			});

		/**
		 * Run one line in agent `who`'s own tile: the `line` tool's host side. Its first line has the
		 * desk open the tile, folded beside the focused one, and waits for the desk's Cmds to be
		 * carried, so the tile's tsh is open, as the agent, before the line is handed to it. Only the
		 * agent's own tile is ever named: a line never reaches a person's tile or another agent's.
		 */
		const lineFor: NonNullable<AgentOptions["line"]> = (who, ask) =>
			Effect.gen(function* () {
				let tile = agentsOf(desk)[who.id];
				if (tile === undefined) {
					if (step({type: "launch", agent: who.id})) shout();
					tile = agentsOf(desk)[who.id];
					if (tile === undefined)
						return yield* new LineRefused({
							why: `the desk could not open a tile for ${who.id}: it is not open`,
						});
					launched.set(tile, {agent: who.id, at: clock.currentTimeMillisUnsafe()});
					yield* Effect.logInfo("agent_tile").pipe(Effect.annotateLogs({agent: who.id, tile}));
				}
				const done = yield* Deferred.make<void>();
				Queue.offerUnsafe(queue, {type: "fence", done});
				yield* Deferred.await(done);
				return yield* tiles.line(tile, ask.line);
			});

		/** Done once a restart was answered: the host ends, as SIGTERM ends it, and sends no signal. */
		const quit = yield* Deferred.make<void>();
		/** One restart at a time: claimed before any file is written, let go of if the note fails. */
		const restarting = yield* Ref.make(false);
		/**
		 * Restart the host for agent `who`, and why: the `restart` tool's host side. Only with an app
		 * attached, since the app starts the next host. The restart is claimed first, so of two agents
		 * that ask at the same moment the second is refused and only one note is left. The note for the
		 * next host is left next, so a restart that could not leave one is refused and changes nothing.
		 * Then its line, then the answer, and the host ends `ANSWER_FIRST` on. Every job stays in the
		 * table, detached at the next start, as after a SIGTERM.
		 */
		const restartFor =
			(r: Restarts): NonNullable<AgentOptions["restart"]> =>
			(who, ask) =>
				Effect.gen(function* () {
					if (![...clients].some((client) => client.up()))
						return yield* new RestartRefused({
							why: "no app is attached to start a new host: the host would stay down",
						});
					if (yield* Ref.getAndSet(restarting, true))
						return yield* new RestartRefused({why: "the host is restarting already"});
					const table = jobs.table.getState().jobs;
					const detached = table.map((job) => job.n);
					const foreground = table.flatMap((job) =>
						job.state === "running" && !job.background && job.owner !== null
							? [`${job.owner}:%${job.n}`]
							: [],
					);
					const by = writerText(who);
					const at = clock.currentTimeMillisUnsafe();
					yield* r
						.leave({by, why: ask.why, at, detached})
						.pipe(Effect.onError(() => Ref.set(restarting, false)));
					const away = idle();
					yield* Effect.logInfo("host_restart").pipe(
						Effect.annotateLogs({
							by,
							why: ask.why,
							detached: detached.join(","),
							foreground: foreground.join(","),
							...(away === null ? {} : {idle_ms: away}),
							build: build ?? "none",
						}),
					);
					yield* Deferred.succeed(quit, undefined).pipe(
						Effect.delay(ANSWER_FIRST),
						Effect.forkIn(scope),
					);
					return RestartAnswer.make({detached});
				});

		const carry = (c: Carried): Effect.Effect<void> => {
			switch (c.type) {
				case "locate":
					if ("ticket" in c.location)
						return Effect.sync(() => {
							const tile =
								desk.at === "open"
									? desk.workspaces.flatMap(tilesOf).find((one) => one.id === c.tile)
									: undefined;
							const run = tile?.shows.run;
							if (run !== undefined && run !== null)
								screens
									.get(`run:${run.id}`)
									?.heard({type: "msg", msg: {type: "query", value: c.location}});
						});
					return c.location.row === null
						? Effect.void
						: runtime.send({type: "select", value: c.location.row});
				case "start_program":
					return Effect.gen(function* () {
						yield* tiles.open(c.tile);
						const entry = apps.find((app) => app.program.name === c.program);
						if (entry === undefined) return yield* Effect.die(`No program named ${c.program}`);
						const started = yield* entry.start(
							{},
							{},
							{id: `${c.program}:${c.tile}`, storage: memoryStorage()},
						);
						if (started.kind !== "running") return;
						inboxTiles.set(c.tile, started);
						if ("row" in c.location && c.location.row !== null)
							yield* runtime.send({type: "select", value: c.location.row});
						if (c.program === "tracker") {
							if ("ticket" in c.location) yield* started.run.offer("query", c.location);
							const declared = viewOf(tracker);
							const glance = glanceOf(tracker);
							if (declared === undefined || glance === undefined)
								return yield* Effect.die("Tracker has no declared views");
							const pages = new Set<(m: import("../messages.ts").ToWindow) => void>();
							let data: unknown = null;
							const machine = started.run.machines[declared.machine];
							if (machine === undefined)
								return yield* Effect.die("Tracker has no declared machine");
							const provider = {
								program: "tracker",
								last: null as import("../messages.ts").ToWindow | null,
								stop: () => {},
							};
							glanceProviders.set(started.run.id, provider);
							options.glance?.providers(inboxOffers());
							yield* machine.changes.pipe(
								Stream.runForEach((state) =>
									Effect.sync(() => {
										if (state !== null) {
											data = declared.of(state);
											provider.last = {
												type: "view",
												program: "tracker",
												data: glance.of(state),
											};
											tellGlance();
											for (const page of pages) page({type: "view", program: "tracker", data});
										}
									}),
								),
								Effect.forkScoped,
							);
							add(`run:tracker:${c.tile}`, {
								show: (page) => {
									pages.add(page);
									if (data !== null) page({type: "view", program: "tracker", data});
									return () => pages.delete(page);
								},
								heard: (raw) => {
									const input = readInput(tracker, Reflect.get(Object(raw), "msg"));
									if (input.kind === "refused") return input;
									Effect.runForkWith(services)(
										started.run.offer(input.msg.type, input.msg.value).pipe(Effect.ignore),
									);
									return {kind: "read"};
								},
							});
							return;
						}
						add(`run:inbox:${c.tile}`, {
							show: (show) => {
								const draw = () => show({type: "view", program: "inbox", data: inbox.getState()});
								draw();
								return inbox.subscribe(draw);
							},
							heard: (raw) => {
								if (typeof raw !== "object" || raw === null || Reflect.get(raw, "type") !== "msg")
									return {kind: "refused", why: "Expected a program input"};
								sendInbox(Reflect.get(raw, "msg"), c.tile);
								return {kind: "read"};
							},
						});
					}).pipe(Scope.provide(scope), Effect.asVoid);
				case "fence":
					return Deferred.succeed(c.done, undefined).pipe(Effect.asVoid);
				case "open":
					return tiles.open(c.tile, c.agent);
				case "close": {
					const running = inboxTiles.get(c.tile);
					if (running !== undefined) {
						return running.stop.pipe(
							Effect.andThen(
								Effect.sync(() => {
									inboxTiles.delete(c.tile);
									gone(`run:${running.run.id}`);
								}),
							),
							Effect.andThen(tiles.close(c.tile)),
						);
					}
					return tiles.close(c.tile);
				}
				case "stop": {
					const running = inboxTiles.get(c.tile);
					if (running !== undefined) {
						return running.stop.pipe(
							Effect.andThen(
								Effect.sync(() => {
									inboxTiles.delete(c.tile);
									gone(`run:${running.run.id}`);
								}),
							),
							Effect.andThen(tiles.stop(c.tile)),
						);
					}
					return tiles.stop(c.tile);
				}
				case "end":
					return tiles.end(c.process);
				case "kill":
					return tiles.kill(c.process);
				case "send":
					if (inboxTiles.has(c.tile) && c.data === "\u0003") return runtime.leave;
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

		// The keys file, heard: the first answer before any page is served, then one each save.
		const heardKeys = yield* Deferred.make<void>();
		const swap = (answer: Setting<Keys>) => {
			if (answer._tag === "refused") {
				// The last table that read stays, on the desk and on the pages; only the file's word changes.
				table = {...table, file: File.cases.refused.make({line: answer.line, why: answer.why})};
			} else {
				table = answer._tag === "read" ? answer.value : defaults;
				step({type: "keys", keys: table});
			}
			for (const client of clients) if (client.page) toPage(client, keysNow());
			shout();
		};
		const keyChanges = options.keybindings.changes.pipe(
			Stream.map((next): Setting<Keys> => {
				snapshot = next;
				return next.keys.file._tag === "read" ? {_tag: "read", value: next.keys} : next.keys.file;
			}),
		);
		yield* keyChanges.pipe(
			Stream.runForEach((answer) =>
				Effect.logInfo("keys").pipe(
					Effect.annotateLogs(
						answer._tag === "refused"
							? {file: "refused", line: answer.line, why: answer.why}
							: answer._tag === "read"
								? {
										file: "read",
										yours: answer.value.rows.filter((r) => r.source === "yours").length,
									}
								: {file: "none"},
					),
					Effect.andThen(Effect.sync(() => swap(answer))),
					Effect.andThen(Deferred.succeed(heardKeys, undefined)),
				),
			),
			// A reader that ends or fails still lets the host serve, on the table it had.
			Effect.ensuring(Deferred.succeed(heardKeys, undefined)),
			Effect.forkScoped,
		);
		yield* Deferred.await(heardKeys);
		const editorQueue = yield* Queue.unbounded<{
			client: Client;
			message: Extract<FromPage, {type: "keys.open" | "keys.close" | "keys.edit"}>;
		}>();
		const closeEditor = (client: Client) =>
			Effect.sync(() => {
				const running = client.editor;
				if (running === null) return;
				for (const request of keyRequests.values())
					if (request.waiting.delete(client) && request.waiting.size === 0) request.screen.closed();
				client.editor = null;
				running.close("close");
				running.close("edit");
				gone(`run:${running.run.id}`);
				toPage(client, {type: "keys.closed", run: running.run.id});
			});
		const openEditor = (client: Client) =>
			Effect.gen(function* () {
				if (client.editor !== null) return client.editor;
				const manager = options.keybindings;
				const running = yield* start(
					keysProgram,
					{window: client.id},
					{
						saved: (saved) => toPage(client, {type: "keys.saved", ...saved}),
						failed: (failed) => toPage(client, {type: "keys.failed", ...failed}),
					},
					{id: `keys:${crypto.randomUUID().slice(0, 8)}`, storage: memoryStorage()},
				).pipe(Effect.provideService(KeybindingManager, manager));
				if (running.kind !== "running") {
					toPage(client, {
						type: "keys.failed",
						request: "open",
						why: "The keyboard editor could not start.",
					});
					return null;
				}
				client.editor = running;
				for (const request of keyRequests.values()) request.waiting.add(client);
				add(`run:${running.run.id}`, {
					show: (page) => {
						page({type: "view", program: "keys", data: {open: true}});
						return () => {};
					},
					heard: () => ({kind: "refused", why: "Use the checked keys inputs on the desk port."}),
				});
				toPage(client, {type: "keys.opened", run: running.run.id});
				return running;
			});
		yield* Queue.take(editorQueue).pipe(
			Effect.flatMap(({client, message}) =>
				Effect.gen(function* () {
					if (message.type === "keys.close") return yield* closeEditor(client);
					if (!client.page) return;
					const running = yield* openEditor(client);
					if (message.type === "keys.edit") {
						if (running === null) {
							toPage(client, {
								type: "keys.failed",
								request: message.request,
								why: "Keyboard settings are unavailable.",
							});
							return;
						}
						yield* tell(running.run, "edit", {
							request: message.request,
							edit: message.edit,
							said: message.said,
						});
					}
				}),
			),
			Effect.catchCause((cause) => Effect.logError("Keyboard editor request failed", cause)),
			Effect.forever,
			Effect.forkScoped,
		);
		if (agents !== undefined)
			yield* serveAgents({
				rooms,
				server: agents.server,
				ports: () => screens.keys(),
				attached: agentCame,
				job: lines.job,
				stop: stopFor,
				restart: restarts === undefined ? undefined : restartFor(restarts),
				line: lineFor,
				sessionFor: options.ledger.kind === "server" ? options.ledger.sessionFor : null,
			}).pipe(
				Effect.catchCause((cause) =>
					Effect.logError("fabrika host: the agents' socket failed", cause),
				),
				Effect.forkScoped,
			);

		/** A key the desk takes: logged when it runs a command, as the person spells it in the file. */
		const pressed = (s: Open, key: string, at: number) => {
			const routed = route(s, key, at);
			if (routed.kind !== "desk" || routed.ran === null) return;
			const {does, key: on} = routed.ran;
			// The desk's prefix is the table's: a refused file changes neither.
			const keys =
				on._tag === "after_prefix" ? `${spell(table.prefix)} ${spell(on.key)}` : spell(on.key);
			did(does, Via.key({keys}));
		};

		/** What the page sent on the desk's port. */
		const fromPage = (client: Client, m: FromPage) => {
			switch (m.type) {
				case "open_program":
					requestOpen(m);
					return;
				case "inbox_input":
					sendInbox(m.msg, m.from, m.via);
					return;
				case "glance_choose":
					if (options.glance !== undefined)
						Effect.runForkWith(services)(
							options.glance
								.choose(m.program)
								.pipe(Effect.catch((error) => Effect.logWarning(error.why))),
						);
					return;
				case "open_lane": {
					if (desk.at !== "open") return;
					const source = desk.workspaces.flatMap(tilesOf).find((t) => t.id === m.from);
					if (source === undefined) return;
					const root = source.shows.kind === "tsh" ? source.id : source.shows.line.from;
					Effect.runForkWith(services)(
						tiles.lane(root, m.ticket).pipe(
							Effect.match({
								onSuccess: (run) => {
									if (desk.at !== "open") return;
									const tile = desk.workspaces
										.flatMap(tilesOf)
										.find((t) => t.shows.run?.id === run);
									if (tile !== undefined) step({type: "go", tile: tile.id});
									shout();
								},
								onFailure: (error) => warn(error.why),
							}),
						),
					);
					return;
				}
				case "ask_answer":
					Effect.runForkWith(services)(
						saveCell({type: "save", id: m.id, next: 1, write: {kind: "answer", ...m.value}}).pipe(
							Effect.provideService(Ledger, ledger),
							Effect.provideService(Author, author),
							Effect.match({
								onSuccess: () => toPage(client, {type: "ask_answered", id: m.id, why: null}),
								onFailure: (error) =>
									toPage(client, {type: "ask_answered", id: m.id, why: error.why}),
							}),
						),
					);
					return;
				case "keys.open":
				case "keys.close":
				case "keys.edit":
					Queue.offerUnsafe(editorQueue, {client, message: m});
					return;
				case "press": {
					const at = clock.currentTimeMillisUnsafe();
					lastKey = at;
					const took = claims(desk, m.key, at);
					if (took && desk.at === "open") pressed(desk, m.key, at);
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
					did("tezgah.fold", Via.click());
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
				case "pick": {
					// A workspace clicked in the top bar: the command its number runs, from the first nine.
					const at =
						desk.at === "open" ? desk.workspaces.findIndex((w) => w.id === m.workspace) : -1;
					const word = at < 0 ? undefined : commandFor({kind: "pick", at: at + 1});
					if (word !== undefined) did(word, Via.click());
					if (step({type: "pick", workspace: m.workspace})) shout();
					return;
				}
				case "run":
					if (m.does.startsWith("program.inbox.") && desk.at === "open") {
						const command = commandsOf(inboxProgram).find((c) => `program.${c.id}` === m.does);
						if (command !== undefined)
							sendInbox(
								command.send,
								activeOf(desk).focused,
								m.via === undefined
									? CommandVia.cases.palette.make({})
									: CommandVia.cases.key.make({keys: m.via.keys}),
							);
						return;
					}
					did(m.does, m.via === undefined ? Via.palette() : Via.key(m.via));
					if (m.does === "palette.open") {
						toPage(client, {type: "show", what: "palette"});
						return;
					}
					if (step({type: "run", does: m.does}, client)) shout();
					return;
				case "later":
				case "back":
					Effect.runForkWith(services)(
						runtime.send({type: "mark", key: m.key, later: m.type === "later"}),
					);
					return;
				case "seen":
					Effect.runForkWith(services)(runtime.send({type: "seen", value: null}));
					return;
				// The top bar's Dismiss: the person at the window, as `dismiss <name>` in their tile.
				case "dismiss":
					if (summons !== undefined)
						Effect.runForkWith(services)(
							summons
								.dismiss(m.name, writerText(author))
								.pipe(
									Effect.catch((e) =>
										Effect.logWarning(`fabrika host: could not dismiss ${m.name}: ${e.why}`),
									),
								),
						);
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
					toPage(client, keysNow());
					toPage(client, programs);
					toPage(client, hostNow());
					toPage(client, saidAsks);
					toPage(client, inboxNow());
					toPage(client, glanceNow());
					toPage(client, glanceView());
					toPage(client, deskNow());
					for (const [name, screen] of screens) showTo(client, name, screen);
					return;
				case "away":
					Queue.offerUnsafe(editorQueue, {client, message: {type: "keys.close"}});
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
					// Keys typed in a tile's terminal are the person's keys too; its size is not.
					else if (m.port.startsWith("tile:") && Reflect.get(Object(m.m), "type") === "keys")
						lastKey = clock.currentTimeMillisUnsafe();
					return;
				}
			}
		};

		const attach = (socket: Socket.Socket) =>
			Effect.gen(function* () {
				const client: Client = {
					id: crypto.randomUUID(),
					editor: null,
					send: () => {},
					up: () => false,
					page: false,
					shown: new Map(),
				};
				const wire = yield* hostWire(socket, (m) => fromApp(client, m), ours, build);
				client.send = wire.send;
				client.up = () => wire.state().at === "up";
				clients.add(client);
				const why = yield* wire.ended;
				client.page = false;
				yield* closeEditor(client);
				hide(client);
				clients.delete(client);
				yield* Effect.logDebug(`fabrika host: an app went: ${why}`);
			}).pipe(Effect.scoped);

		// Until the scope closes, or a restart's answer is out: then the host ends of itself, with a
		// success, and its scope closes as a SIGTERM closes it.
		return yield* server.run(attach).pipe(Effect.raceFirst(Deferred.await(quit)));
	});
