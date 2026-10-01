export const DAY=86400000;
export function hash(value){let h=2166136261;for(const c of value){h^=c.codePointAt(0);h=Math.imul(h,16777619)}return h>>>0;}
const sites=[[230,260],[365,175],[540,160],[665,265],[570,370],[390,355],[205,395],[690,400]];
export function memoryLayout(notes,themes,priority=[]){
 const anchors=themes.map(t=>({...t,x:0,y:0})),occupied=new Set();
 for(const t of [...anchors].sort((a,b)=>a.label.localeCompare(b.label))){let slot=hash(t.label)%8;while(occupied.has(slot)&&occupied.size<8)slot=(slot+1)%8;occupied.add(slot);[t.x,t.y]=sites[slot];}
 const byId=new Map(notes.map(n=>[n.id,n]));
 const wanted=new Set([...priority,...themes.flatMap(t=>t.evidence.map(e=>e.noteId))]);
 const displayed=[...[...wanted].map(id=>byId.get(id)).filter(Boolean),...notes.filter(n=>!wanted.has(n.id))].slice(0,360);
 const memberships=new Map(anchors.map(t=>[t.id,new Set(t.evidence.map(e=>e.noteId))]));
 const nodes=displayed.map(note=>{
  const groups=anchors.filter(t=>memberships.get(t.id).has(note.id));
  const h=hash(note.id),a=(h%6283)/1000;
  let x,y;
  if(groups.length){const r=22+((h>>>8)%62);x=groups[0].x+Math.cos(a)*r;y=groups[0].y+Math.sin(a)*r;}
  else{const r=Math.sqrt((h>>>8)%1000/1000);x=430+Math.cos(a)*300*r;y=285+Math.sin(a)*200*r;}
  return {note,x,y,groups:groups.map(t=>t.id)};
 });return {anchors,nodes};
}
export function inPeriod(date,end,days){const t=Date.parse(date);return t<=end&&(days===0||t>end-days*DAY);}
export function histogram(notes,start,end,bins=36){const counts=Array(bins).fill(0);for(const n of notes){const t=Date.parse(n.date);if(t<start||t>end)continue;counts[Math.min(bins-1,Math.floor((t-start)/Math.max(1,end-start)*bins))]++;}return counts;}
