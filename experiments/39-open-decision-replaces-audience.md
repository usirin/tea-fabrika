# 39. Jev stops deciding who picks an issue up

Not an experiment, a change the runs forced. The first real ticket,
kamp-us/demlik#558 (run 1), parked at triage on the audience question: "human",
0.52, under a floor of 0.8. The duration toy had parked there on every real
run since experiment 23, at 0.04 to 0.46 (sections 23 to 30). Jev reads only the
rewritten ticket, so it cannot tell whether the work rests on a call nobody
has made. The enricher has read the code and can.

So the audience question is gone. The enricher answers a typed
`open_decision`: one question for the owner, or null. Code routes on it: set
means triage parks as `needs_decision` with no Jev call, and the owner's ruling
goes back to the enricher in the same conversation for a new rewrite; null
means Jev sorts type, priority and value as before. A `triaged` issue now
always means an agent can build it. An older saved run sorted for a person
reads back parked on `needs_decision`, since Jev never said what the call was.

Open: how often the enricher names a call where a person would not, and the
other way round. Measure it on the next real tickets.
