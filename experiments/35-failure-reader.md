# 35. The lane reads a failed run before sending it back

Built from experiment 34. When the tests fail, in the builder's folder or on a
fresh copy, the lane asks a `FailureReader` (Jev plug-in, the probe's question,
floor 0.8) whose failure it is, with the change's diff, the run's output and
the test command. A sure "test file" or "setup" parks as `run_failed`, with the
output shown; a person answers `retry` (they fixed it; same attempt), `rebuild`
(it was the builder's after all; spends an attempt) or `drop`. Everything else
goes back to the builder as before: a sure "change", an unsure reading, and a
reader that failed. A side agent pointed out the first draft parked on
"unsure" too, which would have stopped about one ordinary bug in six for a
person. A wrong send-back costs one try and the attempt limit still catches
it; a wrong stop costs a person, so unsure goes back.

The real plug-in over the 14 saved failures, with the workspace's plain test
command (not the probe's exact one): every builder mistake went back (6 of 6),
5 of 8 setup and test-file failures parked, and the other 3 came back unsure
and would have cost one try each. `toy-env-bad-reporter` dropped from 0.97 to
0.39: the bad flag was only visible in the probe's command. Nothing that was
setup trouble was called the builder's.
