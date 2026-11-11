import { AskAnswer } from "@tea-fabrika/tracker";
import { Cause, Effect, Exit, Option, Schema } from "effect";
import { AskKey, AsksNow } from "./asks.ts";
import { DeskSchema, TileIdSchema } from "./desk/desk.ts";
import { Does, KeyName, Keys } from "./desk/keymap.ts";
import { SHOWS } from "./desk/keys.ts";
import { Change, Edit } from "./keys/program.ts";

// What the app's one window and the host say to each other. The window draws the desk
// (desk/desk.ts, run in the host), a terminal per tile, and a view per run of a program with one;
// each has its own two message types, on a port of its own. They are the protocol: the page's
// MessagePort and the host's socket (link.ts) are only what carries them, and the app's main
// process relays them unread, but for the asks, which it reads for the Dock badge on the way
// (`readAsks`). Only Try again (`ToApp`) is main's own, and goes no further. No
// platform here: the window imports this file too.
//
// A tile's terminal is a terminal and nothing more, as a terminal emulator is to a pty: it
// sends the keys pressed and its size, and draws the bytes it is sent. The line editor and tsh
// are in the host (tsh.ts).
//
//   to the terminal      {type: "write", data: "tsh$ "}
//   from the terminal    {type: "keys", data: "cou\t"}
//                        {type: "size", cols: 100, rows: 30}
//
// A program's view draws one run of one program with a view, in a tile, and sends what the
// view sends. Its port is that run's: a message on it can only be for that run. Its types keep
// the word "window", as the programs' own `WindowProps` do.
//
//   to a window          {type: "view", program: "counter", data: {n: 0}}
//   from a window        {type: "msg", msg: {type: "press", value: "plus"}}
//
// A window's `msg` is one of its run's inputs, and only the run's program reads it: the host
// reads it with `readInput` (from @kampus/fabrika-old), after this file's reader took the envelope.
// A view's `data` is read the same way, in the window, by its program's view schema.
//
// Each side reads what it is handed strictly, with no key the schema does not name. The host
// refuses a message from a window that does not read; it never passes one on.

/** A terminal's width or height, in cells. */
const Cells = Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 1000 }));

/**
 * What a tile's terminal is told: bytes to draw, and, for a screen reader, which the canvas is
 * blank to, a job's status (`null`: none any more) and a line to say, such as an agent's reply.
 */
export const ToTerminal = Schema.Union([
  Schema.Struct({ type: Schema.Literal("write"), data: Schema.String }),
  Schema.Struct({ type: Schema.Literal("status"), text: Schema.NullOr(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("said"), text: Schema.String }),
]);
export type ToTerminal = typeof ToTerminal.Type;

const FromTerminal = Schema.Union([
  // A paste is one message: 64 KiB is a long one. Past it, the message is refused whole.
  Schema.Struct({
    type: Schema.Literal("keys"),
    data: Schema.String.check(Schema.isMaxLength(65536)),
  }),
  Schema.Struct({ type: Schema.Literal("size"), cols: Cells, rows: Cells }),
]);
type FromTerminal = typeof FromTerminal.Type;

export const ToWindow = Schema.Struct({
  type: Schema.Literal("view"),
  /** The program's name, which picks the window that draws it. */
  program: Schema.String,
  /** Its view's data, which only its own schema reads. */
  data: Schema.Unknown,
});
export type ToWindow = typeof ToWindow.Type;

const FromWindow = Schema.Struct({
  type: Schema.Literal("msg"),
  /** One of the run's inputs, `{type, value}`: read by its program, not here. */
  msg: Schema.Unknown,
});
type FromWindow = typeof FromWindow.Type;

/** A number the page gives each key it sends the host, so the answer names the key it is for. */
const PressId = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** What waits on the person, as the host folded it (asks.ts): on the desk's port, to every app. */
const AsksMessage = Schema.Struct({ type: Schema.Literal("asks"), now: AsksNow });

/** A size on the page, in whole px: no screen is wider than this. */
const Pixels = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(100_000));

/**
 * What the app found of the host on its home, once a try to attach answered: the window's
 * branches (docs/direction/an-old-host-is-named-then-restarted.md).
 *
 *   {kind: "up"}                                               attached, to a host of this build
 *   {kind: "version", theirs: 1, ours: 2}                       refused: both named, and the restart offered
 *   {kind: "build", theirs: "3f9a0c21b7d4", ours: "77e1..."}    attached, with the banner and the restart
 *
 * `theirs: null` in `build`: the host named no build, as one built before builds were named.
 */
