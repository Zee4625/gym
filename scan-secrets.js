'use strict';
/* Secret scanner. Usage:
     node scripts/scan-secrets.js            scan tracked/working files
     node scripts/scan-secrets.js --history  also scan the whole git history (git log -p --all)
   Exit code 1 when something suspicious is found. Findings are printed redacted. */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const RULES=[
  ['private key block',/-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['AWS access key',/\bAKIA[0-9A-Z]{16}\b/],
  ['Google API key',/\bAIza[0-9A-Za-z_\-]{35}\b/],
  ['Slack token',/\bxox[baprs]-[0-9A-Za-z-]{10,}\b/],
  ['GitHub token',/\bgh[pousr]_[0-9A-Za-z]{30,}\b/],
  ['Stripe live key',/\b[sr]k_live_[0-9A-Za-z]{16,}\b/],
  ['Supabase service role / JWT',/\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\b/],
  ['password / secret / key assignment',/\b(?:pass(?:word)?|passwd|secret|api[_-]?key|token)\b\s*[:=]\s*["'](?!https?:)[^"'\s()+]{12,}["']/i],
  ['.env style secret',/^\s*(?:SMTP_PASS|SESSION_SECRET|DATA_KEY|TURNSTILE_SECRET|OWNER_CODE_HASH)\s*=\s*[A-Za-z0-9+\/=_$-]{16,}\s*$/],
];
const SKIP=/(^|\/)(node_modules|\.git|data)\//,BIN=/\.(png|jpe?g|gif|ico|zip|db|woff2?)$/i,EXAMPLE=/\.env\.example$/;
let found=0;
const report=(where,rule,line)=>{found++;console.log(`! ${where}: ${rule}  ->  ${line.trim().slice(0,12)}…[redacted]`)};
function scanText(where,text){
  text.split(/\r?\n/).forEach((ln,i)=>{
    for(const [n,re] of RULES){
      if(n==='Google API key'&&/(^|\/)config\.js$/.test(where))continue;   /* the Firebase web apiKey in config.js is public by design */
      if(re.test(ln))report(`${where}:${i+1}`,n,ln);
    }
  });
}
function walk(d,out=[]){for(const f of fs.readdirSync(d)){const p=path.join(d,f),r=path.relative(ROOT,p).replace(/\\/g,'/');if(SKIP.test(r+'/'))continue;fs.statSync(p).isDirectory()?walk(p,out):out.push(r)}return out}
let files;
try{files=cp.execFileSync('git',['ls-files'],{cwd:ROOT,stdio:['ignore','pipe','ignore']}).toString().split('\n').filter(Boolean)}catch(e){files=walk(ROOT)}
for(const f of files){
  if(SKIP.test(f)||BIN.test(f)||EXAMPLE.test(f)||!fs.existsSync(path.join(ROOT,f)))continue;
  if(/(^|\/)\.env(\.|$)/.test(f)&&!EXAMPLE.test(f)){report(f,'.env file is tracked by git','.env');continue}
  scanText(f,fs.readFileSync(path.join(ROOT,f),'utf8'));
}
if(process.argv.includes('--history')){
  try{
    const log=cp.execFileSync('git',['log','-p','--all','--no-color'],{cwd:ROOT,maxBuffer:512*1024*1024}).toString();
    let commit='';log.split('\n').forEach(ln=>{const m=/^commit ([0-9a-f]{7,40})/.exec(ln);if(m)commit=m[1].slice(0,8);if(ln.startsWith('+')&&!ln.startsWith('+++'))for(const [n,re] of RULES)if(re.test(ln))report('history@'+commit,n,ln.slice(1))});
  }catch(e){console.log('(no git history to scan)')}
}
if(found){
  console.log(`\n${found} possible secret(s). If any is real:\n 1. ROTATE it now (create a new key/password, revoke the old one): removing it from Git is not enough.\n 2. Purge it from history:  git filter-repo --replace-text <(echo 'THE-SECRET==>REMOVED')   (or the BFG Repo-Cleaner)\n 3. Force-push, ask collaborators to re-clone, and add the file to .gitignore.`);
  process.exit(1);
}
console.log('OK: no secrets found'+(process.argv.includes('--history')?' (working tree + history)':' (working tree)'));
