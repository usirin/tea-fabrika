# clauderow.py --run ID [--billing subscription|key] [--role R] [--ticket T] [--pr P] [--parent RUN] [--outcome O] [--note ID] [--step S]
#              [--corrects RUN] [--turns] <transcript.jsonl> [why...]
#   -> prints one field/runs.jsonl row for a Claude Code subagent, from its transcript.
#   With --turns it prints one line per model call instead (context, dollars, tool calls), so the
#   cost curve of a long run can be read.
#   A subagent's transcript has no `system/init` line, so it does not say how the run was paid.
#   `billing` is written only when the caller gives it (field/README.md), and left out otherwise.
#
# It reads only each assistant message's `usage`, `model`, `id` and tool-call count, the
# timestamps, and the `.meta.json` beside the transcript (effort). No message text is read into
# the row: `why` is what the caller passes.
#
# A transcript writes one line per content block, each with the same message id and the same
# usage, so a call is counted once by its id.
#
# Dollars are the list price on Anthropic's pricing page, read 2026-11-08 (PRICES below), even on
# a subscription, which bills no call. The page's global routing price; every call checked had
# inference_geo "global", service_tier "standard" and speed "standard". A call that says otherwise
# stops the script, since its price is not here.
import argparse,datetime,json,os,sys

SOURCE="https://platform.claude.com/docs/en/about-claude/pricing"
READ="2026-11-08"
M=1e-6
# Dollars per token: input, 5-minute cache write, 1-hour cache write, cache read, output.
PRICES={
    "claude-opus-5-5":(4*M,5*M,8*M,0.20*M,20*M),
    "claude-sonnet-5-5":(2*M,2.5*M,4*M,0.10*M,10*M),
    "claude-fable-5-2":(8*M,10*M,16*M,0.20*M,40*M),
}
# A price read on another day than READ says so here, by model.
READS={"claude-fable-5-2":"2026-11-10"}
# Claude Haiku 5.5 is priced by each call's prompt length: up to 100,000 tokens, and over.
HAIKU=((0.10*M,0.125*M,0.20*M,0.01*M,0.50*M),(0.50*M,0.625*M,1*M,0.05*M,2.50*M))

def calls(path):
    """Each model call once, in order: (at, model, usage, tool calls in the message)."""
    seen={}; order=[]
    for line in open(path):
        try: d=json.loads(line)
        except ValueError: continue
        if d.get("type")!="assistant": continue
        m=d.get("message") or {}; u=m.get("usage")
        if not u: continue
        k=m.get("id") or d.get("uuid")
        tools=sum(1 for b in (m.get("content") or []) if isinstance(b,dict) and b.get("type")=="tool_use")
        if k in seen: seen[k][3]+=tools; continue
        seen[k]=[d.get("timestamp"),m.get("model"),u,tools]; order.append(k)
    return [tuple(seen[k]) for k in order]

def split(u):
    cc=u.get("cache_creation") or {}
    w1=cc.get("ephemeral_1h_input_tokens",0) or 0
    w5=cc.get("ephemeral_5m_input_tokens")
    if w5 is None: w5=(u.get("cache_creation_input_tokens") or 0)-w1
    return (u.get("input_tokens") or 0),w5,w1,(u.get("cache_read_input_tokens") or 0),(u.get("output_tokens") or 0)

def usd(model,u):
    for k,want in (("inference_geo","global"),("service_tier","standard"),("speed","standard")):
        if u.get(k) not in (None,want): raise SystemExit(f"clauderow: {k} {u.get(k)!r} has no price here")
    i,w5,w1,r,o=split(u)
    if model=="claude-haiku-5-5": p=HAIKU[1 if i+w5+w1+r>100_000 else 0]
    elif model in PRICES: p=PRICES[model]
    else: raise SystemExit(f"clauderow: no list price for {model!r}")
    return i*p[0]+w5*p[1]+w1*p[2]+r*p[3]+o*p[4]

def times(path):
    first=last=None
    for line in open(path):
        try: t=json.loads(line).get("timestamp")
        except ValueError: continue
        if t: first=first or t; last=t
    return first,last