export const Found = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("up") }),
  Schema.Struct({ kind: Schema.Literal("version"), theirs: Schema.Int, ours: Schema.Int }),
  Schema.Struct({
    kind: Schema.Literal("build"),
    theirs: Schema.NullOr(Schema.String),
    ours: Schema.String,
  }),
]);
export type Found = typeof Found.Type;

/** What the app found when it is attached: this build, or another. */
export type Attached = Extract<Found, { readonly kind: "up" | "build" }>;

/**
 * The link while the app is not on a host: it is reconnecting, it stopped trying and waits for
 * Try again, or it is stopping the old host to start its own (the restart).
 */
const Lost = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("reconnecting"), why: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("stopped"), why: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("restarting") }),
]);
type Lost = typeof Lost.Type;

/** What the window shows of the link now: what the app found, or how it is lost. */
export const LinkNow = Schema.Union([Found, Lost]);
export type LinkNow = typeof LinkNow.Type;

/** A time on the host's clock, in milliseconds since 1970. */
const Millis = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** An agent attached to the host's agents' socket now (host/agents.ts): its name, and since when. */
export const AgentOn = Schema.Struct({
  name: Schema.String,
  since: Millis,
  /**
   * The agent's own tile, or `null`: it ran no line yet. A host from before agents had tiles
   * sends none.
   */
  tile: Schema.NullOr(TileIdSchema).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
});
export type AgentOn = typeof AgentOn.Type;

/**
 * An agent the person summoned on this host (tsh's `summon`): its name, what it runs on, what it
 * does now, and since when. Ours to dismiss, unlike one attached over the agents' socket.
 */
export const SummonedOn = Schema.Struct({
  name: Schema.String,
  agent: Schema.String,
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(Schema.String),
  state: Schema.Literals(["opening", "idle", "turn", "asking", "down"]),
  since: Millis,
});
export type SummonedOn = typeof SummonedOn.Type;

/**
 * Which ledger the home's host reads and writes (host/connection.ts): the home's own file, or a
 * ledger server, by its address and the login the host signs in as.
 */
export const LedgerLink = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("own") }),
  Schema.Struct({ kind: Schema.Literal("server"), address: Schema.String, login: Schema.String }),
]);
export type LedgerLink = typeof LedgerLink.Type;

/**
 * Who restarted the host before this one, as a writer's text, why, and when (host/restart.ts): an
 * agent's `restart` says why; the person's, from the window, says none.
 */
const Restarted = Schema.Struct({
  by: Schema.String,
  why: Schema.NullOr(Schema.String),
  at: Millis,
});

/**
 * The host, as it says of itself (host/serve.ts): its process, when it started, its build, its
 * ledger, the agents attached now, and who restarted the host before it. `agents` is `null` on a
 * host with no agents' socket: a test's, or one built before every home had one (host/agents.ts).
 * `summoned` is the agents the person summoned here (tsh's `summon`), apart from those attached.
 * `restarted` is `null` on a host that started fresh, or after a crash. A host of an older build
 * sends none, and the app still attaches to it, so a `HostNow` without it reads.
 */
export const HostNow = Schema.Struct({
  pid: Schema.Int.check(Schema.isGreaterThan(0)),
  since: Millis,
  /** Its build (build-id.ts), or `null`: it names none, as a host built before builds were named. */
  build: Schema.NullOr(Schema.String),
  ledger: LedgerLink,
  agents: Schema.NullOr(Schema.Array(AgentOn)),
  restarted: Schema.optionalKey(Schema.NullOr(Restarted)),
  /** The agents summoned here, oldest first. A host from before summon sends none. */
  summoned: Schema.optionalKey(Schema.Array(SummonedOn)),
});
export type HostNow = typeof HostNow.Type;

