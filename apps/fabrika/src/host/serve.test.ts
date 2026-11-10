import type { SocketServer } from "effect/socket";
import { describe, expect, it } from "vitest";
import type { serve } from "./serve.ts";

// On a home connected to a ledger server, each agent writes on its own session there (tracker
// 185a, host/agent-session.ts); the person's session is the person's alone. So the host's options
// can't hold a server ledger with no agents' sessions: with that pair, every agent would write on
// the person's session as the person. The ledger note's doubt: "a bug in the host could send an
// agent's text down the person's path". A type test, as window/frame.test.ts keeps its own: the
// pair does not compile. Today's version.
//
//   {ledger: {kind: "server", address, login}, agents: {server, sessionFor: null}}   no such options
//   {ledger: {kind: "own"}, ...}                                                       agents write on the host's

type Options = Parameters<typeof serve>[0];

const ADDRESS = "https://ledger.example/acme";

describe("the host's options on a connected home", () => {
  it("can't name a server ledger without each agent's own session there", () => {
    const pairs = (server: SocketServer.SocketServer["Service"]) => {
      const ledger = { kind: "server", address: ADDRESS, login: "alice" } as const;
      const agents = { server, sessionFor: null };
      // Each pair on one line: an expected error is looked for on the line below it only.
      // @ts-expect-error a server ledger and no agents' sessions: agents would write as the person
      const shared: Pick<Options, "ledger" | "agents"> = { ledger, agents };
      // @ts-expect-error the server case carries the agents' sessions, never null
      const none: Options["ledger"] = { ...ledger, sessionFor: null };
      return [shared, none];
    };
    expect(pairs).toBeTypeOf("function");
  });
});