def local(t):
    return datetime.datetime.fromisoformat(t.replace("Z","+00:00")).astimezone()

def meta(path):
    p=path[:-len(".jsonl")]+".meta.json"
    return json.load(open(p)) if os.path.exists(p) else {}

def summary(path):
    cs=calls(path)
    if not cs: raise SystemExit("clauderow: no model calls in "+path)
    models={c[1] for c in cs}
    tot=[0,0,0,0,0]; dollars=0.0
    for _,mo,u,_ in cs:
        for j,v in enumerate(split(u)): tot[j]+=v
        dollars+=usd(mo,u)
    i,w5,w1,r,o=tot
    last=split(cs[-1][2])
    first,end=times(path)
    return {"calls":len(cs),"models":sorted(models),"input":i,"write5m":w5,"write1h":w1,"read":r,"output":o,
            "usd":dollars,"context":last[0]+last[1]+last[2]+last[3]+last[4],"tools":sum(c[3] for c in cs),
            "first":first,"last":end,"meta":meta(path)}

def row(path,a):
    s=summary(path); m=s["meta"]
    b,e=local(s["first"]),local(s["last"])
    open_run=m.get("finished") is False
    model=s["models"][0] if len(s["models"])==1 else "+".join(s["models"])
    why=" ".join(a.why)
    why+=(f" Claude Code subagent transcript: {s['calls']} model calls; tokens in {s['input']:,} uncached,"
          f" {s['write5m']:,} 5-minute and {s['write1h']:,} 1-hour cache writes, {s['read']:,} cache reads;"
          f" out {s['output']:,}. Dollars are list price ({SOURCE}, read {', '.join(sorted({READS.get(mo,READ) for mo in s['models']}))}).")
    if open_run: why+=" Still running when read, so `ended` is null and the numbers are a floor."
    if a.billing: why+=f" Billing `{a.billing}` as the caller gave it; the transcript does not record it."
    r={"date":b.strftime("%Y-%m-%d"),"run":a.run,"ticket":a.ticket,"pr":a.pr,
       "started":b.isoformat(timespec="seconds"),"ended":None if open_run else e.isoformat(timespec="seconds"),
       "parent":a.parent,"active":None,"role":a.role,"model":model,"effort":m.get("effort"),
       "outcome":a.outcome,"why":why.strip(),"tokens":s["context"],"tools":s["tools"],
       "minutes":round((e-b).total_seconds()/60,1),"note":a.note,"costUsd":None,"listUsd":round(s["usd"],4),
       "billed":s["input"]+s["write5m"]+s["write1h"]+s["read"]+s["output"],
       "inputTokens":s["input"]+s["write5m"]+s["write1h"]+s["read"],"cachedTokens":s["read"],
       "outputTokens":s["output"]}
    if a.billing: r["billing"]=a.billing
    if a.corrects: r["corrects"]=a.corrects
    if a.step: r["step"]=a.step
    return r

def turns(path):
    total=0.0
    for n,(at,mo,u,tools) in enumerate(calls(path),1):
        i,w5,w1,rd,o=split(u); d=usd(mo,u); total+=d
        yield {"call":n,"at":local(at).isoformat(timespec="seconds"),"context":i+w5+w1+rd,
               "write":w5+w1,"output":o,"tools":tools,"usd":round(d,5),"total":round(total,4)}

if __name__=="__main__":
    p=argparse.ArgumentParser()
    for k in ("ticket","pr","parent","outcome","note","corrects","step"): p.add_argument("--"+k)
    p.add_argument("--billing",choices=("subscription","key"))
    p.add_argument("--role",default="hand"); p.add_argument("--turns",action="store_true")
    p.add_argument("transcript"); p.add_argument("why",nargs="*")
    p.add_argument("--run")
    a=p.parse_args()
    if not a.turns and not a.run: p.error("--run is required: a row needs its id so parent and corrects can name it")
    if a.turns:
        for t in turns(a.transcript): print(json.dumps(t))
        sys.exit(0)
    print(json.dumps(row(a.transcript,a),ensure_ascii=False))
