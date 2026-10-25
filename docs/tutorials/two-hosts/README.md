# Two hosts, one ledger

A tutorial for the host in `@kampus/fabrika`. You start one ledger and two hosts on your laptop and run
two programs that talk to each other: a kettle that brews each order and pours it into a glass,
and a glass that counts what is poured. Then you kill a host with `kill -9` in the middle of
thirty orders, and count. Thirty orders, thirty brewed, thirty poured.

These are the finished files. The tutorial has you write them yourself; if a step goes wrong,
compare with these. `pnpm typecheck` checks them, so they keep working as the package changes. They import `@kampus/fabrika` for the services,
`@kampus/fabrika/local` for the ledger in Miniflare and for the hosts' way to it.

The ledger has a door: a request with no credential is refused. A local ledger keeps its one
person's secret in its data folder (`.teahouse/door-secret`, readable by you only), and the hosts
read it from there (`layerAttach`). So every write is stamped as that person, `user:owner`, and
a holder reads like `host-a@1761000000000@user:owner`: the host's own tag, then who it is.

You need Node `26.12.0`, `pnpm` 10, four terminals and a spare shell. Run everything from the
repo root, after `pnpm install --frozen-lockfile`.

## 1. Start the ledger

```bash
node docs/tutorials/two-hosts/ledger.ts
```

You should see `ledger up at http://127.0.0.1:8790  (names: kettle, glass)`. Its data lands in
`.teahouse/` at the repo root (ignored by git).

## 2. Start two hosts

In a second terminal, then a third once the second has printed its lines:

```bash
node docs/tutorials/two-hosts/host.ts host-a
node docs/tutorials/two-hosts/host.ts host-b
```

host-a claims `kettle` and `glass` and runs both. host-b prints one line and waits as a standby.

## 3. Look

```bash
node docs/tutorials/two-hosts/look.ts
```

Who holds each name, and the last state each program saved. It writes nothing.

## 4. Order thirty teas, and pull the plug

```bash
node docs/tutorials/two-hosts/order.ts 30
```

Around order 10, from the spare shell:

```bash
pkill -9 -f "two-hosts/host.ts host-a"
```

About a second later host-b claims both names under higher fences, and the kettle replays the
orders that came in while nobody held it.

## 5. Count

When the orders are done, run `look.ts` again: `brewed` is 30 and `poured` is 30.

The kettle pours before it saves, under a message id made from the order's id. If a host dies
between the two, the next host pours the same order again and the ledger answers `dup`, so one
order is never two glasses.

## 6. Hand it back, then turn it all off

- Start host-a again. It waits. Send `order.ts 10`, and press Ctrl+C on host-b while the orders
  run: host-a takes over, and `look.ts` shows 40 and 40.
- Stop everything. Start only `ledger.ts` and run `look.ts`: both names are `free`, and the state
  is still 40. It never lived in a host.
- To start from zero, stop everything and delete `.teahouse/`.

## Next

- [`packages/fabrika/src/host/README.md`](../../../packages/fabrika/src/host/README.md): the exports and the rules
  the ledger keeps.
- [`docs/direction/tea-host.md`](../../direction/tea-host.md): why tea-host is OTP for tea programs.
- [`experiments/100-supervision-tree.md`](../../../experiments/100-supervision-tree.md):
  supervisors, links and monitors on three hosts.
