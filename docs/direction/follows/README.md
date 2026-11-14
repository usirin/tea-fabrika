---
state: "decided 2026-11-09 ([0017](../../.decisions/0017-each-model-we-follow-has-one-table.md))"
summary: "`next/`. One living table per outside model: [OTP](./follows/otp.md) for coordination, [Elm](./follows/elm.md) for tea and windows, [Kubernetes](./follows/kubernetes.md) for backoff, `resourceVersion`, limits, labels and leases. One row per behavior: what the model does with a source, what we do with `path:line` or \"not built\", and \"same\" or \"differs, because ...\". A pull request that changes a behavior updates its row."
---

# Where we follow a model, and where we leave it

One living table per outside system that a note in `docs/direction/` names as the model for a
part of `next/`. Each row is one behavior: what the system does, with a source; what we do, with
`path:line` or "not built"; and "same" or "differs, because ...". Read a table to learn the design
by where it follows the model and where it leaves it
([0017](../../../.decisions/0017-each-model-we-follow-has-one-table.md)).

A pull request that changes our behavior in a table's area updates that row in the same pull
request, as a plan row does ([0013](../../../.decisions/0013-plan-docs-change-with-the-work.md)).

```text
| Behavior | What <model> does | What we do | Same or differs |
| Monitor  | one DOWN when it ends ([source]) | `coordination/process-manager.ts:182-214` | same |
```

| Table | The model for | Rows | Differs |
|---|---|---|---|
| [OTP](./otp.md) | Coordination: registry, mailbox, monitors, supervisors | 28 | 19 |
| [Elm](./elm.md) | tea programs and windows | 12 | 6 |
| [Kubernetes](./kubernetes.md) | Restart backoff, `resourceVersion`, limits, labels, leases | 13 | 12 |

Other systems the notes name as a model, with no table yet: DDD's bounded contexts
([we follow DDD](../we-follow-ddd.md)), Linear for screens, and tmux and i3 for tiling
([the desktop layer](../the-desktop-layer.md)). Each gets a table when a pull request first
builds its part in `next/`.
