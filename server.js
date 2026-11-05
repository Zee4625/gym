'use strict';
/* FORMA server: zero dependencies (Node >= 22.13). Serves the site AND the API on the same origin.
   See ../SECURITY.md for how each security item is implemented. */
const http=require('node:http'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),tls=require('node:tls'),net=require('node:net');
const {DatabaseSync}=require('node:sqlite');
const rank=require('./rank.js');

/* ---- config: secrets come from the environment / .env (never from the browser, never committed) ---- */
(function loadEnv(){
  const f=path.join(__dirname,'.env');if(!fs.existsSync(f))return;
  for(const ln of fs.readFileSync(f,'utf8').split(/\r?\n/)){
    const m=/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(ln);
    if(m&&!(m[1] in process.env))process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');
  }
})();
const E=process.env,PROD=E.NODE_ENV==='production',PORT=+E.PORT||3000;
const APP_URL=(E.APP_URL||`http://localhost:${PORT}`).replace(/\/+$/,''),APP_ORIGIN=new URL(APP_URL).origin;
let DATA_KEY=Buffer.from(E.DATA_KEY||'','base64'),SECRET=Buffer.from(E.SESSION_SECRET||'','base64');
if(DATA_KEY.length!==32||SECRET.length<32){
  if(PROD){console.error('DATA_KEY (32 bytes) and SESSION_SECRET (32+ bytes) must be set, base64. Run: npm run keys');process.exit(1)}
  console.warn('[DEV] ephemeral keys in use: accounts will not survive a restart');
  DATA_KEY=crypto.randomBytes(32);SECRET=crypto.randomBytes(32);
}
const SITE=path.resolve(__dirname,'..');
const THEMES=['crimson','midnight','emerald','violet','solar','rose','light'],MUS=['chest','back','legs','sh','bi','tri','fa','abs','calf'];

/* ---- database: parameterized statements only ---- */
const DB_PATH=E.DB_PATH||path.join(__dirname,'data','forma.db');
fs.mkdirSync(path.dirname(DB_PATH),{recursive:true});
const db=new DatabaseSync(DB_PATH);
db.exec(`PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,email_idx TEXT UNIQUE NOT NULL,email_enc TEXT NOT NULL,name TEXT NOT NULL,pass TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,role TEXT NOT NULL DEFAULT 'user',bio TEXT NOT NULL DEFAULT '',soc TEXT NOT NULL DEFAULT '{}',theme TEXT NOT NULL DEFAULT 'crimson',
  avatar TEXT NOT NULL DEFAULT '',pub INTEGER NOT NULL DEFAULT 1,data TEXT NOT NULL,score REAL NOT NULL DEFAULT 0,scores TEXT NOT NULL DEFAULT '{}',seen INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS codes(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,code TEXT NOT NULL,exp INTEGER NOT NULL,tries INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(tok TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,exp INTEGER NOT NULL);`);
