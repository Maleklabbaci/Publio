/* Tests locaux uniquement. Ne pas déployer : protection anti-abus distribuée,
   vérification email, récupération, nettoyage des sessions et audit manquants. */
import {creerCompte,verifierConnexion,creerSession,lireSession,supprimerSession} from './auth-r2.mjs';
import {lireProjet,ecrireProjet} from './stockage-r2.mjs';
import {cleMedia,lireFichier,ecrireObjet} from './medias-r2-experimental.mjs';
import {autoriser} from './limiteur-r2-experimental.mjs';
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const err=(message,status)=>json({ok:false,erreur:message},status);
function jetonCookie(req){
 for(const p of (req.headers.get('Cookie')||'').split(';')){const [k,...v]=p.trim().split('=');if(k==='publio_client')return v.join('=')}return '';
}
function cookie(jeton,maxAge,secure){return `publio_client=${jeton}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure?'; Secure':''}`;}
async function corps(req){
 if(!(req.headers.get('content-type')||'').toLowerCase().startsWith('application/json'))throw Error('Contenu invalide');
 const max=16384, size=req.headers.get('content-length');if(size&&Number(size)>max)throw Error('Contenu trop volumineux');
 const reader=req.body?.getReader();if(!reader)throw Error('Contenu manquant');let parts=[],length=0;
 for(;;){const r=await reader.read();if(r.done)break;length+=r.value.byteLength;if(length>max){await reader.cancel();throw Error('Contenu trop volumineux')}parts.push(r.value)}
 let bytes=new Uint8Array(length),pos=0;for(const p of parts){bytes.set(p,pos);pos+=p.length}
 let d;try{d=JSON.parse(new TextDecoder().decode(bytes))}catch{throw Error('Contenu invalide')}
 if(!d||typeof d!=='object'||Array.isArray(d))throw Error('Contenu invalide');return d;
}
export default {async fetch(req,env){
 // Empêche l'activation accidentelle sur un Worker distant, même si la variable est présente.
 const u=new URL(req.url);
 if(env.LOCAL_TEST_ONLY!=='1'||!['localhost','127.0.0.1'].includes(u.hostname))return err('Authentification en préparation.',503);
 if(!env.PUBLIO_R2)return err('Stockage indisponible.',503);
 const write=['POST','PUT','DELETE','PATCH'].includes(req.method);
 if(write && req.headers.get('Origin')!==u.origin)return err('Requête refusée.',403);
 try {
  if(['/login-photo.jpg','/inscription-photo.jpg','/publio-favicon.svg'].includes(u.pathname)&&req.method==='GET')return env.ASSETS.fetch(req);
  if(u.pathname==='/connexion'&&req.method==='GET')return Response.redirect(new URL('/connexion-client',u),302);
  if(['/connexion-client','/inscription','/espace','/app'].includes(u.pathname)&&req.method==='GET'){
   const c=await lireSession(env.PUBLIO_R2,jetonCookie(req));
   const prive=['/espace','/app'].includes(u.pathname);
   if(prive&&!c)return Response.redirect(new URL('/connexion-client',u),302);
   if(!prive&&c)return Response.redirect(new URL('/espace',u),302);
   const fichier={'/connexion-client':'login.html','/inscription':'signup.html','/espace':'espace.html','/app':'app.html'}[u.pathname];
   const r=await env.ASSETS.fetch(new Request(new URL('/'+fichier,u)));
   if(!r.ok)return err('Interface locale introuvable.',503);
   let html=await r.text();
   if(u.pathname==='/app')html=html.replace('<body>','<body><script>window.PUBLIO_SESSION_CLIENT=true;</script>');
   html=html.replace('</body>','<div style="position:fixed;bottom:5px;right:5px;z-index:999999;background:#302147;color:#fff;padding:5px 9px;font:12px sans-serif;border-radius:6px">TEST LOCAL UNIQUEMENT</div></body>');
   return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
  if(['/api/inscription','/api/connexion-client'].includes(u.pathname)&&write){
   // Mode local seulement ; en production l'origine de l'IP doit être garantie par Cloudflare.
   const ip=req.headers.get('CF-Connecting-IP')||'test-local';
   const limite=u.pathname==='/api/inscription'?30:60;
   const verif=await autoriser(env.PUBLIO_R2,{scope:u.pathname==='/api/inscription'?'inscription':'connexion',sujet:ip,limite,fenetreMs:60000});
   if(!verif.ok)return json({ok:false,erreur:'Trop de tentatives. Réessaie plus tard.'},429,{'Retry-After':String(verif.retryAfter)});
  }
  if(u.pathname==='/api/inscription'&&write){
   let b;try{b=await corps(req)}catch(e){return err(e.message,400)}
   let c;try{c=await creerCompte(env.PUBLIO_R2,{nom:b.nom,email:b.email,motDePasse:b.mot_de_passe})}catch(e){if(/invalide/.test(e.message))return err('Vérifie les informations saisies.',400);throw e}
   if(!c.ok)return err('Un compte existe déjà avec cet email.',409);
   const compte=await verifierConnexion(env.PUBLIO_R2,b.email,b.mot_de_passe);
   if(!compte)return err('Compte créé, mais connexion impossible.',500);
   const s=await creerSession(env.PUBLIO_R2,compte);
   return json({ok:true},200,{'Set-Cookie':cookie(s.jeton,86400,u.protocol==='https:')});
  }
  if(u.pathname==='/api/connexion-client'&&write){
   let b;try{b=await corps(req)}catch(e){return err(e.message,400)}
   const compte=await verifierConnexion(env.PUBLIO_R2,b.email,b.mot_de_passe);
   if(!compte)return err('Email ou mot de passe incorrect.',401);
   const s=await creerSession(env.PUBLIO_R2,compte);
   return json({ok:true},200,{'Set-Cookie':cookie(s.jeton,86400,u.protocol==='https:')});
  }
  if(u.pathname==='/api/moi'&&req.method==='GET'){
   const c=await lireSession(env.PUBLIO_R2,jetonCookie(req));
   if(!c)return err('Connexion requise.',401);
   return json({ok:true,profil:{nom:c.nom,email:c.email,slug:c.id},projet:null,abonnement:{plan:'essai',statut:'essai'}});
  }
  if(u.pathname==='/api/etat'&&req.method==='GET'){
   const c=await lireSession(env.PUBLIO_R2,jetonCookie(req));if(!c)return err('Connexion requise.',401);
   return json({ok:true,canaux:[],regles:[],posts:[],stats:{},journal:[],etat:{},verrou:{automatisations:false},limite:{postsMois:0,max:10},serveur:{vivant:true}});
  }
  const mediaRoute=u.pathname.match(/^\/api\/medias\/([a-f0-9]{32})$/);
  if((u.pathname==='/api/medias'||mediaRoute)&&['GET','HEAD','POST','DELETE'].includes(req.method)){
   const c=await lireSession(env.PUBLIO_R2,jetonCookie(req));if(!c)return err('Connexion requise.',401);
   const lu=await lireProjet(env.PUBLIO_R2,c.id,'principal'),base=lu.existe?lu.donnees:{brouillons:[],medias:[]};
   if(base.medias===undefined)base.medias=[];if(base.brouillons===undefined)base.brouillons=[];
   if(!Array.isArray(base.medias)||!Array.isArray(base.brouillons))return err('Stockage indisponible.',500);
   if(mediaRoute&&['GET','HEAD'].includes(req.method)){
    const m=base.medias.find(x=>x.id===mediaRoute[1]);if(!m)return err('Média introuvable.',404);
    const obj=await env.PUBLIO_R2.get(cleMedia(c.id,m.id));if(!obj)return err('Média indisponible.',503);
    return new Response(req.method==='HEAD'?null:obj.body,{headers:{'Content-Type':m.mime,'Content-Length':String(m.taille),'Content-Disposition':'inline','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
   }
   if(u.pathname==='/api/medias'&&req.method==='GET')return json({ok:true,stockage:{utilise:base.medias.reduce((n,x)=>n+x.taille,0),limite:1073741824},medias:base.medias.map(m=>({...m,url:'/api/medias/'+m.id}))});
   if(u.pathname==='/api/medias'&&req.method==='POST'){
    if(req.headers.get('x-publio-canal'))return err('Aucun canal connecté.',400);
    const f=await lireFichier(req);if(!f.ok)return err(f.erreur,f.code);
    if(base.medias.reduce((n,x)=>n+x.taille,0)+f.media.taille>1073741824)return err('Quota atteint.',413);
    const id=Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
    if(!await ecrireObjet(env.PUBLIO_R2,c.id,id,f.octets,f.media.mime))return err('Conflit de fichier.',409);
    const media={...f.media,id};base.medias.unshift(media);
    const sauve=await ecrireProjet(env.PUBLIO_R2,c.id,'principal',base,lu.etag);
    if(!sauve.ok){await env.PUBLIO_R2.delete(cleMedia(c.id,id));return err('Conflit de modification. Recharge et réessaie.',409)}
    return json({ok:true,media:{...media,url:'/api/medias/'+id}},201);
   }
   if(mediaRoute&&req.method==='DELETE'){
    const i=base.medias.findIndex(x=>x.id===mediaRoute[1]);if(i<0)return err('Média introuvable.',404);
    if(base.brouillons.some(x=>Array.isArray(x.medias)&&x.medias.includes(mediaRoute[1])))return err('Ce média est utilisé dans un brouillon.',409);
    base.medias.splice(i,1);if(!Array.isArray(base.purgesEnAttente))base.purgesEnAttente=[];
    base.purgesEnAttente.push(mediaRoute[1]);
    const sauve=await ecrireProjet(env.PUBLIO_R2,c.id,'principal',base,lu.etag);if(!sauve.ok)return err('Conflit de modification. Recharge et réessaie.',409);
    try{await env.PUBLIO_R2.delete(cleMedia(c.id,mediaRoute[1]))}catch{return json({ok:true,purgeEnAttente:true})}
    // Une purge de marqueurs doit encore être conçue pour les interruptions.
    return json({ok:true,purgeEnAttente:false});
   }
   return err('Méthode non disponible.',405);
  }
  if((u.pathname==='/api/brouillons-composeur'||/^\/api\/brouillons-composeur\/b[a-f0-9]{32}$/.test(u.pathname))&&['GET','POST','DELETE'].includes(req.method)){
   const c=await lireSession(env.PUBLIO_R2,jetonCookie(req));if(!c)return err('Connexion requise.',401);
   const lu=await lireProjet(env.PUBLIO_R2,c.id,'principal');
   const base=lu.existe?lu.donnees:{brouillons:[]};
   if(!Array.isArray(base.brouillons))return err('Stockage indisponible.',500);
   if(req.method==='GET'&&u.pathname==='/api/brouillons-composeur')return json({ok:true,brouillons:base.brouillons});
   if(req.method==='POST'&&u.pathname==='/api/brouillons-composeur'){
    let b;try{b=await corps(req)}catch(e){return err(e.message,400)}
    if(!Array.isArray(b.reseaux)||b.reseaux.length||!Array.isArray(b.medias)||b.medias.length>10||typeof b.legende!=='string'||b.legende.length>2200||(!b.legende.trim()&&!b.medias.length)||b.medias.some(id=>typeof id!=='string'||!(base.medias||[]).some(m=>m.id===id)))return err('Vérifie le texte et les médias. Les canaux ne sont pas encore disponibles.',400);
    if(typeof b.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||!Number.isFinite(Date.parse(b.date+'T12:00:00Z'))||new Date(b.date+'T12:00:00Z').toISOString().slice(0,10)!==b.date||typeof b.heure!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.heure))return err('Date ou heure invalide.',400);
    if(b.id!==undefined && (typeof b.id!=='string'||!/^b[a-f0-9]{32}$/.test(b.id)))return err('Brouillon invalide.',400);
    const idx=b.id?base.brouillons.findIndex(x=>x.id===b.id):-1;
    if(b.id&&idx<0)return err('Brouillon introuvable.',404);
    if(idx<0&&base.brouillons.length>=100)return err('Limite de brouillons atteinte.',409);
    const id=b.id||'b'+Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
    const brouillon={id,reseaux:[],medias:[...b.medias],legende:b.legende,date:b.date,heure:b.heure,musiqueInstagram:null,cree:idx>=0?base.brouillons[idx].cree:new Date().toISOString(),modifie:new Date().toISOString()};
    if(idx>=0)base.brouillons[idx]=brouillon;else base.brouillons.unshift(brouillon);
    const sauve=await ecrireProjet(env.PUBLIO_R2,c.id,'principal',base,lu.etag);if(!sauve.ok)return err('Conflit de modification. Recharge et réessaie.',409);
    return json({ok:true,brouillon});
   }
   if(req.method==='DELETE'&&u.pathname!=='/api/brouillons-composeur'){
    const id=u.pathname.split('/').pop(),idx=base.brouillons.findIndex(x=>x.id===id);if(idx<0)return err('Brouillon introuvable.',404);
    base.brouillons.splice(idx,1);const sauve=await ecrireProjet(env.PUBLIO_R2,c.id,'principal',base,lu.etag);if(!sauve.ok)return err('Conflit de modification. Recharge et réessaie.',409);
    return json({ok:true});
   }
   return err('Méthode non disponible.',405);
  }
  if((u.pathname==='/api/deconnexion-client'||u.pathname==='/api/deconnexion')&&write){
   await supprimerSession(env.PUBLIO_R2,jetonCookie(req));
   return json({ok:true},200,{'Set-Cookie':cookie('',0,u.protocol==='https:')});
  }
  return err('Fonction en préparation.',404);
 }catch(e){console.error('Erreur auth locale');return err('Opération indisponible.',500)}
}};
