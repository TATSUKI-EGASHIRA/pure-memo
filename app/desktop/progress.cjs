// What a wait is actually doing, step by step. Only stages that really happen and counts that are
// really known are reported (notes gathered, characters sent, what Codex says it is weighing);
// nothing is estimated, so there is no percentage.
const STEPS={
  analyze:['gather','connect','send','think','write','check','verify','save'],
  ask:['search','gather','connect','send','think','write','check','verify','save'],
  suggest:['gather','connect','send','think','write','check'],
  memory:['gather','connect','send','think','write','save'],
  classify:['connect','send','think','write','save'],
  backfill:['connect','send','think','write','save'],
  digest:['gather','connect','send','think','write','check','verify','save'],
  article:['fetch'],
  news:['interests','feeds','web','links','filter','translate','save'],
  profile:['gather','connect','send','think','write','save'],
  index:['embed'],
};
const SEND_INTERVAL_MS=150;

class Progress{
  constructor(send=()=>{}){this.send=send;this.tasks=new Map();this.seq=0;this.timer=null;}
  list(){return [...this.tasks.values()].map(task=>({...task,steps:task.steps.map(step=>({...step}))}));}
  flush(){clearTimeout(this.timer);this.timer=null;this.send(this.list());}
  // Text deltas arrive many times a second; the window gets at most one snapshot per interval.
  queue(){if(!this.timer){this.timer=setTimeout(()=>this.flush(),SEND_INTERVAL_MS);this.timer.unref?.();}}
  begin(kind,{ref=null,label=''}={}){
    const id=`${kind}-${++this.seq}`,now=Date.now();
    const task={id,kind,ref,label,startedAt:now,current:null,thought:'',written:0,
      steps:(STEPS[kind]||[]).map(name=>({id:name,facts:null,startedAt:null,endedAt:null}))};
    this.tasks.set(id,task);
    const progress=this;
    const handle={
      id,
      // Moves to a step (earlier steps count as done) and records what is known about it.
      step(name,facts){
        const index=task.steps.findIndex(step=>step.id===name);
        if(index<0)return handle;
        const at=Date.now();
        task.steps.forEach((step,i)=>{if(i<index){step.startedAt??=at;step.endedAt??=at;}});
        const step=task.steps[index];
        step.startedAt??=at;step.endedAt=null;
        if(facts)step.facts={...step.facts,...facts};
        if(task.current!==name){task.current=name;progress.flush();}else progress.queue();
        return handle;
      },
      // Adapter for CodexClient.generate({onProgress}).
      ai(event){
        if(!event?.stage)return;
        if(event.stage==='connect')handle.step('connect');
        else if(event.stage==='send')handle.step('send',{chars:event.chars,model:event.model||null,effort:event.effort||null});
        else if(event.stage==='think'){if(event.thought!==undefined)task.thought=String(event.thought||'').slice(-600);handle.step('think',event.phase?{phase:event.phase}:null);}
        else if(event.stage==='write'){task.written=event.written||0;handle.step('write');}
      },
      done(){task.steps.forEach(step=>{if(step.startedAt)step.endedAt??=Date.now();});progress.tasks.delete(id);progress.flush();},
    };
    this.flush();
    return handle;
  }
  // Runs fn with a task that always ends, whether fn succeeds or throws.
  async run(kind,options,fn){
    const task=this.begin(kind,options);
    try{return await fn(task);}finally{task.done();}
  }
}

// What was gathered for a prompt: note count, and how many come with the text of their linked page.
const material=notes=>({notes:notes.length,articles:notes.filter(note=>note.article?.text).length});
// For workers created without a progress bus (tests, tools).
const quiet={begin:()=>{const handle={id:null,step:()=>handle,ai:()=>{},done:()=>{}};return handle},run:(kind,options,fn)=>fn(quiet.begin())};

module.exports={Progress,STEPS,material,quiet};