try{db.exec("ALTER TABLE users ADD COLUMN avt TEXT NOT NULL DEFAULT ''")}catch(e){}   /* small avatar for the leaderboard (added later, so it is a migration) */
try{fs.chmodSync(DB_PATH,0o600)}catch(e){}
const q={
  byIdx:db.prepare('SELECT * FROM users WHERE email_idx=?'),byId:db.prepare('SELECT * FROM users WHERE id=?'),all:db.prepare('SELECT * FROM users'),
  ins:db.prepare('INSERT INTO users(email_idx,email_enc,name,pass,verified,role,data,created) VALUES(?,?,?,?,?,?,?,?)'),
  setCode:db.prepare('INSERT OR REPLACE INTO codes(user_id,code,exp,tries) VALUES(?,?,?,0)'),getCode:db.prepare('SELECT * FROM codes WHERE user_id=?'),
  tryCode:db.prepare('UPDATE codes SET tries=tries+1 WHERE user_id=?'),delCode:db.prepare('DELETE FROM codes WHERE user_id=?'),
  verify:db.prepare('UPDATE users SET verified=1 WHERE id=?'),seen:db.prepare('UPDATE users SET seen=? WHERE id=?'),
  insSess:db.prepare('INSERT INTO sessions(tok,user_id,exp) VALUES(?,?,?)'),sess:db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.tok=? AND s.exp>?'),
  delSess:db.prepare('DELETE FROM sessions WHERE tok=?'),pruneS:db.prepare('DELETE FROM sessions WHERE exp<?'),pruneC:db.prepare('DELETE FROM codes WHERE exp<?'),
  prof:db.prepare('UPDATE users SET name=?,bio=?,soc=?,theme=?,avatar=?,avt=?,pub=? WHERE id=?'),data:db.prepare('UPDATE users SET data=?,score=?,scores=? WHERE id=?'),
  role:db.prepare('UPDATE users SET role=? WHERE id=?'),del:db.prepare('DELETE FROM users WHERE id=?'),
  board:db.prepare("SELECT * FROM users WHERE verified=1 AND pub=1 ORDER BY score DESC LIMIT 200")
};

/* ---- crypto helpers ---- */
const hmac=(k,s)=>crypto.createHmac('sha256',SECRET).update(k+':'+s).digest('hex');
const enc=s=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',DATA_KEY,iv),ct=Buffer.concat([c.update(String(s),'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),ct]).toString('base64')};
const dec=b=>{const r=Buffer.from(b,'base64'),d=crypto.createDecipheriv('aes-256-gcm',DATA_KEY,r.subarray(0,12));d.setAuthTag(r.subarray(12,28));return Buffer.concat([d.update(r.subarray(28)),d.final()]).toString('utf8')};
const scryptP=(pw,salt)=>new Promise((res,rej)=>crypto.scrypt(pw.normalize('NFKC'),salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024},(e,k)=>e?rej(e):res(k)));
async function hashPw(pw){const salt=crypto.randomBytes(16);return 'scrypt$'+salt.toString('base64')+'$'+(await scryptP(pw,salt)).toString('base64')}
async function checkPw(pw,h){
  const p=String(h).split('$');if(p[0]!=='scrypt'||p.length!==3)return false;
  const k=await scryptP(pw,Buffer.from(p[1],'base64')),e=Buffer.from(p[2],'base64');
  return k.length===e.length&&crypto.timingSafeEqual(k,e);
}
let DUMMY='';hashPw('dummy-password-1').then(h=>{DUMMY=h});
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const pid=u=>hmac('pid',u.id).slice(0,16);

