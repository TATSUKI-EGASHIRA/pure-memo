const http=require('node:http');
const https=require('node:https');
const dns=require('node:dns');
const net=require('node:net');
const zlib=require('node:zlib');

// Enough for long articles; the decoded page is capped too (compression bombs).
const MAX_HTML_BYTES=2*1024*1024,MAX_DECODED_BYTES=6*1024*1024,MAX_TEXT_CHARS=20000;
function publicIPv4(address){
  if(net.isIP(address)!==4)return false;
  const [a,b,c]=address.split('.').map(Number);
  if(a===0||a===10||a===127||a>=224)return false;
  if(a===100&&b>=64&&b<=127)return false;
  if(a===169&&b===254)return false;
  if(a===172&&b>=16&&b<=31)return false;
  if(a===192&&(b===0||b===168))return false;
  if(a===198&&(b===18||b===19))return false;
  if(a===192&&b===88&&c===99)return false;
  if(a===203&&b===0&&c===113)return false;
  if(a===198&&b===51&&c===100)return false;
  return true;
}
function publicArticleUrl(raw){
  const url=new URL(raw);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||!url.hostname||url.port&&!['80','443'].includes(url.port))throw new Error('Only public HTTP or HTTPS article URLs can be previewed.');
  if(net.isIP(url.hostname)||url.hostname==='localhost'||url.hostname.endsWith('.localhost')||url.hostname.endsWith('.local')||url.hostname.endsWith('.internal')||url.hostname.endsWith('.test'))throw new Error('Local or private URLs cannot be previewed.');
  return url;
}
function safeLookup(hostname,options,callback){
  dns.lookup(hostname,{all:true,family:4},(error,addresses)=>{
    if(error)return callback(error);
    if(!addresses?.length||addresses.some(item=>!publicIPv4(item.address)))return callback(new Error('Article host is not publicly reachable.'));
    // Newer Node asks for every address ({all:true}); older callers want one.
    if(options?.all)callback(null,addresses.map(item=>({address:item.address,family:4})));else callback(null,addresses[0].address,4);
  });
}
function decodeEntities(input){
  return String(input||'').replace(/&#(x[0-9a-f]+|[0-9]+);?/gi,(_,code)=>{
    const point=code[0].toLowerCase()==='x'?parseInt(code.slice(1),16):parseInt(code,10);
    return point>0&&point<=0x10ffff?String.fromCodePoint(point):'';
  }).replace(/&(?:amp|lt|gt|quot|apos|nbsp|hellip|mdash|ndash);/gi,entity=>({
    '&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' ','&hellip;':'…','&mdash;':'—','&ndash;':'–'
  })[entity.toLowerCase()]||entity);
}
function clean(value,max){return decodeEntities(value).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,max);}
function metaTags(html){
  const found=new Map();
  for(const tag of html.match(/<meta\b[^>]*>/gi)||[]){
    const attributes={};
    for(const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))attributes[match[1].toLowerCase()]=match[2]??match[3]??match[4];
    const key=(attributes.property||attributes.name||'').toLowerCase();
    if(key&&!found.has(key))found.set(key,attributes.content||'');
  }
  return found;
}
function parseArticleMetadata(html,url){
  const meta=metaTags(html);
  const title=clean(meta.get('og:title')||meta.get('twitter:title')||html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'',300);
  const description=clean(meta.get('og:description')||meta.get('description')||meta.get('twitter:description')||'',600);
  const siteName=clean(meta.get('og:site_name')||new URL(url).hostname.replace(/^www\./,''),120);
  if(!title&&!description)throw new Error('No article title or description was found.');
  return {title,description,siteName};
}
// The readable body of an article, without a DOM: JSON-LD articleBody first, then the
// paragraphs of <article>/<main>/<body> with navigation, headers, footers and asides removed.
function jsonLdBody(html){
  for(const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
    let data;try{data=JSON.parse(match[1].trim())}catch{continue}
    const stack=[data];
    while(stack.length){
      const item=stack.pop();
      if(!item||typeof item!=='object')continue;
      if(typeof item.articleBody==='string'&&item.articleBody.trim().length>=200)return item.articleBody;
      for(const value of Object.values(item))if(value&&typeof value==='object')stack.push(value);
    }
  }
  return '';
}
// Inline tags join without a space (Japanese has none between words); <rt> furigana and
// [1]-style reference marks are dropped.
function textOf(fragment,max){
  const flat=String(fragment)
    .replace(/<(rt|rp)\b[\s\S]*?<\/\1>/gi,'')
    .replace(/<sup\b[^>]*class\s*=\s*["'][^"']*reference[^"']*["'][\s\S]*?<\/sup>/gi,'')
    .replace(/<br\s*\/?>/gi,'\n')
    .replace(/<\/?(a|span|b|i|em|strong|sup|sub|code|small|mark|abbr|cite|q|u|s|time|ruby|rb|bdi|font|wbr|kbd|var|data)\b[^>]*>/gi,'')
    .replace(/<[^>]*>/g,' ');
  return decodeEntities(flat).replace(/[ \t\f\v\u00a0]+/g,' ').replace(/ *\n */g,'\n').trim().slice(0,max);
}
function largest(html,tag){
  let best='';
  for(const match of html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`,'gi')))if(match[1].length>best.length)best=match[1];
  return best;
}
function extractArticleText(html){
  const fromJson=jsonLdBody(html);
  if(fromJson)return clean(fromJson.replace(/\r?\n+/g,'\u2029'),MAX_TEXT_CHARS).replace(/\u2029/g,'\n\n');
  let page=html.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|noscript|svg|template|iframe|canvas|select|button)\b[\s\S]*?<\/\1>/gi,' ');
  let region=largest(page,'article')||largest(page,'main')||largest(page,'body')||page;
  region=region.replace(/<(nav|header|footer|aside|form|menu)\b[\s\S]*?<\/\1>/gi,' ');
  const blocks=[];
  for(const match of region.matchAll(/<(p|h[1-4]|li|blockquote|pre|dd)\b[^>]*>([\s\S]*?)<\/\1>/gi)){
    const text=textOf(match[2],4000);
    const heading=/^h/i.test(match[1]);
    if(text.length>=(heading?2:20)&&blocks[blocks.length-1]!==text)blocks.push(text);
  }
  let text=blocks.join('\n\n');
  // Pages without paragraph markup: fall back to the region's plain text when it says clearly more.
  if(text.length<200){const plain=textOf(region,MAX_TEXT_CHARS).replace(/\s+/g,' ');if(plain.length>text.length*2)text=plain;}
  return text.slice(0,MAX_TEXT_CHARS);
}
// The JSON object that follows `marker` in a page script, or null.
function jsonAfter(html,marker,from=0){
  const at=html.indexOf(marker,from);if(at<0)return null;
  const start=html.indexOf('{',at+marker.length-1);
  let depth=0,quoted=false,escaped=false;
  for(let i=start;i<html.length&&i<start+200000;i++){
    const c=html[i];
    if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue}
    if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){try{return {value:JSON.parse(html.slice(start,i+1)),end:i+1}}catch{return null}}
  }
  return null;
}
const isYouTube=url=>{try{return /(^|\.)(youtube\.com|youtu\.be)$/.test(new URL(url).hostname)}catch{return false}};
// YouTube pages carry the video's own details: channel, full description, and the songs YouTube
// lists under "Music" with their artist and album. These are used as is; nothing is guessed.
function parseYouTube(html){
  const details=jsonAfter(html,'"videoDetails":{')?.value;
  if(!details)return null;
  const tracks=[];let from=0,found;
  while(tracks.length<5&&(found=jsonAfter(html,'"videoAttributeViewModel":{',from))){
    from=found.end;const item=found.value;
    const track={title:clean(item.title||'',200),artist:clean(item.subtitle||'',200),album:clean(item.secondarySubtitle?.content||'',200)};
    if(track.title&&!tracks.some(t=>t.title===track.title&&t.artist===track.artist))tracks.push(track);
  }
  return {title:clean(details.title||'',300),author:clean(details.author||'',120),text:String(details.shortDescription||'').trim().slice(0,5000),
    duration:Number(details.lengthSeconds)||0,tracks};
}
function parseArticle(html,url){
  const meta=metaTags(html);
  const article={...parseArticleMetadata(html,url),text:extractArticleText(html),
    author:clean(meta.get('author')||meta.get('article:author')||'',120),publishedAt:clean(meta.get('article:published_time')||meta.get('date')||'',40)};
  // A video page's visible text is only the site footer; its description is what says what it is.
  const video=isYouTube(url)?parseYouTube(html):null;
  if(video)Object.assign(article,{title:video.title||article.title,author:video.author,text:video.text,media:{kind:'video',duration:video.duration,tracks:video.tracks}});
  return article;
}
function decodeBody(buffer,encoding){
  const limit={maxOutputLength:MAX_DECODED_BYTES};
  if(encoding==='gzip'||encoding==='x-gzip')return zlib.gunzipSync(buffer,limit);
  if(encoding==='br')return zlib.brotliDecompressSync(buffer,limit);
  if(encoding==='deflate'){try{return zlib.inflateSync(buffer,limit)}catch{return zlib.inflateRawSync(buffer,limit)}}
  if(!encoding||encoding==='identity')return buffer;
  throw new Error('Unsupported article encoding.');
}
// One GET to a public host (no private addresses, no credentials), decoded to text.
// `types` lists the content types accepted; anything else is refused.
function requestText(url,{accept='text/html,application/xhtml+xml',types=['text/html','application/xhtml+xml'],redirects=0}={}){
  const target=publicArticleUrl(url);
  return new Promise((resolve,reject)=>{
    const transport=target.protocol==='https:'?https:http;
    const request=transport.request(target,{method:'GET',lookup:safeLookup,headers:{'Accept':accept,'Accept-Encoding':'gzip, deflate, br','Accept-Language':'ja,en;q=0.8','User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) pure-reader/0.2'},timeout:6000},response=>{
      const status=response.statusCode||0;
      if(status>=300&&status<400&&response.headers.location){
        response.resume();
        if(redirects>=3)return reject(new Error('Too many article redirects.'));
        let next;
        try{next=new URL(response.headers.location,target).href;}catch(error){return reject(error);}
        requestText(next,{accept,types,redirects:redirects+1}).then(resolve,reject);return;
      }
      if(status!==200){response.resume();return reject(new Error(`Article returned HTTP ${status}.`));}
      const type=String(response.headers['content-type']||'').toLowerCase();
      if(!types.some(item=>type.includes(item))){response.resume();return reject(new Error('This URL is not an HTML article.'));}
      const chunks=[];let size=0;
      response.on('data',chunk=>{size+=chunk.length;if(size>MAX_HTML_BYTES){request.destroy(new Error('Article preview is too large.'));return;}chunks.push(chunk);});
      response.on('end',()=>{
        const charset=type.match(/charset\s*=\s*([\w-]+)/)?.[1]||'utf-8';
        let bytes;
        try{bytes=decodeBody(Buffer.concat(chunks),String(response.headers['content-encoding']||'').toLowerCase().trim());}catch(error){return reject(error);}
        let text;
        try{text=new TextDecoder(charset).decode(bytes);}catch{text=new TextDecoder().decode(bytes);}
        // A <meta charset> overrides a missing header charset (common on Japanese sites).
        const declared=!type.includes('charset')&&text.slice(0,4096).match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i)?.[1];
        if(declared&&declared.toLowerCase()!=='utf-8'){try{text=new TextDecoder(declared).decode(bytes)}catch{}}
        resolve({text,url:target.href,type});
      });
      response.on('error',reject);
    });
    request.on('timeout',()=>request.destroy(new Error('Article preview timed out.')));
    request.on('error',reject);
    const deadline=setTimeout(()=>request.destroy(new Error('Article preview timed out.')),10000);
    request.on('close',()=>clearTimeout(deadline));
    request.end();
  });
}
// Throws at once for a URL that is not public, before any request is made.
function requestArticle(url){
  return requestText(url).then(({text,url:finalUrl})=>parseArticle(text,finalUrl));
}
module.exports={requestText,clean,decodeEntities,parseYouTube,publicIPv4,publicArticleUrl,parseArticleMetadata,parseArticle,extractArticleText,decodeBody,requestArticle,MAX_TEXT_CHARS};
