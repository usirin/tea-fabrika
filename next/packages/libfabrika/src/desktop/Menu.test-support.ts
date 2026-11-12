import { applyCell } from "@demlik/tea";
// next/, P21 slice 1. The factory takes checked settings at start; no provider is read by update.
import { arbGuidedSequence, stubCtxThrowingProxy } from "@demlik/tea/pbt";
import { Equal, Schema } from "effect";
import * as fc from "fast-check";
import * as Access from "../access/Access.ts";
import * as Id from "../Id.ts";
import * as Menu from "./Menu.ts";

export const seed = 119120;
export const ttl = 137;
export const ctx = stubCtxThrowingProxy<unknown>();
export const machine = Menu.machine({ linkTtl: ttl, browserLink: true });
export type Model = ReturnType<typeof machine.init>[0];
export type Msg = typeof machine.msg.Type;
export type Command = ReturnType<typeof machine.init>[1][number];
export type Row = typeof Menu.Row.Type;
type Client = typeof Menu.Client.Type;

export const same = (a: unknown, b: unknown) => Equal.equals(a, b);
export const cmdId = (n: number) => Id.Cmd.make(`cmd_0000000000e008${n.toString(16).padStart(12, "0")}`);
export const command = fc.nat({ max: 0xfffffff }).map(cmdId);
const stale = cmdId(0xffffffffff);
const kind = fc.constantFrom(...Access.Grant.fields.as.literals);
const Tabs = Schema.TaggedUnion({ known: { online: Schema.Int }, unknown: {} });
const Link = Schema.TaggedUnion({ connecting: {}, online: {}, lost: {} });
export const label = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,23}$/);
const code = fc.integer({ min: 0, max: 999999 }).map((n) => String(n).padStart(6, "0"));
const digest = fc.constantFrom("digest-a", "digest-b", "digest-c");

export const row: fc.Arbitrary<Row> = fc.record({
  key: fc.constantFrom("waiting-a", "waiting-b", "waiting-c"),
  label,
  location: fc.constantFrom("this Mac", "another Mac"),
  code,
  tabs: fc.integer({ min: 1, max: 20 }),
  pass: fc.option(digest, { nil: null }),
  has: fc.uniqueArray(fc.constantFrom("screen", "files", "terminal"), { maxLength: 3 }),
  as: kind,
});

const client: fc.Arbitrary<Client> = fc.record({
  key: fc.constantFrom("client-a", "client-b", "client-c"),
  label,
  location: fc.constantFrom("this Mac", "another Mac"),
  as: kind,
  tabs: fc.oneof(
    fc.nat({ max: 20 }).map((online) => Tabs.cases.known.make({ online })),
    fc.constant(Tabs.cases.unknown.make({})),
  ),
  own: fc.boolean(),
});

const rows = fc.uniqueArray(row, { selector: (r) => r.key, maxLength: 3 });
const clients = fc.uniqueArray(client, { selector: (c) => c.key, maxLength: 3 });
const at = fc.constantFrom(0, 1, ttl - 1, ttl, ttl + 1, ttl * 2);

const click = <const T extends "approve" | "deny" | "remove">(type: T, keys: ReadonlyArray<string>) =>
  fc.record({ type: fc.constant(type), key: fc.constantFrom(...keys), cmd: command });

// tea draws the operation order and answers commands actually sent. The second fold below
// chooses click targets from the reached lists, retaining deliberately stale replies.
const proposals = arbGuidedSequence(
  machine,
  ctx,
  {
    outside: {
      rows: fc.record({ type: fc.constant("rows"), rows, at }),
      clients: fc.record({ type: fc.constant("clients"), clients }),
      link: fc.record({
        type: fc.constant("link"),
        link: fc.constantFrom(Link.cases.connecting.make({}), Link.cases.online.make({}), Link.cases.lost.make({})),
      }),
      approve: click("approve", ["waiting-a", "waiting-b", "waiting-c"]),
      deny: click("deny", ["waiting-a", "waiting-b", "waiting-c"]),
      remove: click("remove", ["client-a", "client-b", "client-c"]),
      enter: fc.constant({ type: "enter" }),
      checked: fc.record({
        type: fc.constant("checked"),
        cmd: fc.constant(stale),
        check: fc.constantFrom("touch", "click"),
      }),
      not_checked: fc.record({
        type: fc.constant("not_checked"),
        cmd: fc.constant(stale),
        reason: fc.constantFrom("declined", "unavailable"),
      }),
      open_browser: fc.record({ type: fc.constant("open_browser"), cmd: command }),
      opened: fc.record({ type: fc.constant("opened"), cmd: fc.constant(stale), digest, at: fc.constant(0) }),
    },
    answers: {
      check: {
        draw: fc.constantFrom("touch", "click", "declined", "unavailable"),
        make: (pending, answer) =>
          answer === "touch" || answer === "click"
            ? { type: "checked", cmd: pending.cmd, check: answer }
            : { type: "not_checked", cmd: pending.cmd, reason: answer },
      },
      open: {
        draw: digest,
        make: (pending, digest) => ({ type: "opened", cmd: pending.cmd, digest, at: 0 }),
      },
    },
  },
  { maxLength: 160, size: "max" },
);

export const walks = proposals.map((messages): ReadonlyArray<Msg> => {
  let [model] = machine.init(null, ctx);
  const output: Array<Msg> = [];

  for (const proposal of messages) {
    let msg = proposal;

    if (proposal.type === "approve" || proposal.type === "deny" || proposal.type === "remove") {
      const targets = proposal.type === "remove" ? model.clients : model.rows;
      const index = proposal.key.endsWith("a") ? 0 : proposal.key.endsWith("b") ? 1 : 2;
      const target = targets[index % Math.max(1, targets.length)];
      msg = target === undefined ? proposal : { ...proposal, key: target.key };
    }

    if (
      (proposal.type === "checked" || proposal.type === "not_checked") &&
      proposal.cmd !== stale &&
      model._tag === "checking"
    ) {
      msg = { ...proposal, cmd: model.cmd };
    }

    output.push(msg);
    [model] = applyCell<Model, Msg, Command>(machine, model, msg);
  }

  return output;
});

export const encoded = (model: Model) => Schema.encodeSync(Schema.fromJsonString(machine.model))(model);
