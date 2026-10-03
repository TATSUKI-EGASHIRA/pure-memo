const {promptFor,validateResult}=require('./analysis.cjs');
const {collectionSchema}=require('./codex.cjs');
const {quiet,material}=require('./progress.cjs');
const {VERSIONS,generateValid,verified}=require('./ai-tasks.cjs');

class DigestWorker{
  // `concurrency`: categories updated at the same time (a first install has a digest for each).
  constructor(store,ai,classifier,onChange=()=>{},progress=quiet,{concurrency=2}={}){
    this.store=store;this.ai=ai;this.classifier=classifier;this.onChange=onChange;this.progress=progress;this.concurrency=concurrency;
    this.running=false;this.stopped=false;this.timer=null;this.idleResolvers=[];this.runs=new Set();this.reschedule=false;
  }
  start(){this.stopped=false;this.schedule();}
  stop(){
    this.stopped=true;
    for(const {job,controller} of this.runs){this.store.deferDigest(job);controller.abort();}
    if(this.timer){clearTimeout(this.timer);this.timer=null;}
  }
  cancel(id,token){for(const run of this.runs)if(run.job.categoryId===id&&run.job.token===token)run.controller.abort();}
  idle(){return this.running?new Promise(resolve=>this.idleResolvers.push(resolve)):Promise.resolve();}
  schedule(delay=400){
    if(this.stopped||!this.store.autoDigestEnabled())return;
    if(this.running){this.reschedule=true;return;}
    if(this.timer)clearTimeout(this.timer);
    this.timer=setTimeout(()=>{this.timer=null;this.drain().catch(()=>{});},delay);this.timer.unref?.();
  }
  async drain(){
    if(this.running||this.stopped||!this.store.autoDigestEnabled())return;
    this.running=true;this.reschedule=false;
    try{
      await this.classifier.idle();
      if(this.stopped||!this.store.autoDigestEnabled())return;
      this.store.queueStaleDigests();this.onChange();
      const active=new Set();
      while(!this.stopped&&this.store.autoDigestEnabled()){
        while(active.size<this.concurrency&&!this.stopped&&this.store.autoDigestEnabled()){
          const job=this.store.nextDigestJob();
          if(!job)break;
          if(!this.store.markDigestRunning(job))continue;
          const update=this.update(job).finally(()=>active.delete(update));
          active.add(update);
        }
        if(!active.size)break;
        await Promise.race(active);
      }
      await Promise.all(active);
    }finally{this.running=false;this.onChange();for(const resolve of this.idleResolvers.splice(0))resolve();if(!this.stopped){const delay=this.store.nextJobDelay('digest');if(this.reschedule)this.schedule();else if(delay!==null)this.schedule(delay);}}
  }
  async update(job){
    const run={job,controller:new AbortController()};
    this.runs.add(run);
    this.onChange();
    const task=this.progress.begin('digest',{ref:job.categoryId,label:this.store.categories().find(category=>category.id===job.categoryId)?.name||''});
    try{
      const items=this.store.analysisNotesFor(job.categoryId).slice(0,30);
      if(items.length<2||job.fingerprint!==this.store.insightFingerprint(job.categoryId)){this.store.queueStaleDigests();return;}
      const categories=this.store.categories().filter(category=>!['all','other'].includes(category.id));
      const feedback=this.store.feedbackFor(job.categoryId);
      task.step('gather',{...material(items),feedback:feedback.length});
      const previous=this.store.previousDigest?.(job.categoryId,items)||null;
      const {raw,result:checkedResult}=await generateValid(this.ai,{items,feedback,contextRunIds:previous?[previous.runId]:[],model:job.model,purpose:'digest',promptVersion:VERSIONS.collection,prompt:promptFor('collection',items,feedback,null,categories,previous),schema:collectionSchema,signal:run.controller.signal,onProgress:task.ai},
        raw=>validateResult(raw,items,'collection'));
      task.step('check',{evidence:raw?.evidenceRevisionIds?.length??0,claims:raw?.claims?.length??0});
      const {result}=await verified(this.ai,{model:job.model,purpose:'collection',result:checkedResult,notes:items,locale:this.store.uiLocale?.()||'ja',signal:run.controller.signal,task});
      if(this.stopped||!this.store.autoDigestEnabled()){this.store.deferDigest(job);return;}
      if(!this.store.digestJobStillRunning(job)||job.fingerprint!==this.store.insightFingerprint(job.categoryId)){this.store.queueStaleDigests();return;}
      task.step('save');
      this.store.saveAnalysis({promptVersion:VERSIONS.collection,purpose:'collection',categoryId:job.categoryId,model:job.model,items,result,fingerprint:job.fingerprint,contextRunIds:[...feedback.map(item=>item._runId),...(previous?[previous.runId]:[])]});
      this.store.finishDigest(job);
    }catch(error){if(this.stopped)this.store.deferDigest(job);else if(error.name!=='AbortError')this.store.failDigest(job,error);}
    finally{this.runs.delete(run);task.done();this.onChange();}
  }
}

module.exports={DigestWorker};
