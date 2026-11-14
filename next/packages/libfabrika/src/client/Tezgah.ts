/**
 * A window's side of tezgah (0167): the server state tezgah last sent, and the focus moves this
 * window made that the server has not answered yet. The drawn state is derived from the two by
 * `optimisticState` and is never stored. One tea machine; the window parent steps it by hand.
 *
 * Its states: `serverState` is null until the first view that decodes as `TezgahView`, then the
 * newest one. A patch must start at the shown revision and end one past it; anything else keeps
 * the shown view and asks for a whole one, as a program client does (`runtime/Client.ts`).
 *
 * @stability unstable
 */
import { Cmd, Machine } from "@demlik/tea/effect";
import { Result, Schema } from "effect";
import { apply } from "../runtime/Patch.ts";
import { order } from "../tezgah/Layout.ts";
import { CursorKey, TezgahView, TileId } from "../tezgah/Workspace.ts";

/**
 * Schema for one focus move this window made and the server has not answered: its letter, the
 * tile it moved to and the cursor it left behind.
 *
 * @stability unstable
 * @category schemas
 */
export const PendingMutation = Schema.Struct({ letter: Schema.String, to: TileId, cursor: Schema.NullOr(CursorKey) });

/**
 * Schema for the window's tezgah child: the workspace it shows, tezgah's last view and its
 * revision, and the moves still pending.
 *
 * @stability unstable
 * @category schemas
 */
export const TezgahClient = Schema.Struct({
  workspace: Schema.Int,
  serverState: Schema.NullOr(TezgahView),
  rev: Schema.Int,
  pendingMutations: Schema.Array(PendingMutation),
});

/**
 * The window's tezgah child, as `TezgahClient` decodes it.
 *
 * @stability unstable
 * @category models
 */
export type TezgahClient = typeof TezgahClient.Type;

const Msg = Schema.Union([
  /** A whole view from tezgah, as the wire carries it. */
  Schema.Struct({ type: Schema.Literal("server"), rev: Schema.Int, view: Schema.Unknown }),
  /** One view patch from tezgah, from revision `base` to `rev`. */
  Schema.Struct({ type: Schema.Literal("patch"), base: Schema.Int, rev: Schema.Int, patch: Schema.Unknown }),
]);

/**
 * The type of a Msg the window's tezgah child takes: a whole view, or a patch.
 *
 * @stability unstable
 * @category models
 */
export type TezgahMsg = typeof Msg.Type;

/** Ask tezgah for a whole view: the shown one stays until it comes. The window turns it into its
 *  own open call and never runs it. */
const ask = Cmd.make("ask", { input: Schema.Struct({}), ok: Schema.Null, err: [] });

type Step = readonly [TezgahClient, ReadonlyArray<ReturnType<typeof ask>>];

const decodeView = Schema.decodeUnknownResult(TezgahView);
const encodeView = Schema.encodeUnknownResult(TezgahView);

/**
 * The window's tezgah child as one tea machine. Its ctx names the workspace the window shows.
 *
 * @stability unstable
 * @category machines
 */
export const tezgahMachine = Machine.make({
  model: TezgahClient,
  msg: Msg,
  cmds: [ask],
  types: { ctx: {} as { readonly workspace: number } },
  init: (loaded, ctx) => [
    loaded ?? TezgahClient.make({ workspace: ctx.workspace, serverState: null, rev: 0, pendingMutations: [] }),
    [],
  ],
  update: {
    server: (s, m): Step => {
      const view = decodeView(m.view);
      return Result.isSuccess(view) ? [{ ...s, serverState: view.success, rev: m.rev }, []] : [s, []];
    },
    patch: (s, m): Step => {
      if (s.serverState === null) {
        return [s, [ask({})]];
      }

      if (m.rev <= s.rev) {
        return [s, []];
      }

      const view = s.serverState;
      const next: Result.Result<TezgahView, unknown> =
        m.base === s.rev && m.rev === s.rev + 1
          ? Result.flatMap(
              Result.flatMap(encodeView(view), (before) => apply(before, m.patch)),
              decodeView,
            )
          : Result.fail("gap");
      return Result.isSuccess(next) ? [{ ...s, serverState: next.success, rev: m.rev }, []] : [s, [ask({})]];
    },
    ask_ok: (s): Step => [s, []],
    ask_err: (s): Step => [s, []],
  },
});

type Mutation = typeof PendingMutation.Type;

/** One pending focus move over a view: the workspace that holds `to` focuses it. */
const applyFocus = (view: TezgahView | null, mutation: Mutation): TezgahView | null =>
  view === null
    ? null
    : {
        ...view,
        workspaces: view.workspaces.map((w) =>
          order(w.layout).includes(mutation.to)
            ? { ...w, focus: mutation.to, recent: [mutation.to, ...w.recent.filter((t) => t !== mutation.to)] }
            : w,
        ),
      };

/**
 * Returns the state a window draws: the server state with every pending move applied on top. It
 * is derived on each read and never stored (0167); with nothing pending it is the server state.
 *
 * @stability unstable
 * @category getters
 */
export const optimisticState = (m: TezgahClient): TezgahView | null =>
  m.pendingMutations.reduce(applyFocus, m.serverState);
