'use strict';
/* GENERATED from app.js by build_site.py: the same rank engine the browser uses. */
const ORDER=[1,2,3,4,5,6,0];
const nm=e=>String((e&&e.n)||'');
let lf={};
const BH=[.6,.85,1.1,1.4,1.75,2.1],PC=[0,10,30,65,88,97,99.5];
const RM={chest:1,legs:1.33,back:1.65,sh:.65,bi:.45,tri:.8,fa:.45,abs:.6,calf:1.2};
const RL={chest:["Împins la bancă","Bench press"],back:["Îndreptări","Deadlift"],legs:["Genuflexiuni cu bara","Back squat"],sh:["Împins deasupra capului","Overhead press"],bi:["Flexii cu bara","Barbell curl"],tri:["Împins cu priză îngustă","Close-grip bench"],fa:["Flexii de încheietură cu bara","Barbell wrist curl"],abs:["Crunch la scripete","Cable crunch"],calf:["Ridicări pe vârfuri în picioare","Standing calf raise"]};
const LIB=[
["dips","Dips cu greutate","Weighted dips","chest","bw",1.05,/dips/i],
["pullup","Tracțiuni cu greutate","Weighted pull-ups","back","bw",.65,/pull.?ups?|chin.?ups?/i],
["calf1","Ridicări pe vârfuri pe un picior","Single-leg calf raise","calf","bw",1,/1 leg.*(gambe|calf)|(gambe|calf).*1 leg/i],
["bulg","Split squat bulgar / fandări","Bulgarian split squat / lunges","legs","db",.25,/bulgarian|split squat|lunge|fand|jump/i],
["legpress","Presă pentru picioare","Leg press","legs","bb",2.2,/leg press|pres[aă] pentru/i],
["squat","Genuflexiuni cu bara","Back squat","legs","bb",1,/squat|genuflex/i],
["deadlift","Îndreptări","Deadlift","back","bb",1,/deadlift|[iî]ndrept/i],
["dbpress","Împins cu gantere (piept)","Dumbbell chest press","chest","db",.4,/chest press/i],
["cgbp","Împins cu priză îngustă","Close-grip bench press","tri","bb",1,/close.?grip|priz[aă] [iî]ngust/i],
["bench","Împins la bancă cu bara","Barbell bench press","chest","bb",1,/bench|banc/i],
["fly","Fluturări cu gantere","Dumbbell fly","chest","db",.25,/chest fly|\bfly\b|flut/i],
["ohp","Împins deasupra capului","Overhead press","sh","bb",1,/overhead|ohp|military/i],
["shpress","Împins cu gantere (umeri)","Dumbbell shoulder press","sh","db",.4,/shoulder press/i],
["lat","Ridicări laterale / high pull","Lateral raise / high pull","sh","db",.2,/lateral|high pull/i],
["kick","Kickback triceps","Triceps kickback","tri","db",.25,/kickback/i],
["skullez","Skull crusher cu bara EZ","EZ-bar skull crusher","tri","bb",.5,/skull.*ez|ez.*skull/i],
["skull","Skull crusher cu o ganteră","Single-dumbbell skull crusher","tri","bb",.45,/skull/i],
["tripush","Extensii triceps la scripete","Triceps pushdown","tri","bb",.6,/triceps|extensii/i],
["wrist","Flexii de încheietură","Wrist curl","fa","db",.5,/wrist|antebra/i],
["bbcurl","Flexii cu bara EZ / dreaptă","Barbell / EZ curl","bi","bb",1,/biceps cu|ez bar|barbell curl/i],
["dbcurl","Flexii cu gantere","Dumbbell curl","bi","db",.45,/curl/i],
["shrug","Ridicări de umeri (trapez)","Dumbbell shrug","back","db",.35,/trapez|shrug/i],
["row","Ramat / tracțiuni la piept","Barbell row / lat pulldown","back","bb",.6,/\brows?\b|ramat|pulldown/i],
["tibial","Ridicări tibiale","Tibialis raise","calf","db",.3,/tibial/i],
["calf","Ridicări pe vârfuri (gambe)","Calf raise","calf","bb",1,/gambe|calf/i],
["ccrunch","Crunch la scripete","Cable crunch","abs","bb",1,/cable crunch|crunch la scripete/i],
["twist","Russian twist / crunch","Russian twist / crunch","abs","db",.35,/twist|crunch|\babs\b|abdom/i]
];
const findEx=e=>e.id?LIB.find(x=>x[0]===e.id):LIB.find(x=>x[6].test((e.n||"")+" "+(e.n2||"")));
function profOf(l){
  const bw=l.bw>=30?l.bw:80,a=l.age>=14?l.age:25;
  return {bw,sc:(l.sex==="f"?.62:1)*(a<18?Math.max(.6,1-(18-a)*.03):a>39?Math.max(.55,1-(a-39)*.01):1)};
}
const prof=()=>profOf(lf);
const TH=k=>BH.map(x=>x*RM[k]);
function score(v,T){if(v<T[0])return v/T[0];let k=0;while(k<5&&v>=T[k+1])k++;return k>=5?6+Math.min(.999,(v-T[5])/(T[5]*.5)):k+1+(v-T[k])/(T[k+1]-T[k])}
function exScore(e,P){
  const c=findEx(e);if(!c)return null;
  if(e.raw||e.u||!(e.s>0&&e.r>0&&e.w>0))return {c,s:null};
  const load=c[4]==="bw"?P.bw+e.w:e.w,rm=e.r>1?load*(1+Math.min(e.r,12)/30):load;   /* Epley 1RM */
  return {c,rm,s:score(rm/P.bw/c[5],TH(c[3]).map(y=>y*P.sc))};
}
function rankData(m0,l0){
  const out={RS:{},RX:[]};
  if(!m0||!m0.sv)return out;
  const P=profOf(Object.assign({bw:80,age:25,sex:"m"},l0||{})),acc={};
  let SV;try{SV=JSON.parse(m0.sv)}catch(x){return out}
  ORDER.forEach(d=>{((SV.days[d]||{}).e||[]).forEach(e=>{
    const r=exScore(e,P);if(!r||r.s==null)return;
    const k=r.c[3],a=acc[k]||(acc[k]={sum:0,sets:0,n:0,best:0});
    a.sum+=r.s*e.s;a.sets+=e.s;a.n++;if(r.s>a.best)a.best=r.s;
    out.RX.push({n:nm(e),k,s:r.s,w:e.w,r:e.r});
  })});
  Object.keys(acc).forEach(k=>{const a=acc[k];out.RS[k]={s:.6*a.sum/a.sets+.4*a.best,n:a.n,sets:a.sets}});
  return out;
}

module.exports={rankData,LIB,profOf,score};
