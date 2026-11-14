/**
 * A program's window contract: its data, presses and optional tile machine.
 *
 * @stability unstable
 */
import type { Machine } from "@demlik/tea/effect";
import type { Schema } from "effect";
import type { Program } from "./Program.ts";

// --- A program's window -------------------------------------------------------------------------

type AnyProgram = Program<any, any, any, any, any>;

/** The data a program's window gets: what its view selector returns. */
export type WindowData<P extends AnyProgram> = Readonly<ReturnType<P["view"]["select"]>>;
/** The Msgs a program's window may send: the program's own, and nothing else. */
export type WindowMsg<P extends AnyProgram> = P["machine"]["msg"]["Type"];

/** What a program's window is given: its checked data, and `press` for one of its own Msgs. */
export type WindowProps<P extends AnyProgram> = {
  readonly data: WindowData<P>;
  readonly press: (m: WindowMsg<P>) => void;
  /** The key a command is bound to now, from the one table matching reads, or null. */
  readonly hint?: (command: WindowCommand<P>) => string | null;
  readonly refusal?: string | null;
};

/** A pure child machine stepped by a window parent. Its only output is a program press. */
export type AnyTile = Machine<any, any, any, any, any> & {
  readonly model: Schema.Schema<any>;
  readonly msg: Schema.Schema<any>;
};

export type TileProps<T extends AnyTile = never> = [T] extends [never]
  ? unknown
  : {
      readonly tile: T["model"]["Type"];
      readonly send: (msg: T["msg"]["Type"]) => void;
    };

type TileCommand<T> = T extends Machine<any, any, infer C, any, any> ? C : never;

type CheckedTile<P extends AnyProgram, T extends AnyTile> =
  TileCommand<T> extends {
    readonly type: "press";
    readonly m: WindowMsg<P>;
  }
    ? T
    : never;

/** A command name for one of the program's inputs, such as `counter.inc`. */
export type WindowCommand<P extends AnyProgram> = `${string}.${keyof P["inputs"] & string}`;

/** How a window is registered: the decoder its data must pass at runtime, the view, and the
 *  default key rows for its inputs. */
export type WindowRegistration<P extends AnyProgram, View = unknown, T extends AnyTile = never> = {
  readonly data: Schema.Decoder<WindowData<P>>;
  readonly View: (props: WindowProps<P> & TileProps<T>) => View;
  readonly keys: Readonly<Partial<Record<WindowCommand<P>, ReadonlyArray<string>>>>;
  readonly tile?: CheckedTile<P, T>;
  readonly refused?: (m: WindowMsg<P>, reason: string) => string;
};

/** Checks a window against its program at compile time, and hands the registration back. The
 *  registration is typed as the contract itself, not inferred, so a key row the program lacks is refused. */
export const defineWindow = <P extends AnyProgram, View, T extends AnyTile = never>(
  _program: P,
  registration: WindowRegistration<NoInfer<P>, View, NoInfer<T>> & { readonly tile?: T },
): WindowRegistration<P, View, T> => registration;

/** The Msg a key command sends: the input named after the program's dot, with no fields. */
export const commandMsg = (command: string): { readonly type: string } | null => {
  const dot = command.indexOf(".");
  return dot <= 0 || dot === command.length - 1 ? null : { type: command.slice(dot + 1) };
};
