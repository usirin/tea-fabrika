# Is tgrep worth adopting over rg?

Run 2026-10-31. **No.** Once made safe, it ties `rg` on the repos we work in, and it costs a
server per working copy. Re-test only if a repo passes about 100k files, or tgrep gains a
mode that fails loudly when its index is stale.

Moved here on 2026-11-01 from an agent's private memory, where it had no place. Its raw
timings were not kept, so this write-up has only the numbers below and no script.

## What was tested

tgrep 1.2.6 against `grep` and `rg` on three repos (2.3k, 5.3k and 17k files), on a Mac with
a warm cache. In a Claude Code shell, `grep` is ugrep inside the claude binary, walking
with `--hidden`, and `rg` was Homebrew 13.0.0 with no SIMD.

## What came back

| Search | tgrep | rg |
|---|---|---|
| Typical, raw server, three repos | 8ms | 21, 39 and 120ms |
| One-letter pattern, 116MB of output | 3.4s | 0.14s |
| Found, safe wrapper, two runs | 26 and 32ms | 28 and 43ms |
| Not found, safe wrapper, two runs | 38 and 63ms | 22 and 42ms |

- **Without its server, tgrep is wrong without saying so.** A stale index gives exit 1 and no
  match. After a clean server stop, stderr is empty too.
- **Right after an edit, the server was wrong 199 of 200 tries** in a tight loop, with a lag
  of about 65ms.
- **The safe wrapper** uses the server only when it is up and rechecks every "no match" with
  `rg`. The table's last two rows are that wrapper, and they tie.
- **Each working copy needs its own server,** at 100 to 390MB.

Saving 20ms a search is nothing next to a model turn, and the condition for adopting it was
"only if it is actually faster".

## What it cannot tell us

- It ran on one Mac, warm, and on nothing past 17k files. tgrep's own benchmark claims 15 to
  50 times faster at about 100k files, and we did not check that.
- The "199 of 200" came from a tight loop built to catch the lag, not from normal use.
