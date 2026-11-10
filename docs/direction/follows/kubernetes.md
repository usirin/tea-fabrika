# Where we follow Kubernetes

We take a few behaviors from Kubernetes: its restart backoff
([experiment 100](../../../experiments/100-supervision-tree.md), C4 in
[the five layers](../a-local-first-sync-engine.md#layer-3-coordination-decided-2026-10-31)), its
`resourceVersion` ([saved state](../saved-state.md)), its limits ([tea-program](../tea-program.md)),
its labels and `status` ([label guidelines](../label-guidelines.md)), its node affinity
([talk where you work](../talk-where-you-work.md)) and its word `reason`
([AGENTS.md](../../../AGENTS.md)). Leases follow etcd's keepalive, which Kubernetes' own leases sit
on (C3). This table is about `next/`. One row per behavior. Paths are under
`next/packages/libfabrika/src/`. A pull request that changes one of these behaviors updates its
row in the same pull request ([0017](../../../.decisions/0017-each-model-we-follow-has-one-table.md)).

Seeded 2026-11-09 from the notes above, checked against main at `5b1171ed`.

| Behavior | What Kubernetes does | What we do | Same or differs |
|---|---|---|---|
| Restart backoff | Doubling from 10 s, capped at 5 minutes ([restart policy][restart]) | Doubling from 100 ms, capped at 800 ms (`app/supervisor.ts:11`, `:103-107`) | differs, because a restart here is a wake in the same object, so the shape is Kubernetes' and the scale is not ([experiment 100](../../../experiments/100-supervision-tree.md)) |
| Backoff reset | Reset after 10 minutes running without a problem ([restart]) | Reset after 5 s live (`app/supervisor.ts:147-149`) | differs, because the scale follows the 800 ms cap |
| A crash loop never gives up | `restartPolicy: Always` keeps trying at the capped wait ([restart]) | Past the brake, `down` until the window has room, then a new start, forever (`app/supervisor.ts:116-136`) | differs, because our wait between brakes stays near 5 s; 0016 picks OTP's give-up instead |
| Which exits restart | `Always`, `OnFailure` or `Never`, picked per pod ([restart]) | Only a throw restarts, like `OnFailure`, with no choice (`app/supervisor.ts:84-131`) | differs, because restart types wait for Tier 4 ([OTP table](./otp.md)) |
| A stale write | `resourceVersion` lets the API server reject a client that is out of date ([versions]) | Each line keeps `seen`; a `seen` past the head is `refused {why: "seen_ahead"}` (`data/ledger-store.ts:128-132`); a stale `seen` still lands | differs, because append stays plain and `seen` is not a lock ([saved state](../saved-state.md), D1) |
| State is observed, not set | `status` holds "the most recent observations of actual state" ([conventions]) | A process's `live`, `ended` or `down` is folded from its facts (`coordination/process.ts:39-43`), never written by hand | same |
| A condition's `reason` key | A condition has a machine-readable `reason` and a human `message` ([conventions]) | `next/` still says `why` (`coordination/process.ts:48`) | differs, because main's `next/` code is renamed by a sweep (ticket 337) |
| Limits end a run | `activeDeadlineSeconds` ends a Job ([job]); going over memory is `OOMKilled` ([resources]) | Not built: `LimitManager` (A2 in [the five layers](../a-local-first-sync-engine.md)) | differs, because not built yet |
| A quota per namespace | `ResourceQuota` caps what one namespace may use, and a request over it is refused ([quotas]) | Not built: every program writes to the project object with no cap | differs, because not built yet; [0020](../../../.decisions/0020-programs-get-hard-walls.md) adds a quota per program (writes per minute, storage, time per step), built by P34c |
| A CPU limit per container | `limits.cpu` throttles a container at its cap ([resources]) | Not built: `limits.cpuMs` is unset on each process's isolate (`workers/index.ts:25`; [Tier 1's detail](../../plan/tier-1-detail.md)) | differs, because not built yet; 0020 sets it from a measured step, built by P34c. Cloudflare ends a step over `cpuMs`; Kubernetes slows it |
| Labels carry no meaning to the core | Labels "do not directly imply semantics to the core system" ([labels]) | Not built in `next/`: the tracker is a later tier ([tier 1](../../plan/tier-1.md), "Later tiers") | differs, because not built yet |
| Where work runs | Required and preferred node affinity ([affinity]) | Not built: hands and the order a turn is offered in are a later tier | differs, because not built yet |
| Leases | A `Lease` with a holder, a duration and a renew time ([leases]) | Not built: C3's 30 s claim renewed every 10 s waits for hands, a later tier | differs, because not built yet |

Count: 13 rows, 1 same, 12 differ. Of the 12, 6 are not built yet (limits, a quota per namespace, a
CPU limit per container, labels, node affinity, leases).

Coming: [0016](../../../.decisions/0016-tier-1-supervision-is-otps-top-level-supervisor.md)
drops the backoff for OTP's restart at once, and past its limit a name waits for a person. P34c's
pull request updates the first four rows; they may then leave this table. It also builds the
quota and CPU limit rows ([0020](../../../.decisions/0020-programs-get-hard-walls.md)).

[restart]: https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#restart-policy
[versions]: https://kubernetes.io/docs/reference/using-api/api-concepts/#resource-versions
[conventions]: https://github.com/kubernetes/community/blob/master/contributors/devel/sig-architecture/api-conventions.md#typical-status-properties
[job]: https://kubernetes.io/docs/concepts/workloads/controllers/job/#job-termination-and-cleanup
[resources]: https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/
[labels]: https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/
[affinity]: https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#node-affinity
[leases]: https://kubernetes.io/docs/concepts/architecture/leases/
[quotas]: https://kubernetes.io/docs/concepts/policy/resource-quotas/
