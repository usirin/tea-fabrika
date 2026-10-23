---------------------------- MODULE HostedLane ----------------------------
(***************************************************************************)
(* Experiment 116. The hosted lane, the host and one outcome row per child, *)
(* written by hand from packages/pipeline/src/hosted/lane.ts.              *)
(*                                                                         *)
(* The lane starts its children one at a time, in order. A child may      *)
(* write its outcome row (or may never: a crash, a kill, a cap) and then   *)
(* its process ends. The host promises the parent an EXIT for every child  *)
(* that ended. It does not promise a row.                                  *)
(*                                                                         *)
(* Fixed = FALSE: today's lane. Its wait on a child ends only on the row;  *)
(* the EXIT is trapped and ignored (lane.ts lines 217-234 and 286).        *)
(* Fixed = TRUE:  the wait also ends on the EXIT. It reads the row once    *)
(* more; no row is stuck:no_outcome, and the lane stops.                   *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS N,      \* how many children the plan needs, in order
          Fixed   \* which wait the lane has

Kids == 1..N

VARIABLES
  lane,   \* "ready": about to start child `cur`; "running": waiting on it; "over"
  cur,    \* the child the lane is on
  proc,   \* each child's process: "none" (not started), "up", "down"
  row,    \* each child's outcome row is in the ledger
  exit,   \* the host has put the child's EXIT in the lane's inbox
  seen    \* the lane has taken the child's end (its kid_over)

vars == <<lane, cur, proc, row, exit, seen>>

Init ==
  /\ lane = "ready"
  /\ cur = 1
  /\ proc = [k \in Kids |-> "none"]
  /\ row = [k \in Kids |-> FALSE]
  /\ exit = [k \in Kids |-> FALSE]
  /\ seen = [k \in Kids |-> FALSE]

(* The lane: lane_start for child `cur`, then the host starts it. *)
Start ==
  /\ lane = "ready"
  /\ proc' = [proc EXCEPT ![cur] = "up"]
  /\ lane' = "running"
  /\ UNCHANGED <<cur, row, exit, seen>>

(* A child writes its row. Not fair: it may never happen. *)
WriteRow(k) ==
  /\ proc[k] = "up"
  /\ ~row[k]
  /\ row' = [row EXCEPT ![k] = TRUE]
  /\ UNCHANGED <<lane, cur, proc, exit, seen>>

(* A child's process ends, with or without its row. *)
End(k) ==
  /\ proc[k] = "up"
  /\ proc' = [proc EXCEPT ![k] = "down"]
  /\ UNCHANGED <<lane, cur, row, exit, seen>>

(* The host's promise: an ended child's EXIT reaches the lane. *)
Deliver(k) ==
  /\ proc[k] = "down"
  /\ ~exit[k]
  /\ exit' = [exit EXCEPT ![k] = TRUE]
  /\ UNCHANGED <<lane, cur, proc, row, seen>>

(* After the lane took child `cur`'s end: the next child, or over. *)
Next(k, ok) ==
  /\ seen' = [seen EXCEPT ![k] = TRUE]
  /\ IF ok /\ k < N
       THEN lane' = "ready" /\ cur' = k + 1
       ELSE lane' = "over" /\ cur' = k

(* The lane's child Sub reads the row (every 150 ms in the code). It ends on the row. *)
SeeRow ==
  /\ lane = "running"
  /\ row[cur]
  /\ Next(cur, TRUE)
  /\ UNCHANGED <<proc, row, exit>>

(* The fixed Sub only: the EXIT came and still no row. stuck:no_outcome. *)
SeeExit ==
  /\ Fixed
  /\ lane = "running"
  /\ exit[cur]
  /\ ~row[cur]
  /\ Next(cur, FALSE)
  /\ UNCHANGED <<proc, row, exit>>

Step ==
  \/ Start \/ SeeRow \/ SeeExit
  \/ \E k \in Kids : WriteRow(k) \/ End(k) \/ Deliver(k)

(* The lane is fair, a child's process ending is fair, the host's EXIT is fair. *)
(* WriteRow has no fairness.                                                    *)
Spec ==
  /\ Init
  /\ [][Step]_vars
  /\ WF_vars(Start) /\ WF_vars(SeeRow) /\ WF_vars(SeeExit)
  /\ \A k \in Kids : WF_vars(End(k)) /\ WF_vars(Deliver(k))

TypeOK ==
  /\ lane \in {"ready", "running", "over"}
  /\ cur \in Kids
  /\ proc \in [Kids -> {"none", "up", "down"}]
  /\ row \in [Kids -> BOOLEAN]
  /\ exit \in [Kids -> BOOLEAN]
  /\ seen \in [Kids -> BOOLEAN]

(* The law: every child the lane started, the lane eventually sees end. *)
EveryStartedChildSeen == \A k \in Kids : (proc[k] # "none") ~> seen[k]

(* And every lane ends. *)
LaneEnds == <>(lane = "over")

(* Not noise: the lane can reach its end with every child's row. TLC must break this. *)
NeverAllDone == ~(lane = "over" /\ \A k \in Kids : seen[k] /\ row[k])
=============================================================================
