import React,{useEffect,useRef} from 'react';

// Abstract branching filaments. No private note text is used in the backdrop.
export default function SynapseField({reduced=false,variant='graph'}){
  const canvas=useRef(null);
  useEffect(()=>{
    const el=canvas.current;
    const ctx=el.getContext('2d');
    let frame=0,clock=0,last=0,visible=false,w=1,h=1;
    const paths=Array.from({length:29},(_,i)=>({a:i/28*6.28,r:.12+(i%7)*.025,phase:i*.61}));

    function point(p,t){
      const angle=p.a+t*2.8;
      const radius=p.r+Math.sin(t*4+p.phase)*.048;
      return [w*(.48+Math.cos(angle)*radius*1.65),h*(.48+Math.sin(angle)*radius*.96)];
    }
    function draw(time){
      ctx.clearRect(0,0,w,h);
      for(const p of paths){
        ctx.beginPath();
        for(let k=0;k<=56;k++){
          const [x,y]=point(p,k/56);
          if(k)ctx.lineTo(x,y);else ctx.moveTo(x,y);
        }
        ctx.strokeStyle=`rgba(149,182,202,${variant==='graph'?.055:.11})`;
        ctx.lineWidth=.55;
        ctx.stroke();
        for(let k=0;k<12;k++){
          const t=(k/12+(reduced?0:time*.000018)+p.phase)%1;
          const [x,y]=point(p,t);
          ctx.beginPath();
          ctx.arc(x,y,k%4===0?1.05:.55,0,Math.PI*2);
          ctx.fillStyle=`rgba(197,218,227,${variant==='graph'?.22:.39})`;
          ctx.fill();
        }
      }
    }
    function tick(time){
      if(!visible)return;
      if(time-last>45){clock=time;last=time;draw(time)}
      frame=requestAnimationFrame(tick);
    }
    function syncVisibility(){
      const shouldRun=!reduced&&!document.hidden&&document.hasFocus();
      if(shouldRun===visible)return;
      visible=shouldRun;
      cancelAnimationFrame(frame);
      if(visible){last=0;frame=requestAnimationFrame(tick)}
    }
    const resize=new ResizeObserver(()=>{
      const rect=el.getBoundingClientRect();
      w=rect.width;h=rect.height;
      const scale=Math.min(devicePixelRatio,1.5);
      el.width=Math.max(1,Math.round(w*scale));
      el.height=Math.max(1,Math.round(h*scale));
      ctx.setTransform(scale,0,0,scale,0,0);
      draw(clock);
    });
    resize.observe(el);
    document.addEventListener('visibilitychange',syncVisibility);
    window.addEventListener('focus',syncVisibility);
    window.addEventListener('blur',syncVisibility);
    syncVisibility();
    return ()=>{
      resize.disconnect();
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange',syncVisibility);
      window.removeEventListener('focus',syncVisibility);
      window.removeEventListener('blur',syncVisibility);
    };
  },[reduced,variant]);
  return <canvas className={'synapse-field '+variant} ref={canvas} aria-hidden="true"/>;
}
