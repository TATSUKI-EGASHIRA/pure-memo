const {promptFor,validateResult}=require('./analysis.cjs');
const {collectionSchema}=require('./codex.cjs');

class DigestWorker{
  constructor(store,ai,classifier,onChange=()=>{}){
    this.store=store;this.ai=ai;this.classifier=classifier;this.onChange=onChange;
    this.running=false;this.stopped=false;this.timer=null;this.idleResolvers=[];this.current=null;this.reschedule=false;
  }
  start(){this.stopped=false;this.schedule();}
  stop(){
    this.stopped=true;
    if(this.current){this.store.deferDigest(this.current.job);this.current.controller.abort();}
    if(this.timer){clearTimeout(this.timer);this.timer=null;}
  }
  cancel(id,token){if(this.current?.job.categoryId===id&&this.current.job.token===token)this.current.controller.abort();}
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
      while(!this.stopped&&this.store.autoDigestEnabled()){
        const job=this.store.nextDigestJob();
        if(!job)break;
        if(!this.store.markDigestRunning(job))continue;
        this.current={job,controller:new AbortController()};
        this.onChange();
        try{
          const items=this.store.analysisNotesFor(job.categoryId).slice(0,30);
          if(items.length<2||job.fingerprint!==this.store.insightFingerprint(job.categoryId)){
            this.store.queueStaleDigests();continue;
          }
          const categories=this.store.categories().filter(category=>!['all','other'].includes(category.id));
          const feedback=this.store.feedbackFor(job.categoryId);
          const result=validateResult(await this.ai.generate({items,feedback,model:job.model,prompt:promptFor('collection',items,feedback,null,categories),schema:collectionSchema,signal:this.current.controller.signal}),items,'collection');
          if(this.stopped||!this.store.autoDigestEnabled()){
            this.store.deferDigest(job);break;
          }
          if(!this.store.digestJobStillRunning(job)||job.fingerprint!==this.store.insightFingerprint(job.categoryId)){
            this.store.queueStaleDigests();continue;
          }
          this.store.saveAnalysis({purpose:'collection',categoryId:job.categoryId,model:job.model,items,result,fingerprint:job.fingerprint,contextRunIds:feedback.map(item=>item._runId)});
          this.store.finishDigest(job);
        }catch(error){if(this.stopped)this.store.deferDigest(job);else if(error.name!=='AbortError')this.store.failDigest(job,error);}finally{this.current=null;}
        this.onChange();
      }
    }finally{this.running=false;this.onChange();for(const resolve of this.idleResolvers.splice(0))resolve();if(!this.stopped){const delay=this.store.nextJobDelay('digest');if(this.reschedule)this.schedule();else if(delay!==null)this.schedule(delay);}}
  }
}

module.exports={DigestWorker};
