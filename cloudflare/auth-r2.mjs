/* Socle d'authentification R2 expérimental. Aucun endpoint public.
 * Ne pas déployer avant protections anti-abus, vérification mail, reprise et audit.
 */
const enc = new TextEncoder();
const iterations = 600000;
const dureeSessionMs = 24 * 60 * 60 * 1000;
const hex = b => Array.from(new Uint8Array(b), x=>x.toString(16).padStart(2,'0')).join('');
const randomHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const normaliserEmail = e => typeof e === 'string' ? e.trim().toLowerCase() : '';
function verifierDonnees(nom,email,mdp){
  if(typeof nom!=='string'||nom.trim().length<2||nom.length>120) throw Error('Nom invalide');
  if(email.length>254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw Error('Email invalide');
  if(typeof mdp!=='string'||mdp.length<8||mdp.length>256||!/[A-Za-zÀ-ÿ]/.test(mdp)||!/[0-9]/.test(mdp)) throw Error('Mot de passe invalide');
}
async function hashMdp(mdp, salt){
  const cle=await crypto.subtle.importKey('raw',enc.encode(mdp),'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations,hash:'SHA-256'},cle,256));
}
function egal(a,b){
  if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;
  let difference=0;for(let i=0;i<a.length;i++)difference |= a.charCodeAt(i)^b.charCodeAt(i);
  return difference===0;
}
const cleCompte = async email => 'auth/comptes/'+await sha256(email)+'.json';
const cleSession = async jeton => 'auth/sessions/'+await sha256(jeton)+'.json';
async function objetJson(bucket,cle){
  const obj=await bucket.get(cle);
  if(!obj)return null;
  if(obj.size>16384) throw Error('Données de compte invalides');
  let x;try{x=await obj.json()}catch{throw Error('Données de compte invalides')}
  if(!x||typeof x!=='object'||Array.isArray(x))throw Error('Données de compte invalides');
  return x;
}
async function creerSiAbsent(bucket,cle,objet){
  const headers=new Headers({'If-None-Match':'*'});
  return !!(await bucket.put(cle,JSON.stringify(objet),{onlyIf:headers,httpMetadata:{contentType:'application/json'}}));
}
export async function creerCompte(bucket, {nom,email,motDePasse}){
  email=normaliserEmail(email); verifierDonnees(nom,email,motDePasse);
  const salt=randomHex(16), compte={version:1,id:'u-'+randomHex(16),nom:nom.trim(),email,salt,iterations,hash:await hashMdp(motDePasse,salt),cree:new Date().toISOString()};
  const cree=await creerSiAbsent(bucket,await cleCompte(email),compte);
  return cree ? {ok:true,id:compte.id} : {ok:false,existe:true};
}
export async function verifierConnexion(bucket,email,motDePasse){
  email=normaliserEmail(email);
  if(email.length>254 || typeof motDePasse!=='string'||motDePasse.length>256)return null;
  const compte=await objetJson(bucket,await cleCompte(email));
  // Ne jamais transformer un objet corrompu en compte valide.
  const valide=compte&&compte.version===1&&/^u-[a-f0-9]{32}$/.test(compte.id)&&compte.email===email&&typeof compte.nom==='string'&&/^[a-f0-9]{32}$/.test(compte.salt)&&/^[a-f0-9]{64}$/.test(compte.hash)&&compte.iterations===iterations;
  const candidat=await hashMdp(motDePasse,valide?compte.salt:'00000000000000000000000000000000');
  if(!valide||!egal(candidat,compte.hash))return null;
  return {id:compte.id,nom:compte.nom,email:compte.email};
}
export async function creerSession(bucket, compte){
  if(!compte||!/^u-[a-f0-9]{32}$/.test(compte.id)||typeof compte.email!=='string')throw Error('Compte invalide');
  const jeton=randomHex(32), expires=Date.now()+dureeSessionMs;
  if(!await creerSiAbsent(bucket,await cleSession(jeton),{version:1,id:compte.id,email:compte.email,expires}))throw Error('Session non créée');
  return {jeton,expires};
}
export async function lireSession(bucket,jeton){
  if(typeof jeton!=='string'||!/^[a-f0-9]{64}$/.test(jeton))return null;
  const s=await objetJson(bucket,await cleSession(jeton));
  if(!s||s.version!==1||!/^u-[a-f0-9]{32}$/.test(s.id)||typeof s.email!=='string'||!Number.isSafeInteger(s.expires)||s.expires<=Date.now())return null;
  const compte=await objetJson(bucket,await cleCompte(s.email));
  if(!compte||compte.id!==s.id||compte.email!==s.email)return null;
  return {id:compte.id,nom:compte.nom,email:compte.email};
}
export async function supprimerSession(bucket,jeton){
  if(typeof jeton==='string'&&/^[a-f0-9]{64}$/.test(jeton))await bucket.delete(await cleSession(jeton));
}
