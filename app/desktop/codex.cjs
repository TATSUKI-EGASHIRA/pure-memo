const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { existsSync, mkdtempSync, rmSync, realpathSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {abortError}=require('./job-policy.cjs');

const outputSchema={
  type:'object',additionalProperties:false,
  properties:{
    status:{type:'string',enum:['ready','insufficient']},text:{type:'string'},pattern:{type:'string'},action:{type:'string'},
    evidenceRevisionIds:{type:'array',items:{type:'string'}},
    categories:{type:'array',items:{type:'object',additionalProperties:false,properties:{name:{type:'string'},revisionIds:{type:'array',items:{type:'string'}}},required:['name','revisionIds']}}
  },required:['status','text','pattern','action','evidenceRevisionIds','categories']
};
const digestClaimSchema={type:'object',additionalProperties:false,properties:{
  text:{type:'string'},kind:{type:'string',enum:['preference','experience','intention','observation','change','uncertainty']},
  speaker:{type:'string',enum:['self','external','unknown']},period:{type:'string'},
  evidenceRevisionIds:{type:'array',items:{type:'string'}},counterRevisionIds:{type:'array',items:{type:'string'}}
},required:['text','kind','speaker','period','evidenceRevisionIds','counterRevisionIds']};
const collectionSchema={type:'object',additionalProperties:false,properties:{...outputSchema.properties,claims:{type:'array',items:digestClaimSchema}},required:[...outputSchema.required,'claims']};
const answerClaimSchema={type:'object',additionalProperties:false,properties:{
  text:{type:'string'},kind:{type:'string',enum:['record','inference']},speaker:{type:'string',enum:['self','external','unknown']},
  period:{type:'string'},evidenceRevisionIds:{type:'array',items:{type:'string'}}
},required:['text','kind','speaker','period','evidenceRevisionIds']};
const askSchema={type:'object',additionalProperties:false,properties:{...outputSchema.properties,claims:{type:'array',items:answerClaimSchema}},required:[...outputSchema.required,'claims']};
const categorySuggestionSchema={type:'object',additionalProperties:false,properties:{suggestions:{type:'array',items:{type:'object',additionalProperties:false,properties:{name:{type:'string'},reason:{type:'string'},revisionIds:{type:'array',items:{type:'string'}}},required:['name','reason','revisionIds']}}},required:['suggestions']};
const PROFILE='pure_analysis';
const profileConfig=(directory,command)=>`permissions.${PROFILE}.filesystem={":root"="deny",":minimal"="read",${[directory,path.dirname(command),path.dirname(realpathSync(command))].filter((value,index,all)=>all.indexOf(value)===index).map(value=>`${JSON.stringify(value)}="read"`).join(',')}}`;

class CodexClient {
  constructor({codexHome}={}) { this.seq=0;this.pending=new Map();this.turns=new Map();this.early=new Map();this.ignoredTurns=new Set();this.proc=null;this.directory=mkdtempSync(path.join(os.tmpdir(),'pure-ai-'));this.codexHome=codexHome; }
  async start() {
    if(this.proc&&!this.proc.killed) return;
    const candidate=path.join(os.homedir(),'.local','bin','codex');
    const executable=existsSync(candidate)?candidate:(process.env.PATH||'').split(path.delimiter).map(directory=>path.join(directory,'codex')).find(existsSync);
    if(!executable) throw new Error('Codex CLI was not found.');
    const command=realpathSync(executable);
    this.proc=spawn(command,['app-server','--stdio','-c',profileConfig(this.directory,command),'-c',`permissions.${PROFILE}.network.enabled=false`,'-c',`default_permissions="${PROFILE}"`],{stdio:['pipe','pipe','pipe'],env:{HOME:os.homedir(),PATH:process.env.PATH||'/usr/bin:/bin',TMPDIR:os.tmpdir(),LANG:process.env.LANG||'en_US.UTF-8',USER:process.env.USER||'',NO_COLOR:'1',...(this.codexHome?{CODEX_HOME:this.codexHome}:{})}});
    this.proc.on('error',error=>this.failAll(error));
    this.proc.on('exit',(code)=>{this.failAll(new Error(`Codex App Server stopped (${code}).`));this.proc=null;});
    createInterface({input:this.proc.stdout}).on('line',line=>this.onLine(line));
    this.proc.stderr.on('data',()=>{});
    await this.request('initialize',{clientInfo:{name:'pure_memo',title:'pure.',version:'0.1.0'},capabilities:{experimentalApi:true}},15000);
    this.send({method:'initialized',params:{}});
  }
  send(message) { if(!this.proc?.stdin?.writable) throw new Error('Codex App Server is unavailable.');this.proc.stdin.write(JSON.stringify(message)+'\n'); }
  request(method,params={},timeout=30000) {
    const id=++this.seq;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`${method} timed out.`));},timeout);
      this.pending.set(id,{resolve,reject,timer});
      try{this.send({id,method,params});}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
    });
  }
  onLine(line) {
    let message;try{message=JSON.parse(line)}catch{return;}
    if(message.id!==undefined){const wait=this.pending.get(message.id);if(!wait)return;this.pending.delete(message.id);clearTimeout(wait.timer);message.error?wait.reject(new Error(message.error.message||'Codex request failed.')):wait.resolve(message.result);return;}
    const turnId=message.params?.turn?.id||message.params?.turnId;
    if(this.ignoredTurns.has(turnId))return;
    if(message.method==='item/completed' && message.params?.item?.type==='agentMessage' && turnId){const turn=this.turns.get(turnId);if(turn&&message.params.item.phase!=='commentary')turn.message=message.params.item.text;else if(!turn)this.early.set(turnId,{...(this.early.get(turnId)||{}),message:message.params.item.text});}
    if(message.method==='turn/completed' && turnId){const turn=this.turns.get(turnId);if(!turn){this.early.set(turnId,{...(this.early.get(turnId)||{}),completed:message.params.turn});return;}this.turns.delete(turnId);clearTimeout(turn.timer);message.params.turn.status==='completed'?turn.resolve(turn.message||message.params.turn.items?.filter(i=>i.type==='agentMessage').at(-1)?.text||''):turn.reject(new Error(message.params.turn.error?.message||`AI turn ${message.params.turn.status}.`));}
  }
  failAll(error){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error)}this.pending.clear();for(const t of this.turns.values()){clearTimeout(t.timer);t.reject(error)}this.turns.clear();this.early.clear();this.ignoredTurns.clear();}
  async account(){await this.start();return this.request('account/read',{refreshToken:false});}
  async models(){await this.start();const result=await this.request('model/list',{limit:30,includeHidden:false});return result.data||[];}
  async login(){await this.start();return this.request('account/login/start',{type:'chatgpt',useHostedLoginSuccessPage:true,appBrand:'codex'});}
  async generate({model,prompt,schema=outputSchema,signal,beforeSend}) {
    const checkAbort=()=>{if(signal?.aborted)throw abortError();};
    checkAbort();
    await this.start();
    checkAbort();
    const thread=await this.request('thread/start',{model,cwd:this.directory,approvalPolicy:'never',permissions:PROFILE,ephemeral:true},30000);
    checkAbort();
    beforeSend?.();
    const started=await this.request('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:prompt}],cwd:this.directory,model,approvalPolicy:'never',permissions:PROFILE,outputSchema:schema},30000);
    const id=started.turn.id;
    const interrupt=()=>{
      this.ignoredTurns.add(id);
      if(this.ignoredTurns.size>100)this.ignoredTurns.delete(this.ignoredTurns.values().next().value);
      return this.request('turn/interrupt',{threadId:thread.thread.id,turnId:id}).catch(()=>{});
    };
    if(signal?.aborted){this.early.delete(id);interrupt();throw abortError();}
    const text=await new Promise((resolve,reject)=>{
      let timer;
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);};
      const succeed=value=>{cleanup();resolve(value);};
      const fail=error=>{cleanup();reject(error);};
      const onAbort=()=>{this.turns.delete(id);this.early.delete(id);interrupt();fail(abortError());};
      const early=this.early.get(id);this.early.delete(id);
      if(early?.completed){if(early.completed.status==='completed')resolve(early.message||early.completed.items?.filter(i=>i.type==='agentMessage').at(-1)?.text||'');else reject(new Error(early.completed.error?.message||`AI turn ${early.completed.status}.`));return;}
      timer=setTimeout(()=>{this.turns.delete(id);interrupt();fail(new Error('AI analysis timed out.'));},180000);
      this.turns.set(id,{resolve:succeed,reject:fail,timer,message:early?.message||''});
      signal?.addEventListener('abort',onAbort,{once:true});
      if(started.turn.status==='completed'){this.turns.delete(id);succeed(started.turn.items?.filter(i=>i.type==='agentMessage').at(-1)?.text||'');}
    });
    checkAbort();
    let data;try{data=JSON.parse(text)}catch{throw new Error('AI returned invalid JSON.');}
    return data;
  }
  stop(){this.proc?.kill();this.proc=null;rmSync(this.directory,{recursive:true,force:true});}
}
module.exports={CodexClient,categorySuggestionSchema,collectionSchema,askSchema,PROFILE};