/**
 * What the host tells the page, on the desk's port. The desk runs in the host (host/serve.ts);
 * the page draws what it is sent and nothing else. `keys` is the keys file's table (desk/keymap.ts):
 * the prefix, one row per command, the keys eaten and what came of the file, sent as the page
 * loads and again each time the file is saved. `desk` is the whole desk, after every change,
 * with the keys the desk takes now (`takes`): the page sends those keys to the host and no
 * further. `answer` says whether the
 * host took the key sent with that id; a key it did not take goes on to the tile, in order.
 * `link` is the app's own, not the host's: what the window shows of the link `now`
 * (reconnect.ts), sent each time that changes, and again as a page loads.
 *
 *   {type: "keys", prefix: "<c-b>", rows: [{does: "tezgah.split", keys: [{_tag: "after_prefix",
 *    key: "|"}], source: "default"}, ...], ignore: ["<m-w>"], file: {_tag: "none"}}
 *   {type: "desk", desk: {at: "open", ...}, takes: {all: false, keys: ["<c-b>"]}}
 *   {type: "answer", id: 3, took: true}
 *   {type: "link", now: {kind: "reconnecting", why: "The link to the host ended: the other side closed."}}
 *   {type: "link", now: {kind: "version", theirs: 1, ours: 2}}
 *
 * For the window's frame (window/frame.tsx): `programs` is what each program takes and sends,
 * by its inputs' and outputs' names, sent once as the page loads. `asks` is what waits on the
 * person (asks.ts), sent each time it changes, to every app attached, with a page or not: the
 * app's main reads it for the Dock badge. `show` is what a key the page sent asks the frame to
 * show (desk.ts, `show`), sent to that page alone, before its answer; a desk word typed in a
 * tile's tsh (desk/words.ts) asks it of every page. `host` is the host as it says of itself, sent
 * as a page loads and each time an agent attaches or goes.
 *
 *   {type: "programs", programs: [{name: "ticket", takes: ["ticket"], sends: ["ticket"]}]}
 *   {type: "asks", now: {asks: [{key: "7/a-1", ticket: 7, what: "approve plan", ...}], ...}}
 *   {type: "show", what: "keys"}
 *   {type: "host", now: {pid: 4121, since: 1793400000000, build: "3f9a0c21b7d4",
 *    ledger: {kind: "own"}, agents: [{name: "claude", since: 1793400060000}]}}
 */
export const ToPage = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("ask_answered"),
    id: Schema.String,
    why: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("keys"),
    ...Keys.fields,
    version: Schema.optionalKey(Schema.String),
    changes: Schema.optionalKey(Schema.Array(Change)),
  }),
  Schema.Struct({
    type: Schema.Literal("keys.saved"),
    request: Schema.String,
    version: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("keys.failed"), request: Schema.String, why: Schema.String }),
  Schema.Struct({ type: Schema.Literal("keys.opened"), run: Schema.String }),
  Schema.Struct({ type: Schema.Literal("keys.closed"), run: Schema.String }),
  Schema.Struct({ type: Schema.Literal("host"), now: HostNow }),
  Schema.Struct({
    type: Schema.Literal("programs"),
    programs: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        takes: Schema.Array(Schema.String),
        sends: Schema.Array(Schema.String),
      }),
    ),
  }),
  AsksMessage,
  Schema.Struct({
    type: Schema.Literal("show"),
    what: Schema.Literals([...SHOWS, "focus-next", "focus-previous"]),
  }),
  Schema.Struct({
    type: Schema.Literal("desk"),
    desk: DeskSchema,
    takes: Schema.Struct({ all: Schema.Boolean, keys: Schema.Array(KeyName) }),
  }),
  Schema.Struct({ type: Schema.Literal("answer"), id: PressId, took: Schema.Boolean }),
  Schema.Struct({ type: Schema.Literal("link"), now: LinkNow }),
]);
export type ToPage = typeof ToPage.Type;

/**
 * What the page tells the app itself, on the desk's port: the person pressed Try again, after the
 * app stopped trying to reconnect, or "Stop the old host and start this one". Main reads it and
 * does not pass it on; the host never sees it.
 *
 *   {type: "again"}
 *   {type: "restart"}
 */
export const ToApp = Schema.Union([
  Schema.Struct({ type: Schema.Literal("again") }),
  Schema.Struct({ type: Schema.Literal("restart") }),
]);
export type ToApp = typeof ToApp.Type;

/**
 * What the page tells the host, on the desk's port: a key the desk takes, a click on a tile, a
 * border let go, a double-click on a title bar (fold) or a click on a strip (unfold). A tile's
 * id names a folder in the app's home, so it is read by its pattern (`t` and a number) and
 * nothing else passes. The host stamps each key with its own clock.
 *
 *   {type: "press", id: 3, key: "<c-b>"}
 *   {type: "click", tile: "t2"}
 *   {type: "resize", container: "c2", sizes: {t1: 30, t2: 70}}
 *   {type: "fold", tile: "t2"}
 *   {type: "unfold", node: "c4"}
 *   {type: "area", width: 1432, height: 868}     the workspace was drawn at this size, in px
 *
 * And from the window's frame (window/frame.tsx), with no key pressed:
 *
 *   {type: "go", tile: "t7"}          an ask picked in the asks list: its tile, wherever it is
 *   {type: "pick", workspace: "w2"}   a workspace clicked in the top bar
 *   {type: "run", does: "tezgah.zoom"}   the palette ran a command by its word, bound or not
 *   {type: "later", key: "7/a-1"}     an ask set aside: out of the count, at the list's foot
 *   {type: "back", key: "7/a-1"}      and counted again
 *   {type: "seen"}                    the asks list was opened: no ask is new any more
 */
