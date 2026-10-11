# 21. Does triage make mistakes of its own?

Experiment 20's wrong examples were planted by hand, on the ticket's own
inputs. Triage had not yet written a wrong result (0 of 108 in experiment 19),
but there it chose easy inputs. `21-natural-mistakes.ts` adds two toys whose
results take real working out, and asks for three examples per rule, one on an
edge:

- `businessDays(start, end)`: weekdays after start up to end, without weekends,
  January 1 and December 25. The result needs the weekday of each date.
- `formatBytes(n)`: 1024-based units, one decimal rounded half up, rolling over
  to the next unit when rounding reaches 1024.

The rules are in the ticket in words; there are no tests to copy, and triage
can read the stub but run nothing (`--tools Read Glob Grep`). Three triage runs
per toy, three throwaway references per toy, and one builder per run told to
list every example that contradicts the rules.

| | businessDays | formatBytes |
|---|---|---|
| Examples written | 85 | 90 |
| Wrong on the correct code | 0 | 0 |
| References disagreeing with a right example | 0 | 0 |
| Builder flagging a right example | 0 | 0 |

The examples were not easy. They cross a year end over a holiday
(`businessDays("2023-12-29", "2024-01-02") -> 1`), need the weekday of
2025-12-31, and sit on the rounding edge (`formatBytes(1048525) -> "1 MB"`,
`formatBytes(1048524) -> "1023.9 KB"`). Triage got all 175 right.

So there were no natural mistakes to catch, and how well the two checks catch
them is still unmeasured. What this does show: over 283 examples in experiments
19 and 21, triage wrote 0 wrong results (under about 1% at 95%, rule of three),
and neither check raised a false alarm on 175 right ones. Triage here is the
CLI's default model; a smaller model would need its own run.

**Took from it:** a wrong result in an example is rare for this kind of rule,
and the checks for it cost nothing in false alarms, so they are cheap
insurance. What actually goes wrong is the ticket: a rule it leaves out or
leaves open (experiments 16, 19, 20).
