# 276. Can a program declare what should exist as resources, and can Alchemy's own engine apply them inside the brain when the program is loaded?

**Draft, started 2026-11-11. Nothing has run yet.** This page is written on its branch from its
first line ([0128](../.decisions/0128-a-write-up-is-born-in-the-repo.md)). It follows experiment
264, which wrote two custom Alchemy resources in Effect. `next/` only.

## The idea

A program declares the standing things it needs. Loading the program creates them, a changed
declaration updates them, and removing the program deletes them.

```ts
// A sketch. `resources` and `ScheduledJob` are made-up names; nothing here is built.
export default Program.make({
  name: "nightly-sweep",
  machine,
  resources: {
    // This should exist. Loading the program creates it; removing the program deletes it.
    sweep: ScheduledJob({ every: "1 hour", input: "sweep" }),
  },
});
```

One line sorts what may be a resource:

```text
should exist    a scheduled job, a process that should be running    a resource, declared
should happen   a Job, one run of a command                          a command the program returns
```

## What experiment 264 already showed

- A custom resource of our own is four small functions in Effect: read, diff, reconcile, delete.
- A deploy does not notice a dead process, and Alchemy keeps nothing alive.

So the resource is the wish, and fabrika's supervisor keeps it true. Kubernetes splits it the same
way: a spec, and a controller that makes it so.

## The question

Can Alchemy's own engine (its plan, its apply, its state store) run inside the brain, in the local
runtime and on Cloudflare, when a program is loaded at run time, with the ledger as its state
store?

- If yes, a program's resources are Alchemy resources for real, and an instance and its programs
  are provisioned one way ([0126](../.decisions/0126-the-library-makes-an-instance-from-an-apps-choices.md)).
- If no, this page says exactly what stops it, and sketches the same four functions applied by
  fabrika itself.

## What is measured

- Whether the engine loads and applies inside the runtime at all, and what it imports that the
  runtime lacks.
- The time to apply two resources, and what a second apply with no change costs.
- What the state store must hold, and whether the ledger can be it.
- What delete does when the program is removed.

## Results

None yet.

## What it cannot tell us

To be written with the results.
