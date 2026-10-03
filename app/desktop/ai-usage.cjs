// How much of the connected AI accounts is used, and how much of it pure. used.
// Codex answers for its account (5-hour and weekly windows) whenever asked, without using any.
// Claude Code reports its windows only with an answer, so the last report is kept and shown with its
// time. pure.'s own share comes from the local call log (ai_calls): calls, tokens and time by purpose.
const DAY=24*60*60*1000;
const CODEX_TTL=60*1000;

function codexLimits(result){
  const limits=result?.rateLimitsByLimitId?.codex||result?.rateLimits||{};
  const window=(id,value)=>value&&Number.isFinite(value.usedPercent)?{id,usedPercent:Math.round(value.usedPercent),resetsAt:Number(value.resetsAt)||null}:null;
  return {windows:[window('five_hour',limits.primary),window('seven_day',limits.secondary)].filter(Boolean),plan:limits.planType||'',
    limited:!!limits.rateLimitReachedType,checkedAt:new Date().toISOString()};
}

class AiUsage{
  constructor(store,{codex,claude,provider=()=>'codex',now=()=>Date.now()}){
    Object.assign(this,{store,codex,claude,provider,now});
    this.codexCache=null;
    claude.onRateLimit=limits=>{try{store.claudeLimits(limits)}catch{}};
  }
  async codexState({refresh=false}={}){
    if(!refresh&&this.codexCache&&this.now()-this.codexCache.at<CODEX_TTL)return this.codexCache.value;
    let value;
    try{value={connected:true,...codexLimits(await this.codex.limits())};}
    catch(error){value={connected:false,windows:[],error:String(error.message||error).slice(0,200)};}
    this.codexCache={at:this.now(),value};
    return value;
  }
  async claudeState(){
    const account=await this.claude.account().catch(()=>({account:null}));
    const last=this.store.claudeLimits();
    return {connected:!!account.account,windows:last?.windows||[],limited:!!last?.limited,checkedAt:last?.checkedAt||''};
  }
  async read({refresh=false}={}){
    const now=this.now(),midnight=new Date(now);midnight.setHours(0,0,0,0);
    const [codex,claude]=await Promise.all([this.codexState({refresh}),this.claudeState()]);
    return {provider:this.provider(),providers:[{id:'codex',name:'Codex',...codex},{id:'claude',name:'Claude Code',...claude}],
      today:this.store.aiUsage(midnight.toISOString()),week:this.store.aiUsage(new Date(now-7*DAY).toISOString())};
  }
}

module.exports={AiUsage,codexLimits};
