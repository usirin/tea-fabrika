// P18 slice 1, next/ (ticket 290): the window start's test socket. One in-memory WebSocket that
// Effect's own `Socket.fromWebSocket` reads through an injected `Socket.WebSocketConstructor`, so
// the start's laws run on Effect's real reader and writer, never on a socket of our own making.
import type { Socket } from "effect/socket";

type Kind = "open" | "message" | "error" | "close";
type Listener = (event: Socket.WebSocketEvent) => void;

/** What a test learns as the socket is used: each send, each listener, each close it was asked for. */
export type Hooks = {
  readonly send?: (text: string, socket: MemorySocket) => void;
  readonly closed?: (socket: MemorySocket) => void;
};

/**
 * One in-memory WebSocket, as a browser's behaves where a law can see it.
 *
 * **Details**
 *
 * An event fired before any listener of its kind is attached waits for the first one, so nothing
 * the door says is lost while Effect's reader attaches. `send` while connecting throws, as a
 * browser's does, and after a close it drops the text. `close` records its code; `drop` is the
 * door closing the socket with a code of its own.
 */
export class MemorySocket implements Socket.WebSocketLike {
  readyState = 0;
  /** Every text the client wrote while the socket was open, in order. */
  readonly sent: Array<string> = [];
  /** How many `message` listeners were ever attached: one per reader. */
  readers = 0;
  /** The code the client closed with, or null while it has not closed it. */
  closedWith: number | null = null;
  readonly url: string;
  private readonly hooks: Hooks;
  private readonly listeners = new Map<Kind, Array<{ readonly fn: Listener; readonly once: boolean }>>();
  private readonly waiting = new Map<Kind, Array<Socket.WebSocketEvent>>();

  constructor(url: string, hooks: Hooks = {}) {
    this.url = url;
    this.hooks = hooks;
  }

  addEventListener(type: Kind, listener: Listener, options?: { readonly once?: boolean }): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), { fn: listener, once: options?.once === true }]);
    this.readers += type === "message" ? 1 : 0;
    const held = this.waiting.get(type) ?? [];
    this.waiting.delete(type);

    for (const event of held) {
      this.fire(type, event);
    }
  }

  removeEventListener(type: Kind, listener: Listener): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((l) => l.fn !== listener),
    );
  }

  /** How many listeners of `type` are attached now. */
  listening(type: Kind): number {
    return (this.listeners.get(type) ?? []).length;
  }

  /** The listeners of `type` attached now, so a law can tell whose each one is. */
  attached(type: Kind): ReadonlyArray<Listener> {
    return (this.listeners.get(type) ?? []).map((l) => l.fn);
  }

  send(data: string | Uint8Array<ArrayBuffer>): void {
    if (this.readyState === 0) {
      throw new DOMException("still connecting", "InvalidStateError");
    }

    if (this.readyState !== 1) {
      return;
    }

    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    this.sent.push(text);
    this.hooks.send?.(text, this);
  }

  close(code = 1000): void {
    if (this.closedWith !== null) {
      return;
    }

    this.closedWith = code;
    const was = this.readyState;
    this.readyState = 3;

    if (was < 2) {
      this.fire("close", { type: "close", code });
    }

    this.hooks.closed?.(this);
  }

  /** The socket opens. */
  open(): void {
    if (this.readyState === 0) {
      this.readyState = 1;
      this.fire("open", { type: "open" });
    }
  }

  /** The door sends one text frame. */
  receive(text: string): void {
    if (this.readyState === 1) {
      this.fire("message", { type: "message", data: text });
    }
  }

  /** The door closes the socket with `code`. */
  drop(code: number): void {
    if (this.readyState < 2) {
      this.readyState = 3;
      this.fire("close", { type: "close", code });
    }
  }

  private fire(type: Kind, event: Socket.WebSocketEvent): void {
    const now = this.listeners.get(type) ?? [];

    if (now.length === 0) {
      this.waiting.set(type, [...(this.waiting.get(type) ?? []), event]);
      return;
    }

    this.listeners.set(
      type,
      now.filter((l) => !l.once),
    );

    for (const l of now) {
      l.fn(event);
    }
  }
}
