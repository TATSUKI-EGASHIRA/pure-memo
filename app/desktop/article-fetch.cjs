const http=require('node:http');
const https=require('node:https');
const dns=require('node:dns');
const net=require('node:net');

const MAX_HTML_BYTES=192*1024;
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
    callback(null,addresses[0].address,4);
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
function requestArticle(url,redirects=0){
  const target=publicArticleUrl(url);
  return new Promise((resolve,reject)=>{
    const transport=target.protocol==='https:'?https:http;
    const request=transport.request(target,{method:'GET',lookup:safeLookup,headers:{'Accept':'text/html,application/xhtml+xml','Accept-Encoding':'identity','User-Agent':'pure-preview/0.1'},timeout:6000},response=>{
      const status=response.statusCode||0;
      if(status>=300&&status<400&&response.headers.location){
        response.resume();
        if(redirects>=3)return reject(new Error('Too many article redirects.'));
        let next;
        try{next=new URL(response.headers.location,target).href;}catch(error){return reject(error);}
        requestArticle(next,redirects+1).then(resolve,reject);return;
      }
      if(status!==200){response.resume();return reject(new Error(`Article returned HTTP ${status}.`));}
      const type=String(response.headers['content-type']||'').toLowerCase();
      if(!type.includes('text/html')&&!type.includes('application/xhtml+xml')){response.resume();return reject(new Error('This URL is not an HTML article.'));}
      if(response.headers['content-encoding']&&response.headers['content-encoding']!=='identity'){response.resume();return reject(new Error('Compressed article preview is unavailable.'));}
      const chunks=[];let size=0;
      response.on('data',chunk=>{size+=chunk.length;if(size>MAX_HTML_BYTES){request.destroy(new Error('Article preview is too large.'));return;}chunks.push(chunk);});
      response.on('end',()=>{
        const charset=type.match(/charset\s*=\s*([\w-]+)/)?.[1]||'utf-8';
        let html;
        try{html=new TextDecoder(charset).decode(Buffer.concat(chunks));}catch{html=new TextDecoder().decode(Buffer.concat(chunks));}
        try{resolve(parseArticleMetadata(html,target.href));}catch(error){reject(error);}
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
module.exports={publicIPv4,publicArticleUrl,parseArticleMetadata,requestArticle};
