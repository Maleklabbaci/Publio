// Lancer uniquement avec le Worker local de test Wrangler sur 127.0.0.1:4495.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const base='http://127.0.0.1:4495', email='test-'+randomUUID()+'@example.test', password='EssaiPassword123';
async function post(path,data,cookie,origin=base){return fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','Origin':origin,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)});}
let r=await fetch(base+'/api/moi');assert.equal(r.status,401);
r=await post('/api/inscription',{nom:'Client Test',email,mot_de_passe:password},null,'https://example.com');assert.equal(r.status,403);
r=await post('/api/inscription',{nom:'Client Test',email,mot_de_passe:password});assert.equal(r.status,200);let cookie=r.headers.get('set-cookie').split(';')[0];
assert.match(r.headers.get('set-cookie'),/HttpOnly/);assert.match(r.headers.get('set-cookie'),/SameSite=Strict/);
r=await fetch(base+'/api/moi',{headers:{Cookie:cookie}});assert.equal(r.status,200);assert.equal((await r.json()).profil.email,email);
r=await post('/api/inscription',{nom:'Client Test',email,mot_de_passe:password});assert.equal(r.status,409);
r=await post('/api/connexion-client',{email,mot_de_passe:'incorrect123'});assert.equal(r.status,401);
r=await post('/api/deconnexion-client',{},cookie);assert.equal(r.status,200);
r=await fetch(base+'/api/moi',{headers:{Cookie:cookie}});assert.equal(r.status,401);
r=await post('/api/connexion-client',{email,mot_de_passe:password});assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];
r=await fetch(base+'/api/moi',{headers:{Cookie:cookie}});assert.equal(r.status,200);
const worker=(await import('../auth-http-experimental.mjs')).default; r=await worker.fetch(new Request('https://distant.example/api/moi'),{LOCAL_TEST_ONLY:'1',PUBLIO_R2:{}});assert.equal(r.status,503);
console.log('OK test local : inscription, doublon, connexion, session, déconnexion, blocage inter-origine et refus hôte distant.');