/* ---- input validation: everything that comes from the client is checked and rebuilt field by field ---- */
const EMAIL_RE=/^[^\s@<>()\[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const NAME_RE=/^[\p{L}\p{N} ._-]{2,24}$/u;
const str=(v,max,min=0)=>typeof v==='string'&&v.length<=max&&v.length>=min&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)?v:null;
const num=(v,lo,hi)=>{v=+v;return Number.isFinite(v)&&v>=lo&&v<=hi?v:0};
function cleanEx(e){
  if(!e||typeof e!=='object')return null;const n=str(e.n,80);if(n==null)return null;
  const o={n};if(e.n2!=null){const n2=str(e.n2,80);if(n2!=null)o.n2=n2}
  if(typeof e.id==='string'&&/^[a-z0-9]{1,24}$/.test(e.id))o.id=e.id;
  o.s=num(e.s,0,50);o.r=num(e.r,0,500);o.w=num(e.w,0,1000);
  if(e.u==='s')o.u='s';if(e.raw===true)o.raw=true;if(e.d===true)o.d=true;
  return o;
}
function cleanDays(days){
  const out={};
  for(const d of [0,1,2,3,4,5,6]){
    const x=days&&typeof days==='object'?days[d]:null,o={m:[],e:[]};
    if(x&&Array.isArray(x.m))o.m=[...new Set(x.m.filter(k=>MUS.includes(k)))];
    if(x&&Array.isArray(x.e))o.e=x.e.slice(0,80).map(cleanEx).filter(Boolean);
    if(x&&str(x.f,40)!=null&&x.f)o.f=x.f;if(x&&str(x.i,8)!=null&&x.i)o.i=x.i;
    out[d]=o;
  }
  return out;
}
function cleanMp(mp){
  mp=mp&&typeof mp==='object'?mp:{};
  const o={n:str(mp.n,40)||'',days:cleanDays(mp.days),sv:null,log:{}};
  if(typeof mp.sv==='string'&&mp.sv.length<300000){try{const v=JSON.parse(mp.sv);o.sv=JSON.stringify({t:num(v.t,0,4e12),n:str(v.n,40)||'',days:cleanDays(v.days)})}catch(e){}}
  if(mp.log&&typeof mp.log==='object'){
    let c=0;
    for(const k of Object.keys(mp.log)){
      if(c++>80)break;if(!/^[\w .-]{1,60}$/.test(k)||k==='__proto__'||!Array.isArray(mp.log[k]))continue;
      o.log[k]=mp.log[k].slice(-200).map(z=>({t:num(z&&z.t,0,4e12),w:num(z&&z.w,0,1000),r:num(z&&z.r,0,500)})).filter(z=>z.w>0&&z.r>0);
    }
  }
  return o;
}
const cleanLf=l=>{l=l&&typeof l==='object'?l:{};return {bw:num(l.bw,30,300)||80,age:num(l.age,10,100)||25,sex:l.sex==='f'?'f':'m'}};
const cleanPr=p=>{p=p&&typeof p==='object'?p:{};return {p:cleanDays(p.p),g:cleanDays(p.g)}};
function cleanProfile(b){
  if(!b||typeof b!=='object')return null;
  const name=str(b.name,24,2);if(name==null||!NAME_RE.test(name))return null;
  const bio=str(b.bio||'',140);if(bio==null)return null;
  const soc={};
  if(b.soc&&typeof b.soc==='object')for(const k of ['ig','tt','yt','x','fb','dc','web']){const v=str(b.soc[k]||'',80);if(v==null)return null;if(v)soc[k]=v}
  const theme=THEMES.includes(b.theme)?b.theme:'crimson',av=b.avatar||'';
  if(av){
    if(typeof av!=='string'||av.length>60000||!/^data:image\/(jpeg|png);base64,[A-Za-z0-9+\/=]+$/.test(av))return null;
    const buf=Buffer.from(av.split(',')[1],'base64');   /* magic bytes must match a real JPEG/PNG */
    if(!((buf[0]===0xff&&buf[1]===0xd8&&buf[2]===0xff)||buf.subarray(0,4).equals(Buffer.from([0x89,0x50,0x4e,0x47]))))return null;
  }
  let avt=b.avt||'';
  if(avt){
    if(typeof avt!=='string'||avt.length>9000||!/^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(avt))return null;
    const t=Buffer.from(avt.split(',')[1],'base64');if(!(t[0]===0xff&&t[1]===0xd8&&t[2]===0xff))return null;
  }
  return {name,bio,soc,theme,avatar:av,avt,pub:b.pub===false?0:1};
}
function scoreOf(mp,lf){
  const o=rank.rankData(mp,lf),ks=Object.keys(o.RS),s={};
  ks.forEach(k=>{s[k]=Math.round(o.RS[k].s*1000)/1000});
  return {score:ks.length?Math.round(ks.reduce((a,k)=>a+o.RS[k].s,0)/ks.length*1000)/1000:0,scores:s};
}

/* ---- rate limiting, login lockout (3 wrong -> 30 s pause), anti-bot ---- */
const hits=new Map(),locks=new Map(),usedCh=new Map();
function rl(key,max,win){const now=Date.now(),a=(hits.get(key)||[]).filter(t=>now-t<win);if(a.length>=max){hits.set(key,a);return false}a.push(now);hits.set(key,a);return true}
const lockLeft=k=>{const L=locks.get(k);return L&&L.until>Date.now()?Math.ceil((L.until-Date.now())/1000):0};
function lockFail(k){const L=locks.get(k)||{f:0,until:0};L.f++;if(L.f>=3){L.until=Date.now()+30000;L.f=0}locks.set(k,L)}
function makeChallenge(){
  const a=2+crypto.randomInt(8),b=2+crypto.randomInt(8),n=crypto.randomBytes(6).toString('hex');
  const p=Buffer.from(JSON.stringify({a,b,exp:Date.now()+300000,n})).toString('base64url');
  return {token:p+'.'+hmac('ch',p),q:`${a} + ${b} = ?`};
}
function verifyChallenge(token,ans){
  if(typeof token!=='string'||token.length>220)return false;
  const [p,sig]=token.split('.');if(!p||!sig)return false;
  const good=hmac('ch',p);if(sig.length!==good.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(good)))return false;
  let o;try{o=JSON.parse(Buffer.from(p,'base64url').toString())}catch(e){return false}
  if(Date.now()>o.exp||usedCh.has(o.n))return false;
  usedCh.set(o.n,o.exp);return +ans===o.a+o.b;
}
async function botOk(b,ip){
  if(E.TURNSTILE_SECRET){   /* Cloudflare Turnstile ("I am not a robot"), verified server-side */
    if(typeof b.ts!=='string'||b.ts.length>2048)return false;
    try{const r=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret:E.TURNSTILE_SECRET,response:b.ts,remoteip:ip})});return (await r.json()).success===true}catch(e){return false}
  }
  return verifyChallenge(b.ch,b.ans);
}
setInterval(()=>{const n=Date.now();for(const [k,a] of hits)if(!a.length||n-a[a.length-1]>36e5)hits.delete(k);for(const [k,e] of usedCh)if(e<n)usedCh.delete(k);for(const [k,L] of locks)if(L.until<n&&!L.f)locks.delete(k);q.pruneS.run(n);q.pruneC.run(n)},60000).unref();

