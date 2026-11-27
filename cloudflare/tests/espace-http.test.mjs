// Essai HTTP strictement local avec R2 émulé. Ne constitue pas une validation production.
import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
const base='http://127.0.0.1:4495';
async function req(path,method='GET',data=null,cookie=''){
 const headers={};if(method!=='GET')headers.Origin=base;if(cookie)headers.Cookie=cookie;
 if(data){headers['Content-Type']='application/json';data=JSON.stringify(data)}
 return fetch(base+path,{method,headers,body:data,redirect:'manual'});
}
async function compte(){const email=`essai-${randomUUID()}@example.test`,mot_de_passe='Exemple12345';const r=await req('/api/inscription','POST',{nom:'Test Utilisateur',email,mot_de_passe});assert.equal(r.status,200);return {email,mot_de_passe,cookie:r.headers.get('set-cookie').split(';')[0]};}
let r=await req('/app');assert.equal(r.status,302);assert.equal(new URL(r.headers.get('location')).pathname,'/connexion-client');
r=await req('/app.html');assert.equal(r.status,404);
const a=await compte(),b=await compte();
r=await req('/app','GET',null,a.cookie);assert.equal(r.status,200);assert.match(await r.text(),/window.PUBLIO_SESSION_CLIENT=true/);
const d={reseaux:[],medias:[],legende:'Essai sans réseau',date:'2027-02-03',heure:'14:20'};
r=await req('/api/brouillons-composeur','POST',d,a.cookie);assert.equal(r.status,200);const {brouillon}=await r.json();assert.match(brouillon.id,/^b[a-f0-9]{32}$/);
r=await req('/api/brouillons-composeur','GET',null,a.cookie);assert.equal((await r.json()).brouillons[0].legende,d.legende);
r=await req('/api/brouillons-composeur','GET',null,b.cookie);assert.equal((await r.json()).brouillons.length,0);
r=await req('/api/brouillons-composeur/'+brouillon.id,'DELETE',null,b.cookie);assert.equal(r.status,404);
r=await req('/api/brouillons-composeur','POST',{...d,id:brouillon.id,legende:'Modifié'},a.cookie);assert.equal(r.status,200);
r=await req('/api/brouillons-composeur','POST',{...d,reseaux:['ig']},a.cookie);assert.equal(r.status,400);
r=await req('/api/brouillons-composeur','POST',{...d,date:'2027-02-31'},a.cookie);assert.equal(r.status,400);
r=await req('/api/brouillons-composeur/'+brouillon.id,'DELETE',null,a.cookie);assert.equal(r.status,200);
r=await req('/api/brouillons-composeur','GET',null,a.cookie);assert.equal((await r.json()).brouillons.length,0);
console.log('OK test local : accès protégé, données isolées, création/modification/suppression de brouillons texte.');
