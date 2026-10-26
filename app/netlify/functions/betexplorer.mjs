// Netlify Function, Node 20+. Public read-only relay restricted to BetExplorer football.
const ORIGIN = 'https://www.betexplorer.com';
const cache = new Map();
const pending = new Map();
export function targetFor(input) {
  if (!input || input.length > 240 || !input.startsWith('/') || input.startsWith('//')) throw new Error('Chemin interdit');
  const u = new URL(input, ORIGIN);
  if (u.origin !== ORIGIN || u.hash || !(/^\/$/.test(u.pathname) || /^\/football\/[a-z0-9-]+\/[a-z0-9-]+\/results\/$/.test(u.pathname))) throw new Error('Chemin interdit');
  const keys = [...u.searchParams.keys()];
  if (u.pathname === '/') {
    if (keys.length !== 3 || !['year','month','day'].every(k => keys.includes(k))) throw new Error('Date requise');
    const y = Number(u.searchParams.get('year')), m = Number(u.searchParams.get('month')), d = Number(u.searchParams.get('day'));
    const date = Date.UTC(y,m-1,d), check = new Date(date);
    if (check.getUTCFullYear()!==y || check.getUTCMonth()!==m-1 || check.getUTCDate()!==d || Math.abs(date-Date.now())>5*86400000) throw new Error('Date hors limite');
  } else if (keys.length) throw new Error('Paramètres interdits');
  return u;
}
async function retrieve(u) {
  const key=u.href, ttl=u.pathname==='/'?300000:3600000;
  const saved=cache.get(key);if(saved&&Date.now()-saved.fetchedAt<ttl)return saved;
  if(pending.has(key))return pending.get(key);
  const task=(async()=>{
    const r=await fetch(u,{redirect:'error',signal:AbortSignal.timeout(18000),headers:{'Accept':'text/html','User-Agent':'Valuecombiner/1.0 (personal football statistics reader)'}});
    if(!r.ok)throw new Error('BetExplorer répond HTTP '+r.status);
    if(!r.headers.get('content-type')?.includes('text/html'))throw new Error('Format source inattendu');
    const reader=r.body.getReader();let length=0;const chunks=[];
    for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>3500000){await reader.cancel();throw new Error('Page trop volumineuse');}chunks.push(value);}
    const html=Buffer.concat(chunks).toString('utf8');
    if(!html.includes('data-event-id')&&!html.includes('in-match')&&!html.includes('No matches'))throw new Error('Page sans données reconnues ou accès refusé');
    const data={version:1,source:'BetExplorer',sourceURL:key,fetchedAt:Date.now(),html};cache.set(key,data);
    if(cache.size>150)cache.delete(cache.keys().next().value);
    return data;
  })();pending.set(key,task);try{return await task;}finally{pending.delete(key);}
}
export default async function handler(req) {
  const headers={'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Cache-Control':'no-store'};
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='GET')return Response.json({error:'Lecture uniquement'},{status:405,headers});
  let u;try{u=targetFor(new URL(req.url).searchParams.get('path'));}catch(e){return Response.json({error:e.message},{status:400,headers});}
  try {return Response.json(await retrieve(u),{headers});}
  catch(e){return Response.json({error:e.name==='TimeoutError'?'BetExplorer ne répond pas à temps':e.message},{status:502,headers});}
}