/* ---- email (real verification code through SMTP, e.g. Gmail with an app password) ---- */
function smtp(to,subject,text){
  return new Promise((resolve,reject)=>{
    if(!EMAIL_RE.test(to)||/[\r\n]/.test(to))return reject(new Error('bad recipient'));
    const host=E.SMTP_HOST,port=+E.SMTP_PORT||465,from=E.SMTP_FROM||E.SMTP_USER;
    if(!from||/[\r\n<>]/.test(from))return reject(new Error('bad sender'));
    const sock=E.SMTP_SECURE==='false'?net.connect({host,port}):tls.connect({host,port,servername:host});
    sock.setTimeout(15000,()=>{sock.destroy();reject(new Error('smtp timeout'))});
    sock.on('error',reject);
    const body=Buffer.from(text,'utf8').toString('base64').replace(/(.{76})/g,'$1\r\n');
    const msg=[`From: FORMA <${from}>`,`To: <${to}>`,`Subject: ${subject}`,`Date: ${new Date().toUTCString()}`,'MIME-Version: 1.0','Content-Type: text/plain; charset=utf-8','Content-Transfer-Encoding: base64','',body,'.',''].join('\r\n');
    const cmds=[null,'EHLO forma.local'],exps=['220','250'];
    if(E.SMTP_USER)cmds.push('AUTH LOGIN',Buffer.from(E.SMTP_USER).toString('base64'),Buffer.from(E.SMTP_PASS||'').toString('base64')),exps.push('334','334','235');
    cmds.push(`MAIL FROM:<${from}>`,`RCPT TO:<${to}>`,'DATA',msg,'QUIT');exps.push('250','25','354','250','221');
    let buf='',i=0;
    sock.on('data',d=>{
      buf+=d.toString('utf8');
      for(;;){
        const m=/(?:^|\r\n)(\d{3}) [^\r\n]*\r\n/.exec(buf);if(!m)break;
        buf=buf.slice(m.index+m[0].length);
        if(!m[1].startsWith(exps[i])){sock.destroy();return reject(new Error('smtp '+m[1]))}
        if(++i>=cmds.length){sock.end();return resolve()}
        sock.write(cmds[i]===msg?msg:cmds[i]+'\r\n');   /* the message already ends with CRLF.CRLF */
      }
    });
  });
}
async function sendCode(to,code){
  const text=`Codul tau de verificare FORMA: ${code}\n(expira in 15 minute; daca nu ai cerut acest cod, ignora mesajul)\n\nYour FORMA verification code: ${code}\n(valid for 15 minutes; ignore this message if you did not request it)\n`;
  if(!E.SMTP_HOST){if(PROD)throw new Error('smtp not configured');console.log(`[DEV] verification code for ${to}: ${code}`);return}
  await smtp(to,'FORMA - verification code',text);
}
async function issueCode(u,email){
  const code=String(crypto.randomInt(100000,1000000));
  q.setCode.run(u.id,hmac('code',u.id+':'+code),Date.now()+15*60000);
  await sendCode(email,code);
}

