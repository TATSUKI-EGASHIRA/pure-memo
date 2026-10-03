// Items under the word they were collected for: newest first, a few at a time, and a word that
// brought nothing new last time says so instead of being missing. A related word (widened by AI from
// an interest) names the interest it came from.
export function topicGroups(items,{settings,interests}){
  const when=item=>Date.parse(item.publishedAt||item.fetchedAt)||0;
  const labels=new Map([...interests.items,...(interests.related||[])].map(item=>[item.query,item.label]));
  const from=new Map((interests.related||[]).map(item=>[item.query,item.fromLabel]));
  const groups=new Map();
  for(const entry of settings.lastTopics||[])groups.set(entry.topic,{topic:entry.topic,items:[],added:entry.added});
  for(const item of items){const group=groups.get(item.topic)||{topic:item.topic,items:[],added:null};group.items.push(item);groups.set(item.topic,group);}
  // Words widened by AI from an interest come after the interests themselves.
  return [...groups.values()].map(group=>({...group,label:labels.get(group.topic)||group.topic,from:from.get(group.topic)||'',items:group.items.sort((a,b)=>when(b)-when(a))}))
    .sort((a,b)=>Number(!!a.from)-Number(!!b.from)||(b.items[0]?when(b.items[0]):-1)-(a.items[0]?when(a.items[0]):-1));
}
