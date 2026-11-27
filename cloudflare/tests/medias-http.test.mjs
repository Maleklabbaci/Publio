// Test uniquement local avec bucket R2 simulé et données fictives.
import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
const base='http://127.0.0.1:4495';
async function req(path,method='GET',body=null,cookie='',headers={}){return fetch(base+path,{method,headers:{...(method!=='GET'?{Origin:base}:{}),...(cookie?{Cookie:cookie}:{}),...headers},body,redirect:'manual'});}
async function compte(){const r=await req('/api/inscription','POST',JSON.stringify({nom:'Essai Utilisateur',email:randomUUID()+'@example.test',mot_de_passe:'Exemple12345'}),'',{'Content-Type':'application/json'});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
const a=await compte(),b=await compte();
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aRkAAAAASUVORK5CYII=','base64');
let r=await req('/api/medias','POST',image,a,{'Content-Type':'image/png','X-Filename':'photo.png'});assert.equal(r.status,201);const m=(await r.json()).media;
r=await req('/api/medias/'+m.id,'GET',null,b);assert.equal(r.status,404);
r=await req('/api/medias/'+m.id,'GET',null,a);assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),image);
r=await req('/api/medias','GET',null,a);let infos=await r.json();assert.equal(infos.stockage.utilise,image.length);assert.equal(infos.medias[0].id,m.id);
const d={reseaux:[],medias:[m.id],legende:'',date:'2027-02-03',heure:'14:20'};
r=await req('/api/brouillons-composeur','POST',JSON.stringify(d),a,{'Content-Type':'application/json'});assert.equal(r.status,200);const draft=(await r.json()).brouillon;
r=await req('/api/medias/'+m.id,'DELETE',null,a);assert.equal(r.status,409);
r=await req('/api/brouillons-composeur/'+draft.id,'DELETE',null,a);assert.equal(r.status,200);
r=await req('/api/medias/'+m.id,'DELETE',null,a);assert.equal(r.status,200);
r=await req('/api/medias/'+m.id,'GET',null,a);assert.equal(r.status,404);
r=await req('/api/medias','POST',Buffer.from('faux'),a,{'Content-Type':'image/png'});assert.equal(r.status,415);
r=await req('/api/medias','GET',null,a);assert.equal((await r.json()).stockage.utilise,0);
console.log('OK test local : import privé, isolation, brouillon lié, suppression et refus de format invalide.');
