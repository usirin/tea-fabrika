/**
 * Menu bar extra state and items. Checks and signatures are commands, never I/O here.
 * @stability unstable
 */
import { Cmd, Machine } from "@demlik/tea/effect";
import * as Schema from "effect/Schema";
import * as Access from "../access/Access.ts";
import * as Id from "../Id.ts";

const Kind = Access.Grant.fields.as;

/**
 * Words for every admitted client kind. A new kind must have words before it can be drawn.
 * @stability unstable
 * @category models
 */
export const words: Record<typeof Kind.Type, string> = { window: "window", agent: "agent" };

/**
 * Schema for one waiting key, shared by its tabs. A pass is a digest only.
 * @stability unstable
 * @category schemas
 */
export const Row = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  location: Schema.String,
  code: Schema.String,
  tabs: Schema.Int,
  pass: Schema.NullOr(Schema.String),
  has: Schema.Array(Schema.String),
  as: Kind,
});
type Row = typeof Row.Type;

const Tabs = Schema.TaggedUnion({ known: { online: Schema.Int }, unknown: {} });

/**
 * Schema for an admitted client, with its current tab count or an unknown probe result.
 * @stability unstable
 * @category schemas
 */
export const Client = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  location: Schema.String,
  as: Kind,
  tabs: Tabs,
  own: Schema.Boolean,
});

const Act = Schema.TaggedUnion({
  approve: { key: Schema.String, as: Kind, shown: Row },
  remove: { key: Schema.String, shown: Client },
});

const Link = Schema.TaggedUnion({ connecting: {}, online: {}, lost: {} });
const Pass = Schema.Struct({ digest: Schema.String, until: Schema.Number });

const Shown = {
  link: Link,
  rows: Schema.Array(Row),
  clients: Schema.Array(Client),
  passes: Schema.Array(Pass),
  opens: Schema.Array(Id.Cmd),
  browserLink: Schema.Boolean,
};

const Model = Schema.TaggedUnion({
  idle: { ...Shown },
  checking: { ...Shown, act: Act, cmd: Id.Cmd },
});
type Model = typeof Model.Type;

const clickFields = { key: Schema.String, cmd: Id.Cmd };

const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("link"), link: Link }),
  Schema.Struct({ type: Schema.Literal("rows"), rows: Schema.Array(Row), at: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("clients"), clients: Schema.Array(Client) }),
  Schema.Struct({ type: Schema.Literal("approve"), ...clickFields }),
  Schema.Struct({ type: Schema.Literal("deny"), ...clickFields }),
  Schema.Struct({ type: Schema.Literal("remove"), ...clickFields }),
  Schema.Struct({ type: Schema.Literal("enter") }),
  Schema.Struct({ type: Schema.Literal("checked"), cmd: Id.Cmd, check: Schema.Literals(["touch", "click"]) }),
  Schema.Struct({
    type: Schema.Literal("not_checked"),
    cmd: Id.Cmd,
    reason: Schema.Literals(["declined", "unavailable"]),
  }),
  Schema.Struct({ type: Schema.Literal("open_browser"), cmd: Id.Cmd }),
  Schema.Struct({ type: Schema.Literal("opened"), cmd: Id.Cmd, digest: Schema.String, at: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("open_window") }),
  Schema.Struct({ type: Schema.Literal("quit") }),
]);

const check = Cmd.make("check", {
  input: Schema.Struct({ cmd: Id.Cmd, reason: Schema.String }),
  ok: Schema.Null,
  err: [],
});

const signGrant = Cmd.make("sign_grant", {
  input: Schema.Struct({ key: Schema.String, as: Kind, saw: Access.Saw }),
  ok: Schema.Null,
  err: [],
});

const signRevoke = Cmd.make("sign_revoke", {
  input: Schema.Struct({ key: Schema.String, saw: Access.Took }),
  ok: Schema.Null,
  err: [],
});

const deny = Cmd.make("deny", {
  input: Schema.Struct({ key: Schema.String, saw: Access.Saw }),
  ok: Schema.Null,
  err: [],
});

const open = Cmd.make("open", { input: Schema.Struct({ cmd: Id.Cmd }), ok: Schema.Null, err: [] });
const openWindow = Cmd.make("open_window", { input: Schema.Struct({}), ok: Schema.Null, err: [] });
const quit = Cmd.make("quit", { input: Schema.Struct({}), ok: Schema.Null, err: [] });

