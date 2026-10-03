// One front for every AI call: which provider runs it (Codex or Claude Code, chosen in Settings),
// and which model and effort it gets. Light work (sorting, reading notes into memory, checking
// answers, translating headlines) runs on the light model, or on the chosen model with low effort;
// everything else on the model and effort the user chose.
const LIGHT=new Set(['classify','classify-link','memory-backfill','profile','verify-collection','verify-ask','news-translate','news-filter']);
const isLight=purpose=>LIGHT.has(String(purpose||'').replace(/-retry$/,''));

class AiRouter{
  constructor({providers,provider=()=>'codex',lightModel=()=>'',reasoningEffort=()=>'',onCall}={}){
    this.providers=providers;this.provider=provider;this.lightModel=lightModel;this.reasoningEffort=reasoningEffort;
    for(const [name,client] of Object.entries(providers))client.onCall=call=>this.onCall?.({...call,provider:name});
    this.onCall=onCall;
  }
  get current(){return this.providers[this.provider()]||this.providers.codex;}
  // Light work keeps its own effort when it asks for one (verification asks for low).
  // A model saved with a job (or chosen for light work) may belong to the other provider; the
  // current provider then uses its own default.
  usable(...models){const client=this.current;return models.find(model=>model&&(!client.accepts||client.accepts(model)))||client.defaultModel?.()||models.find(Boolean);}
  route(options){
    // Codex reads the chosen effort itself; other providers get it here.
    if(!isLight(options.purpose))return {...options,model:this.usable(options.model),effort:options.effort??(this.reasoningEffort()||undefined)};
    return {...options,model:this.usable(this.lightModel(),options.model),effort:options.effort??'low'};
  }
  generate(options){return this.current.generate(this.route(options));}
  models(){return this.current.models();}
  account(){return this.current.account();}
  login(){return this.current.login();}
  stop(){for(const client of Object.values(this.providers))client.stop?.();}
}

module.exports={AiRouter,isLight,LIGHT};
