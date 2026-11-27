#!/usr/bin/env node
/* Sauvegarde chiffrée à froid : outil opérateur, pas d'API web, aucune activation automatique. */
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),os=require('os');
const {spawn}=require('child_process');const {pipeline}=require('stream/promises');
const DIR=__dirname, LOCK=path.join(DIR,'moteur.lock'), HELPER=path.join(DIR,'sauvegarde-archive.py');
const MAGIC=Buffer.from('PBK1'), HEADER_SIZE=16, TAG_SIZE=16;
function options(argv){const out={};for(let i=0;i<argv.length;i++){if(!argv[i].startsWith('--')||!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Options attendues : --cle, --sortie ou --destination, avec chemins absolus.');if(out[argv[i]])throw Error('Option répétée : '+argv[i]);out[argv[i]]=argv[++i];}return out;}
function absolu(v,nom){if(!v||!path.isAbsolute(v))throw Error(nom+' : chemin absolu requis.');return path.resolve(v);}
function readKey(f){const st=fs.lstatSync(f);if(!st.isFile() || st.isSymbolicLink() || (st.mode&0o077)!==0)throw Error('Clé : fichier ordinaire privé requis (chmod 600).');const b=fs.readFileSync(f);if(b.length!==32)throw Error('Clé invalide : 32 octets requis.');return b;}
function newKey(f){const fd=fs.openSync(f,'wx',0o600);try{fs.writeFileSync(fd,crypto.randomBytes(32));fs.fsyncSync(fd);}finally{fs.closeSync(fd)}console.log('Clé privée créée. Conserve une copie séparée et sécurisée : sa perte rendra la sauvegarde illisible.');}
function source(env,def){return path.resolve(process.env[env]||path.join(DIR,def));}
function isWithin(candidate,root){const r=path.relative(root,candidate);return r===''||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));}
function sources(){
 const tenant=source('PUBLIO_LOCATAIRES_DIR','locataires');
 const list=[
  {nom:'base/publio.json',chemin:source('PUBLIO_DB','publio.json'),requis:'fichier'},
  {nom:'base/locataires.json',chemin:source('PUBLIO_LOCATAIRES','locataires.json'),requis:'fichier'},
  {nom:'locataires',chemin:tenant,requis:'dossier'},
  {nom:'secrets/secret',chemin:source('PUBLIO_SECRET_FILE','.secret'),requis:'fichier'},
  {nom:'base/journal.jsonl',chemin:source('PUBLIO_JOURNAL','journal.jsonl')},
  {nom:'base/circuit.json',chemin:source('PUBLIO_CIRCUIT','circuit.json')},
  {nom:'secrets/apps.json',chemin:source('PUBLIO_APPS','.apps.json')},
  {nom:'secrets/cles.json',chemin:source('PUBLIO_CLES','.cles.json')},
  {nom:'secrets/admin-pass',chemin:source('PUBLIO_ADMIN_PASS_FILE','.admin-pass')},
 ];
 const auto=path.resolve(process.env.PUBLIO_AUTOMATISATIONS_DIR||path.join(tenant,'.automatisations'));
 if(!isWithin(auto,tenant))list.push({nom:'automatisations',chemin:auto});
 return list.filter(x=>{
   let st;try{st=fs.lstatSync(x.chemin)}catch(e){if(e.code==='ENOENT'&&!x.requis)return false;throw Error('Source requise introuvable : '+x.nom);}
   if(st.isSymbolicLink()||!(st.isFile()||st.isDirectory()))throw Error('Source non ordinaire refusée : '+x.nom);
   if(x.requis==='fichier'&&!st.isFile())throw Error('Fichier requis : '+x.nom);
   if(x.requis==='dossier'&&!st.isDirectory())throw Error('Dossier requis : '+x.nom);
   return true;
 });
}
function prendreVerrou(){
 let fd;try{fd=fs.openSync(LOCK,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw Error('Verrou existant : arrête le moteur et vérifie moteur.lock avant toute sauvegarde. Ne supprime pas un verrou actif.');throw e;}
 try{fs.writeFileSync(fd,JSON.stringify({pid:process.pid,hote:os.hostname(),usage:'sauvegarde-hors-ligne',depuis:new Date().toISOString()}));fs.fsyncSync(fd)}catch(e){fs.closeSync(fd);try{fs.unlinkSync(LOCK)}catch(_){}throw e}
 return ()=>{try{fs.closeSync(fd)}catch(_){}try{const j=JSON.parse(fs.readFileSync(LOCK,'utf8'));if(j.pid===process.pid&&j.usage==='sauvegarde-hors-ligne')fs.unlinkSync(LOCK)}catch(_){}};
}
function lancer(args,extra={}){
 const child=spawn('python3',[HELPER,...args],{stdio:['ignore','pipe','pipe'],env:{...process.env,...extra}});let stderr='';child.stderr.on('data',b=>{if(stderr.length<8000)stderr+=String(b).slice(0,8000-stderr.length)});
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error(stderr.trim()||'Échec du traitement de l’archive.')))});return {child,done};
}
async function creer(keyFile,outFile){
 const key=readKey(keyFile), liberer=prendreVerrou();let tmp,fd;
 try{
  const spec=sources();const outReel=path.join(fs.realpathSync(path.dirname(outFile)),path.basename(outFile));for(const x of spec){const st=fs.lstatSync(x.chemin);if(st.isDirectory()&&isWithin(outReel,fs.realpathSync(x.chemin)))throw Error('La sauvegarde ne peut pas être placée dans une source.');if(outReel===fs.realpathSync(x.chemin))throw Error('Destination identique à une source.');}
  if(fs.existsSync(outFile))throw Error('La sauvegarde de destination existe déjà.');
  tmp=path.join(path.dirname(outFile),'.publio-backup-'+crypto.randomBytes(12).toString('hex')+'.part');fd=fs.openSync(tmp,'wx',0o600);
  const header=Buffer.concat([MAGIC,crypto.randomBytes(12)]);fs.writeSync(fd,header);const cipher=crypto.createCipheriv('aes-256-gcm',key,header.subarray(4));cipher.setAAD(header);
  const proc=lancer(['creer'],{PUBLIO_ARCHIVE_SOURCES:JSON.stringify(spec)});const output=fs.createWriteStream(tmp,{fd,autoClose:false});
  await Promise.all([pipeline(proc.child.stdout,cipher,output),proc.done]);fs.writeSync(fd,cipher.getAuthTag());fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  fs.linkSync(tmp,outFile);fs.unlinkSync(tmp);tmp=undefined;
  console.log('Sauvegarde chiffrée créée : '+outFile+'\nConserve-la hors machine avec une copie séparée de la clé et teste sa restauration.');
 }finally{key.fill(0);if(fd!==undefined)try{fs.closeSync(fd)}catch(_){}if(tmp)try{fs.unlinkSync(tmp)}catch(_){}liberer()}
}
async function restaurer(keyFile,archive,dest){
 const key=readKey(keyFile);let stage;
 try{
  const ast=fs.lstatSync(archive);if(!ast.isFile()||ast.isSymbolicLink()||ast.size<=HEADER_SIZE+TAG_SIZE)throw Error('Sauvegarde invalide.');if(fs.existsSync(dest))throw Error('La destination existe déjà. Choisis un nouveau dossier vide.');
  stage=fs.mkdtempSync(path.join(path.dirname(dest),'.publio-restore-'));fs.chmodSync(stage,0o700);const tarfile=path.join(stage,'archive.tar.gz'), extrait=path.join(stage,'extrait');fs.mkdirSync(extrait,{mode:0o700});
  const fd=fs.openSync(archive,'r');const header=Buffer.alloc(HEADER_SIZE),tag=Buffer.alloc(TAG_SIZE);try{fs.readSync(fd,header,0,HEADER_SIZE,0);fs.readSync(fd,tag,0,TAG_SIZE,ast.size-TAG_SIZE)}finally{fs.closeSync(fd)}
  if(!header.subarray(0,4).equals(MAGIC))throw Error('Format de sauvegarde inconnu.');const decipher=crypto.createDecipheriv('aes-256-gcm',key,header.subarray(4));decipher.setAAD(header);decipher.setAuthTag(tag);
  try{await pipeline(fs.createReadStream(archive,{start:HEADER_SIZE,end:ast.size-TAG_SIZE-1}),decipher,fs.createWriteStream(tarfile,{flags:'wx',mode:0o600}));}catch(e){throw Error('Authentification impossible : clé incorrecte ou sauvegarde altérée.');}
  const proc=lancer(['restaurer',tarfile,extrait]);proc.child.stdout.resume();await proc.done;
  if(fs.existsSync(dest))throw Error('La destination existe déjà.');fs.renameSync(extrait,dest);
  console.log('Restauration isolée effectuée : '+dest+'\nElle ne remplace aucune donnée active. Vérifie les fichiers et la procédure avant toute remise en service.');
 }finally{key.fill(0);if(stage)try{fs.rmSync(stage,{recursive:true,force:true})}catch(_){}}
}
async function main(){
 const mode=process.argv[2],o=options(process.argv.slice(3));
 const cle=absolu(o['--cle'],'--cle');
 if(mode==='cle'&&Object.keys(o).length===1)return newKey(cle);
 if(mode==='creer'&&Object.keys(o).length===2)return creer(cle,absolu(o['--sortie'],'--sortie'));
 if(mode==='restaurer'&&Object.keys(o).length===3)return restaurer(cle,absolu(o['--archive'],'--archive'),absolu(o['--destination'],'--destination'));
 throw Error('Usage : cle --cle /chemin ; creer --cle /chemin --sortie /fichier ; restaurer --cle /chemin --archive /fichier --destination /nouveau-dossier');
}
main().catch(e=>{console.error('Erreur : '+e.message);process.exitCode=1});