/* ---- http layer ---- */
const CSP="default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' https://fonts.googleapis.com; style-src-attr 'unsafe-inline'; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";
const secHeaders=()=>Object.assign({'Content-Security-Policy':CSP,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=()','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Resource-Policy':'same-origin'},PROD?{'Strict-Transport-Security':'max-age=63072000; includeSubDomains; preload'}:{});
const COOKIE=PROD?'__Host-sid':'sid';
const send=(res,st,obj,h)=>{res.writeHead(st,Object.assign({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},secHeaders(),h||{}));res.end(JSON.stringify(obj))};
const fail=(res,st,code,extra)=>send(res,st,Object.assign({error:code},extra||{}));
function readBody(req,max){
  return new Promise((res,rej)=>{
    if(!/^application\/json/i.test(req.headers['content-type']||''))return rej(Object.assign(new Error('type'),{status:415}));
    let n=0;const c=[];
    req.on('data',d=>{n+=d.length;if(n>max){rej(Object.assign(new Error('large'),{status:413}));req.destroy();return}c.push(d)});
    req.on('end',()=>{try{res(c.length?JSON.parse(Buffer.concat(c).toString('utf8')):{})}catch(e){rej(Object.assign(new Error('json'),{status:400}))}});
    req.on('error',rej);
  });
}
const getTok=req=>{const m=(req.headers.cookie||'').split(/;\s*/).find(c=>c.startsWith(COOKIE+'='));return m?m.slice(COOKIE.length+1):''};
function startSession(res,u){
  const tok=crypto.randomBytes(32).toString('base64url');
  q.insSess.run(sha(tok),u.id,Date.now()+30*864e5);
  res.setHeader('Set-Cookie',`${COOKIE}=${tok}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30*86400}${PROD?'; Secure':''}`);
}
function authed(req){
  const tok=getTok(req);if(!tok||tok.length>80)return null;
  const u=q.sess.get(sha(tok),Date.now());if(u)q.seen.run(Date.now(),u.id);
  return u||null;
}
function meOf(u){
  let data={};try{data=JSON.parse(dec(u.data))}catch(e){}
  return {id:pid(u),name:u.name,role:u.role,email:dec(u.email_enc),bio:u.bio,soc:JSON.parse(u.soc||'{}'),theme:u.theme,avatar:u.avatar,avt:u.avt||'',pub:!!u.pub,data};
}
const EMPTY=()=>enc(JSON.stringify({pr:cleanPr({}),lf:cleanLf({}),mp:cleanMp({})}));
const ipOf=req=>E.TRUST_PROXY==='1'?((req.headers['x-forwarded-for']||'').split(',')[0].trim()||req.socket.remoteAddress):req.socket.remoteAddress;

async function api(req,res,url){
  const m=req.method,p=url.pathname,ip=ipOf(req);
  if(m!=='GET'){   /* CSRF: custom header + same-origin check (cookie is also SameSite=Strict) */
    const o=req.headers.origin;
    if(req.headers['x-requested-with']!=='forma'||(o&&o!==APP_ORIGIN))return fail(res,403,'forbidden');
  }
  if(!rl('all:'+ip,240,60000))return fail(res,429,'rate_limited');
  if(m==='GET'&&p==='/api/challenge'){if(!rl('ch:'+ip,30,60000))return fail(res,429,'rate_limited');return send(res,200,makeChallenge())}
  if(m==='POST'&&p==='/api/signup'){
    if(!rl('su:'+ip,5,36e5))return fail(res,429,'rate_limited');
    const b=await readBody(req,4096);
    if(!(await botOk(b,ip)))return fail(res,400,'bot_failed');
    const email=str(b.email,254),name=str(b.name,24,2),pw=str(b.password,128,8);
    if(!email||!EMAIL_RE.test(email)||!name||!NAME_RE.test(name)||!pw)return fail(res,400,'bad_input');
    if(!/[A-Za-z]/.test(pw)||!/\d/.test(pw))return fail(res,400,'weak_password');
    const idx=hmac('email',email.toLowerCase());
    if(q.byIdx.get(idx))return fail(res,409,'email_taken');
    const r=q.ins.run(idx,enc(email.toLowerCase()),name,await hashPw(pw),0,'user',EMPTY(),Date.now());
    const u=q.byId.get(Number(r.lastInsertRowid));
    try{await issueCode(u,email.toLowerCase())}catch(e){q.del.run(u.id);console.error('mail failed:',e.message);return fail(res,502,'server_error')}
    return send(res,200,{ok:true});
  }
  if(m==='POST'&&p==='/api/resend'){
    const b=await readBody(req,2048),email=str(b.email,254);
    if(!email||!EMAIL_RE.test(email))return fail(res,400,'bad_input');
    const idx=hmac('email',email.toLowerCase());
    if(rl('rs:'+idx,1,60000)&&rl('rs:'+ip,10,36e5)){const u=q.byIdx.get(idx);if(u&&!u.verified)try{await issueCode(u,email.toLowerCase())}catch(e){console.error('mail failed:',e.message)}}
    return send(res,200,{ok:true});   /* same answer for every address: no account enumeration */
  }
  if(m==='POST'&&p==='/api/verify'){
    if(!rl('vf:'+ip,15,600000))return fail(res,429,'rate_limited');
    const b=await readBody(req,2048),email=str(b.email,254),code=str(b.code,6,6);
    if(!email||!code||!/^\d{6}$/.test(code))return fail(res,400,'bad_code');
    const u=q.byIdx.get(hmac('email',email.toLowerCase())),c=u&&q.getCode.get(u.id);
    if(!u||!c||c.exp<Date.now()||c.tries>=5){if(u&&c&&c.tries>=5)q.delCode.run(u.id);return fail(res,400,'bad_code')}
    q.tryCode.run(u.id);
    const good=hmac('code',u.id+':'+code);
    if(good.length!==c.code.length||!crypto.timingSafeEqual(Buffer.from(good),Buffer.from(c.code)))return fail(res,400,'bad_code');
    q.delCode.run(u.id);q.verify.run(u.id);startSession(res,u);
    return send(res,200,{me:meOf(q.byId.get(u.id))});
  }
  if(m==='POST'&&p==='/api/login'){
    if(!rl('li:'+ip,30,600000))return fail(res,429,'rate_limited');
    const b=await readBody(req,4096);
    if(!(await botOk(b,ip)))return fail(res,400,'bot_failed');
    const email=str(b.email,254),pw=str(b.password,128);
    if(!email||!pw||!EMAIL_RE.test(email))return fail(res,400,'bad_input');
    const idx=hmac('email',email.toLowerCase()),left=lockLeft(idx);
    if(left)return fail(res,423,'locked',{retryAfter:left});
    const u=q.byIdx.get(idx),ok=await checkPw(pw,u?u.pass:DUMMY)&&!!u;
    if(!ok){lockFail(idx);const l2=lockLeft(idx);return l2?fail(res,423,'locked',{retryAfter:l2}):fail(res,401,'bad_credentials')}
    locks.delete(idx);
    if(!u.verified)return fail(res,403,'not_verified');
    startSession(res,u);return send(res,200,{me:meOf(u)});
  }
  if(m==='POST'&&p==='/api/owner'){   /* "Panel": owner code, checked against a hash kept in the server environment */
    if(!rl('ow:'+ip,10,600000))return fail(res,429,'rate_limited');
    const b=await readBody(req,2048);
    if(!(await botOk(b,ip)))return fail(res,400,'bot_failed');
    const key='owner:'+ip,left=lockLeft(key);if(left)return fail(res,423,'locked',{retryAfter:left});
    const code=str(b.code,64,1);
    if(!code||!E.OWNER_CODE_HASH||!(await checkPw(code.trim().toUpperCase(),E.OWNER_CODE_HASH))){lockFail(key);const l2=lockLeft(key);return l2?fail(res,423,'locked',{retryAfter:l2}):fail(res,401,'bad_credentials')}
    locks.delete(key);
    const idx=hmac('email','owner@forma.local');let u=q.byIdx.get(idx);
    if(!u){q.ins.run(idx,enc('owner@forma.local'),'Zee',await hashPw(crypto.randomBytes(24).toString('base64')),1,'owner',EMPTY(),Date.now());u=q.byIdx.get(idx)}
    startSession(res,u);return send(res,200,{me:meOf(u)});
  }
  if(m==='GET'&&p==='/api/config')return send(res,200,{turnstile:E.TURNSTILE_SITEKEY||''});
  /* everything below needs a valid server-side session */
  const u=authed(req);
  if(!u)return fail(res,401,'unauthorized');
  if(m==='POST'&&p==='/api/logout'){const t=getTok(req);if(t)q.delSess.run(sha(t));res.setHeader('Set-Cookie',`${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${PROD?'; Secure':''}`);return send(res,200,{ok:true})}
  if(m==='GET'&&p==='/api/me')return send(res,200,{me:meOf(u)});
  if(m==='POST'&&p==='/api/ping')return send(res,200,{ok:true});
  if(m==='PUT'&&p==='/api/me/profile'){
    const c=cleanProfile(await readBody(req,120000));if(!c)return fail(res,400,'bad_input');
    q.prof.run(c.name,c.bio,JSON.stringify(c.soc),c.theme,c.avatar,c.avt,c.pub,u.id);return send(res,200,{ok:true});
  }
  if(m==='PUT'&&p==='/api/me/data'){   /* the client never sends a score: the server recomputes it from the saved program */
    const b=await readBody(req,600000),pr=cleanPr(b.pr),lf=cleanLf(b.lf),mp=cleanMp(b.mp),sc=scoreOf(mp,lf);
    q.data.run(enc(JSON.stringify({pr,lf,mp})),sc.score,JSON.stringify(sc.scores),u.id);
    return send(res,200,{ok:true,score:sc.score});
  }
  if(m==='DELETE'&&p==='/api/me'){q.del.run(u.id);res.setHeader('Set-Cookie',`${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${PROD?'; Secure':''}`);return send(res,200,{ok:true})}
  if(m==='GET'&&p==='/api/leaderboard'){
    if(!rl('lb:'+ip,60,60000))return fail(res,429,'rate_limited');
    const now=Date.now();
    return send(res,200,{players:q.board.all().map(x=>({id:pid(x),name:x.name,avatar:x.avt||'',bio:x.bio,soc:JSON.parse(x.soc||'{}'),score:x.score,scores:JSON.parse(x.scores||'{}'),online:now-x.seen<120000,seen:Math.round((now-x.seen)/1000)}))});
  }
  if(p.startsWith('/api/admin/')){
    if(u.role!=='owner')return fail(res,403,'forbidden');
    const find=id=>q.all.all().find(x=>pid(x)===id);
    if(m==='GET'&&p==='/api/admin/users')return send(res,200,{users:q.all.all().map(x=>({id:pid(x),name:x.name,role:x.role,verified:!!x.verified,created:x.created,seen:x.seen}))});
    if(m==='POST'&&p==='/api/admin/role'){const b=await readBody(req,1024),t=find(String(b.id||''));if(!t||t.role==='owner'||!['user','admin'].includes(b.role))return fail(res,400,'bad_input');q.role.run(b.role,t.id);return send(res,200,{ok:true})}
    if(m==='DELETE'&&p.startsWith('/api/admin/user/')){const t=find(decodeURIComponent(p.slice(16)));if(!t||t.role==='owner')return fail(res,400,'bad_input');q.del.run(t.id);return send(res,200,{ok:true})}
  }
  return fail(res,404,'not_found');
}

/* static files: only an allow-list of file types from the site folder (never server/, scripts/, data/, dotfiles) */
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.jpeg':'image/jpeg','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};
function serve(req,res,url){
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,Object.assign({Allow:'GET, HEAD'},secHeaders()));return res.end()}
  let p;try{p=decodeURIComponent(url.pathname)}catch(e){res.writeHead(400,secHeaders());return res.end()}
  if(p==='/config.js'){res.writeHead(200,Object.assign({'Content-Type':MIME['.js'],'Cache-Control':'no-store'},secHeaders()));return res.end(`window.FORMA_CFG={server:true,turnstile:${JSON.stringify(E.TURNSTILE_SITEKEY||'')}};`)}
  if(p==='/')p='/index.html';
  const f=path.resolve(SITE,'.'+p),rel=path.relative(SITE,f),ext=path.extname(f).toLowerCase();
  if(p.includes('\0')||rel.startsWith('..')||path.isAbsolute(rel)||rel.includes(path.sep)||rel.startsWith('.')||!MIME[ext]||!fs.existsSync(f)||!fs.statSync(f).isFile()){res.writeHead(404,Object.assign({'Content-Type':'text/plain'},secHeaders()));return res.end('Not found')}
  res.writeHead(200,Object.assign({'Content-Type':MIME[ext],'Cache-Control':'no-cache'},secHeaders()));
  req.method==='HEAD'?res.end():fs.createReadStream(f).pipe(res);
}
const server=http.createServer(async(req,res)=>{
  try{
    if(PROD&&req.headers['x-forwarded-proto']!=='https'){   /* force HTTPS (the proxy sets x-forwarded-proto) */
      res.writeHead(308,{Location:'https://'+new URL(APP_URL).host+req.url});return res.end();
    }
    const url=new URL(req.url,APP_ORIGIN);
    if(url.pathname.startsWith('/api/'))return await api(req,res,url);
    serve(req,res,url);
  }catch(e){
    if(e&&e.status&&!res.headersSent)return fail(res,e.status,e.status===413?'bad_input':e.status===415?'bad_input':'bad_input');
    console.error('error:',e&&e.message);
    if(!res.headersSent)fail(res,500,'server_error');
  }
});
server.requestTimeout=20000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
server.listen(PORT,()=>console.log(`FORMA listening on ${APP_URL} (${PROD?'production':'development'})`));
