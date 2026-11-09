# fieldrow.py [--parent RUN] [--model M] [--effort E] <jsonl> <run> <ticket> <outcome> <why...>
#   -> prints one field/runs.jsonl row for a Codex run. The model and effort default to CODEX_MODEL
#   and CODEX_EFFORT (env.sh). Codex reports the tokens billed over the run, not the size of its
#   conversation at the last turn, so they go in `billed` and `tokens` stays null (field/README.md).
import argparse,datetime,json,os
a=argparse.ArgumentParser()
a.add_argument("--parent"); a.add_argument("--model",default=os.environ.get("CODEX_MODEL","gpt-6.1-sol"))
a.add_argument("--effort",default=os.environ.get("CODEX_EFFORT","xhigh"))
a.add_argument("--step"); a.add_argument("--started"); a.add_argument("--ended")
a.add_argument("--start"); a.add_argument("--end"); a.add_argument("--status",type=int)
a.add_argument("jsonl"); a.add_argument("run"); a.add_argument("ticket"); a.add_argument("outcome"); a.add_argument("why",nargs="+")
x=a.parse_args(); why=" ".join(x.why)
u=None
if os.path.exists(x.jsonl):
    for l in open(x.jsonl):
        try: event=json.loads(l)
        except ValueError: continue
        if event.get("type")=="turn.completed" and isinstance(event.get("usage"),dict):
            usage=event["usage"]
            if all(isinstance(usage.get(k),int) for k in ("input_tokens","cached_input_tokens","output_tokens")):
                if u is None: u={k:0 for k in usage}
                for k in ("input_tokens","cached_input_tokens","output_tokens"): u[k]+=usage[k]
now=datetime.datetime.now().astimezone()
st=os.stat(x.jsonl) if os.path.exists(x.jsonl) else None
b=datetime.datetime.fromisoformat(x.started) if x.started else datetime.datetime.fromtimestamp(getattr(st,"st_birthtime",st.st_ctime)).astimezone() if st else now
e=datetime.datetime.fromisoformat(x.ended) if x.ended else datetime.datetime.fromtimestamp(st.st_mtime).astimezone() if st else now
i,c,o=(u["input_tokens"],u["cached_input_tokens"],u["output_tokens"]) if u else (None,None,None)
# gpt-6.1-sol's standard list price (experiments/lib/list-price.ts). Another model gets no dollars here.
sol=x.model=="gpt-6.1-sol"
usd=round((i-c)*2e-6+c*0.1e-6+o*10e-6,4) if sol and u else None
if sol: why+=" Dollars are gpt-6.1-sol's standard list price (experiments/lib/list-price.ts); runs use the standard tier."
row={"date":b.strftime("%Y-%m-%d"),"run":x.run,"ticket":x.ticket,"pr":None,"started":b.isoformat(timespec="seconds"),"ended":e.isoformat(timespec="seconds"),"parent":x.parent,"active":None,"role":"hand","model":x.model,"effort":x.effort,"outcome":x.outcome,"why":why,"tokens":None,"tools":None,"minutes":round((e-b).total_seconds()/60,1),"note":None,"costUsd":None,"listUsd":usd,"billed":i+o if u else None,"inputTokens":i,"cachedTokens":c,"outputTokens":o}
# box.sh run gives the run's bounds too; drive gives only the step, which box.sh's order check reads.
if x.step: row.update(step=x.step,**{k:v for k,v in (("start",x.start),("end",x.end),("status",x.status)) if v is not None})
receipt=x.jsonl+".redacted"
if os.path.exists(receipt): row["redacted"]=int(open(receipt).read().strip())
print(json.dumps(row,ensure_ascii=False))
