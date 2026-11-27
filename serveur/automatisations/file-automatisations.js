'use strict';
/* Fondation autonome (non branchée au serveur). Stockage mono-machine sur
   un système de fichiers local. N'envoie rien aux réseaux. Un travail en
   cours après crash exige une vérification humaine avant toute relance. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const CLES_RESEAU = new Set(['ig','fb','tt','li','th','yt']);
const hacher = s => crypto.createHash('sha256').update(s).digest('hex');
function texte(x, nom){
  if (typeof x !== 'string' || !x.trim() || x.length > 256) throw new Error(nom + ' invalide');
  return x;
}
function espace(compte, projet){ return hacher(JSON.stringify([texte(compte,'compte'),texte(projet,'projet')])); }
function identifiant(reseau, evenement, regle){
  if (!CLES_RESEAU.has(reseau)) throw new Error('réseau invalide');
  return hacher(JSON.stringify([reseau,texte(evenement,'événement'),texte(regle,'règle')]));
}
function ecrireComplet(fd, donnees){
  fs.writeFileSync(fd, donnees, 'utf8'); fs.fsyncSync(fd);
}
function atomicReplace(fichier, objet){
  const tmp = fichier + '.' + crypto.randomBytes(12).toString('hex') + '.tmp';
  let fd;
  try { fd = fs.openSync(tmp,'wx',0o600); ecrireComplet(fd, JSON.stringify(objet)); fs.closeSync(fd); fd=undefined; fs.renameSync(tmp,fichier); }
  finally { if(fd !== undefined) fs.closeSync(fd); try{fs.unlinkSync(tmp)}catch(e){if(e.code!=='ENOENT') throw e} }
}
function publierSiAbsent(fichier, objet){
  const tmp = fichier + '.' + crypto.randomBytes(12).toString('hex') + '.tmp';
  let fd;
  try {
    fd = fs.openSync(tmp,'wx',0o600); ecrireComplet(fd, JSON.stringify(objet)); fs.closeSync(fd); fd=undefined;
    try { fs.linkSync(tmp,fichier); return true; } catch(e){ if(e.code==='EEXIST') return false; throw e; }
  } finally { if(fd !== undefined) fs.closeSync(fd); try{fs.unlinkSync(tmp)}catch(e){if(e.code!=='ENOENT') throw e} }
}
function creerFile(dossier){
  if (typeof dossier !== 'string' || !path.isAbsolute(dossier)) throw new Error('dossier absolu requis');
  fs.mkdirSync(dossier,{recursive:true,mode:0o700});
  function chemin(compte, projet, reseau, evenement, regle){
    const dir=path.join(dossier,espace(compte,projet));
    return {dir, fichier:path.join(dir,identifiant(reseau,evenement,regle)+'.json')};
  }
  function lire(fichier){
    try { return JSON.parse(fs.readFileSync(fichier,'utf8')); }
    catch(e){ if(e.code==='ENOENT') return null; throw e; }
  }
  function serrure(fichier, fn){
    const lock=fichier+'.lock'; let fd;
    try { fd=fs.openSync(lock,'wx',0o600); }
    catch(e){ if(e.code==='EEXIST') throw new Error('travail verrouillé : vérifier les processus avant intervention'); throw e; }
    try { return fn(); } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
  }
  function ajouter({compte,projet,reseau,evenement,regle,action,donnees={}}){
    texte(action,'action');
    const json=JSON.stringify(donnees);
    if (typeof json !== 'string' || Buffer.byteLength(json)>32768) throw new Error('données invalides ou trop volumineuses');
    const {dir,fichier}=chemin(compte,projet,reseau,evenement,regle);
    fs.mkdirSync(dir,{recursive:true,mode:0o700});
    const travail={version:1,reseau,evenement,regle,action,donnees:JSON.parse(json),etat:'en_attente',cree:new Date().toISOString(),tentatives:0};
    const ajoute=publierSiAbsent(fichier,travail);
    return {ajoute,travail:lire(fichier)};
  }
  function obtenir(ref){ return lire(chemin(ref.compte,ref.projet,ref.reseau,ref.evenement,ref.regle).fichier); }
  function demarrer(ref){
    const {fichier}=chemin(ref.compte,ref.projet,ref.reseau,ref.evenement,ref.regle);
    if(!fs.existsSync(fichier)) throw new Error('travail introuvable');
    return serrure(fichier,()=>{
      const travail=lire(fichier);
      if (!travail || travail.etat!=='en_attente') return {demarre:false,travail};
      travail.etat='en_cours'; travail.tentatives++; travail.debut=new Date().toISOString(); atomicReplace(fichier,travail);
      return {demarre:true,travail};
    });
  }
  function terminer(ref, resultat){
    if (!['confirme','refuse','incertain'].includes(resultat)) throw new Error('résultat invalide');
    const {fichier}=chemin(ref.compte,ref.projet,ref.reseau,ref.evenement,ref.regle);
    if(!fs.existsSync(fichier)) throw new Error('travail introuvable');
    return serrure(fichier,()=>{
      const travail=lire(fichier);
      if(!travail || travail.etat!=='en_cours') throw new Error('travail non démarré');
      travail.etat=resultat;travail.fin=new Date().toISOString();atomicReplace(fichier,travail);return travail;
    });
  }
  function liste(compte,projet){
    const dir=path.join(dossier,espace(compte,projet));
    let fichiers; try {fichiers=fs.readdirSync(dir)} catch(e){if(e.code==='ENOENT')return [];throw e}
    return fichiers.filter(x=>/^[0-9a-f]{64}\.json$/.test(x)).map(x=>lire(path.join(dir,x))).filter(Boolean);
  }
  return {ajouter,obtenir,demarrer,terminer,liste};
}
module.exports={creerFile};
