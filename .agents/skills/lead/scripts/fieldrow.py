# fieldrow.py <jsonl> <run> <ticket> <outcome> <why...>  -> prints one field/runs.jsonl row for a Codex run
import json,os,sys,datetime
f,run,ticket,outcome=sys.argv[1:5]; why=" ".join(sys.argv[5:])
u=None
for l in open(f):
    if '"turn.completed"' in l: u=json.loads(l)["usage"]
st=os.stat(f); b=datetime.datetime.fromtimestamp(st.st_birthtime).astimezone(); e=datetime.datetime.fromtimestamp(st.st_mtime).astimezone()
i,c,o=u["input_tokens"],u["cached_input_tokens"],u["output_tokens"]
usd=round((i-c)*2e-6+c*0.1e-6+o*10e-6,4)
print(json.dumps({"date":b.strftime("%Y-%m-%d"),"run":run,"ticket":ticket,"pr":None,"started":b.isoformat(timespec="seconds"),"ended":e.isoformat(timespec="seconds"),"parent":None,"active":None,"role":"hand","model":"gpt-6.1-sol","effort":"xhigh","outcome":outcome,"why":why+" Dollars are gpt-6.1-sol's standard list price (experiments/lib/list-price.ts); the priority tier bills more.","tokens":i+o,"tools":None,"minutes":round((e-b).total_seconds()/60,1),"note":None,"costUsd":None,"listUsd":usd,"billed":None,"inputTokens":i,"cachedTokens":c,"outputTokens":o},ensure_ascii=False))
