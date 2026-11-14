REPORT: fabrika/jsdocs over all of libfabrika on newest main (48460bdaa) fires 581 times; packs and repositories are already at zero.

The rule is the t913 branch's own (fabrikalfa/cloud-t913 at 84c8b013e), run over `next/packages/libfabrika/src/` of `origin/main` at `48460bdaa` from a scratch copy. Only `fabrika/jsdocs` was on, at `error` with `{ "since": "absent" }`. It was off for the same six kinds as the t913 config: `internal/`, tests, test support, shared suites, fixtures, declaration files. Nothing was committed.

| Folder | Exports with no block | Blocks in the wrong shape | Files with a missing or wrong module block | Fires |
|---|---|---|---|---|
| top files | 75 | 13 | 7 | 95 |
| cloudflare | 66 | 12 | 15 | 93 |
| runtime | 4 | 77 | 2 | 83 |
| coordination | 72 | 0 | 1 | 73 |
| settings | 26 | 23 | 10 | 59 |
| transport | 30 | 13 | 10 | 53 |
| access | 18 | 21 | 7 | 46 |
| processes | 6 | 34 | 0 | 40 |
| jobs | 3 | 11 | 3 | 17 |
| gateway | 4 | 0 | 3 | 7 |
| schedules | 3 | 1 | 1 | 5 |
| telemetry | 3 | 0 | 1 | 4 |
| node | 3 | 0 | 0 | 3 |
| presence | 1 | 0 | 1 | 2 |
| ledger | 1 | 0 | 0 | 1 |
| all | 315 | 205 | 61 | 581 |

- **Which column a fire lands in, by its message:** "has no doc block" counts as no block. "doc block is out of Effect's shape" counts as wrong shape. Any message about the module block counts as module block.
- **Check that the count is right:** the same script over t913's base tree (`c0aaf4a24`) gives 346, 232, 88 and 666, exactly t913's reported numbers. Over `ci/` it gives 0.
- **Folders with 0 fires,** which the table leaves out: `ci`, `codehost`, `packs`, `repositories` and `desktop`.
- **The six folders you named:**
  - `runtime`: 83 fires, 77 of them shape.
  - `processes`: 40, of them 34 shape.
  - `telemetry`: 4.
  - `ledger`: 1.
  - `packs` and `repositories`: already 0. The rule finds nothing to fill, so I will open no branch for them unless you say otherwise.
- **Next:** I start writers now on `telemetry`, `ledger`, `runtime` and `processes`, one per folder.
