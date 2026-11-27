'use strict';
/* Test HTTP autonome : copie du serveur, comptes et fichiers exclusivement temporaires. */
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert'),net=require('net'),{spawn}=require('child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'publio-stockage-test-')),code=path.join(root,'serveur'),data=path.join(root,'data');
fs.mkdirSync(code,{recursive:true});fs.mkdirSync(data,{recursive:true});
for(const n of fs.readdirSync(path.join(__dirname,'..'))) if(n.endsWith('.js')&&!n.startsWith('test')) fs.copyFileSync(path.join(__dirname,'..',n),path.join(code,n));
fs.cpSync(path.join(__dirname,'..','automatisations'),path.join(code,'automatisations'),{recursive:true});
const env={...process.env,PUBLIO_DB:path.join(data,'db.json'),PUBLIO_JOURNAL:path.join(data,'journal.jsonl'),PUBLIO_CIRCUIT:path.join(data,'circuit.json'),PUBLIO_LOCATAIRES:path.join(data,'locataires.json'),PUBLIO_LOCATAIRES_DIR:path.join(data,'comptes'),PUBLIO_BACKUPS:path.join(data,'backups'),PUBLIO_SECRET_FILE:path.join(data,'.secret'),PUBLIO_ADMIN_PASS_FILE:path.join(data,'absent-admin'),PUBLIO_CLES:path.join(data,'absent-cles')};
for(const k of Object.keys(env)) if(k.startsWith('PUBLIO_ADMIN_MOT_DE_PASSE') || k==='PUBLIO_MOT_DE_PASSE') delete env[k];
Object.assign(process.env,env);const loc=require(path.join(code,'locataires.js'));
for(const [nom,email,slug] of [['Alpha Test','alpha@example.test','alpha-test'],['Beta Test','beta@example.test','beta-test']]){let r=loc.creer({nom,email,slug,plan:'agence',motDePasse:'Test12345'});assert(r.locataire);assert(loc.maj(slug,{statut:'actif'}).locataire);}

let enfant;
async function portLibre(){return await new Promise((resolve,reject)=>{const srv=net.createServer().listen(0,'127.0.0.1',()=>{const p=srv.address().port;srv.close(()=>resolve(p));});srv.on('error',reject);});}
async function lancer(port){enfant=spawn(process.execPath,['moteur.js'],{cwd:code,env:{...env,PORT:String(port)},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{let s='';const t=setTimeout(()=>reject(new Error('Démarrage trop long : '+s)),10000);for(const stream of [enfant.stdout,enfant.stderr]) stream.on('data',b=>{s+=b;if(s.includes('adresse    http://localhost:')){clearTimeout(t);resolve();}});enfant.once('exit',()=>{clearTimeout(t);reject(new Error('Arrêt prématuré : '+s))});});}
async function arreter(){if(!enfant || enfant.exitCode!==null)return;await new Promise(resolve=>{enfant.once('exit',resolve);enfant.kill('SIGTERM')});enfant=null;}
(async()=>{
 const port=await portLibre(), base='http://127.0.0.1:'+port, f=path.join(data,'comptes','alpha-test','publio.json');
 const original=fs.readFileSync(f,'utf8');
 async function request(method,url,body,cookie){const headers={};if(cookie)headers.Cookie=cookie;if(body){headers['Content-Type']='application/json';body=JSON.stringify(body)}return fetch(base+url,{method,headers,body,redirect:'manual'});}
 async function login(email){const r=await request('POST','/api/connexion-client',{email,mot_de_passe:'Test12345'});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
 for(const cas of ['{corrompu','[]',null]){
   if(cas===null) fs.unlinkSync(f); else fs.writeFileSync(f,cas);
   await lancer(port);
   const alpha=await login('alpha@example.test'), beta=await login('beta@example.test');
   let r=await request('GET','/api/medias',null,alpha);assert.equal(r.status,500);let d=await r.json();assert(d.erreur.includes('Aucune modification'));
   r=await request('POST','/api/brouillons-composeur',{reseaux:[],medias:[],legende:'essai',date:'2027-02-03',heure:'12:00'},alpha);assert.equal(r.status,500);
   assert.equal((await request('GET','/api/medias',null,beta)).status,200);
   if(cas===null)assert(!fs.existsSync(f));else assert.equal(fs.readFileSync(f,'utf8'),cas);
   await arreter(); fs.writeFileSync(f,original);
 }
 await lancer(port);const alpha=await login('alpha@example.test');assert.equal((await request('GET','/api/medias',null,alpha)).status,200);
 console.log('OK protection des données : fichier corrompu, invalide ou manquant jamais écrasé ; autre compte et restauration fonctionnels.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await arreter();fs.rmSync(root,{recursive:true,force:true})});