/**
 * Schema for the ordered items a popover draws and labels for its controls.
 * @stability unstable
 * @category schemas
 */
export const Item = Schema.TaggedUnion({
  status: { words: Schema.String },
  empty: { words: Schema.String },
  waiting: { key: Schema.String, words: Schema.String, code: Schema.String, busy: Schema.Boolean },
  client: { key: Schema.String, words: Schema.String, removable: Schema.Boolean, busy: Schema.Boolean },
  action: { id: Schema.Literals(["open_window", "open_browser", "quit"]), words: Schema.String },
});

const safe = (text: string) => text.toWellFormed().replace(/[\p{Cc}\p{Cf}]/gu, "");

// The brain-line text cap is 256 UTF-16 units. Keep a pair whole at its boundary.
const label = (text: string) => {
  const cut = safe(text).slice(0, 256);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
};

const code = (text: string) => safe(text).replace(/^(\d{3})(\d{3})$/, "$1 $2");

const named = (row: { readonly label: string; readonly location: string }) =>
  `${label(row.label)} on ${safe(row.location)}`;

const tabs = (count: number) => `${count} ${count === 1 ? "tab" : "tabs"}`;

const saw = (
  row: Row,
  method: typeof Access.Saw.Type.method,
  check: typeof Access.Saw.Type.check,
): typeof Access.Saw.Type => ({
  code: row.code,
  label: row.label,
  location: row.location,
  has: [...row.has],
  method,
  check,
});

const current = (model: Model) => ({
  link: model.link,
  rows: model.rows,
  clients: model.clients,
  passes: model.passes,
  opens: model.opens,
  browserLink: model.browserLink,
});

const idle = (model: Model): Model => Model.cases.idle.make(current(model));

const unique = <A extends { readonly key: string }>(rows: ReadonlyArray<A>): ReadonlyArray<A> => [
  ...new Map(rows.map((row) => [row.key, row])).values(),
];

/**
 * Creates the menu's one machine with the loaded link lifetime and live-link switch.
 * Its model is temporary; restart always starts with fresh rows and no pending confirmation.
 * @stability unstable
 * @category constructors
 */
