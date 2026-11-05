'use strict';
/* Runs the real app.js (in a simulated browser) against a FAKE Firebase REST API (anonymous sign-in + Firestore rules checks).
   Checks: shared leaderboard works, daily auto-refresh, manual refresh, offline cache, weight steppers, hexagon frames, admin-only Special. Run: node test/firebase.test.js */
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const PORT=3114,B='http://localhost:'+PORT,APP=fs.readFileSync(path.join(__dirname,'..','..','app.js'),'utf8');
const docs={},toks={},calls={list:0,patch:0,del:0,signup:0,denied:0};let n=0;
const RULE_KEYS=['n','bio','soc','sc','s','av','t'];
function rulesOk(f){   /* same checks as firebase/firestore.rules */
  if(!f||Object.keys(f).some(k=>!RULE_KEYS.includes(k)))return false;
  const n=f.n&&f.n.stringValue,sc=f.sc&&f.sc.doubleValue;
  return typeof n==='string'&&n.length>=2&&n.length<=24&&typeof sc==='number'&&sc>=0&&sc<7&&(!f.bio||f.bio.stringValue.length<=140)&&(!f.av||f.av.stringValue.length<12000);
}
const fake=http.createServer((req,res)=>{
  let body='';req.on('data',d=>body+=d);req.on('end',()=>{
    const u=new URL(req.url,B),send=(c,o)=>{res.writeHead(c,{'Content-Type':'application/json'});res.end(JSON.stringify(o))};
    if(u.pathname==='/v1/accounts:signUp'){calls.signup++;const id='anon'+(++n);toks['tok'+n]=id;toks['rt'+n]=id;return send(200,{idToken:'tok'+n,refreshToken:'rt'+n,localId:id,expiresIn:'3600'})}
    if(u.pathname==='/v1/token'){const rt=new URLSearchParams(body).get('refresh_token'),id=toks[rt];if(!id)return send(400,{});const t='tok'+(++n);toks[t]=id;return send(200,{id_token:t,refresh_token:rt,user_id:id,expires_in:'3600'})}
    const m=/^\/v1\/projects\/([^/]+)\/databases\/\(default\)\/documents\/leaderboard(?:\/([^/]+))?$/.exec(u.pathname);
    if(!m)return send(404,{});
    const uid=toks[(req.headers.authorization||'').replace('Bearer ','')];if(!uid){calls.denied++;return send(401,{})}
    if(req.method==='GET'&&!m[2]){calls.list++;return send(200,{documents:Object.entries(docs).map(([id,f])=>({name:`projects/p/databases/(default)/documents/leaderboard/${id}`,fields:f}))})}
    if(req.method==='PATCH'&&m[2]){const f=JSON.parse(body).fields;if(m[2]!==uid||!rulesOk(f)){calls.denied++;return send(403,{})}calls.patch++;docs[m[2]]=f;return send(200,{})}
    if(req.method==='DELETE'&&m[2]){if(m[2]!==uid){calls.denied++;return send(403,{})}calls.del++;delete docs[m[2]];return send(200,{})}
    send(404,{});
  });
});
function sandbox(cfg,page){
  const store={},sess={},els={};
  const mk=()=>({addEventListener(){},classList:{toggle(){},add(){},remove(){}},dataset:{},style:{},value:'',checked:true,disabled:false,innerHTML:'',textContent:'',hidden:false,offsetWidth:0,src:'',outerHTML:'',scrollTop:0,open:false,setAttribute(){},closest(){return null},scrollIntoView(){},select(){},focus(){},click(){},querySelector(){return null}});
  const sb={console,setTimeout,clearTimeout,setInterval,clearInterval,fetch,URL,URLSearchParams,TextEncoder,crypto:globalThis.crypto,process,els};
  sb.window=sb;sb.globalThis=sb;
  sb.document={body:{hasAttribute:()=>!!page,dataset:{page}},head:{appendChild(){}},createElement:()=>mk(),querySelector:s=>els[s]||(els[s]=mk()),querySelectorAll:()=>[],documentElement:{style:{setProperty(){}}},addEventListener(){},title:''};
  sb.localStorage={getItem:k=>k in store?store[k]:null,setItem(k,v){store[k]=String(v)},removeItem(k){delete store[k]}};
  sb.sessionStorage={getItem:k=>k in sess?sess[k]:null,setItem(k,v){sess[k]=String(v)},removeItem(k){delete sess[k]}};
  sb.matchMedia=()=>({matches:false});sb.scrollTo=()=>{};sb.location={hash:'',replace(u){sb.replaced=u}};sb.addEventListener=()=>{};sb.Image=function(){};sb.FORMA_CFG=cfg;
  vm.createContext(sb);return sb;
}
const ok=(c,m)=>console.log((c?'PASS':'FAIL')+' - '+m);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const TEST=`
(async()=>{
  const solve=()=>{const [a,b]=$("#botQ").textContent.match(/\\d+/g).map(Number);$("#botA").value=String(a+b);tmShow=0};
  const login=async(name)=>{amode="new";renderAuth();solve();$("#aN").value=name;$("#aP").value="parola1";await localAuth()};
  await new Promise(r=>setTimeout(r,50));
  __ok(!!FBC&&!SERVER,"Firebase mode is on (config.js has apiKey + projectId)");
  await login("Andrei");__ok(!!uid,"local account created (uid "+uid+")");
  // ---- weight steppers: raise the weight straight from the site
  const dd=my.days[msel];dd.e.push({id:"bench",n:"Bench",s:3,r:5,w:100});
  __ok(!RS.chest,"no rank before the program is saved");
  bump(0,2.5,0);
  __ok(dd.e[0].w===102.5&&JSON.parse(my.sv).days[msel].e[0].w===102.5,"+2.5 kg changes the weight to 102.5 and saves the program");
  __ok(!!RS.chest&&RS.chest.s>3,"rank for the chest appears immediately (score "+RS.chest.s.toFixed(2)+")");
  bump(0,-5,0);__ok(dd.e[0].w===97.5,"-5 kg works (97.5)");bump(0,0,1);__ok(dd.e[0].r===6,"+1 rep works");
  await new Promise(r=>setTimeout(r,2300));
  __ok((my.log.bench||[]).length===1&&my.log.bench[0].w===97.5,"after you stop clicking, ONE log entry is written (spam-free)");
  // ---- hexagon rank frame
  const h=bimg(RK[2],2,48);__ok(h.includes('class="hx"')&&h.includes("--c:"+RK[2][2])&&h.includes("beast.jpeg"),"rank picture is wrapped in the hexagon frame (hx) with the rank colour");
  // ---- publish to Firebase (anonymous auth + Firestore) and read the board
  USERS[uid].pub=true;USERS[uid].avt="data:image/jpeg;base64,/9j/AAAA";USERS[uid].bio="hello";saveUsers();
  await new Promise(r=>setTimeout(r,1700));
  const mine=Object.values(__t.docs)[0];
  __ok(Object.keys(__t.docs).length===1&&mine.n.stringValue==="Andrei"&&mine.sc.doubleValue>3&&mine.av&&mine.s.mapValue.fields.chest,"score + small avatar published to Firestore (anonymous uid, rules passed)");
  __t.docs.zoe={n:{stringValue:"Zoe"},bio:{stringValue:""},soc:{mapValue:{fields:{}}},sc:{doubleValue:2.1},s:{mapValue:{fields:{chest:{doubleValue:2.1}}}},t:{integerValue:String(Date.now()-3*864e5)}};
  await loadBoard();
  __ok(ONL.length===2&&onlOK,"leaderboard loaded from Firebase: "+ONL.length+" players");
  renderBoard();const html=els["#bList"].innerHTML,st=els["#bStat"].innerHTML;
  __ok(html.indexOf("Andrei")<html.indexOf("Zoe")&&/Zoe[\\s\\S]*offline/.test(html)&&/Andrei[\\s\\S]*online/.test(html),"sorted by score; me = online, Zoe (3 days ago) = offline");
  __ok(st.includes('data-a="rfs"')&&st.includes("Ultima actualizare"),"status shows last/next refresh and the Refresh button");
  // ---- once-a-day automatic refresh
  let l0=__t.calls.list;lbLast=0;await lbRefresh(false);
  __ok(__t.calls.list===l0,"auto-refresh does NOT hit Firebase again within 24 h");
  localStorage.setItem("lbT",String(Date.now()-25*3600e3));lbLast=0;await lbRefresh(false);
  __ok(__t.calls.list===l0+1,"auto-refresh runs when the last refresh is older than 24 h");
  l0=__t.calls.list;await lbRefresh(true);
  __ok(__t.calls.list===l0,"manual refresh has a 30 s cooldown (no spam)");
  lbLast=0;await lbRefresh(true);__ok(__t.calls.list===l0+1,"manual refresh works on demand");
  // ---- rules: forged score is rejected
  const bad=await fetch(__t.B+"/v1/projects/p/databases/(default)/documents/leaderboard/"+FB.uid,{method:"PATCH",headers:{Authorization:"Bearer "+FB.tok,"Content-Type":"application/json"},body:JSON.stringify({fields:{n:{stringValue:"Hax"},sc:{doubleValue:99},s:{mapValue:{fields:{}}},soc:{mapValue:{fields:{}}},t:{doubleValue:1}}})});
  __ok(bad.status===403,"Firestore rules reject sc=99 (403)");
  // ---- offline: the board still shows everyone from the saved copy
  __t.fake.close();await loadBoard();renderBoard();
  __ok(!onlOK&&ONL.length===2&&els["#bList"].innerHTML.includes("Zoe")&&els["#bStat"].innerHTML.includes("Offline"),"server unreachable: players still listed from the local copy, marked offline");
  // ---- turn publishing off -> entry removed (fake is closed again, so just check the call path)
  // ---- Special is only for admin/owner
  __ok(!els["#nav"].innerHTML.includes("#special"),"normal account: no Special tab");
  logout();amode="pan";renderAuth();solve();$("#aC").value="zee4625cool";await localAuth();
  __ok(isOwn()&&els["#nav"].innerHTML.includes("#special"),"Owner (Panel code): Special tab appears");
  __t.done();
})().catch(e=>{console.log("TEST ERROR",e);process.exit(1)});
`;
const TEST2=`
(async()=>{
  const solve=()=>{const [a,b]=$("#botQ").textContent.match(/\\d+/g).map(Number);$("#botA").value=String(a+b);tmShow=0};
  await new Promise(r=>setTimeout(r,50));
  amode="new";renderAuth();solve();$("#aN").value="Mia";$("#aP").value="parola1";await localAuth();
  __ok(replaced==="index.html","opening special.html as a normal user redirects to index.html");
  __t.done();
})().catch(e=>{console.log("TEST ERROR",e);process.exit(1)});
`;
fake.listen(PORT,async()=>{
  const cfg={server:false,turnstile:'',firebase:{apiKey:'k',projectId:'p',auth:B,token:B,store:B}};
  const a=sandbox(cfg,null);a.__ok=ok;a.__t={docs,calls,B,fake,done:()=>{}};
  await new Promise(res=>{a.__t.done=res;vm.runInContext(APP+'\n'+TEST,a)});
  const b=sandbox({server:false,turnstile:''},'special');b.__ok=ok;
  await new Promise(res=>{b.__t={done:res};vm.runInContext(APP+'\n'+TEST2,b)});
  process.exit(0);
});
