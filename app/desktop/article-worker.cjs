const {requestArticle}=require('./article-fetch.cjs');

class ArticleWorker{
  constructor(store,fetchPreview=requestArticle,onChange=()=>{}){
    this.store=store;this.fetchPreview=fetchPreview;this.onChange=onChange;
    this.running=false;this.stopped=true;this.idleResolvers=[];
  }
  start(){this.stopped=false;this.schedule();}
  stop(){this.stopped=true;}
  idle(){return this.running?new Promise(resolve=>this.idleResolvers.push(resolve)):Promise.resolve();}
  schedule(){if(!this.stopped&&!this.running)setImmediate(()=>this.drain());}
  async drain(){
    if(this.stopped||this.running)return;
    this.running=true;
    try{
      while(!this.stopped){
        const job=this.store.nextArticlePreviewJob();
        if(!job)break;
        if(!this.store.markArticlePreviewRunning(job.revisionId))continue;
        try{
          const preview=await this.fetchPreview(job.url);
          if(this.stopped)break;
          this.store.finishArticlePreview(job.revisionId,preview);
        }catch(error){if(!this.stopped)this.store.failArticlePreview(job.revisionId,error);}
        this.onChange();
      }
    }finally{this.running=false;this.onChange();for(const resolve of this.idleResolvers.splice(0))resolve();}
  }
}
module.exports={ArticleWorker};