export const machine = (options: { readonly linkTtl: number; readonly browserLink: boolean }) =>
  Machine.make({
    model: Model,
    msg: Msg,
    cmds: [check, signGrant, signRevoke, deny, open, openWindow, quit],
    init: (_loaded) => [
      Model.cases.idle.make({
        link: Link.cases.connecting.make({}),
        rows: [],
        clients: [],
        passes: [],
        opens: [],
        browserLink: options.browserLink,
      }),
      [],
    ],
    update: {
      link: (s, m) => [{ ...s, link: m.link }, []],
      clients: (s, m) => {
        const clients = unique(m.clients);
        // Snapshots arrive separately. The latest list decides a shared key's row.
        const rows = s.rows.filter((row) => !clients.some((client) => client.key === row.key));
        return [{ ...s, rows, clients }, []];
      },
      rows: (s, m) => {
        let passes = s.passes.filter((p) => m.at < p.until);
        const commands: Array<ReturnType<typeof signGrant>> = [];
        const rows = unique(m.rows);

        for (const row of rows) {
          if (row.pass !== null && passes.some((p) => p.digest === row.pass)) {
            passes = passes.filter((p) => p.digest !== row.pass);
            commands.push(signGrant({ key: row.key, as: row.as, saw: saw(row, "link", "none") }));
          }
        }

        const clients = s.clients.filter((client) => !rows.some((row) => row.key === client.key));
        return [{ ...s, rows, clients, passes }, commands];
      },
      approve: (s, m) => {
        if (s._tag !== "idle") {
          return [s, []];
        }

        const row = s.rows.find((r) => r.key === m.key);

        if (row === undefined) {
          return [s, []];
        }

        const shown = Row.make({ ...row, has: [...row.has] });
        return [
          Model.cases.checking.make({
            ...current(s),
            cmd: m.cmd,
            act: Act.cases.approve.make({ key: row.key, as: row.as, shown }),
          }),
          [check({ cmd: m.cmd, reason: `Let in ${named(row)}, code ${code(row.code)}` })],
        ];
      },
      remove: (s, m) => {
        if (s._tag !== "idle") {
          return [s, []];
        }

        const client = s.clients.find((c) => c.key === m.key && !c.own);

        if (client === undefined) {
          return [s, []];
        }

        const shown = Client.make({ ...client, tabs: { ...client.tabs } });
        return [
          Model.cases.checking.make({
            ...current(s),
            cmd: m.cmd,
            act: Act.cases.remove.make({ key: client.key, shown }),
          }),
          [check({ cmd: m.cmd, reason: `Remove ${named(client)}` })],
        ];
      },
      deny: (s, m) => {
        const row = s.rows.find((r) => r.key === m.key);
        return [s, row === undefined ? [] : [deny({ key: row.key, saw: saw(row, "compare", "none") })]];
      },
      checked: (s, m) => {
        if (s._tag !== "checking" || s.cmd !== m.cmd) {
          return [s, []];
        }

        const act = s.act;

        if (act._tag === "approve") {
          return [idle(s), [signGrant({ key: act.key, as: act.as, saw: saw(act.shown, "compare", m.check) })]];
        }

        return [
          idle(s),
          [
            signRevoke({
              key: act.key,
              saw: {
                label: act.shown.label,
                location: act.shown.location,
                method: "panel",
                check: m.check,
              },
            }),
          ],
        ];
      },
      not_checked: (s, m) => [s._tag === "checking" && s.cmd === m.cmd ? idle(s) : s, []],
      enter: (s) => [s, []],
      open_browser: (s, m) =>
        s.browserLink && !s.opens.includes(m.cmd)
          ? [{ ...s, opens: [...s.opens, m.cmd] }, [open({ cmd: m.cmd })]]
          : [s, []],
      opened: (s, m) => {
        if (!s.opens.includes(m.cmd)) {
          return [s, []];
        }

        return [
          {
            ...s,
            opens: s.opens.filter((cmd) => cmd !== m.cmd),
            passes: [
              ...s.passes.filter((p) => p.digest !== m.digest),
              { digest: m.digest, until: m.at + options.linkTtl },
            ],
          },
          [],
        ];
      },
      open_window: (s) => [s, [openWindow({})]],
      quit: (s) => [s, [quit({})]],
      check_ok: (s) => [s, []],
      check_err: (s) => [s, []],
      sign_grant_ok: (s) => [s, []],
      sign_grant_err: (s) => [s, []],
      sign_revoke_ok: (s) => [s, []],
      sign_revoke_err: (s) => [s, []],
      deny_ok: (s) => [s, []],
      deny_err: (s) => [s, []],
      open_ok: (s) => [s, []],
      open_err: (s) => [s, []],
      open_window_ok: (s) => [s, []],
      open_window_err: (s) => [s, []],
      quit_ok: (s) => [s, []],
      quit_err: (s) => [s, []],
    },
  });

/**
 * Returns status, waiting keys, admitted clients and actions, in that order.
 * Every state has words, including an empty list and an unknown tab count.
 * @stability unstable
 * @category getters
 */
export const view = (model: Model): ReadonlyArray<typeof Item.Type> => {
  const status = { connecting: "fabrika is connecting", online: "fabrika is running", lost: "Connection lost" };
  const busy = model._tag === "checking";
  const items: Array<typeof Item.Type> = [Item.cases.status.make({ words: status[model.link._tag] })];

  if (model.rows.length === 0 && model.clients.length === 0) {
    items.push(Item.cases.empty.make({ words: "No clients yet. New requests will appear here." }));
  }

  for (const row of model.rows) {
    items.push(
      Item.cases.waiting.make({
        key: row.key,
        code: row.code,
        busy,
        words: `Waiting: ${named(row)}, ${words[row.as]}, ${tabs(row.tabs)}, says code ${code(row.code)}${busy ? ". Checking a person" : ""}`,
      }),
    );
  }

  for (const client of model.clients) {
    const count = client.tabs._tag === "known" ? tabs(client.tabs.online) : "tabs unknown";
    items.push(
      Item.cases.client.make({
        key: client.key,
        removable: !client.own,
        busy,
        words: `${client.own ? "This app" : "Let in"}: ${named(client)}, ${words[client.as]}, ${count}${busy ? ". Checking a person" : ""}`,
      }),
    );
  }

  items.push(Item.cases.action.make({ id: "open_window", words: "Open window" }));

  if (model.browserLink) {
    items.push(Item.cases.action.make({ id: "open_browser", words: "Open in browser" }));
  }

  items.push(Item.cases.action.make({ id: "quit", words: "Quit" }));
  return items;
};