export const FromPage = Schema.Union([
  Schema.Struct({ type: Schema.Literal("open_lane"), from: TileIdSchema, ticket: Schema.Int }),
  Schema.Struct({ type: Schema.Literal("ask_answer"), id: Schema.String, value: AskAnswer }),
  Schema.Struct({
    type: Schema.Literal("keys.edit"),
    request: Schema.String,
    edit: Edit,
    said: Schema.Number,
  }),
  Schema.Struct({ type: Schema.Literal("keys.open") }),
  Schema.Struct({ type: Schema.Literal("keys.close") }),
  Schema.Struct({ type: Schema.Literal("press"), id: PressId, key: KeyName }),
  Schema.Struct({ type: Schema.Literal("click"), tile: TileIdSchema }),
  Schema.Struct({
    type: Schema.Literal("resize"),
    container: Schema.String,
    sizes: Schema.Record(Schema.String, Schema.Number),
  }),
  Schema.Struct({ type: Schema.Literal("fold"), tile: TileIdSchema }),
  Schema.Struct({ type: Schema.Literal("unfold"), node: Schema.String }),
  Schema.Struct({ type: Schema.Literal("area"), width: Pixels, height: Pixels }),
  Schema.Struct({ type: Schema.Literal("go"), tile: TileIdSchema }),
  Schema.Struct({ type: Schema.Literal("pick"), workspace: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("run"),
    does: Does,
    via: Schema.optionalKey(Schema.Struct({ keys: Schema.String })),
  }),
  Schema.Struct({ type: Schema.Literal("later"), key: AskKey }),
  Schema.Struct({ type: Schema.Literal("back"), key: AskKey }),
  Schema.Struct({ type: Schema.Literal("seen") }),
  Schema.Struct({ type: Schema.Literal("dismiss"), name: Schema.String }),
]);
export type FromPage = typeof FromPage.Type;

/** A message read: what it says, or why it was refused, in the schema's words. */
export type Read<T> = { readonly kind: "read"; readonly msg: T } | { readonly kind: "refused"; readonly why: string };

/**
 * A reader for one of the message types: strict, so a key the schema does not name is refused.
 * What it reads may be older than what it answers: a desk from a host before letters (desk.ts).
 */
export const reader = <T, E>(schema: Schema.Codec<T, E>) => {
  const decode = Schema.decodeUnknownExit(schema);
  return (raw: unknown): Read<T> => {
    const exit = decode(raw, { onExcessProperty: "error" });

    if (Exit.isSuccess(exit)) {
      return { kind: "read", msg: exit.value };
    }

    const failure = Cause.squash(exit.cause);
    return { kind: "refused", why: failure instanceof Error ? failure.message : String(failure) };
  };
};

/** What the host reads from the terminal. */
export const readFromTerminal = reader(FromTerminal);
/** What the terminal reads from the host. */
export const readToTerminal = reader(ToTerminal);
/** What the host reads from a program's window. */
export const readFromWindow = reader(FromWindow);
/** What a program's window reads from the host. */
export const readToWindow = reader(ToWindow);
/** What the host reads from the page, on the desk's port. */
export const readFromPage = reader(FromPage);
/** What the page reads from the host, on the desk's port. */
export const readToPage = reader(ToPage);
const AnswerId = Schema.Struct({ type: Schema.Literal("ask_answer"), id: Schema.String });

/** The id of an answer the page sent, even one whose value does not read: its reply needs it. `null`: no answer. */
export const answerIdOf = (raw: unknown): string | null =>
  Option.getOrNull(Option.map(Schema.decodeUnknownOption(AnswerId)(raw), (m) => m.id));

/** What main reads from the page, on the desk's port, before it passes the rest on to the host. */
export const readToApp = reader(ToApp);
/** What main reads of the host's messages on the desk's port: the asks, for the Dock badge. */
export const readAsks = reader(AsksMessage);
