'use strict';
/* node tools/hash-code.js "THE-OWNER-CODE"  ->  prints OWNER_CODE_HASH=... (scrypt) for server/.env */
const c=require('node:crypto');
const code=(process.argv[2]||'').trim().toUpperCase();
if(!code){console.error('usage: node tools/hash-code.js "OWNER-CODE"');process.exit(1)}
const salt=c.randomBytes(16);
const k=c.scryptSync(code.normalize('NFKC'),salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
console.log('OWNER_CODE_HASH='+'scrypt$'+salt.toString('base64')+'$'+k.toString('base64'));
