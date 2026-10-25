------------------------------- MODULE TraceV1 -------------------------------
(***************************************************************************)
(* Experiment 139. The same trace check as TraceV2, against experiment    *)
(* 116's HostedLane.tla as it was written, before any real run was read.  *)
(* The script copies HostedLane.tla in from experiments/116-established-  *)
(* checkers. TraceDataV1 holds the same runs read for N children, with a  *)
(* row as TRUE once written, of either kind (116 gave a row no kind).     *)
(***************************************************************************)
EXTENDS HostedLane, Sequences, TLC, TraceDataV1

VARIABLES r, l

Is(e) ==
  CASE e.act = "Start"    -> Start
    [] e.act = "WriteRow" -> WriteRow(e.k)
    [] e.act = "End"      -> End(e.k)
    [] e.act = "Deliver"  -> Deliver(e.k)
    [] e.act = "SeeRow"   -> SeeRow
    [] e.act = "SeeExit"  -> SeeExit
    [] OTHER              -> FALSE

Lands(s) ==
  /\ lane' = s.lane
  /\ cur' = s.cur
  /\ proc' = s.proc
  /\ row' = s.row
  /\ exit' = s.exit
  /\ seen' = s.seen

(* 116 has no list of owed moves; it is Step less WriteRow. *)
Owed == Start \/ SeeRow \/ SeeExit \/ \E k \in Kids : End(k) \/ Deliver(k)

TraceInit == r \in 1..Len(Runs) /\ l = 1 /\ Init

TraceNext ==
  \/ /\ l <= Len(Runs[r])
     /\ Is(Runs[r][l])
     /\ Lands(Runs[r][l].to)
     /\ l' = l + 1
     /\ UNCHANGED r
     /\ PrintT(<<"took", r, l>>)
  \/ /\ l = Len(Runs[r]) + 1
     /\ ~ENABLED Owed
     /\ l' = l + 1
     /\ UNCHANGED <<vars, r>>
     /\ PrintT(<<"rest", r>>)
=============================================================================
