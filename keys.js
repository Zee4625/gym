'use strict';
/* Prints fresh secrets. Paste them into server/.env (never commit that file). */
const c=require('node:crypto');
console.log('DATA_KEY='+c.randomBytes(32).toString('base64'));
console.log('SESSION_SECRET='+c.randomBytes(48).toString('base64'));
