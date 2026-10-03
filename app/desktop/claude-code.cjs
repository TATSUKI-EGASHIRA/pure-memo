// Claude Code as an AI provider: `claude -p` with structured output, run as a plain analysis
// engine. No tools (web search only for news collection), no user/project settings, hooks or MCP
// servers, no saved session, an empty working folder, and pure.'s own system prompt. Uses the
// user's own Claude Code sign-in; pure. stores no key.
const {spawn}=require('node:child_process');
const {existsSync,mkdtempSync,rmSync,realpathSync}=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {abortError}=require('./job-policy.cjs');
const {instructionsFor}=require('./codex.cjs');

const MODELS=[
  {model:'sonnet',displayName:'Claude Sonnet',description:'Balanced model for most work.',isDefault:true},
  {model:'opus',displayName:'Claude Opus',description:'Most capable model for demanding analysis.',isDefault:false},
  {model:'haiku',displayName:'Claude Haiku',description:'Fast model for light work.',isDefault:false},
];
const EFFORTS=['low','medium','high','xhigh','max'];
const TIMEOUT_MS=180000;

function findClaude(){
  const candidates=[path.join(os.homedir(),'.local','bin','claude'),...(process.env.PATH||'').split(path.delimiter).map(dir=>path.join(dir,'claude'))];
  const found=candidates.find(existsSync);
  return found?realpathSync(found):null;
}

// The account's usage windows as Claude Code reports them after a request (utilization 0–1).
function readLimits(info){
  const windows=info?.unifiedWindows||{};
  const window=(id,value)=>value&&Number.isFinite(value.utilization)?{id,usedPercent:Math.round(value.utilization*100),resetsAt:Number(value.resetsAt)||null}:null;
  return {windows:[window('five_hour',windows.five_hour),window('seven_day',windows.seven_day)].filter(Boolean),limited:info?.status&&info.status!=='allowed',checkedAt:new Date().toISOString()};
}

class ClaudeCodeClient{
  constructor({command}={}){this.command=command;this.directory=mkdtempSync(path.join(os.tmpdir(),'pure-claude-'));this.running=new Set();}
  executable(){this.command??=findClaude();if(!this.command)throw new Error('Claude Code was not found.');return this.command;}
  args({model,effort,schema,webSearch}){
    // stream-json (with --verbose) also carries the account's usage windows (rate_limit_event).
    return ['-p','--output-format','stream-json','--verbose','--json-schema',JSON.stringify(schema),'--system-prompt',instructionsFor(webSearch?{web_search:'live'}:null),
      '--setting-sources','','--strict-mcp-config','--no-session-persistence',
      ...(webSearch?['--tools','WebSearch','--allowedTools','WebSearch']:['--tools','']),
      ...(model?['--model',model]:[]),...(effort&&EFFORTS.includes(effort)?['--effort',effort]:[])];
  }
  accepts(model){return MODELS.some(item=>item.model===model)||/^claude-/.test(String(model||''));}
  defaultModel(){return MODELS.find(item=>item.isDefault).model;}
  async models(){this.executable();return MODELS.map(item=>({...item,efforts:EFFORTS.map(effort=>({effort,description:''})),defaultEffort:null,upgrade:null}));}
  async account(){
    try{this.executable();return {account:{type:'claude-code'},provider:'claude'};}
    catch{return {account:null,provider:'claude'};}
  }
  async login(){throw new Error('ターミナルで claude を一度起動してログインしてください。');}
  async generate(options){
    const started=Date.now(),record={purpose:options.purpose||'unknown',promptVersion:options.promptVersion||'',model:options.model||'',effort:options.effort||null,usage:null};
    try{const result=await this.run(options,record);this.onCall?.({...record,ms:Date.now()-started,status:'ok',error:''});return result;}
    catch(error){this.onCall?.({...record,ms:Date.now()-started,status:error.name==='AbortError'?'cancelled':'error',error:String(error.message||error).slice(0,300)});throw error;}
  }
  run({model,effort,prompt,schema,signal,beforeSend,onProgress,threadConfig},record){
    const emit=event=>{try{onProgress?.(event)}catch{}};
    if(signal?.aborted)return Promise.reject(abortError());
    emit({stage:'connect'});
    const command=this.executable();
    beforeSend?.();
    if(signal?.aborted)return Promise.reject(abortError());
    emit({stage:'send',chars:prompt.length,model,effort});
    return new Promise((resolve,reject)=>{
      // HOME stays the user's so Claude Code finds its own sign-in; settings files are not read.
      const child=spawn(command,this.args({model,effort,schema,webSearch:threadConfig?.web_search==='live'}),{cwd:this.directory,stdio:['pipe','pipe','pipe'],
        env:{HOME:os.homedir(),PATH:process.env.PATH||'/usr/bin:/bin',TMPDIR:os.tmpdir(),LANG:process.env.LANG||'en_US.UTF-8',USER:process.env.USER||'',NO_COLOR:'1',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'}});
      this.running.add(child);
      let stdout='',stderr='',settled=false;
      const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',onAbort);this.running.delete(child);error?reject(error):resolve(value);};
      const onAbort=()=>{child.kill('SIGTERM');finish(abortError());};
      const timer=setTimeout(()=>{child.kill('SIGTERM');finish(new Error('AI analysis timed out.'));},TIMEOUT_MS);
      signal?.addEventListener('abort',onAbort,{once:true});
      child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>20000000){child.kill();finish(new Error('AI response is too large.'));}});
      child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-2000);});
      child.on('error',error=>finish(error));
      child.on('close',code=>{
        const messages=stdout.split('\n').map(line=>{try{return JSON.parse(line)}catch{return null}}).filter(Boolean);
        const limits=messages.filter(message=>message.type==='rate_limit_event').pop()?.rate_limit_info;
        if(limits)try{this.onRateLimit?.(readLimits(limits));}catch{}
        const data=messages.filter(message=>message.type==='result').pop();
        if(!data)return finish(new Error(code?`Claude Code stopped (${code}). ${stderr.trim().slice(0,200)}`:'AI returned invalid JSON.'));
        const usage=data.usage||{};
        record.usage={input:(usage.input_tokens||0)+(usage.cache_read_input_tokens||0)+(usage.cache_creation_input_tokens||0),cachedInput:usage.cache_read_input_tokens||0,output:usage.output_tokens||0,reasoning:usage.output_tokens_details?.thinking_tokens||0};
        if(data.is_error||data.subtype!=='success')return finish(new Error(String(data.result||data.subtype||'Claude Code failed.').slice(0,300)));
        let result=data.structured_output;
        if(result===undefined){try{result=JSON.parse(data.result);}catch{return finish(new Error('AI returned invalid JSON.'));}}
        emit({stage:'write',written:JSON.stringify(result).length});
        finish(null,result);
      });
      emit({stage:'think',phase:'waiting'});
      child.stdin.end(prompt);
    });
  }
  stop(){for(const child of this.running)child.kill('SIGTERM');this.running.clear();rmSync(this.directory,{recursive:true,force:true});}
}

module.exports={ClaudeCodeClient,readLimits,MODELS:MODELS.map(item=>item.model)};
