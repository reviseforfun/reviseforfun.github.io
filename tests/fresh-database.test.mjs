import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'dist/worker/index.js',compatibilityDate:'2026-09-24',compatibilityFlags:['nodejs_compat'],d1Databases:['DB']}));
after(async()=>{await mf.dispose();});
test('missing tables are created on the first request',async()=>{
 const origin='https://example.com';
 const db=await mf.getD1Database('DB');
 // Simulate a half set-up database: some tables exist, rate_limits does not.
 await db.prepare('CREATE TABLE messages (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, text TEXT NOT NULL, created INTEGER NOT NULL)').run();
 const r=await mf.dispatchFetch(origin+'/api/auth/register',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'fresh',password:'correct horse battery staple'})});
 assert.equal(r.status,200,await r.clone().text());
 assert.equal((await mf.dispatchFetch(origin+'/api/sets')).status,200);
 assert.deepEqual(await (await mf.dispatchFetch(origin+'/api/chat')).json(),[]);
});
test('server schema matches the migration file',async()=>{
 const { readFile }=await import('node:fs/promises');
 const { default: schema }=await import('../server/schema.js');
 assert.equal(schema.trim(),(await readFile('migrations/0001_initial.sql','utf8')).trim());
});
test('password hashing stays within the Workers PBKDF2 limit',async()=>{
 const { readFile }=await import('node:fs/promises');
 const source=await readFile('server/index.js','utf8');
 const n=Number(source.match(/PBKDF2_ITERATIONS = (\d+)/)[1]);
 assert.ok(n<=100000,'Cloudflare rejects more than 100,000 iterations in production');
 assert.equal(source.match(/derive\(/g).length,source.match(/PBKDF2_ITERATIONS, 32/g).length,'every derive() call uses the constant');
});
