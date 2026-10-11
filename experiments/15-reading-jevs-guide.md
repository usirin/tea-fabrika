# 15. Reading Jev's own guide

After fourteen experiments we read the docs properly
(https://docs.typesafe.ai/concepts/how-to-build-with-system-one). By their
measure we are using Jev the hard way:

- "Ask the most explicit, narrow, specific, atomic questions you can." They
  call this the most important idea in the guide. We ask one broad question:
  would this test passing show the criterion is met?
- "Ask many narrow, independent questions about the same state in one
  request." Questions in one call run in parallel, so splitting costs no extra
  round trip. We ask one question per call.
- "Give each question only the context it needs." Experiments 12 and 13 are
  that rule learned the slow way: a title, then a goal line, each moved the
  answer.
- There is a yes/no question type (`noul`) and a rubric type (`score`). We
  have only used `choice`.
- An option's description can say what it covers, what it does not, and give
  examples. Ours are one sentence each.
- "Combine independent answers with deterministic rules" in code.

What we did beyond the guide: measured how often each confidence level is
right, on cases with known answers, and tried to fool it.
