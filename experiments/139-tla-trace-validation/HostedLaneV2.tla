---------------------------- MODULE HostedLaneV2 ----------------------------
(***************************************************************************)
(* Experiment 139. Experiment 116's HostedLane.tla, changed only where     *)
(* the real runs showed it was wrong:                                      *)
(*                                                                         *)
(*   1. A row has a kind. The lane goes on after a `done` row and stops    *)
(*      after a `stuck` one (lane machine, `afterChild`). 116 let every    *)
(*      row go on.                                                         *)
(*   2. N is not how many children the plan needs. The lane starts         *)
(*      children for as long as they say `done`, round after round. N is   *)
(*      a bound for TLC: the N-th child never says `done`, as the          *)
(*      harness's last child writes `stuck` (lane-ends.ts).                *)
(*   3. The lane's own process ends after it is over ("gone"). The host   *)
(*      puts no EXIT in the inbox of a name that is down, so a child that *)
(*      exits after that gets none. 116 promised every EXIT.              *)
(*                                                                         *)
(* Everything else is 116's, word for word.                                *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS N,      \* the most children one run starts (a bound, see 2.)
          Fixed   \* which wait the lane has

Kids == 1..N
Kinds == {"done", "stuck"}

VARIABLES
  lane,   \* "ready": about to start child `cur`; "running": waiting on it; "over";
          \* "gone": over, and its process has exited
  cur,    \* the child the lane is on
  proc,   \* each child's process: "none" (not started), "up", "down"
  row,    \* each child's outcome row: "none", "done" or "stuck"
  exit,   \* the host has put the child's EXIT in the lane's inbox
  seen    \* the lane has taken the child's end (its child_over)

vars == <<lane, cur, proc, row, exit, seen>>

Init ==
  /\ lane = "ready"
  /\ cur = 1
  /\ proc = [k \in Kids |-> "none"]
  /\ row = [k \in Kids |-> "none"]
  /\ exit = [k \in Kids |-> FALSE]
  /\ seen = [k \in Kids |-> FALSE]

(* The lane: lane_start for child `cur`, then the host starts it. *)
Start ==
  /\ lane = "ready"
  /\ proc' = [proc EXCEPT ![cur] = "up"]
  /\ lane' = "running"
  /\ UNCHANGED <<cur, row, exit, seen>>

(* A child writes its row. Not fair: it may never happen. *)
WriteRow(k, kind) ==
  /\ proc[k] = "up"
  /\ row[k] = "none"
  /\ kind \in (IF k < N THEN Kinds ELSE {"stuck"})
  /\ row' = [row EXCEPT ![k] = kind]
  /\ UNCHANGED <<lane, cur, proc, exit, seen>>

(* A child's process ends, with or without its row. *)
End(k) ==
  /\ proc[k] = "up"
  /\ proc' = [proc EXCEPT ![k] = "down"]
  /\ UNCHANGED <<lane, cur, row, exit, seen>>

(* The host's promise: an ended child's EXIT reaches the lane, while the lane's process is up. *)
Deliver(k) ==
  /\ proc[k] = "down"
  /\ ~exit[k]
  /\ lane # "gone"
  /\ exit' = [exit EXCEPT ![k] = TRUE]
  /\ UNCHANGED <<lane, cur, proc, row, seen>>

(* After the lane took child `k`'s end: on to the next child after a done row, else over. *)
Next(k, ok) ==
  /\ seen' = [seen EXCEPT ![k] = TRUE]
  /\ IF ok
       THEN lane' = "ready" /\ cur' = k + 1
       ELSE lane' = "over" /\ cur' = k

(* The lane's child Sub reads the row (every 150 ms in the code). It ends on the row. *)
SeeRow ==
  /\ lane = "running"
  /\ row[cur] # "none"
  /\ Next(cur, row[cur] = "done")
  /\ UNCHANGED <<proc, row, exit>>

(* The fixed Sub only: the EXIT came and still no row. stuck:no_outcome. *)
SeeExit ==
  /\ Fixed
  /\ lane = "running"
  /\ exit[cur]
  /\ row[cur] = "none"
  /\ Next(cur, FALSE)
  /\ UNCHANGED <<proc, row, exit>>

(* The lane is over: it writes its outcome row, and its process exits. *)
Exit ==
  /\ lane = "over"
  /\ lane' = "gone"
  /\ UNCHANGED <<cur, proc, row, exit, seen>>

Step ==
  \/ Start \/ SeeRow \/ SeeExit \/ Exit
  \/ \E k \in Kids : (\E kind \in Kinds : WriteRow(k, kind)) \/ End(k) \/ Deliver(k)

(* The moves that must happen once they can: all but WriteRow. *)
Owed == Start \/ SeeRow \/ SeeExit \/ Exit \/ \E k \in Kids : End(k) \/ Deliver(k)

Spec ==
  /\ Init
  /\ [][Step]_vars
  /\ WF_vars(Start) /\ WF_vars(SeeRow) /\ WF_vars(SeeExit) /\ WF_vars(Exit)
  /\ \A k \in Kids : WF_vars(End(k)) /\ WF_vars(Deliver(k))

Done == lane \in {"over", "gone"}

TypeOK ==
  /\ lane \in {"ready", "running", "over", "gone"}
  /\ cur \in Kids
  /\ proc \in [Kids -> {"none", "up", "down"}]
  /\ row \in [Kids -> {"none"} \cup Kinds]
  /\ exit \in [Kids -> BOOLEAN]
  /\ seen \in [Kids -> BOOLEAN]

(* 116's two laws, unchanged. *)
EveryStartedChildSeen == \A k \in Kids : (proc[k] # "none") ~> seen[k]
LaneEnds == <>Done

(* Not noise: a lane can reach its last child. TLC must break this. *)
NeverTheLast == ~(Done /\ cur = N)
=============================================================================
