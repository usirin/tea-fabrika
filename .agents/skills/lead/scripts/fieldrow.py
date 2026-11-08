# fieldrow.py [--parent RUN] [--model M] [--effort E] <jsonl> <run> <ticket> <outcome> <why...>
#   -> prints one field/runs.jsonl row for a Codex run. The model and effort default to CODEX_MODEL
#   and CODEX_EFFORT (env.sh). Codex reports the tokens billed over the run, not the size of its
#   conversation at the last turn, so they go in `billed` and `tokens` stays null (field/README.md).
import argparse,datetime,json,os
a=argparse.ArgumentParser()
a.add_argument("--parent"); a.add_argument("--model",default=os.environ.get("CODEX_MODEL","gpt-6.1-sol"))
a.add_argument("--effort",default=os.environ.get("CODEX_EFFORT","xhigh"))
a.add_argument("jsonl"); a.add_argument("run"); a.add_argument("ticket"); a.add_argument("outcome"); a.add_argument("why",nargs="+")
x=a.parse_args(); why=" ".join(x.why)
u=None
for l in open(x.jsonl):
    if '"turn.completed"' in l: u=json.loads(l)["usage"]
if u is None: raise SystemExit("fieldrow: no turn.completed in "+x.jsonl)
st=os.stat(x.jsonl); b=datetime.datetime.fromtimestamp(st.st_birthtime).astimezone(); e=datetime.datetime.fromtimestamp(st.st_mtime).astimezone()
i,c,o=u["input_tokens"],u["cached_input_tokens"],u["output_tokens"]
# gpt-6.1-sol's standard list price (experiments/lib/list-price.ts). Another model gets no dollars here.
sol=x.model=="gpt-6.1-sol"
usd=round((i-c)*2e-6+c*0.1e-6+o*10e-6,4) if sol else None
if sol: why+=" Dollars are gpt-6.1-sol's standard list price (experiments/lib/list-price.ts); the priority tier bills more."
print(json.dumps({"date":b.strftime("%Y-%m-%d"),"run":x.run,"ticket":x.ticket,"pr":None,"started":b.isoformat(timespec="seconds"),"ended":e.isoformat(timespec="seconds"),"parent":x.parent,"active":None,"role":"hand","model":x.model,"effort":x.effort,"outcome":x.outcome,"why":why,"tokens":None,"tools":None,"minutes":round((e-b).total_seconds()/60,1),"note":None,"costUsd":None,"listUsd":usd,"billed":i+o,"inputTokens":i,"cachedTokens":c,"outputTokens":o},ensure_ascii=False))
