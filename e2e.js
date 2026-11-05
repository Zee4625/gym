'use strict';
/* End-to-end test: starts the real server + a fake SMTP server and checks auth, e-mail codes, lockout, anti-bot, validation, tampering, headers. Run: npm test */
const {spawn,execFileSync}=require('node:child_process'),net=require('node:net'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const ROOT=path.join(__dirname,'..'),TMP=path.join(os.tmpdir(),'forma-e2e');
const PORT=3111,B='http://localhost:'+PORT;
const mails=[];
const smtp=net.createServer(s=>{
  let data='',inData=false;s.write('220 fake\r\n');
  s.on('data',d=>{data+=d.toString();
    while(true){
      if(inData){const i=data.indexOf('\r\n.\r\n');if(i<0)break;mails.push(data.slice(0,i));data=data.slice(i+5);inData=false;s.write('250 queued\r\n');continue}
      const i=data.indexOf('\r\n');if(i<0)break;const l=data.slice(0,i);data=data.slice(i+2);
      if(/^EHLO/.test(l))s.write('250-fake\r\n250 OK\r\n');else if(/^MAIL|^RCPT/.test(l))s.write('250 OK\r\n');else if(l==='DATA'){s.write('354 go\r\n');inData=true}else if(l==='QUIT'){s.write('221 bye\r\n');s.end()}else s.write('250 OK\r\n');
    }});
}).listen(2525);
const hash=execFileSync('node',['tools/hash-code.js','ZEE4625COOL'],{cwd:ROOT}).toString().trim().split('=').slice(1).join('=');
try{fs.rmSync(TMP,{recursive:true})}catch(e){}
const srv=spawn('node',['server.js'],{cwd:ROOT,env:Object.assign({},process.env,{PORT,DB_PATH:path.join(TMP,'forma.db'),SMTP_HOST:'127.0.0.1',SMTP_PORT:'2525',SMTP_SECURE:'false',SMTP_FROM:'forma@test.local',OWNER_CODE_HASH:hash,APP_URL:B,TRUST_PROXY:'1'})});
srv.stdout.on('data',d=>process.stdout.write('[srv] '+d));srv.stderr.on('data',d=>process.stdout.write('[srv-err] '+d));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let N=0;class Cl{constructor(ip){this.ck='';this.ip=ip}
  async r(m,p,b,h){const res=await fetch(B+p,{method:m,headers:Object.assign({'Content-Type':'application/json','X-Requested-With':'forma',Cookie:this.ck,'X-Forwarded-For':this.ip||('10.1.'+(Math.floor(++N/250))+'.'+(N%250+1))},h||{}),body:b?JSON.stringify(b):undefined,redirect:'manual'});
    const sc=res.headers.get('set-cookie');if(sc)this.ck=sc.split(';')[0];
    let j=null;try{j=await res.json()}catch(e){}return {s:res.status,j,h:res.headers}}}
const ok=(c,m)=>console.log((c?'PASS':'FAIL')+' - '+m);
async function bot(c){const ch=(await c.r('GET','/api/challenge')).j;const [a,b]=ch.q.match(/\d+/g).map(Number);return {ch:ch.token,ans:a+b}}
(async()=>{
  await sleep(1200);
  const c=new Cl();
  // security headers + static
  let r=await fetch(B+'/index.html');const h=r.headers;
  ok(r.status===200&&/default-src 'self'/.test(h.get('content-security-policy')||'')&&h.get('x-content-type-options')==='nosniff'&&h.get('x-frame-options')==='DENY'&&h.get('referrer-policy')==='no-referrer','static page served with CSP + security headers');
  ok((await fetch(B+'/server/server.js')).status===404&&(await fetch(B+'/server/.env')).status===404&&(await fetch(B+'/..%2fserver%2fserver.js')).status===404&&(await fetch(B+'/%2e%2e/etc/passwd')).status===404,'server files / traversal / dotfiles are not reachable');
  ok(/server:true/.test(await (await fetch(B+'/config.js')).text()),'config.js switches the app to server mode');
  // CSRF
  ok((await c.r('POST','/api/login',{},{'X-Requested-With':'x'})).s===403,'missing CSRF header is rejected');
  ok((await c.r('POST','/api/login',{},{Origin:'https://evil.example'})).s===403,'foreign Origin is rejected');
  // bot protection
  ok((await c.r('POST','/api/signup',{email:'a@b.co',name:'Ana',password:'abcdefg1'})).j.error==='bot_failed','signup without anti-bot answer is rejected');
  let bt=await bot(c);ok((await c.r('POST','/api/signup',Object.assign({email:'a@b.co',name:'Ana',password:'abcdefg1'},{ch:bt.ch,ans:bt.ans+1}))).j.error==='bot_failed','wrong anti-bot answer is rejected');
  // validation
  bt=await bot(c);ok((await c.r('POST','/api/signup',Object.assign({email:'not-an-email',name:'Ana',password:'abcdefg1'},bt))).j.error==='bad_input','invalid email rejected');
  bt=await bot(c);ok((await c.r('POST','/api/signup',Object.assign({email:'ana@gmail.com',name:'<script>',password:'abcdefg1'},bt))).j.error==='bad_input','dangerous name rejected');
  bt=await bot(c);ok((await c.r('POST','/api/signup',Object.assign({email:'ana@gmail.com',name:'Ana',password:'short1'},bt))).s===400,'short password rejected');
  bt=await bot(c);ok((await c.r('POST','/api/signup',Object.assign({email:'ana@gmail.com',name:'Ana',password:'onlyletters'},bt))).j.error==='weak_password','password without a digit rejected');
  // signup -> real email sent
  bt=await bot(c);r=await c.r('POST','/api/signup',Object.assign({email:'Ana@Gmail.com',name:'Ana',password:'parola123'},bt));
  await sleep(300);console.log('   signup ->',r.s,JSON.stringify(r.j),'mails:',mails.length);ok(r.s===200&&mails.length===1,'signup sends a verification email (SMTP conversation worked)');
  const raw=mails[0]||'';const b64=raw.split('\r\n\r\n').slice(1).join('').replace(/\s+/g,'');const text=Buffer.from(b64,'base64').toString();
  const code=(text.match(/(\d{6})/)||[])[1];ok(/^To: <ana@gmail.com>/m.test(raw)&&!!code,'mail goes to the (lower-cased) address and carries a 6-digit code');
  bt=await bot(c);ok((await c.r('POST','/api/signup',Object.assign({email:'ana@gmail.com',name:'Ana2',password:'parola123'},bt))).j.error==='email_taken','duplicate email rejected');
  // login before verify
  bt=await bot(c);ok((await c.r('POST','/api/login',Object.assign({email:'ana@gmail.com',password:'parola123'},bt))).j.error==='not_verified','correct password but unverified email -> blocked');
  // wrong code, then right code
  ok((await c.r('POST','/api/verify',{email:'ana@gmail.com',code:'000000'})).j.error==='bad_code','wrong verification code rejected');
  r=await c.r('POST','/api/verify',{email:'ana@gmail.com',code});
  ok(r.s===200&&r.j.me.name==='Ana'&&/HttpOnly/i.test(r.h.get('set-cookie'))&&/SameSite=Strict/i.test(r.h.get('set-cookie')),'right code verifies the email and sets an HttpOnly SameSite=Strict session cookie');
  ok(!('pass' in r.j.me)&&!('email_idx' in r.j.me),'API response contains no password / index fields');
  // lockout: 3 wrong -> 30 s
  const c2=new Cl();let last;
  for(let i=1;i<=3;i++){bt=await bot(c2);last=await c2.r('POST','/api/login',Object.assign({email:'ana@gmail.com',password:'wrongpass'+i},bt));console.log('   wrong #'+i,'->',last.s,last.j.error,last.j.retryAfter||'')}
  ok(last.s===423&&last.j.retryAfter>=25,'3 wrong passwords -> 30 s lock');
  bt=await bot(c2);ok((await c2.r('POST','/api/login',Object.assign({email:'ana@gmail.com',password:'parola123'},bt))).s===423,'even the right password is refused during the pause');
  // unknown email behaves the same (no enumeration)
  bt=await bot(c2);ok((await c2.r('POST','/api/login',Object.assign({email:'ghost@gmail.com',password:'whatever12'},bt))).j.error==='bad_credentials','unknown email gives the same generic error');
  // data: tampering is ignored, score computed by the server
  const days={};for(let d=0;d<7;d++)days[d]={m:[],e:[]};days[1].e.push({id:'bench',n:'Bench',s:3,r:5,w:100,role:'owner',score:999});
  const mp={n:'x',days,sv:JSON.stringify({t:1,n:'x',days}),role:'owner'};
  r=await c.r('PUT','/api/me/data',{pr:{},lf:{bw:80,age:25,sex:'m'},mp,score:99999,role:'owner'});
  ok(r.s===200&&r.j.score>3&&r.j.score<5,'server computed the score itself ('+r.j.score+'), ignoring the client "score":99999');
  r=await c.r('GET','/api/me');ok(r.j.me.role==='user'&&!JSON.stringify(r.j.me.data).includes('999')&&!JSON.stringify(r.j.me.data).includes('"role"'),'unknown / tampered fields (role, score) were dropped');
  ok((await c.r('PUT','/api/me/profile',{name:'Ana',bio:'<img src=x onerror=1>',soc:{ig:'ana'},theme:'hax',avatar:'data:image/png;base64,AAAA'})).s===400,'fake image (bad magic bytes) is refused');
  r=await c.r('PUT','/api/me/profile',{name:'Ana',bio:'hello',soc:{ig:'ana.fit',evil:'x'},theme:'hax',avatar:'',pub:true});ok(r.s===200,'valid profile saved');
  r=await c.r('GET','/api/me');ok(r.j.me.theme==='crimson'&&!('evil' in r.j.me.soc),'unknown theme / social keys are normalised');
  // auth required + leaderboard trimmed
  ok((await new Cl().r('GET','/api/me')).s===401&&(await new Cl().r('GET','/api/leaderboard')).s===401,'no session -> 401');
  r=await c.r('GET','/api/leaderboard');const p=r.j.players[0];
  ok(r.s===200&&p.name==='Ana'&&p.online===true&&!('email' in p)&&!('role' in p)&&Object.keys(p).sort().join()==='avatar,bio,id,name,online,score,scores,seen,soc','leaderboard: trimmed fields, shows online status');
  // owner panel
  const o=new Cl();bt=await bot(o);ok((await o.r('POST','/api/owner',Object.assign({code:'nope'},bt))).s===401,'wrong Panel code rejected');
  bt=await bot(o);r=await o.r('POST','/api/owner',Object.assign({code:'zee4625cool'},bt));ok(r.s===200&&r.j.me.role==='owner','Panel code ZEE4625COOL (any case) opens the Owner account');
  ok((await c.r('GET','/api/admin/users')).s===403,'normal user cannot reach admin API');
  r=await o.r('GET','/api/admin/users');ok(r.s===200&&r.j.users.length===2,'owner sees the accounts');
  const ana=r.j.users.find(u=>u.name==='Ana');ok((await o.r('POST','/api/admin/role',{id:ana.id,role:'admin'})).s===200,'owner can grant admin');
  // owner Panel lockout
  const o2=new Cl('9.9.9.9');for(let i=0;i<3;i++){bt=await bot(o2);last=await o2.r('POST','/api/owner',Object.assign({code:'bad'+i},bt))}ok(last.s===423,'Panel code also locks for 30 s after 3 wrong tries');
  // logout kills the session on the server
  await c.r('POST','/api/logout');ok((await c.r('GET','/api/me')).s===401,'logout invalidates the session server-side');
  // email stored encrypted
  const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(path.join(TMP,'forma.db'));const row=d.prepare('SELECT email_enc,pass,data FROM users WHERE name=?').get('Ana');
  ok(!row.email_enc.includes('gmail')&&row.pass.startsWith('scrypt$')&&!row.data.includes('Bench'),'email + training data are encrypted at rest, password is a scrypt hash');
  srv.kill();smtp.close();setTimeout(()=>process.exit(0),200);
})().catch(e=>{console.log('TEST ERROR',e);srv.kill();process.exit(1)});
