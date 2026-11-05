'use strict';
/* Runs the real app.js against a FAKE Supabase (Auth + PostgREST + the RLS / CHECK rules of supabase/leaderboard.sql).
   Run: node test/supabase.test.js */
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const PORT=3115,B='http://localhost:'+PORT,KEY='sb_publishable_TESTKEY',APP=fs.readFileSync(path.join(__dirname,'..','..','app.js'),'utf8');
const rows={},toks={},calls={signup:0,get:0,post:0,del:0,denied:0,badAuthHeader:0};let n=0;
function constraints(r){   /* CHECK constraints of the SQL file */
  return typeof r.name==='string'&&r.name.length>=2&&r.name.length<=24&&(r.bio||'').length<=140&&typeof r.score==='number'&&r.score>=0&&r.score<7&&(r.avatar||'').length<12000;
}
const fake=http.createServer((req,res)=>{
  let body='';req.on('data',d=>body+=d);req.on('end',()=>{
    const u=new URL(req.url,B),send=(c,o)=>{res.writeHead(c,{'Content-Type':'application/json'});res.end(JSON.stringify(o))};
    if(req.headers.apikey!==KEY){calls.denied++;return send(401,{message:'No API key'})}
    const bearer=(req.headers.authorization||'').replace('Bearer ','');
    if(bearer===KEY)calls.badAuthHeader++;     /* the publishable key must never be sent as a Bearer token */
    if(u.pathname==='/auth/v1/signup'){calls.signup++;const id='uuid-'+(++n);toks['tok'+n]=id;toks['rt'+n]=id;return send(200,{access_token:'tok'+n,refresh_token:'rt'+n,expires_in:3600,user:{id}})}
    if(u.pathname==='/auth/v1/token'){const id=toks[JSON.parse(body).refresh_token];if(!id)return send(400,{});const t='tok'+(++n);toks[t]=id;return send(200,{access_token:t,refresh_token:JSON.parse(body).refresh_token,expires_in:3600,user:{id}})}
    if(u.pathname!=='/rest/v1/leaderboard')return send(404,{});
    if(req.method==='GET'){calls.get++;return send(200,Object.values(rows).sort((a,b)=>b.score-a.score))}
    const uid=toks[bearer];
    if(!uid){calls.denied++;return send(401,{})}
    if(req.method==='POST'){const r=JSON.parse(body);if(r.user_id!==uid){calls.denied++;return send(403,{message:'RLS'})}if(!constraints(r)){calls.denied++;return send(400,{message:'check'})}calls.post++;rows[uid]=Object.assign({updated_at:new Date().toISOString()},r);return send(201,{})}
    if(req.method==='DELETE'){const t=u.searchParams.get('user_id');if(t!=='eq.'+uid){calls.denied++;return send(200,{})}calls.del++;delete rows[uid];return send(204,{})}
    send(404,{});
  });
});
function sandbox(cfg){
  const store={},sess={},els={};
  const mk=()=>({addEventListener(){},classList:{toggle(){},add(){},remove(){}},dataset:{},style:{},value:'',checked:true,disabled:false,innerHTML:'',textContent:'',hidden:false,offsetWidth:0,src:'',outerHTML:'',scrollTop:0,open:false,setAttribute(){},closest(){return null},scrollIntoView(){},select(){},focus(){},click(){},querySelector(){return null}});
  const sb={console,setTimeout,clearTimeout,setInterval,clearInterval,fetch,URL,URLSearchParams,TextEncoder,crypto:globalThis.crypto,process,els};
  sb.window=sb;sb.globalThis=sb;
  sb.document={body:{hasAttribute:()=>false,dataset:{}},head:{appendChild(){}},createElement:()=>mk(),querySelector:s=>els[s]||(els[s]=mk()),querySelectorAll:()=>[],documentElement:{style:{setProperty(){}}},addEventListener(){},title:''};
  sb.localStorage={getItem:k=>k in store?store[k]:null,setItem(k,v){store[k]=String(v)},removeItem(k){delete store[k]}};
  sb.sessionStorage={getItem:k=>k in sess?sess[k]:null,setItem(k,v){sess[k]=String(v)},removeItem(k){delete sess[k]}};
  sb.matchMedia=()=>({matches:false});sb.scrollTo=()=>{};sb.location={hash:'',replace(){}};sb.addEventListener=()=>{};sb.Image=function(){};sb.FORMA_CFG=cfg;
  vm.createContext(sb);return sb;
}
const ok=(c,m)=>console.log((c?'PASS':'FAIL')+' - '+m);
const TEST=`
(async()=>{
  const solve=()=>{const [a,b]=$("#botQ").textContent.match(/\\d+/g).map(Number);$("#botA").value=String(a+b);tmShow=0};
  await new Promise(r=>setTimeout(r,50));
  __ok(!!SBC&&!SERVER&&!FBC,"Supabase mode is on (config.js has url + publishable key)");
  amode="new";renderAuth();solve();$("#aN").value="Andrei";$("#aP").value="parola1";await localAuth();
  const dd=my.days[msel];dd.e.push({id:"bench",n:"Bench",s:3,r:5,w:100});bump(0,2.5,0);
  USERS[uid].pub=true;USERS[uid].avt="data:image/jpeg;base64,/9j/AAAA";saveUsers();
  await new Promise(r=>setTimeout(r,1800));
  const rowsNow=Object.values(__t.rows);
  __ok(__t.calls.signup===1&&rowsNow.length===1&&rowsNow[0].name==="Andrei"&&rowsNow[0].score>3&&rowsNow[0].avatar&&rowsNow[0].scores.chest,"opt-in: anonymous Supabase user created, score + thumbnail upserted (RLS + CHECK passed)");
  __ok(__t.calls.badAuthHeader===0,"the publishable key is never sent as a Bearer token");
  __t.rows.zoe={user_id:"zoe",name:"Zoe",bio:"",soc:{},score:2.1,scores:{chest:2.1},avatar:"",updated_at:new Date(Date.now()-3*864e5).toISOString()};
  await loadBoard();
  __ok(ONL.length===2&&onlOK&&ONL[0].n==="Andrei","board loaded WITHOUT signing in (public read): "+ONL.length+" players, best first");
  renderBoard();const html=els["#bList"].innerHTML,st=els["#bStat"].innerHTML;
  __ok(/Zoe[\\s\\S]*offline/.test(html)&&/Andrei[\\s\\S]*online/.test(html)&&st.includes('data-a="rfs"'),"online/offline shown + Refresh button + last/next update");
  let g0=__t.calls.get;lbLast=0;await lbRefresh(false);
  __ok(__t.calls.get===g0,"no automatic refresh inside 24 h");
  localStorage.setItem("lbT",String(Date.now()-25*3600e3));lbLast=0;await lbRefresh(false);
  __ok(__t.calls.get===g0+1,"automatic refresh once the data is older than 24 h");
  // RLS / CHECK: forged requests are refused
  const hdr={apikey:"${KEY}",Authorization:"Bearer "+SB.tok,"Content-Type":"application/json"};
  const forge=await fetch(__t.B+"/rest/v1/leaderboard?on_conflict=user_id",{method:"POST",headers:hdr,body:JSON.stringify({user_id:"zoe",name:"Hax",score:1,scores:{},soc:{}})});
  __ok(forge.status===403,"RLS: writing someone else's row is refused (403)");
  const big=await fetch(__t.B+"/rest/v1/leaderboard?on_conflict=user_id",{method:"POST",headers:hdr,body:JSON.stringify({user_id:SB.uid,name:"Andrei",score:99,scores:{},soc:{}})});
  __ok(big.status===400,"CHECK: score 99 is refused (400)");
  // token refresh path
  SB.tok="";SB.exp=0;await sbToken();__ok(__t.calls.signup===1,"session is refreshed with the saved refresh token (no new anonymous user)");
  // offline
  __t.fake.close();await loadBoard();renderBoard();
  __ok(!onlOK&&ONL.length===2&&els["#bList"].innerHTML.includes("Zoe")&&els["#bStat"].innerHTML.includes("Offline"),"Supabase unreachable: everyone still listed from the local copy, marked offline");
  __t.done();
})().catch(e=>{console.log("TEST ERROR",e);process.exit(1)});
`;
fake.listen(PORT,async()=>{
  const cfg={server:false,turnstile:'',supabase:{url:B,key:KEY}};
  const a=sandbox(cfg);a.__ok=ok;a.__t={rows,calls,B,fake};
  await new Promise(res=>{a.__t.done=res;vm.runInContext(APP+'\n'+TEST,a)});
  process.exit(0);
});
