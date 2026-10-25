------------------------------- MODULE TraceV2 -------------------------------
(***************************************************************************)
(* Experiment 139. Trace validation: is a real run of the hosted lane a   *)
(* behaviour of HostedLaneV2? After Cirstea, Kuppe, Loillier and Merz,    *)
(* "Validating Traces of Distributed Programs Against TLA+ Specifications" *)
(* (arXiv 2404.16075).                                                     *)
(*                                                                         *)
(* The experiment script writes the config (N, Fixed, INIT TraceInit,     *)
(* NEXT TraceNext) and TraceData, and keeps neither. TraceData holds      *)
(* `Runs`: one sequence of events per run, read from the ledger's log in  *)
(* `pos` order (packages/pipeline/src/hosted/lane-trace.ts). Each event   *)
(* names the action and the child, and logs every variable after it. TLC *)
(* starts one behaviour per run. Each step must be the named action of    *)
(* the spec, and must land on the logged state. After the last event, one *)
(* more step says the run is at rest: nothing the spec owes is still      *)
(* possible. A run is accepted when TLC prints its "rest". "took" says    *)
(* how far a rejected run got.                                            *)
(***************************************************************************)
EXTENDS HostedLaneV2, Sequences, TLC, TraceData

VARIABLES r, \* which run
          l  \* its next event

Is(e) ==
  CASE e.act = "Start"    -> Start
    [] e.act = "WriteRow" -> \E kind \in Kinds : WriteRow(e.k, kind)
    [] e.act = "End"      -> End(e.k)
    [] e.act = "Deliver"  -> Deliver(e.k)
    [] e.act = "SeeRow"   -> SeeRow
    [] e.act = "SeeExit"  -> SeeExit
    [] e.act = "Exit"     -> Exit
    [] OTHER              -> FALSE

Lands(s) ==
  /\ lane' = s.lane
  /\ cur' = s.cur
  /\ proc' = s.proc
  /\ row' = s.row
  /\ exit' = s.exit
  /\ seen' = s.seen

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
