# North Star first; harden later

Decided 2026-10-12. The order of work was added 2026-10-18.

## What was decided

- **Security is always a concern, never a limit on the goal.** The same holds
  for accessibility and speed. First settle what the tool should be, then make
  that safe.
- **The goal for safety:** nobody can steal a login by filing a ticket.
- **Safety never rests on one code host's settings.** Not on GitHub's
  organisation permissions, and not on a label only collaborators can set. A
  project may not use GitHub at all.
- **Order of work (2026-10-18):**
  - finish the experiments;
  - then finish fabrika;
  - then Tuval;
  - then a hardening pass, one package at a time.
- **Developer experience comes first until then.** A hole that today's fabrika
  has too is parked for hardening, not treated as a blocker. It is fixed before
  the build stage leaves experiment status.
- **Lists of known holes are not kept in this public repo.** Only the fixes
  land here.
- Shapes that make a mistake impossible
  ([make the mistake impossible](./make-the-mistake-impossible.md)) still get
  built now. What waits is new security guards.

## Why

- Designing around a code host's permissions ties the design to that host, and
  goes round in circles.
- The tools are wanted soon. A side quest into hardening costs more now than an
  edge that is no worse than today's.

## What would change it

A hole this repo adds that today's fabrika does not have. That one is fixed
now, not parked.
