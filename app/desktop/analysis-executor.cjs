const {abortError}=require('./job-policy.cjs');

// Guard immediately before uploading, as well as when the result arrives.
class AnalysisExecutor{
  constructor(store,client){this.store=store;this.client=client;this.active=new Set();}
  // contextRunIds: earlier runs whose output goes into this prompt (feedback, or a previous digest).
  async generate({items,feedback=[],contextRunIds:extraRunIds=[],signal,...options}){
    const contextRunIds=[...new Set([...feedback.map(item=>item._runId),...extraRunIds].filter(Boolean))];
    const controller=new AbortController();
    const operation={items,contextRunIds,controller};
    const forwardAbort=()=>controller.abort();
    const guard=()=>{
      if(controller.signal.aborted)throw abortError();
      this.store.assertAiSnapshot(items,contextRunIds);
    };
    if(signal?.aborted)controller.abort();
    signal?.addEventListener('abort',forwardAbort,{once:true});
    this.active.add(operation);
    try{
      guard();
      const result=await this.client.generate({...options,signal:controller.signal,beforeSend:guard});
      guard();
      return result;
    }finally{signal?.removeEventListener('abort',forwardAbort);this.active.delete(operation);}
  }
  cancelInvalid(){
    for(const operation of this.active){
      try{this.store.assertAiSnapshot(operation.items,operation.contextRunIds)}catch{operation.controller.abort();}
    }
  }
  cancelAll(){for(const operation of this.active)operation.controller.abort();}
}
module.exports={AnalysisExecutor};
