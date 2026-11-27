/**
 * PUBLIO — LE MOTEUR
 * ------------------------------------------------------------------
 * Le vrai backend : les règles tournent ici, toutes seules, sans
 * navigateur, sans personne devant l'écran.
 *
 * Ce fichier ne dépend de rien. Pas de npm install. Node 20+ et c'est tout.
 * Une base JSON sur le disque. Un cron interne à la seconde.
 *
 * Ce qu'il fait :
 *   • exécute les règles QUAND → ALORS de chaque canal
 *   • rattrape les heures manquées (arrêt, coupure, redémarrage)
 *   • publie aux créneaux, recycle, prévient, répond
 *   • expose une API HTTP pour que l'interface pilote tout ça
 *   • écrit tout ce qu'il fait dans un journal
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const publication = require('./publier.js');
const locataires = require('./locataires.js');
const tenantCles = require('./tenant-cles.js');
const autoInstagram = require('./automatisations/automatisation-instagram.js');
const { creerFile: creerFileAutomatisations } = require('./automatisations/file-automatisations.js');
const { FOURNISSEURS, appPour, signerEtat, verifierEtat, urlRedirection } = require('./oauth.js');
const CLIENT_PAGES = require('./client-pages.js');

const PORT = process.env.PORT || 4400;
const DOSSIER = __dirname;
const FICHIER_DB = process.env.PUBLIO_DB || path.join(DOSSIER, 'publio.json');
const FICHIER_JOURNAL = process.env.PUBLIO_JOURNAL || path.join(DOSSIER, 'journal.jsonl');

/* ==================================================================
   1. LA BASE
   Un fichier JSON, des écritures atomiques (on écrit à côté puis on
   renomme : si le disque lâche en plein milieu, on ne perd pas tout).
   ================================================================== */

const DEFAUT = {
  version: 1,
  cree: null,
  canaux: [
    { id:'ig', compte:'@maisonora',  reseau:'instagram', connecte:true },
    { id:'li', compte:'Maison Ora',  reseau:'linkedin',  connecte:true },
    { id:'tt', compte:'@maison.ora', reseau:'tiktok',    connecte:true },
  ],
  regles: [],
  clients: [],        // { id, nom, email, entreprise, plan, statut, montant, debut, renouvellement, notes, cree }
  posts: [],          // { id, canal, titre, legende, jour, heure, etat, media, type, cree }
  stats: {},          // { ig:{ abon, vues, likes, ... } }
  journal: [],        // les 300 dernières actions
  etat: { dernierTick: 0, actions: 0, demarrages: 0 },
};

let DB = null;


const PLANS_CLIENTS = new Set(['essai','starter','pro','agence']);
/* essai 30 jours = limites Starter — pas d'habitude à réduire à la fin de l'essai */
const limitesStarter = (l) => ['essai','starter'].includes(String((l && l.plan) || 'starter').toLowerCase());
const analysesAutoriseesClient = (l) => String((l && l.plan) || '').toLowerCase() === 'agence' && String((l && l.statut) || '').toLowerCase() !== 'essai';
const STATUTS_CLIENTS = new Set(['essai','actif','suspendu','annule']);
/* starter est plafonné : pas d'automatisations. Essai, pro et agence ont tout. */
const ESPACE_LECTURE_SEULE = (l) => ['suspendu','annule'].includes(String((l && l.statut) || '').toLowerCase());
const LECTURE_SEULE_MSG = 'Ton espace est en lecture seule — contacte Publio pour le réactiver.';
const automatisationsBloquees = (l) => !['essai','pro','agence'].includes(String((l && l.plan) || 'starter').toLowerCase());
const VERROU_MSG = 'Les automatisations font partie du pack Pro — passe sur Pro (ou agence) pour les activer.';
/* starter est gratuit : 10 posts par mois (les brouillons ne comptent pas) */
const LIMITE_POSTS_STARTER = 10;
function postsMois(db){
  const mois = new Date().toISOString().slice(0, 7);
  return db.posts.filter(p => p && typeof p.cree === 'string'
      && p.cree.slice(0, 7) === mois
      && p.etat !== 'brouillon' && !p.brouillon).length;
}
const limitePostsAtteinte = (l, db) =>
  limitesStarter(l) && postsMois(db) >= LIMITE_POSTS_STARTER;
/* starter : un seul réseau connecté — déconnecter puis reconnecter pour en changer */
const RESEAU_MSG = (n) => 'Starter : un seul réseau — « ' + n + ' » est déjà connecté. Déconnecte-le pour en changer.';
function canauxConnectes(db){ return db.canaux.filter(c => c && c.connecte); }
/* renvoie le canal déjà connecté qui bloque, sinon null */
function reseauBloquePourStarter(l, db, canal){
  if (!limitesStarter(l)) return null;
  const meme = db.canaux.find(c => c && c.id === canal && c.connecte);
  if (meme) return null; /* reconnexion du même réseau : autorisée */
  const deja = canauxConnectes(db);
  return deja.length ? deja[0] : null;
}
/* starter : un seul changement de réseau par fenêtre de 30 jours.
   Un « changement » est compté quand le client connecte un réseau DIFFÉRENT
   de celui qu'il vient de déconnecter. Déconnecter reste toujours libre. */
const FENETRE_SWITCH = 30 * 24 * 3600 * 1000;
function starterPlan(l){ return limitesStarter(l); }
function enregistrerHistoire(db, id, etat){
  if (!db) return;
  db.reseauxHistorique = Array.isArray(db.reseauxHistorique) ? db.reseauxHistorique : [];
  db.reseauxHistorique.push({ id, etat, t: Date.now() });
  if (db.reseauxHistorique.length > 60) db.reseauxHistorique = db.reseauxHistorique.slice(-60);
}
function dernierDeconnexion(db){
  const h = Array.isArray(db.reseauxHistorique) ? db.reseauxHistorique : [];
  for (let i = h.length - 1; i >= 0; i--) if (h[i] && h[i].etat === 'deconnecte') return h[i];
  return null;
}
const SWITCH_MSG = (j) => 'Starter : un seul changement de réseau tous les 30 jours — il te reste ' + j + ' jour' + (j > 1 ? 's' : '') + ' avant de pouvoir en choisir un autre.';
/* { compte, bloque, jours } — compte = ce connecter-ci compte comme un changement */
function switchStarterStatus(l, db, canal){
  if (!db || !starterPlan(l)) return { compte: false, bloque: false, jours: 0 };
  const de = dernierDeconnexion(db);
  if (!de || de.id === canal) return { compte: false, bloque: false, jours: 0 }; /* reconnexion du même réseau */
  const t = Number(db.dernierSwitchISO) || 0;
  const restant = FENETRE_SWITCH - (Date.now() - t);
  if (t && restant > 0) return { compte: true, bloque: true, jours: Math.ceil(restant / 86400000) };
  return { compte: true, bloque: false, jours: 0 };
}
function enregistrerSwitchStarter(l, db, canal){
  const s = switchStarterStatus(l, db, canal);
  if (s.compte) db.dernierSwitchISO = Date.now();
  enregistrerHistoire(db, canal, 'connecte');
}
function nouvClientId(){ return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function nettoyerClient(c, corps, partiel){
  if (corps == null || typeof corps !== 'object') corps = {};
  if (!partiel || corps.nom !== undefined){
    const v = String(corps.nom || '').trim();
    if (!v) return 'nom requis';
    c.nom = v.slice(0, 120);
  }
  if (!partiel || corps.email !== undefined){
    const v = String(corps.email || '').trim();
    if (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return 'email invalide';
    c.email = v.slice(0, 160);
  }
  if (!partiel || corps.entreprise !== undefined) c.entreprise = String(corps.entreprise || '').trim().slice(0, 120);
  if (!partiel || corps.plan !== undefined){ const v = String(corps.plan || ''); c.plan = PLANS_CLIENTS.has(v) ? v : 'starter'; }
  if (!partiel || corps.statut !== undefined){ const v = String(corps.statut || ''); c.statut = STATUTS_CLIENTS.has(v) ? v : 'essai'; }
  if (!partiel || corps.montant !== undefined){ const v = Number(corps.montant); c.montant = isFinite(v) ? Math.max(0, Math.min(1000000, Math.round(v))) : 0; }
  if (!partiel || corps.renouvellement !== undefined){ const v = String(corps.renouvellement || '').trim(); c.renouvellement = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''; }
  if (!partiel || corps.notes !== undefined) c.notes = String(corps.notes || '').slice(0, 500);
  return null;
}
function resumeClients(){
  const l = (DB && DB.clients) || [];
  const actif = l.filter(c => c.statut === 'actif');
  return {
    actifs: actif.length,
    essai: l.filter(c => c.statut === 'essai').length,
    suspendus: l.filter(c => c.statut === 'suspendu').length,
    annules: l.filter(c => c.statut === 'annule').length,
    mrr: actif.reduce((s2, c) => s2 + (Number(c.montant) || 0), 0),
  };
}

function charger(){
  /* nettoyage : les anciennes bases peuvent contenir un `_dernier` qui
     n'a plus de sens. On l'ignore et on l'efface. */
  try{
    const brut = fs.readFileSync(FICHIER_DB, 'utf8');
    DB = Object.assign({}, DEFAUT, JSON.parse(brut));
    DB.etat = Object.assign({}, DEFAUT.etat, DB.etat);
  }catch(e){
    DB = JSON.parse(JSON.stringify(DEFAUT));
    DB.cree = new Date().toISOString();
    console.log('  base créée :', FICHIER_DB);
  }
  DB.etat.demarrages = (DB.etat.demarrages || 0) + 1;
  if (!Array.isArray(DB.clients)) DB.clients = [];   // anciennes bases : on crée la table
  return DB;
}

let minuteurSauve = null;
function sauver(toutDeSuite){
  if (CONTEXTE_LOCATAIRE) return sauverTenant(CONTEXTE_LOCATAIRE);
  const ecrire = () => {
    const tmp = FICHIER_DB + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(DB, null, 1));
    fs.renameSync(tmp, FICHIER_DB);       // atomique
  };
  if (toutDeSuite) return ecrire();
  clearTimeout(minuteurSauve);
  minuteurSauve = setTimeout(ecrire, 400);   // on groupe les écritures
}

function journaliser(ligne){
  const l = Object.assign({ t:Date.now(), id:'j' + Date.now() + Math.round(Math.random()*1e4) }, ligne);
  DB.journal.unshift(l);
  DB.journal = DB.journal.slice(0, 300);
  if (CONTEXTE_LOCATAIRE) return l;   /* journal du client uniquement — l'agence n'en sait rien */
  fs.appendFileSync(FICHIER_JOURNAL, JSON.stringify(l) + '\n');
  sauver();
  return l;
}

/* ==================================================================
   2. LE CALENDRIER DU MOTEUR
   Les posts sont rangés par JOUR DU MOIS + HEURE.
   On a besoin de savoir quel jour de la semaine tombe un jour donné.
   ================================================================== */

const JOURS_COURTS = ['lun.','mar.','mer.','jeu.','ven.','sam.','dim.'];
const MOIS = ['janvier','février','mars','avril','mai','juin','juillet',
              'août','septembre','octobre','novembre','décembre'];

function jourDeSemaine(annee, mois, jour){
  return JOURS_COURTS[(new Date(annee, mois, jour).getDay() + 6) % 7];
}

/* prochaine date réelle pour un couple (jourDuMois, heure) */
function prochaineDate(jourDuMois, heure){
  const [h, m] = creneauDit(heure);
  const maintenant = new Date();
  for (let bond = 0; bond < 3; bond++){
    const d = new Date(maintenant.getFullYear(), maintenant.getMonth() + bond, jourDuMois, h, m, 0, 0);
    if (d > maintenant) return d;
  }
  return null;
}

function creneauDit(txt){
  if (Array.isArray(txt)) return [+txt[0] || 0, +txt[1] || 0];
  const m = String(txt === undefined || txt === null ? '09:00' : txt)
    .match(/(\d{1,2})\s*[:hH.]?\s*(\d{0,2})/);
  if (!m) return [9, 0];
  return [Math.min(23, +m[1] || 0), Math.min(59, +m[2] || 0)];
}

function ditCreneau(d){
  if (!d) return 'aucun créneau';
  return JOURS_COURTS[(d.getDay() + 6) % 7] + ' '
    + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}

/* ==================================================================
   3. LES RÈGLES DU CONSTRUCTEUR
   Chaque déclencheur dit sur quels réseaux il existe, et quelles
   actions il autorise. Exactement la même logique que dans l'interface :
   ce sont les mêmes ids, donc une règle créée dans l'app s'exécute ici.
   ================================================================== */

const RESEAU_DU_CANAL = { ig:'instagram', li:'linkedin', tt:'tiktok', fb:'facebook', th:'threads' };

const DECLENCHEURS = [
  { id:'sans-date',      reseaux:null },
  { id:'date-arrive',    reseaux:null },
  { id:'jour-semaine',   reseaux:null },
  { id:'creneau-libre',  reseaux:null },
  { id:'toujours',       reseaux:null },
  { id:'perf',           reseaux:null },
  { id:'engagement',     reseaux:null },
  { id:'chute',          reseaux:null },
  { id:'date-passe',     reseaux:null },
  { id:'republication',  reseaux:null },
  { id:'commentaire',    reseaux:null },
  { id:'mot-cle',        reseaux:null },
  { id:'dm',             reseaux:null },
  { id:'mention',        reseaux:null },
  { id:'avis-negatif',   reseaux:null },
  { id:'nouvel-abonne',  reseaux:null },
  { id:'abonnes-seuil',  reseaux:null },
  { id:'desabonnement',  reseaux:null },
  { id:'pic-abonnes',    reseaux:null },
  { id:'nouvelle-video', reseaux:null },
  { id:'flux',           reseaux:null },
  { id:'fichier',        reseaux:null },
  { id:'nouveau-post',   reseaux:null },
  { id:'post-valide',    reseaux:null },
  { id:'blog',           reseaux:null },
  /* les déclencheurs propres à un réseau */
  { id:'story-repond',   reseaux:['ig'] },
  { id:'reactualise',    reseaux:['ig'] },
  { id:'tag-produit',    reseaux:['ig'] },
  { id:'sauvegarde',     reseaux:['ig'] },
  { id:'reel-vues',      reseaux:['ig'] },
  { id:'commentaire-li', reseaux:['li'] },
  { id:'vue-profil',     reseaux:['li'] },
  { id:'invitation',     reseaux:['li'] },
  { id:'fin-live',       reseaux:['tt'] },
  { id:'video-1min',     reseaux:['tt'] },
  { id:'son-tendance',   reseaux:['tt'] },
  { id:'commentaire-fb', reseaux:['fb'] },
  { id:'avis-fb',        reseaux:['fb'] },
  { id:'message-fb',     reseaux:['fb'] },
  { id:'thread-repond',  reseaux:['th'] },
  { id:'thread-viral',   reseaux:['th'] },
];

const ACTIONS = [
  'publier-creneaux','publier-immediat','publier-plus-tard','approuver','brouillon',
  'republier','recycler-boucle','republier-ailleurs','publier-story','epingle',
  'dupliquer','rediger-ia','variantes','ajouter-media','ajouter-hashtags','ajouter-utm',
  'repondre','repondre-ia','repondre-dm','envoyer-lien','prevenir','prevenir-equipe',
  'marquer-lu','archiver','taguer','rapport-semaine',
];

const PEUT = {
  'sans-date':      ['publier-creneaux','publier-immediat','publier-plus-tard','approuver','brouillon','prevenir','prevenir-equipe'],
  'date-arrive':    ['publier-creneaux','publier-immediat','publier-plus-tard','prevenir','prevenir-equipe','approuver'],
  'jour-semaine':   ['publier-creneaux','publier-immediat','publier-plus-tard','rapport-semaine','prevenir'],
  'creneau-libre':  ['publier-creneaux','publier-immediat','approuver','prevenir'],
  'toujours':       ['publier-creneaux','rapport-semaine','prevenir','prevenir-equipe'],
  'perf':           ['republier','recycler-boucle','republier-ailleurs','publier-story','epingle','dupliquer','prevenir','ajouter-hashtags','ajouter-utm','rapport-semaine'],
  'engagement':     ['republier','recycler-boucle','publier-story','epingle','dupliquer','prevenir','rapport-semaine'],
  'chute':          ['repondre-ia','rediger-ia','variantes','publier-story','republier-ailleurs','prevenir','archiver','brouillon'],
  'date-passe':     ['republier','recycler-boucle','archiver','publier-story','dupliquer','prevenir','taguer'],
  'republication':  ['repondre','repondre-ia','prevenir','marquer-lu','dupliquer','ajouter-hashtags'],
  'commentaire':    ['repondre','repondre-ia','repondre-dm','envoyer-lien','prevenir','prevenir-equipe','marquer-lu','taguer','archiver'],
  'mot-cle':        ['repondre','repondre-ia','repondre-dm','envoyer-lien','prevenir','prevenir-equipe','taguer','marquer-lu'],
  'dm':             ['repondre-dm','repondre-ia','envoyer-lien','repondre','prevenir','prevenir-equipe','marquer-lu','taguer'],
  'mention':        ['repondre','repondre-ia','prevenir','prevenir-equipe','marquer-lu','dupliquer'],
  'avis-negatif':   ['repondre','repondre-ia','repondre-dm','prevenir','prevenir-equipe','marquer-lu','taguer'],
  'nouvel-abonne':  ['repondre','repondre-dm','prevenir','rapport-semaine','envoyer-lien','taguer'],
  'abonnes-seuil':  ['rapport-semaine','prevenir','prevenir-equipe','rediger-ia','publier-creneaux','repondre'],
  'desabonnement':  ['prevenir','rapport-semaine','rediger-ia','taguer'],
  'pic-abonnes':    ['rapport-semaine','prevenir','rediger-ia','publier-creneaux'],
  'nouvelle-video': ['publier-creneaux','publier-immediat','republier-ailleurs','publier-story','prevenir','rediger-ia'],
  'flux':           ['rediger-ia','publier-creneaux','publier-immediat','variantes','prevenir','publier-story'],
  'fichier':        ['ajouter-media','publier-creneaux','rediger-ia','brouillon','prevenir','approuver'],
  'nouveau-post':   ['approuver','prevenir','prevenir-equipe','brouillon','taguer','ajouter-hashtags','ajouter-utm','rediger-ia'],
  'post-valide':    ['publier-creneaux','publier-immediat','publier-plus-tard','publier-story','recycler-boucle','prevenir','prevenir-equipe'],
  'blog':           ['rediger-ia','publier-creneaux','publier-immediat','variantes','ajouter-utm','ajouter-hashtags','publier-story','republier-ailleurs','prevenir'],
  'story-repond':   ['repondre','repondre-dm','repondre-ia','prevenir','taguer','marquer-lu'],
  'reactualise':    ['repondre','prevenir','marquer-lu','dupliquer'],
  'tag-produit':    ['repondre','prevenir','marquer-lu','taguer','dupliquer'],
  'sauvegarde':     ['republier','recycler-boucle','publier-story','epingle','dupliquer','prevenir','rapport-semaine'],
  'reel-vues':      ['republier','recycler-boucle','publier-story','epingle','republier-ailleurs','prevenir','dupliquer'],
  'commentaire-li': ['repondre','repondre-ia','repondre-dm','prevenir','prevenir-equipe','marquer-lu','taguer'],
  'vue-profil':     ['prevenir','rapport-semaine','rediger-ia','publier-creneaux'],
  'invitation':     ['repondre','prevenir','marquer-lu'],
  'fin-live':       ['publier-creneaux','publier-immediat','republier-ailleurs','publier-story','rediger-ia','prevenir','variantes'],
  'video-1min':     ['republier','recycler-boucle','republier-ailleurs','publier-story','prevenir','dupliquer'],
  'son-tendance':   ['rediger-ia','publier-creneaux','publier-immediat','variantes','prevenir'],
  'commentaire-fb': ['repondre','repondre-ia','repondre-dm','prevenir','prevenir-equipe','marquer-lu','taguer'],
  'avis-fb':        ['repondre','repondre-ia','repondre-dm','prevenir','prevenir-equipe','marquer-lu','taguer'],
  'message-fb':     ['repondre-dm','repondre-ia','envoyer-lien','prevenir','marquer-lu','taguer'],
  'thread-repond':  ['repondre','repondre-ia','prevenir','marquer-lu','dupliquer'],
  'thread-viral':   ['republier','recycler-boucle','publier-story','prevenir','rapport-semaine','dupliquer'],
};

function declExisteSur(declId, canalId){
  const d = DECLENCHEURS.find(x => x.id === declId);
  if (!d) return false;
  return !d.reseaux || d.reseaux.includes(canalId);
}
function actionsPour(declId){
  const permis = PEUT[declId];
  return permis ? ACTIONS.filter(a => permis.includes(a)) : [];
}
/* Les nouvelles règles multi-actions ne sont que des brouillons. Aucun moteur
   ou webhook ne doit pouvoir les activer avant la prise en charge réelle. */
function verifierBrouillonMulti(regle, ancien){
  const avait = !!(ancien && ancien.p && ancien.p.multi);
  const m = regle && regle.p && regle.p.multi;
  if (!m) return avait ? 'Un brouillon multi-actions ne peut pas être converti en règle active.' : null;
  if (regle.actif !== false) return 'Ce brouillon ne peut pas être activé : exécution réelle en préparation.';
  const canaux={commentaire:['ig','fb','li','th','yt'],mot_cle:['ig','fb','li','th','yt'],message:['ig','fb'],mention:['ig','fb','li','th'],vues:['ig','fb','li','th','tt','yt'],erreur:['ig','fb','li','th','tt','yt'],publie:['ig','fb','li','th','tt','yt'],semaine:['ig','fb','li','th','tt','yt']};
  const autorise={commentaire:['reponse_publique','alerte'],mot_cle:['reponse_publique','alerte'],message:['reponse_message','alerte'],mention:['alerte'],vues:['alerte','proposer_brouillon'],erreur:['alerte'],publie:['alerte'],semaine:['rapport']};
  if (typeof m!=='object'||Array.isArray(m)||m.version!==1||!Object.hasOwn(canaux,m.quand)||!canaux[m.quand].includes(regle.canaux)) return 'Déclencheur indisponible pour ce canal.';
  if (m.quand==='mot_cle'&&(typeof m.mot!=='string'||!m.mot.trim()||m.mot.length>100)) return 'Mot-clé invalide.';
  if (m.quand==='vues'&&(!Number.isFinite(m.seuil)||m.seuil<1||m.seuil>100000000)) return 'Objectif de vues invalide.';
  const opts=autorise[m.quand].slice(); if (['commentaire','mot_cle'].includes(m.quand)&&['ig','fb'].includes(regle.canaux)) opts.push('reponse_privee');
  if (!Array.isArray(m.actions)||!m.actions.length||m.actions.length>4) return 'Choisis entre une et quatre actions.';
  const deja=new Set();
  for(const a of m.actions){
    if(!a||typeof a!=='object'||!opts.includes(a.type)||deja.has(a.type)) return 'Action invalide pour ce canal ou déclencheur.';
    deja.add(a.type);
    if(['reponse_publique','reponse_privee','reponse_message'].includes(a.type)&&(typeof a.texte!=='string'||!a.texte.trim()||a.texte.length>640)) return 'Texte de réponse invalide.';
    if(a.type==='reponse_privee' && (a.bouton||a.lien)){
      if(typeof a.bouton!=='string'||!a.bouton.trim()||a.bouton.length>20||typeof a.lien!=='string'||a.lien.length>500) return 'Bouton invalide.';
      try { if(new URL(a.lien).protocol!=='https:') return 'Lien HTTPS requis.'; } catch(_) { return 'Lien HTTPS invalide.'; }
    }
  }
  if (regle.declencheur!=='commentaire'||regle.action!=='prevenir') return 'Format du brouillon invalide.';
  return null;
}

function regleValide(r){
  const erreurMulti = verifierBrouillonMulti(r);
  if (erreurMulti) return erreurMulti;
  if (!r || !r.declencheur || !r.action) return 'déclencheur ou action manquant';
  if (!declExisteSur(r.declencheur, r.canaux))
    return 'le déclencheur « ' + r.declencheur + ' » n’existe pas sur ' + (RESEAU_DU_CANAL[r.canaux] || r.canaux);
  if (!actionsPour(r.declencheur).includes(r.action))
    return 'l’action « ' + r.action + ' » ne va pas avec « ' + r.declencheur + ' »';
  return null;
}

/* ==================================================================
   4. LES POSTS
   ================================================================== */

function etatDe(p){
  if (p.etat) return p.etat;              // publié / brouillon décidé
  if (p.brouillon) return 'brouillon';
  return 'prog';
}

function postsDuCanal(canal){
  return DB.posts.filter(p => p.canal === canal);
}
function postsEnAttente(canal){
  return postsDuCanal(canal)
    .filter(p => !['publie','traitement','attente-validation'].includes(etatDe(p)))
    .sort((a,b) => a.jour - b.jour || String(a.heure).localeCompare(String(b.heure)));
}
function prochainPostDuCanal(canal){
  const l = postsEnAttente(canal);
  return l.length ? l[0] : null;
}

/* les créneaux déjà occupés par un post programmé de ce canal */
function creneauxPris(canal, saufId){
  return DB.posts
    .filter(p => p.canal === canal && p.id !== saufId && etatDe(p) === 'prog' && p.datePrevue)
    .map(p => new Date(p.datePrevue).getTime());
}

/* le prochain créneau RÉELLEMENT libre : on saute une semaine si c'est pris */
function prochainCreneauLibre(liste, canal, saufId){
  let base = prochainCreneau(liste);
  if (!base) return null;
  const pris = creneauxPris(canal, saufId);
  let essais = 0;
  while (pris.includes(base.getTime()) && essais++ < 52){
    const suivants = (liste || []).map(x => {
      const d = new Date(base);
      d.setDate(d.getDate() + 7);
      return d;
    });
    base = suivants.sort((a,b) => a - b)[0];
  }
  return base;
}

/* le prochain créneau libre dans une liste de créneaux */
function prochainCreneau(liste){
  const now = new Date();
  let meilleur = null;
  (liste || []).forEach(x => {
    const cible = JOURS_COURTS.indexOf(x[0]);
    if (cible < 0) return;
    const jsDay = (now.getDay() + 6) % 7;
    let ecart = (cible - jsDay + 7) % 7;
    if (ecart === 0 && (x[1] * 60 + (x[2] || 0)) <= now.getHours() * 60 + now.getMinutes()) ecart = 7;
    const d = new Date(now);
    d.setDate(d.getDate() + ecart);
    d.setHours(x[1], x[2] || 0, 0, 0);
    if (!meilleur || d < meilleur) meilleur = d;
  });
  return meilleur;
}

/* ==================================================================
   5. L'EXÉCUTION : UNE PAIRE (déclencheur → action) SUR UN CANAL
   Chaque action modifie vraiment la base. Rien de décoratif.
   ================================================================== */

const STATS_DEFAUT = { abon:0, vues:0, likes:0, commentaires:0, engagement:0 };
function statsDe(canal){
  if (!DB.stats[canal]) DB.stats[canal] = Object.assign({}, STATS_DEFAUT);
  return DB.stats[canal];
}

let HORLOGE = new Date();
let EN_REJEU = false;
/* pendant la passe locataire : la base est CELLE du client, pas celle de l'agence */
let CONTEXTE_LOCATAIRE = null;

function maintenantMin(){ return HORLOGE.getHours() * 60 + HORLOGE.getMinutes(); }
function jourCourtAuj(){ return JOURS_COURTS[(HORLOGE.getDay() + 6) % 7]; }

async function executer(declId, actId, p, canal, ctx){
  p = p || {};
  ctx = ctx || {};
  const canalInfo = DB.canaux.find(c => c.id === canal);
  const nom = canalInfo ? canalInfo.compte : canal;
  const n = (k, d) => (p[k] === undefined || p[k] === null || p[k] === '') ? d : p[k];
  const prochain = prochainPostDuCanal(canal);
  const post = ctx.post || null;
  const cible = post || prochain;

  /* ---------- l'action change vraiment la base ---------- */
  switch (actId){

    case 'publier-creneaux': {
      if (!cible) return { fait:false, dit:'Je n’ai aucun post en attente sur ' + nom + '.' };
      /* un créneau déjà pris par un autre post n'est pas libre */
      const cr = prochainCreneauLibre(p.creneaux || [['mar.',18,0]], canal, cible.id);
      if (!cr) return { fait:false, dit:'Aucun créneau valable pour ' + nom + '.' };
      cible.jour = cr.getDate();
      cible.heure = String(cr.getHours()).padStart(2,'0') + ':' + String(cr.getMinutes()).padStart(2,'0');
      cible.brouillon = false;
      cible.etat = 'prog';
      cible.datePrevue = cr.toISOString();
      return { fait:true, dit:'« ' + cible.titre + ' » passe ' + ditCreneau(cr) + '.', titre:cible.titre };
    }

    case 'publier-immediat': {
      if (!cible) return { fait:false, dit:'Je n’ai aucun post à publier sur ' + nom + '.' };
      const r = await envoyer(cible, canal, nom);
      /* un essai raté n'est PAS une action réussie, mais il doit être
         journalisé : c'est ce qui distingue « rien à faire » de « j'ai essayé ». */
      return { fait:r.fait, essai:!r.fait, dit:r.dit, titre:cible.titre };
    }

    case 'publier-plus-tard': {
      if (!cible) return { fait:false, dit:'Je n’ai aucun post à décaler sur ' + nom + '.' };
      const h = n('h', 3);
      const d = new Date(HORLOGE); d.setHours(d.getHours() + h);
      cible.jour = d.getDate();
      cible.heure = String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
      cible.brouillon = false;
      cible.etat = 'prog';
      return { fait:true, dit:'« ' + cible.titre + ' » passe dans ' + h + ' h.', titre:cible.titre };
    }

    case 'approuver': {
      if (!cible) return { fait:false, dit:'Rien à approuver sur ' + nom + '.' };
      cible.brouillon = false;
      cible.etat = 'prog';
      return { fait:true, dit:'« ' + cible.titre + ' » est approuvé.', titre:cible.titre };
    }

    case 'brouillon': {
      if (!cible) return { fait:false, dit:'Rien à mettre en brouillon sur ' + nom + '.' };
      cible.brouillon = true;
      cible.etat = 'brouillon';
      return { fait:true, dit:'« ' + cible.titre + ' » repasse en brouillon.', titre:cible.titre };
    }

    case 'republier':
    case 'recycler-boucle': {
      /* on prend un post déjà publié qui n'a JAMAIS été recyclé.
         Sinon, à chaque passage, le même post repartirait encore et encore. */
      const dejaRecycles = DB.posts.filter(x => x.recycleDe).map(x => x.recycleDe);
      const src = postsDuCanal(canal)
        .filter(x => etatDe(x) === 'publie' && !dejaRecycles.includes(x.id))
        .sort((a,b) => b.jour - a.jour)[0];
      if (!src) return { fait:false, dit:'Tous mes posts publiés ont déjà été recyclés.' };
      const jours = n('jours', 90);
      const d = new Date(HORLOGE); d.setDate(d.getDate() + jours);
      const copie = {
        id:'p' + Date.now() + Math.round(Math.random()*1e4),
        canal, titre:src.titre, legende:src.legende,
        jour:d.getDate(), heure:src.heure || '09:00',
        etat:'prog', brouillon:false, media:(src.media || []).slice(),
        type:src.type || 'texte', cree:new Date().toISOString(),
        recycleDe:src.id,
      };
      DB.posts.push(copie);
      return { fait:true, dit:'« ' + src.titre + ' » repart le ' + d.getDate()
        + ' ' + MOIS[d.getMonth()] + '.', titre:src.titre };
    }

    case 'dupliquer': {
      const src = cible;
      if (!src) return { fait:false, dit:'Rien à dupliquer sur ' + nom + '.' };
      const copie = JSON.parse(JSON.stringify(src));
      copie.id = 'p' + Date.now() + Math.round(Math.random()*1e4);
      copie.cree = new Date().toISOString();
      copie.etat = 'brouillon'; copie.brouillon = true;
      delete copie.publie; delete copie.datePrevue;
      DB.posts.push(copie);
      return { fait:true, dit:'Une copie de « ' + src.titre + ' » est en brouillon.', titre:src.titre };
    }

    case 'publier-story': {
      const src = cible;
      if (!src) return { fait:false, dit:'Rien à mettre en story sur ' + nom + '.' };
      const d = new Date(HORLOGE); d.setHours(d.getHours() + 2);
      DB.posts.push({
        id:'p' + Date.now() + Math.round(Math.random()*1e4),
        canal, titre:'Story · ' + src.titre, legende:src.legende,
        jour:d.getDate(), heure:String(d.getHours()).padStart(2,'0') + ':00',
        etat:'prog', brouillon:false, type:'story', story:true,
        cree:new Date().toISOString(),
      });
      return { fait:true, dit:'Une story reprend « ' + src.titre + ' ».', titre:src.titre };
    }

    case 'epingle': {
      const src = cible;
      if (!src) return { fait:false, dit:'Rien à épingler sur ' + nom + '.' };
      src.epingle = true;
      return { fait:true, dit:'« ' + src.titre + ' » est épinglé en haut du profil.', titre:src.titre };
    }

    case 'republier-ailleurs': {
      const src = cible;
      if (!src) return { fait:false, dit:'Rien à republier ailleurs.' };
      const autre = DB.canaux.find(c => c.id !== canal && c.connecte);
      if (!autre) return { fait:false, dit:'Aucun autre canal connecté pour republier.' };
      const d = new Date(HORLOGE); d.setDate(d.getDate() + n('jours', 3));
      DB.posts.push({
        id:'p' + Date.now() + Math.round(Math.random()*1e4),
        canal:autre.id, titre:src.titre, legende:src.legende,
        jour:d.getDate(), heure:'09:00', etat:'prog', brouillon:false,
        media:(src.media || []).slice(), type:src.type || 'texte',
        cree:new Date().toISOString(),
      });
      return { fait:true, dit:'« ' + src.titre + ' » part aussi sur ' + autre.compte + '.', titre:src.titre };
    }

    case 'archiver': {
      const src = cible;
      if (!src) return { fait:false, dit:'Rien à archiver sur ' + nom + '.' };
      src.etat = 'archive';
      return { fait:true, dit:'« ' + src.titre + ' » est archivé.', titre:src.titre };
    }

    case 'taguer': {
      const src = cible;
      if (!src) return { fait:false, dit:'Rien à taguer sur ' + nom + '.' };
      src.tags = src.tags || [];
      const t = n('tag', 'collab');
      if (!src.tags.includes(t)) src.tags.push(t);
      return { fait:true, dit:'« ' + src.titre + ' » porte le tag « ' + t + ' ».', titre:src.titre };
    }

    case 'ajouter-hashtags': {
      const src = cible;
      if (!src) return { fait:false, dit:'Rien à compléter sur ' + nom + '.' };
      const k = n('nb', 5);
      const deja = (src.legende || '').match(/#\w+/g) || [];
      const manque = Math.max(0, k - deja.length);
      src.hashtagsAjoutes = manque;
      return { fait:true, dit:manque
        ? manque + ' hashtag' + (manque > 1 ? 's' : '') + ' proposé' + (manque > 1 ? 's' : '') + ' pour « ' + src.titre + ' ».'
        : '« ' + src.titre + ' » a déjà ses ' + k + ' hashtags.', titre:src.titre };
    }

    case 'ajouter-utm': {
      const src = cible;
      if (!src) return { fait:false, dit:'Rien à tracer sur ' + nom + '.' };
      src.utm = 'utm_source=' + canal + '&utm_medium=social';
      return { fait:true, dit:'Le lien de « ' + src.titre + ' » est tracé.', titre:src.titre };
    }

    case 'ajouter-media': {
      if (!cible) return { fait:false, dit:'Aucun post à illustrer sur ' + nom + '.' };
      cible.mediaSuggere = true;
      return { fait:true, dit:'Une image est proposée pour « ' + cible.titre + ' ».', titre:cible.titre };
    }

    case 'repondre':
    case 'repondre-ia':
    case 'repondre-dm': {
      const priv = actId === 'repondre-dm';
      const txt = ctx.reponse || (priv ? 'Bonjour ! Je vous réponds tout de suite.' : 'Merci beaucoup !');
      return { fait:true, dit:(priv ? 'message privé envoyé' : 'réponse envoyée')
        + ' sur ' + nom + ' : « ' + txt.slice(0,50) + ' »' };
    }

    case 'envoyer-lien': {
      const url = n('url', 'maisonora.fr');
      return { fait:true, dit:'lien envoyé sur ' + nom + ' : ' + url };
    }

    case 'rediger-ia': {
      const style = n('style', 'chaleureux');
      return { fait:true, dit:'texte ' + style + ' écrit pour ' + nom };
    }

    case 'variantes': {
      const k = n('k', 3);
      return { fait:true, dit:k + ' variantes du texte, pour ' + nom };
    }

    case 'prevenir':
    case 'prevenir-equipe': {
      const ou = actId === 'prevenir-equipe' ? 'à ton collègue' : n('par', 'par e-mail');
      const quoi = ctx.quoi || 'une action a eu lieu';
      return { fait:true, dit:'alerte envoyée ' + ou + ' · ' + quoi };
    }

    case 'marquer-lu': {
      return { fait:true, dit:'conversations lues sur ' + nom };
    }

    case 'rapport-semaine': {
      const st = statsDe(canal);
      return { fait:true, dit:'récap de ' + nom + ' : ' + st.abon + ' abonnés, '
        + st.vues + ' vues, ' + st.likes + ' likes' };
    }

    default:
      return { fait:false, dit:'Action inconnue : ' + actId };
  }
}

/* ==================================================================
   L'ENVOI — le seul endroit où un post quitte la base
   ------------------------------------------------------------------
   Trois issues possibles, et on ne les confond jamais :
     • ça part            → état publié
     • ça échoue, on retente → le post reste en attente, avec une raison
     • ça échoue pour de bon → état « echoue », visible sur la carte
   ================================================================== */
async function envoyer(post, canal, nom){
  /* en contexte locataire : un disjoncteur À LUI — jamais celui de l'agence */
  const canalEff = CONTEXTE_LOCATAIRE ? CONTEXTE_LOCATAIRE.slug + ':' + canal : canal;
  /* le disjoncteur : si ce canal vient de tomber, on n'insiste pas */
  const panne = canalEnPanne(canalEff);
  if (panne){
    const reste = Math.round((panne.ouvertJusqua - Date.now()) / 60000);
    return { fait:false, essai:false,
      dit:'« ' + post.titre + ' » en attente · ' + nom + ' se repose encore '
        + reste + ' min après ' + panne.echecs + ' échecs.' };
  }

  /* les clés : CELLES DU CLIENT quand c'est son canal — jamais celles de l'agence */
  const locataireEnvoi = CONTEXTE_LOCATAIRE;
  let cles = locataireEnvoi
    ? tenantCles.lire(locataireEnvoi.slug, canal)
    : publication.clesDe(canal);
  // TikTok renouvelle les accès de chaque client séparément, avant l'envoi.
  if (locataireEnvoi && canal === 'tt' && cles && cles.refresh_token && cles.token_expire){
    const cfg = appPour('tiktok');
    if (cfg){
      const copie = Object.assign({}, cles, { client_key:cfg.client_id, client_secret:cfg.client_secret });
      const resultat = await require('./rafraichir-tokens.js').rafraichirCanal('tt', copie);
      if (resultat.fait){
        const actuelles = tenantCles.lire(locataireEnvoi.slug, canal);
        // Une reconnexion pendant l'appel ne doit jamais être écrasée.
        if (actuelles && actuelles.access_token === cles.access_token && actuelles.refresh_token === cles.refresh_token){
          const miseAJour = Object.assign({}, actuelles, { access_token:copie.access_token,
            refresh_token:copie.refresh_token, token_expire:copie.token_expire,
            expires_at:Date.parse(copie.token_expire) });
          if (!(tenantCles.ecrire(locataireEnvoi.slug, canal, miseAJour) || {}).erreur) cles = miseAJour;
        } else cles = actuelles;
      }
    }
  }
  const r = await publication.publier(post, canal, cles);
  noterEnvoi(canalEff, r.ok);

  if (r.ok){
    post.jour = HORLOGE.getDate();
    post.heure = String(HORLOGE.getHours()).padStart(2,'0') + ':'
               + String(HORLOGE.getMinutes()).padStart(2,'0');
    post.brouillon = false;
    post.etat = r.enAttenteUtilisateur ? 'attente-validation' : r.traitementEnCours ? 'traitement' : 'publie';
    if (post.etat === 'publie') post.publie = HORLOGE.toISOString();
    post.idExterne = r.idExterne || null;
    post.url = r.url || null;
    const dit = r.enAttenteUtilisateur ? '« ' + post.titre + ' » est dans la boîte TikTok : termine et publie dans TikTok.'
      : r.traitementEnCours ? '« ' + post.titre + ' » est en cours de traitement sur TikTok.'
      : '« ' + post.titre + ' » est publié sur ' + nom + '.';
    return { fait:true, dit, ok:true };
  }

  /* l'échec : le post NE disparaît pas */
  post.brouillon = false;
  post.dernierEssai = HORLOGE.toISOString();
  if (post.etat !== 'echoue' && post.prochainEssai) post.etat = 'retente';

  const dit = '« ' + post.titre + ' » n’est pas parti · ' + (r.erreur || 'erreur inconnue — relance depuis le journal')
    + (r.conseil ? ' · ' + r.conseil : '');

  return { fait:false, dit, ok:false, code:r.code };
}

/* ==================================================================
   LA FILE DE REPRISE
   Les posts qui ont échoué et qu'on doit retenter.
   Elle tourne à chaque battement, comme les règles.
   ================================================================== */
async function reprendreLesEnvois(){
  let faites = 0;
  for (const post of DB.posts){
    if (post.etat !== 'retente') continue;
    if (!post.prochainEssai) continue;
    if (new Date(post.prochainEssai).getTime() > HORLOGE.getTime()) continue;

    const canalInfo = DB.canaux.find(c => c.id === post.canal);
    if (!canalInfo) continue;

    const r = await envoyer(post, post.canal, canalInfo.compte);
    if (r.fait){
      faites++;
      DB.etat.actions++;
      journaliser({ canal:post.canal, texte:'reprise réussie · ' + r.dit });
    } else {
      journaliser({ canal:post.canal, texte:'reprise ratée · ' + r.dit });
    }
    sauver();
  }
  return faites;
}

/* ---------- ce que la règle regarde avant d'agir ---------- */
function laReglePeutAgir(r, canal){
  const p = r.p || {};
  const n = (k, d) => (p[k] === undefined || p[k] === null || p[k] === '') ? d : p[k];

  switch (r.declencheur){
    case 'sans-date': {
      const dispo = postsEnAttente(canal).filter(x => etatDe(x) === 'brouillon' || !x.heure);
      return dispo.length ? { oui:true, post:dispo[0] }
        : { oui:false, dit:'Je n’ai aucun post en attente.' };
    }
    case 'date-arrive':
      return { oui:true, post:prochainPostDuCanal(canal) };

    case 'jour-semaine': {
      const pp = prochainPostDuCanal(canal);
      const j = pp ? pp.jour : HORLOGE.getDate();
      const jourReel = JOURS_COURTS[(new Date(HORLOGE.getFullYear(), HORLOGE.getMonth(), j).getDay() + 6) % 7];
      const [hh, mm] = creneauDit(n('heure','09:00'));
      const proche = Math.abs(maintenantMin() - (hh * 60 + mm)) <= 5;
      return (jourReel === n('jour','lun.') && proche)
        ? { oui:true, post:pp }
        : { oui:false, dit:'Ce n’est pas ' + n('jour','lun.') + ' à ' + n('heure','09:00') + ' pile.' };
    }

    case 'toujours': {
      const [hh, mm] = creneauDit(n('heure','09:00'));
      return Math.abs(maintenantMin() - (hh * 60 + mm)) <= 90
        ? { oui:true } : { oui:false, dit:'Le moment est passé pour aujourd’hui.' };
    }

    case 'creneau-libre': {
      const cr = prochainCreneau(p.creneaux || [['mar.',18,0]]);
      return (cr && postsEnAttente(canal).length)
        ? { oui:true } : { oui:false, dit:'Planning plein ou rien à publier.' };
    }

    case 'perf': {
      const st = statsDe(canal);
      const cap = n('vues', 2000);
      return st.vues >= cap ? { oui:true } : { oui:false, dit:'Le cap de ' + cap + ' vues n’est pas atteint (' + st.vues + ').' };
    }
    case 'engagement': {
      const st = statsDe(canal);
      const cap = n('pct', 4);
      return st.engagement >= cap ? { oui:true } : { oui:false, dit:'L’engagement est à ' + st.engagement + ' %, sous les ' + cap + ' %.' };
    }
    case 'abonnes-seuil': {
      const st = statsDe(canal);
      const cap = n('n', 10000);
      return st.abon >= cap ? { oui:true } : { oui:false, dit:st.abon + ' abonnés sur ' + cap + '.' };
    }

    /* les déclencheurs « quelqu'un réagit » : c'est un événement, pas un état.
       Ils n'agissent que si on le leur dit (une vraie notification). */
    default:
      return { oui:false, dit:'En attente d’un vrai événement.', evenement:true };
  }
}

/* ==================================================================
   6. L'HORLOGE DU SERVEUR
   Deux régimes :
     • normal : on regarde l'heure vraie, on fait tourner
     • rattrapage : au démarrage, on rejoue les heures manquées
   ================================================================== */

function reglesDuCanal(canal){
  return DB.regles.filter(r => r.actif && r.canaux === canal);
}

/* le dernier passage de chaque règle, EN MÉMOIRE seulement.
   Pourquoi pas dans la base : sauvegardé sur disque, il reviendrait au
   redémarrage avec une heure qui n'a plus de sens et bloquerait la règle. */
const DERNIER_PASSAGE = {};

async function faireTourner(){
  let faites = 0;
  for (const c of DB.canaux.filter(x => x.connecte)){
    for (const r of reglesDuCanal(c.id)){
      if (regleValide(r)) return;      // null = valide ; un texte = elle ne peut pas tourner

      /* Combien de temps entre deux passages ?
         • les règles de temps (créneaux, jour fixe) : 20 s en marche
           normale, mais une fois par jour quand on rejoue des heures —
           sinon un rattrapage de 7 jours rejouerait la même action 168 fois.
         • les règles de performance (recycler, republier) : une fois par jour,
           même en marche normale. Recycler toutes les 4 secondes n'a aucun sens. */
      const cle = r.declencheur + '|' + r.action + '|' + c.id;
      const parJour = ['perf','engagement','sauvegarde','reel-vues','thread-viral',
                       'republier','recycler-boucle'].includes(r.declencheur)
                    || ['republier','recycler-boucle','republier-ailleurs'].includes(r.action);
      const battement = (EN_REJEU || parJour) ? 24 * 3600 * 1000 : 20000;
      /* l'horloge du moteur, pas celle du process : pendant un rejeu,
         HORLOGE avance d'une heure à chaque tour. Avec Date.now(), toutes
         les heures rejouées auraient la même date et la règle ne verrait
         jamais passer 24 h. */
      const maintenant = HORLOGE.getTime();
      if (DERNIER_PASSAGE[cle] && maintenant - DERNIER_PASSAGE[cle] < battement) continue;

      const peut = laReglePeutAgir(r, c.id);
      if (!peut.oui) continue;

      const res = await executer(r.declencheur, r.action, r.p, c.id, { post:peut.post, regle:r });
      if (res.fait){
        DERNIER_PASSAGE[cle] = HORLOGE.getTime();
        r.derniereAction = new Date().toISOString();
        faites++;
        DB.etat.actions++;
      }
      /* on journalise TOUJOURS quelque chose quand une règle a essayé :
         une règle qui n'agit pas ne doit pas être un silence. */
      if (res.fait || res.essai){
        journaliser({ canal:c.id, regleId:r.id, decl:r.declencheur,
          action:r.action, texte:res.dit, essai:!!res.essai });
      }
    }
  }
  return faites;
}

/* ==================================================================
   LA PASSE LOCATAIRE — SIMULATION HONNÊTE
   Chaque client actif a SA base. Le battement du moteur l'évalue comme
   la base globale — mais dans ce régime, RIEN ne part sur un réseau :
   on journalise seulement « la règle aurait fait ça », chez le client.
   Quand les canaux de chaque client seront connectés (clés à lui),
   cette passe passera en exécution réelle.
   ================================================================== */
const DERNIER_PASSAGE_LOC = {};

async function faireTournerTenant(l){
  if (!l) return 0;
  if (automatisationsBloquees(l)) return 0;   /* starter : aucune règle évaluée */
  const db = tenantBase(l);
  if (!db) return 0;
  let faites = 0;
  /* on bascule temporairement le contexte global vers la base du client :
     les évaluateurs (laReglePeutAgir, regleValide…) lisent DB comme pour l'agence */
  const garde = DB;
  const gardeContexte = CONTEXTE_LOCATAIRE;
  DB = db;
  CONTEXTE_LOCATAIRE = l;
  try{
    for (const c of db.canaux.filter(x => x.connecte)){
      for (const r of db.regles.filter(x => x.actif && x.canaux === c.id)){
        if (regleValide(r)) continue;              /* règle incomplète : on ne simule rien */
        const cle = 'loc:' + l.slug + '|' + r.declencheur + '|' + r.action + '|' + c.id;
        const parJour = ['perf','engagement','sauvegarde','reel-vues','thread-viral',
                         'republier','recycler-boucle'].includes(r.declencheur)
                      || ['republier','recycler-boucle','republier-ailleurs'].includes(r.action);
        const battement = (EN_REJEU || parJour) ? 24 * 3600 * 1000 : 20000;
        const maintenant = HORLOGE.getTime();
        if (DERNIER_PASSAGE_LOC[cle] && maintenant - DERNIER_PASSAGE_LOC[cle] < battement) continue;

        const peut = laReglePeutAgir(r, c.id);
        if (!peut.oui) continue;

        DERNIER_PASSAGE_LOC[cle] = maintenant;
        faites++;
        db.etat.actions = (db.etat.actions || 0) + 1;
        db.etat.dernierTick = maintenant;
        journalTenant(l, 'simulation — la règle « ' + (r.nom || r.declencheur)
          + ' » aurait exécuté « ' + r.action + ' » — rien n’a été publié ni envoyé',
          { canal: c.id, regleId: r.id, decl: r.declencheur, action: r.action, simulation: true });
      }
    }
    /* la file du client aussi : un post en « retente » repart avec SES clés */
    try { await reprendreLesEnvois(); } catch(e){ console.error('  ! reprise locataire ' + l.slug + ' : ' + e.message); }
  } finally {
    DB = garde;
    CONTEXTE_LOCATAIRE = gardeContexte;
  }
  if (faites) sauverTenant(l);
  return faites;
}

/* le registre des locataires est lu au plus toutes les 30 s (le fichier est petit, mais le battement est chaque seconde) */
let REG_CACHE = { t: 0, liste: [] };
function locatairesActifs(){
  if (Date.now() - REG_CACHE.t < 30000) return REG_CACHE.liste;
  let liste = [];
  try { liste = locataires.charger().locataires || []; }
  catch (e) { liste = []; }
  REG_CACHE = { t: Date.now(),
    liste: liste.filter(x => x && (x.statut === 'actif' || x.statut === 'essai')) };
  return REG_CACHE.liste;
}

async function tic(heureForcee){
  /* une sauvegarde par jour au maximum (en mémoire, pas dans la base) */
  if (!DERNIER_BACKUP || Date.now() - DERNIER_BACKUP > 86400000){
    if (faireBackup()) journaliser({ texte:'sauvegarde quotidienne créée' });
  }

  /* le rafraîchissement des jetons, une fois par jour aussi */
  if (!DERNIER_RAFRAICHISSEMENT || Date.now() - DERNIER_RAFRAICHISSEMENT > 86400000){
    DERNIER_RAFRAICHISSEMENT = Date.now();
    try{
      const r = await require('./rafraichir-tokens.js').rafraichirTout();
      for (const x of (r.resultats || [])){
        if (x.erreur) journaliser({ canal: x.canal, texte:'jeton non rafraîchi · ' + x.erreur });
        else if (x.fait) journaliser({ canal: x.canal, texte: x.dit });
      }
    }catch(e){ /* pas de clés : rien à rafraîchir, on ne pollue pas le journal */ }
  }
  HORLOGE = heureForcee || new Date();
  const faites = await faireTourner();
  /* puis les locataires, en simulation — l'agence d'abord, jamais l'inverse */
  for (const l of locatairesActifs()){
    try { await faireTournerTenant(l); }
    catch (e) { console.error('  ! locataire ' + ((l && l.slug) || '?') + ' : ' + e.message); }
  }
  await reprendreLesEnvois();
  DB.etat.dernierTick = Date.now();
  if (faites) sauver();
  return faites;
}

/* ---------- le rattrapage : on rejoue les heures manquées ---------- */
const PAS_MAX = 24 * 7;        // 7 jours, au-delà c'est du déterrage

function heuresManquees(dernierMs){
  const ms = Date.now() - dernierMs;
  if (ms < 3600 * 1000) return 0;
  return Math.min(PAS_MAX, Math.floor(ms / 3600000));
}

function ditDuree(heures){
  if (heures < 24) return heures + ' h';
  const j = Math.floor(heures / 24), r = heures % 24;
  return j + ' j' + (r ? ' ' + r + ' h' : '');
}

async function rattraper(){
  const dernier = DB.etat.dernierTick || Date.now();
  const manquees = heuresManquees(dernier);
  if (!manquees) return { heures:0, actions:0 };

  EN_REJEU = true;
  let faites = 0;
  for (let i = 1; i <= manquees; i++){
    const h = new Date(dernier + i * 3600000);
    /* on efface l'anti-répétition : chaque heure rejouée est un moment neuf */
    Object.keys(DERNIER_PASSAGE).forEach(k => { delete DERNIER_PASSAGE[k]; });
    HORLOGE = h;
    faites += await faireTourner();
  }
  Object.keys(DERNIER_PASSAGE).forEach(k => { delete DERNIER_PASSAGE[k]; });
  EN_REJEU = false;
  HORLOGE = new Date();

  journaliser({ canal:'', rattrapage:manquees,
    texte: faites > 0
      ? 'pendant l’arrêt (' + ditDuree(manquees) + ') : ' + faites + ' action' + (faites > 1 ? 's' : '')
      : 'pendant l’arrêt (' + ditDuree(manquees) + ') : rien à faire, tout était à jour' });

  DB.etat.dernierRattrapage = { t:Date.now(), heures:manquees, faites, dit:ditDuree(manquees) };
  sauver(true);
  return { heures:manquees, actions:faites };
}

/* ==================================================================
   7. L'API HTTP
   Le serveur sert DEUX choses :
     • l'API JSON  (/api/...)
     • la landing (/ → landing.html, publique) + la plateforme (/app → app-publio.html)
   ================================================================== */

function json(res, code, obj){
  const corps = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type':'application/json; charset=utf-8',
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'content-type',
    'Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS',
    'Cache-Control':'no-store',
  });
  res.end(corps);
}

function lireCorps(req){
  return new Promise((ok, ko) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 2e6) req.destroy(); });
    req.on('end', () => { try{ ok(d ? JSON.parse(d) : {}); }catch(e){ ok({}); } });
    req.on('error', ko);
  });
}

const TYPES = { '.html':'text/html; charset=utf-8', '.css':'text/css',
  '.js':'text/javascript', '.png':'image/png', '.jpg':'image/jpeg',
  '.svg':'image/svg+xml', '.ico':'image/x-icon', '.woff2':'font/woff2',
  '.mp4':'video/mp4', '.webm':'video/webm' };

/* ==================================================================
   LA RAPIDITÉ — gzip + cache ETag/304 + Range (vidéos) + cache navigateur
   On mémorise les fichiers (version compressée incluse) entre deux mtime.
   ================================================================== */
const CACHE_FICHIERS = new Map();
function entreeFichier(cheminFs){
  const st = fs.statSync(cheminFs);                 /* cwd existe (appelant vérifie) */
  let e = CACHE_FICHIERS.get(cheminFs);
  if (e && e.mtimeMs === st.mtimeMs && e.size === st.size) return e;
  const raw = fs.readFileSync(cheminFs);
  const etag = '"' + crypto.createHash('sha1').update(raw).digest('base64url') + '"';
  e = { mtimeMs: st.mtimeMs, size: st.size, raw,
        gz: zlib.gzipSync(raw, { level: 6 }), etag };
  CACHE_FICHIERS.set(cheminFs, e);
  return e;
}
const JETABLE_E = /^(text\/|application\/(javascript|json)|image\/svg)/;
function expedierFichier(req, res, cheminFs, type){
  let e;
  try { e = entreeFichier(cheminFs); } catch(_){ res.writeHead(404); return res.end('introuvable'); }
  const enTete = { 'Content-Type': type, 'ETag': e.etag, 'Cache-Control':'no-cache', 'Vary':'Accept-Encoding' };
  if (req.headers['if-none-match'] === e.etag){ res.writeHead(304, enTete); return res.end(); }
  if (JETABLE_E.test(type) && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))){
    enTete['Content-Encoding'] = 'gzip'; enTete['Content-Length'] = e.gz.length;
    res.writeHead(200, enTete); return res.end(e.gz);
  }
  enTete['Content-Length'] = e.raw.length;
  res.writeHead(200, enTete); return res.end(e.raw);
}
function expedierBinaire(req, res, cheminFs, type){
  let e;
  try { e = entreeFichier(cheminFs); } catch(_){ res.writeHead(404); return res.end('introuvable'); }
  const taille = e.raw.length;
  const enTete = { 'Content-Type': type, 'ETag': e.etag,
    'Cache-Control':'public, max-age=2592000',          /* 30 j — mp4 / images */
    'Accept-Ranges':'bytes' };
  if (req.headers['if-none-match'] === e.etag){ res.writeHead(304, enTete); return res.end(); }
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  if (m){
    let debut = m[1] ? parseInt(m[1], 10) : Math.max(0, taille - parseInt(m[2] || '0', 10));
    let fin   = m[1] ? (m[2] ? parseInt(m[2], 10) : taille - 1) : taille - 1;
    if (isNaN(debut) || isNaN(fin) || debut > fin || debut >= taille){
      res.writeHead(416, Object.assign(enTete, { 'Content-Range':'bytes */' + taille }));
      return res.end();
    }
    fin = Math.min(fin, taille - 1);
    const tranche = e.raw.subarray(debut, fin + 1);
    enTete['Content-Range'] = 'bytes ' + debut + '-' + fin + '/' + taille;
    enTete['Content-Length'] = tranche.length;
    res.writeHead(206, enTete); return res.end(tranche);
  }
  enTete['Content-Length'] = taille;
  res.writeHead(200, enTete); return res.end(e.raw);
}
const EXT_BINAIRE = new Set(['.mp4', '.webm', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.woff2', '.ico']);
function servirFichier(req, res, chemin){
  const type = TYPES[path.extname(chemin)] || 'application/octet-stream';
  if (EXT_BINAIRE.has(path.extname(chemin))) return expedierBinaire(req, res, chemin, type);
  return expedierFichier(req, res, chemin, type);
}
/* pour les pages HTML inline (landing, /app, espaces…) : gzip mémorisé par empreinte */
const CACHE_HTML = new Map();
function envoyerHtml(req, res, page){
  const brut = Buffer.from(page);
  const etag = '"' + crypto.createHash('sha1').update(brut).digest('base64url') + '"';
  let entree = CACHE_HTML.get(etag);
  if (!entree){
    entree = { gz: zlib.gzipSync(brut, { level: 6 }) };
    CACHE_HTML.set(etag, entree);
    if (CACHE_HTML.size > 40) CACHE_HTML.delete(CACHE_HTML.keys().next().value);
  }
  const enTete = { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-cache',
                   'ETag': etag, 'Vary':'Accept-Encoding' };
  if (req.headers['if-none-match'] === etag){ res.writeHead(304, enTete); return res.end(); }
  if (/\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))){
    enTete['Content-Encoding'] = 'gzip'; enTete['Content-Length'] = entree.gz.length;
    res.writeHead(200, enTete); return res.end(entree.gz);
  }
  enTete['Content-Length'] = brut.length;
  res.writeHead(200, enTete); return res.end(page);
}
/* lecture de fichier frais, sans relire le disque à chaque requête /app */
const CACHE_FRAIS = new Map();
function lireFrais(cheminFs){
  const st = fs.statSync(cheminFs);
  let e = CACHE_FRAIS.get(cheminFs);
  if (e && e.mtimeMs === st.mtimeMs && e.size === st.size) return e.brut;
  const brut = fs.readFileSync(cheminFs);
  CACHE_FRAIS.set(cheminFs, { mtimeMs: st.mtimeMs, size: st.size, brut });
  return brut;
}

/* ---- le pont avec l'interface ----
   L'app est un fichier HTML autonome : elle marche seule, sans serveur.
   Quand le serveur est là, elle peut s'y brancher. On lui donne un
   petit script qui dit « oui, il y a un moteur ici » et qui branche
   les appels. Sans serveur, l'app continue exactement comme avant. */
const PONT = `
<script>
/* ===== PUBLIO — le pont vers le moteur =====
 Ce script n'existe QUE quand la page est servie par moteur.js.
 Il ne casse rien : si l'API ne répond pas, l'app marche comme avant. */
(function(){
if (location.protocol === 'file:') return;   // ouverte en double-clic : pas de serveur
window.PUBLIO_SERVEUR = true;
let dernier = 0;

const api = (chemin, opt) => fetch('/api' + chemin, Object.assign({
  headers:{'Content-Type':'application/json'}
}, opt)).then(r => r.json());

window.publioSync = async function(){
  try{
    const e = await api('/etat');
    window.PUBLIO_ETAT = e;
    return e;
  }catch(err){ window.PUBLIO_SERVEUR = false; return null; }
};

window.publioRegle = (r) => api('/regles', {method:'POST', body:JSON.stringify(r)});
window.publioTester = (id) => api('/tester', {method:'POST', body:JSON.stringify({regle:id})});
window.publioEvenement = (kind, canal, extra) =>
  api('/evenement', {method:'POST', body:JSON.stringify(Object.assign({kind,canal}, extra||{}))});

/* on rafraîchit l'état toutes les 5 s : l'app affiche le vrai travail
   du serveur, pas une simulation */
const battre = async function(){
  const e = await window.publioSync();
  if (e && typeof window.publioRecu === 'function') window.publioRecu(e);
  setTimeout(battre, 5000);
};
window.addEventListener('load', () => setTimeout(battre, 800));
})();
</script>
`;

function gardeProjetHtml(id, owner){
  return `<script>(function(){
    window.PUBLIO_PROJET_ACTIF=${JSON.stringify(id)};
    window.PUBLIO_COMPTE_SLUG=${JSON.stringify(owner)};
    var original=window.fetch;
    window.fetch=function(input,options){
      if(typeof input!=='string' || !input.startsWith('/api/')) return original.apply(this,arguments);
      var opt=Object.assign({},options||{}), entetes=new Headers(opt.headers||{});
      entetes.set('X-Publio-Projet',window.PUBLIO_PROJET_ACTIF); opt.headers=entetes;
      return original.call(this,input,opt).then(function(r){
        if(r.status===409) r.clone().json().then(function(d){
          if(d.code!=='projet-change' || document.getElementById('projet-change-alerte')) return;
          var n=document.createElement('div'); n.id='projet-change-alerte'; n.setAttribute('role','alert');
          n.style.cssText='position:fixed;z-index:99999;top:12px;left:50%;transform:translateX(-50%);background:#2b211b;color:#fff;padding:14px 18px;border-radius:12px;max-width:90%;font:14px sans-serif;box-shadow:0 8px 24px #0004';
          n.textContent='Le projet actif a changé dans un autre onglet. Recharge cette page avant de continuer.'; document.body.appendChild(n);
        }).catch(function(){});
        return r;
      });
    };
  })();</script>`;
}
const COULEURS_PROJET = ['sable','bleu','sauge','lavande','corail','prune'];
const PROJETS_AGENCE_INCLUS = 5;
const PRIX_PROJET_SUPPLEMENTAIRE_DA = 700;
const IMPORTS_EN_COURS = new Set();
const QUOTA_MEDIAS_OCTETS = 1024 * 1024 * 1024;
async function route(req, res){
  const u = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const chemin = u.pathname;

  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (chemin.startsWith('/api/') && chemin !== '/api/agence/projets/activer' && req.headers['x-publio-projet']){
    const contexte = clientDepuisReq(req);
    if (contexte && agenceActive(contexte) && String(req.headers['x-publio-projet']) !== String(contexte.projetId || 'principal'))
      return json(res,409,{ok:false,code:'projet-change',erreur:'Le projet actif a changé dans un autre onglet. Recharge cette page avant de continuer.'});
  }

  /* Webhook Meta public, vérifié sur les octets bruts. Il refuse encore
     les événements même valides : aucun worker d'envoi réel n'est activé. */
  if (chemin === '/webhooks/meta/instagram'){
    const token = String(process.env.PUBLIO_META_WEBHOOK_VERIFY_TOKEN || '');
    const secret = String(process.env.PUBLIO_META_APP_SECRET || '');
    if (!token || !secret) return json(res,503,{ok:false,erreur:'Webhook Meta non configuré.'});
    if (req.method === 'GET'){
      const demande=String(u.searchParams.get('hub.verify_token') || '');
      const a=Buffer.from(demande), b=Buffer.from(token);
      const challenge=u.searchParams.get('hub.challenge');
      if(u.searchParams.get('hub.mode')!=='subscribe' || !challenge || challenge.length>1024 || a.length!==b.length || !crypto.timingSafeEqual(a,b))
        return json(res,403,{ok:false,erreur:'Vérification refusée.'});
      res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}); return res.end(challenge);
    }
    if (req.method === 'POST'){
      const max=256*1024; let taille=0, blocs=[];
      if(Number(req.headers['content-length'] || 0)>max) return json(res,413,{ok:false,erreur:'Corps trop volumineux.'});
      for await (const bloc of req){ taille+=bloc.length; if(taille>max) return json(res,413,{ok:false,erreur:'Corps trop volumineux.'}); blocs.push(bloc); }
      const resultat=autoInstagram.extraireCommentaires(Buffer.concat(blocs), req.headers['x-hub-signature-256'], secret);
      if (!resultat.ok) return json(res,403,{ok:false,erreur:'Notification refusée.'});
      // Ne jamais accuser réception d'un événement que Publio ne sait pas traiter.
      return json(res,503,{ok:false,erreur:'Traitement des événements Meta en préparation.'});
    }
    return json(res,405,{ok:false,erreur:'Méthode non autorisée.'});
  }

  /* État factuel du socle, limité au projet de la session cliente. */
  if (chemin === '/api/automatisations/statut' && req.method === 'GET'){
    const l=clientDepuisReq(req);
    if(!l) return json(res,401,{ok:false,erreur:'Connexion requise.'});
    if(automatisationsBloquees(l)) return json(res,403,{ok:false,verrouille:true,erreur:VERROU_MSG});
    const racine=process.env.PUBLIO_AUTOMATISATIONS_DIR || path.join(TENANT_DOSSIER,'.automatisations');
    const file=creerFileAutomatisations(path.resolve(racine));
    const travaux=file.liste(l.proprietaireSlug || l.slug,l.projetId || 'principal');
    const compte=(etat)=>travaux.filter(x=>x.etat===etat).length;
    return json(res,200,{ok:true,meta:{verificationConfiguree:!!(process.env.PUBLIO_META_WEBHOOK_VERIFY_TOKEN && process.env.PUBLIO_META_APP_SECRET),receptionActive:false,envoisActifs:false},
      file:{enAttente:compte('en_attente'),enCours:compte('en_cours'),incertains:compte('incertain'),confirmes:compte('confirme'),refuses:compte('refuse')}});
  }

  /* ================= l'espace client ================= */

  /* la page de connexion client */
  if (chemin === '/connexion-client' && req.method === 'GET'){
    const deja = clientDepuisReq(req);
    if (deja) return envoyerHtml(req, res, '<!DOCTYPE html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=/espace"><title>Publio</title>');
    return envoyerHtml(req, res, CLIENT_PAGES.LOGIN_PAGE);
  }

  /* la connexion — identifiants vérifiés contre le registre des locataires */
  if (chemin === '/api/connexion-client' && req.method === 'POST'){
    const b = await lireCorps(req);
    const email = String(b.email || '').trim().toLowerCase();
    const mdp = String(b.mot_de_passe || '');
    const tous = locataires.charger().locataires;
    const l = tous.find(x => String(x.email || '').trim().toLowerCase() === email);
    const ok = !!(l && l.statut !== 'annule' && locataires.verifier(mdp, l.motDePasseHash));
    if (ok){
      const securise = String(req.headers['x-forwarded-proto'] || '').includes('https');
      res.setHeader('Set-Cookie', 'publio_client=' + creerJetonClient(l.slug)
        + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + DUREE_CLIENT_S + (securise ? '; Secure' : ''));
      journaliser({ action:'client', texte:'connexion client — ' + l.slug });
      sauver(true);
      return json(res, 200, { ok:true });
    }
    await new Promise((r) => setTimeout(r, 800));   // on ralentit le cassage
    return json(res, 401, { ok:false, erreur:'email ou mot de passe incorrect' });
  }

  if (chemin === '/api/deconnexion-client' && req.method === 'POST'){
    res.setHeader('Set-Cookie', ['publio_client=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0','publio_projet=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0']);
    return json(res, 200, { ok:true });
  }

  /* la page d'inscription — publique */
  if (chemin === '/inscription' && req.method === 'GET'){
    const deja = clientDepuisReq(req);
    if (deja) return envoyerHtml(req, res, '<!DOCTYPE html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=/espace"><title>Publio</title>');
    return envoyerHtml(req, res, CLIENT_PAGES.SIGNUP_PAGE);
  }

  /* l'inscription — crée un locataire en essai, connecté aussitôt */
  if (chemin === '/api/inscription' && req.method === 'POST'){
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'inconnu').split(',')[0].trim();
    if (!inscriptionAutorisee(ip))
      return json(res, 429, { ok:false, erreur:'Trop de comptes créés depuis cette connexion — réessaie dans une heure.' });
    const b = await lireCorps(req);
    const nom = String(b.nom || '').trim().slice(0, 120);
    const email = String(b.email || '').trim().toLowerCase();
    const mdp = String(b.mot_de_passe || '');
    if (!nom) return json(res, 400, { ok:false, erreur:'ton nom est requis — au moins 2 caractères' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return json(res, 400, { ok:false, erreur:'email invalide — vérifie le nom, le @ et l’extension (ex : toi@exemple.fr)' });
    if (mdp.length < 8 || !/[A-Za-zÀ-ÿ]/.test(mdp) || !/[0-9]/.test(mdp))
      return json(res, 400, { ok:false, erreur:'mot de passe : 8 caractères minimum, avec des lettres et des chiffres' });
    const reseaux = Array.isArray(b.reseaux)
      ? [...new Set(b.reseaux.map(x => String(x).trim().toLowerCase()))].slice(0, 8) : [];
    const tous = locataires.charger().locataires;
    if (tous.some(x => String(x.email || '').trim().toLowerCase() === email))
      return json(res, 409, { ok:false, erreur:'un compte existe déjà avec cet email — connecte-toi' });
    /* même nom, double clic, file d'attente : on re-tente avec un suffixe aléatoire si le slug est pris */
    const creerEnEssai = () => {
      const base = locataires.slugifier(nom);
      let r = locataires.creer({ nom, email, motDePasse: mdp, plan:'essai', montant:0,
                                 notes:'inscription publique — essai', reseaux });
      for (let i = 0; r.erreur && r.erreur.indexOf('déjà pris') !== -1 && i < 5; i++){
        const slug = (base.slice(0, 22) + '-' + crypto.randomBytes(3).toString('hex')).slice(0, 31);
        r = locataires.creer({ nom, email, motDePasse: mdp, plan:'essai', montant:0,
                               notes:'inscription publique — essai', slug, reseaux });
      }
      return r;
    };
    const r = creerEnEssai();
    if (r.erreur) return json(res, 400, { ok:false, erreur:r.erreur });
    const securise = String(req.headers['x-forwarded-proto'] || '').includes('https');
    res.setHeader('Set-Cookie', 'publio_client=' + creerJetonClient(r.locataire.slug)
      + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + DUREE_CLIENT_S + (securise ? '; Secure' : ''));
    journaliser({ action:'client', texte:'inscription — ' + r.locataire.slug });
    sauver(true);
    return json(res, 200, { ok:true });
  }

  /* l’espace client — réservé aux sessions client */
  if (chemin === '/espace' && req.method === 'GET'){
    const l = clientDepuisReq(req);
    if (!l){ res.writeHead(302, { Location:'/connexion-client' }); return res.end(); }
    let page=CLIENT_PAGES.ESPACE_PAGE;
    if (agenceActive(l)) page=page.replace('<body>', '<body>'+gardeProjetHtml(l.projetId || 'principal',l.proprietaireSlug || l.slug));
    return envoyerHtml(req, res, page);
  }
  /* Portefeuille Agence : tous les projets appartiennent au compte connecté. */
  if (chemin === '/api/agence/projets' || chemin === '/api/agence/projets/activer'){
    const owner = clientProprietaire(req);
    if (!owner) return json(res,401,{ok:false,erreur:'Connexion requise.'});
    if (!agenceActive(owner)) return json(res,403,{ok:false,erreur:'La gestion des projets est réservée au pack Agence actif.'});
    const principal = tenantBase(owner);
    if (!Array.isArray(principal.projetsAgence)) principal.projetsAgence = [];
    if (chemin === '/api/agence/projets' && req.method === 'GET'){
      const actif = clientDepuisReq(req);
      const projets = [{id:'principal',nom:principal.nomProjetPrincipal || 'Projet principal',couleur:principal.couleurProjetPrincipal,photo:principal.photoProjetPrincipal || null},...principal.projetsAgence].map((p,i)=>{
        const l = p.id === 'principal' ? owner : Object.assign({},owner,{slug:p.id});
        const db=tenantBase(l);
        return {id:p.id,nom:p.nom,couleur:COULEURS_PROJET.includes(p.couleur) ? p.couleur : COULEURS_PROJET[i % COULEURS_PROJET.length],reseaux:db.canaux.filter(c=>c && c.connecte).map(c=>c.id),brouillons:db.brouillonsComposeur.length,photo:photoProjetValide(p.photo) ? p.photo : null};
      });
      return json(res,200,{ok:true,actif:actif.projetId || 'principal',projets,limite:PROJETS_AGENCE_INCLUS,prixSupplementaire:PRIX_PROJET_SUPPLEMENTAIRE_DA,achatDisponible:false});
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') return json(res,403,{ok:false,erreur:'Requête refusée.'});
    if (chemin === '/api/agence/projets' && req.method === 'POST'){
      const b=await lireCorps(req); const nom=String(b.nom || '').trim().replace(/\s+/g,' ').slice(0,80);
      if (1 + principal.projetsAgence.length >= PROJETS_AGENCE_INCLUS) return json(res,403,{ok:false,code:'limite-projets',erreur:'Les 5 projets inclus sont utilisés. Les projets supplémentaires coûteront 700 DA/mois chacun ; leur achat en ligne est en préparation.'});
      if (nom.length < 2) return json(res,400,{ok:false,erreur:'Donne un nom au projet (2 caractères minimum).'});
      if (principal.projetsAgence.some(p=>p.nom.toLocaleLowerCase('fr')===nom.toLocaleLowerCase('fr')) || nom.toLocaleLowerCase('fr')===String(principal.nomProjetPrincipal || 'Projet principal').toLocaleLowerCase('fr'))
        return json(res,409,{ok:false,erreur:'Un projet porte déjà ce nom.'});
      let id; do { id='pr-'+crypto.randomBytes(12).toString('hex'); } while (locataires.lire(id) || fs.existsSync(path.join(TENANT_DOSSIER,id)));
      if (b.couleur !== undefined && !COULEURS_PROJET.includes(b.couleur)) return json(res,400,{ok:false,erreur:'Couleur de projet invalide.'});
      const couleur = b.couleur || COULEURS_PROJET[(principal.projetsAgence.length+1)%COULEURS_PROJET.length];
      if (b.photo !== undefined && b.photo !== null && !photoProjetValide(b.photo)) return json(res,400,{ok:false,erreur:'Photo invalide ou trop volumineuse.'});
      const p={id,nom,couleur,photo:b.photo || null,cree:new Date().toISOString()};
      const loc=Object.assign({},owner,{slug:id});
      if (!sauverTenant(loc)) return json(res,500,{ok:false,erreur:'Impossible de créer le projet.'});
      principal.projetsAgence.push(p);
      if (!sauverTenant(owner)){ principal.projetsAgence.pop(); return json(res,500,{ok:false,erreur:'Impossible de sauvegarder le projet.'}); }
      return json(res,201,{ok:true,projet:p});
    }
    if (chemin === '/api/agence/projets' && req.method === 'PUT'){
      const b=await lireCorps(req), id=String(b.id || ''), nom=String(b.nom || '').trim().replace(/\s+/g,' ').slice(0,80);
      if (nom.length < 2) return json(res,400,{ok:false,erreur:'Donne un nom au projet (2 caractères minimum).'});
      const p=id==='principal' ? null : principal.projetsAgence.find(x=>x.id===id);
      if (id!=='principal' && !p) return json(res,404,{ok:false,erreur:'Projet introuvable.'});
      const doublon=principal.projetsAgence.some(x=>x.id!==id && x.nom.toLocaleLowerCase('fr')===nom.toLocaleLowerCase('fr')) || (id!=='principal' && String(principal.nomProjetPrincipal || 'Projet principal').toLocaleLowerCase('fr')===nom.toLocaleLowerCase('fr'));
      if(doublon) return json(res,409,{ok:false,erreur:'Un projet porte déjà ce nom.'});
      if (b.couleur !== undefined && !COULEURS_PROJET.includes(b.couleur)) return json(res,400,{ok:false,erreur:'Couleur de projet invalide.'});
      const ancien=id==='principal' ? principal.nomProjetPrincipal : p.nom;
      const ancienneCouleur=id==='principal' ? principal.couleurProjetPrincipal : p.couleur;
      if (b.photo !== undefined && b.photo !== null && !photoProjetValide(b.photo)) return json(res,400,{ok:false,erreur:'Photo invalide ou trop volumineuse.'});
      const anciennePhoto=id==='principal' ? principal.photoProjetPrincipal : p.photo;
      if(id==='principal'){ principal.nomProjetPrincipal=nom; if(b.couleur !== undefined) principal.couleurProjetPrincipal=b.couleur; if(b.photo !== undefined) principal.photoProjetPrincipal=b.photo; }
      else { p.nom=nom; if(b.couleur !== undefined) p.couleur=b.couleur; if(b.photo !== undefined) p.photo=b.photo; }
      if(!sauverTenant(owner)){
        if(id==='principal'){ principal.nomProjetPrincipal=ancien; principal.couleurProjetPrincipal=ancienneCouleur; principal.photoProjetPrincipal=anciennePhoto; }
        else { p.nom=ancien; p.couleur=ancienneCouleur; p.photo=anciennePhoto; }
        return json(res,500,{ok:false,erreur:'Impossible de modifier le projet.'});
      }
      return json(res,200,{ok:true});
    }
    if (chemin === '/api/agence/projets/activer' && req.method === 'POST'){
      const b=await lireCorps(req), id=String(b.id || '');
      if (id!=='principal' && !principal.projetsAgence.some(p=>p.id===id)) return json(res,404,{ok:false,erreur:'Projet introuvable.'});
      const secure=String(req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
      res.setHeader('Set-Cookie','publio_projet='+signerProjet(owner.slug,id)+'; HttpOnly; SameSite=Lax; Path=/; Max-Age='+DUREE_CLIENT_S+secure);
      return json(res,200,{ok:true});
    }
    return json(res,405,{ok:false,erreur:'Méthode non autorisée.'});
  }
  if (chemin === '/api/moi' && req.method === 'GET'){
    const l = clientDepuisReq(req);
    if (!l) return json(res, 401, { ok:false, erreur:'connexion requise', connexion:true });
    return json(res, 200, { ok:true,
      profil: { nom: l.nom, email: l.email || null, slug: l.proprietaireSlug || l.slug,
        membreISO: l.cree ? new Date(l.cree).toISOString().slice(0, 10) : null },
      projet: agenceActive(l) ? {id:l.projetId || 'principal',nom:l.projetNom || 'Projet principal'} : null,
      abonnement: { plan: l.plan, montant: l.montant, devise: l.devise || 'EUR', statut: l.statut,
        renouvellement: l.renouvellement || null },
      quota: limitesStarter(l)
        ? { postsMois: postsMois(tenantBase(l)), max: LIMITE_POSTS_STARTER }
        : null,
    });
  }
  /* Médias et brouillons : toujours isolés par la session du client. */
  const mediaPrive = chemin.match(/^\/api\/medias\/([a-f0-9]{32})$/);
  if ((chemin === '/api/medias' || mediaPrive) && ['GET','HEAD','POST','DELETE'].includes(req.method)){
    const l = clientDepuisReq(req);
    if (!l) return json(res, 401, {ok:false, erreur:'Connexion requise.'});
    const db = tenantBase(l);
    if (mediaPrive && (req.method === 'GET' || req.method === 'HEAD')){
      const m = db.medias.find(x => x.id === mediaPrive[1]);
      if (m && require('./stockage-medias').envoyer(req,res,path.join(TENANT_DOSSIER,l.slug),m)) return;
      return json(res,404,{ok:false,erreur:'Média introuvable.'});
    }
    if (mediaPrive && req.method === 'DELETE'){
      if (ESPACE_LECTURE_SEULE(l)) return json(res,403,{ok:false,erreur:LECTURE_SEULE_MSG});
      if (req.headers['sec-fetch-site'] === 'cross-site') return json(res,403,{ok:false,erreur:'Requête refusée.'});
      const id=mediaPrive[1], i=db.medias.findIndex(x=>x.id===id);
      if (i<0) return json(res,404,{ok:false,erreur:'Média introuvable.'});
      if (db.brouillonsComposeur.some(b=>Array.isArray(b.medias) && b.medias.includes(id)) || db.posts.some(p=>JSON.stringify(p).includes(id)))
        return json(res,409,{ok:false,code:'media-utilise',erreur:'Ce média est utilisé dans une publication ou un brouillon. Retire-le d’abord de ces contenus.'});
      const f=path.join(TENANT_DOSSIER,l.slug,'medias',id), reserve=f+'.suppression-'+crypto.randomBytes(8).toString('hex');
      try { fs.renameSync(f,reserve); } catch(e) { return json(res,500,{ok:false,erreur:'Impossible de retirer le fichier. Réessaie ou contacte le support.'}); }
      const ancien=db.medias.splice(i,1)[0];
      if(!sauverTenant(l)){
        db.medias.splice(i,0,ancien);
        try { fs.renameSync(reserve,f); } catch(e) { console.error('  ! restauration média après échec de sauvegarde : '+e.message); }
        return json(res,500,{ok:false,erreur:'Suppression non enregistrée. Réessaie.'});
      }
      try { fs.unlinkSync(reserve); } catch(e) {
        db.medias.splice(i,0,ancien);
        const baseRestauree=sauverTenant(l);
        try { fs.renameSync(reserve,f); } catch(e2) { console.error('  ! restauration fichier média : '+e2.message); }
        if(!baseRestauree) console.error('  ! restauration base média impossible');
        return json(res,500,{ok:false,erreur:'Suppression incomplète. Recharge et contacte le support si nécessaire.'});
      }
      return json(res,200,{ok:true});
    }
    if (chemin === '/api/medias' && req.method === 'GET')
      return json(res,200,{ok:true,stockage:{utilise:db.medias.reduce((n,m)=>n+(Number(m.taille)||0),0),limite:QUOTA_MEDIAS_OCTETS},medias:db.medias.map(m => Object.assign({},m,{url:'/api/medias/'+m.id}))});
    if (chemin === '/api/medias' && req.method === 'POST'){
      if (ESPACE_LECTURE_SEULE(l)) return json(res,403,{ok:false,erreur:LECTURE_SEULE_MSG});
      if (req.headers['sec-fetch-site'] === 'cross-site') return json(res,403,{ok:false,erreur:'Requête refusée.'});
      const canalMedia = String(req.headers['x-publio-canal'] || '');
      if (canalMedia && !db.canaux.some(c=>c.id===canalMedia && c.connecte)) return json(res,400,{ok:false,erreur:'Ce canal n’est pas connecté dans ce projet.'});
      const longueur = Number(req.headers['content-length']);
      if (!Number.isSafeInteger(longueur) || longueur <= 0) return json(res,411,{ok:false,erreur:'Taille du fichier requise.'});
      if (IMPORTS_EN_COURS.has(l.slug)) return json(res,429,{ok:false,erreur:'Un import est déjà en cours. Attends la fin avant de réessayer.'});
      if (db.medias.reduce((n,m)=>n+(Number(m.taille)||0),0) + longueur > QUOTA_MEDIAS_OCTETS) return json(res,413,{ok:false,erreur:'Espace de stockage temporairement limité à 1 Go par projet.'});
      IMPORTS_EN_COURS.add(l.slug);
      try {
        const r = await require('./stockage-medias').recevoir(req,path.join(TENANT_DOSSIER,l.slug));
        if (!r.ok) return json(res,r.code || 500,{ok:false,erreur:r.erreur});
        r.media.canaux = canalMedia ? [canalMedia] : [];
        db.medias.unshift(r.media);
        if (!sauverTenant(l)){ db.medias.shift(); try{fs.unlinkSync(path.join(TENANT_DOSSIER,l.slug,'medias',r.media.id));}catch(_){} return json(res,500,{ok:false,erreur:'Impossible de sauvegarder le média.'}); }
        return json(res,201,{ok:true,media:Object.assign({},r.media,{url:'/api/medias/'+r.media.id})});
      } finally { IMPORTS_EN_COURS.delete(l.slug); }
    }
    return json(res,405,{ok:false,erreur:'Méthode non autorisée.'});
  }
  const brouillonPrive=chemin.match(/^\/api\/brouillons-composeur\/(b[a-f0-9]{32})$/);
  if (brouillonPrive && req.method === 'DELETE'){
    const l=clientDepuisReq(req);
    if(!l) return json(res,401,{ok:false,erreur:'Connexion requise.'});
    if(ESPACE_LECTURE_SEULE(l)) return json(res,403,{ok:false,erreur:LECTURE_SEULE_MSG});
    if(req.headers['sec-fetch-site']==='cross-site') return json(res,403,{ok:false,erreur:'Requête refusée.'});
    const db=tenantBase(l), i=db.brouillonsComposeur.findIndex(b=>b.id===brouillonPrive[1]);
    if(i<0) return json(res,404,{ok:false,erreur:'Brouillon introuvable.'});
    const ancien=db.brouillonsComposeur.splice(i,1)[0];
    if(!sauverTenant(l)){db.brouillonsComposeur.splice(i,0,ancien);return json(res,500,{ok:false,erreur:'Suppression non enregistrée.'});}
    return json(res,200,{ok:true});
  }
  if (chemin === '/api/brouillons-composeur' && (req.method === 'GET' || req.method === 'POST')){
    const l = clientDepuisReq(req);
    if (!l) return json(res,401,{ok:false,erreur:'Connexion requise.'});
    const db = tenantBase(l);
    if (req.method === 'GET') return json(res,200,{ok:true,brouillons:db.brouillonsComposeur});
    if (ESPACE_LECTURE_SEULE(l)) return json(res,403,{ok:false,erreur:LECTURE_SEULE_MSG});
    if (req.headers['sec-fetch-site'] === 'cross-site') return json(res,403,{ok:false,erreur:'Requête refusée.'});
    const b = await lireCorps(req);
    const canaux = [...new Set(Array.isArray(b.reseaux) ? b.reseaux : [])];
    const ids = Array.isArray(b.medias) ? b.medias : [];
    if (canaux.some(x => !['ig','fb','tt','li','th'].includes(x) || !db.canaux.some(c => c.id === x && c.connecte)))
      return json(res,400,{ok:false,erreur:'Choisis uniquement des réseaux connectés.'});
    if (limitesStarter(l) && canaux.length > 1) return json(res,403,{ok:false,erreur:'Starter : un seul réseau.'});
    if (ids.length > 10 || ids.some(id => typeof id !== 'string' || !db.medias.some(m => m.id === id)))
      return json(res,400,{ok:false,erreur:'Un média est introuvable ou ne t’appartient pas.'});
    if (!ids.length && !String(b.legende || '').trim()) return json(res,400,{ok:false,erreur:'Ajoute un média ou une légende.'});
    let musique = null;
    if (b.musiqueInstagram){
      const m = b.musiqueInstagram;
      if (!canaux.includes('ig') || ids.length !== 1 || !db.medias.some(x => x.id === ids[0] && x.type === 'video') || !/^\d{1,32}$/.test(String(m.id || '')))
        return json(res,400,{ok:false,erreur:'Le son Instagram est réservé à un Reel vidéo.'});
      musique = {id:String(m.id), titre:String(m.titre || '').slice(0,200), artiste:String(m.artiste || '').slice(0,120)};
    }
    const date = String(b.date || ''), heure = String(b.heure || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(heure) || !Number.isFinite(Date.parse(date+'T12:00:00Z')) || new Date(date+'T12:00:00Z').toISOString().slice(0,10) !== date)
      return json(res,400,{ok:false,erreur:'Date ou heure invalide.'});
    const id = b.id && /^b[a-f0-9]{32}$/.test(b.id) ? b.id : 'b'+crypto.randomBytes(16).toString('hex');
    const indice = db.brouillonsComposeur.findIndex(x => x.id === id);
    if (b.id && indice < 0) return json(res,404,{ok:false,erreur:'Brouillon introuvable.'});
    const ancien = indice >= 0 ? db.brouillonsComposeur[indice] : null;
    const brouillon = {id,reseaux:canaux,medias:ids.slice(),legende:String(b.legende || '').slice(0,2200),date,heure,musiqueInstagram:musique,cree:ancien ? ancien.cree : new Date().toISOString(),modifie:new Date().toISOString()};
    if (indice >= 0) db.brouillonsComposeur[indice] = brouillon; else db.brouillonsComposeur.unshift(brouillon);
    if (!sauverTenant(l)){ if (indice >= 0) db.brouillonsComposeur[indice] = ancien; else db.brouillonsComposeur.shift(); return json(res,500,{ok:false,erreur:'Impossible de sauvegarder le brouillon.'}); }
    return json(res,200,{ok:true,brouillon});
  }

  /* Catalogue Instagram associé uniquement au compte de la session cliente. */
  if (chemin === '/api/musiques/instagram' && req.method === 'GET'){
    const l = clientDepuisReq(req);
    if (!l) return json(res, 401, { ok:false, erreur:'Connexion requise.' });
    const canal = tenantBase(l).canaux.find(c => c.id === 'ig' && c.connecte);
    const cles = canal && tenantCles.lire(l.slug, 'ig');
    const resultat = await require('./musique-meta.js').rechercher(cles, u.searchParams.get('q'), u.searchParams.get('type') || 'music');
    return json(res, resultat.ok ? 200 : resultat.code === 'connexion' ? 409 : resultat.code === 'parametre' ? 400 : 502, resultat);
  }
  /* ===== les clés réseaux du client — jamais renvoyées par l'API, jamais dans la base ===== */
  if (chemin === '/api/mes-cles' && req.method === 'GET'){
    const l = clientDepuisReq(req);
    if (!l) return json(res, 401, { ok:false, erreur:'connexion requise' });
    return json(res, 200, { ok:true,
      canaux: tenantCles.liste(l.slug),
      noms: { ig:'Instagram', fb:'Facebook', tt:'TikTok', li:'LinkedIn', th:'Threads' } });
  }
  const RESEAU_ID = { ig:'instagram', fb:'facebook', tt:'tiktok', li:'linkedin', th:'threads' };
  const mMesCles = chemin.match(/^\/api\/mes-cles\/(ig|fb|tt|li|th)$/);
  if (mMesCles && req.method === 'PUT'){
    const l = clientDepuisReq(req);
    if (!l) return json(res, 401, { ok:false, erreur:'connexion requise' });
    if (ESPACE_LECTURE_SEULE(l))
      return json(res, 403, { ok:false, verrouille:true, code:'lecture-seule', erreur: LECTURE_SEULE_MSG });
    const id = mMesCles[1];
    const b = await lireCorps(req);
    const base = tenantBase(l);
    const bloque = reseauBloquePourStarter(l, base, id);
    if (bloque) return json(res, 409, { ok:false, verrouille:true, code:'limite-reseau',
      erreur: RESEAU_MSG(bloque.compte || bloque.id) });
    const swPut = switchStarterStatus(l, base, id);
    if (swPut.bloque) return json(res, 409, { ok:false, verrouille:true, code:'switch-reseau',
      erreur: SWITCH_MSG(swPut.jours) });
    const r = tenantCles.ecrire(l.slug, id, b);
    if (r.erreur) return json(res, 400, { ok:false, erreur:r.erreur });
    /* le canal devient « connecté » pour SON moteur, jamais celui de l'agence */
    const db = tenantBase(l);
    const RESEAU = { ig:'instagram', fb:'facebook', tt:'tiktok', li:'linkedin', th:'threads' };
    let canal = db.canaux.find(c => c.id === id);
    if (canal){ canal.connecte = true; if (b.compte) canal.compte = String(b.compte).slice(0, 60); }
    else db.canaux.push({ id, compte: String(b.compte || 'compte connecté').slice(0, 60),
      reseau: RESEAU[id], connecte: true });
    enregistrerSwitchStarter(l, db, id);
    journalTenant(l, 'canal « ' + id + ' » connecté (clés enregistrées)');
    sauverTenant(l);
    return json(res, 200, { ok:true });
  }
  if (mMesCles && req.method === 'DELETE'){
    const l = clientDepuisReq(req);
    if (!l) return json(res, 401, { ok:false, erreur:'connexion requise' });
    if (ESPACE_LECTURE_SEULE(l))
      return json(res, 403, { ok:false, verrouille:true, code:'lecture-seule', erreur: LECTURE_SEULE_MSG });
    const id = mMesCles[1];
    tenantCles.supprimer(l.slug, id);
    const db = tenantBase(l);
    const canal = db.canaux.find(c => c.id === id);
    if (canal && canal.connecte){ enregistrerHistoire(db, id, 'deconnecte'); }
    if (canal) canal.connecte = false;
    journalTenant(l, 'canal « ' + id + ' » déconnecté (clés supprimées)');
    sauverTenant(l);
    return json(res, 200, { ok:true });
  }
  /* ===== OAuth — « Connecter mon compte » ===== */
  const mOauth = chemin.match(/^\/api\/oauth\/(meta|tiktok|linkedin)\/(start|callback)$/);
  if (mOauth){
    const l = clientDepuisReq(req);
    const nom = mOauth[1], action = mOauth[2];
    const dest = (statut, msg) => {
      const q = new URLSearchParams({ reseaux: statut, p: nom });
      if (msg) q.set('msg', String(msg).slice(0, 300));
      res.writeHead(302, { Location: '/espace?' + q.toString() });
      return res.end();
    };
    if (!l){ res.writeHead(302, { Location: '/connexion-client' }); return res.end(); }
    const f = FOURNISSEURS[nom];
    const cfg = appPour(nom);
    if (action === 'start'){
      const depuisProjet=u.searchParams.get('projet');
      if (agenceActive(l) && depuisProjet && depuisProjet !== (l.projetId || 'principal')) return dest('err','Le projet actif a changé dans un autre onglet. Recharge la page.');
      if (!cfg) return dest('err', "cette connexion n'est pas encore activée côté Publio — réessaie plus tard");
      const cible = nom === 'meta' ? (u.searchParams.get('canal') === 'fb' ? 'fb' : 'ig') : nom === 'tiktok' ? 'tt' : 'li';
      { const db0 = tenantBase(l);
        const b0 = reseauBloquePourStarter(l, db0, cible);
        if (b0) return dest('err', RESEAU_MSG(b0.compte || b0.id));
        const swOauth = switchStarterStatus(l, db0, cible);
        if (swOauth.bloque) return dest('err', SWITCH_MSG(swOauth.jours)); }
      const etat = signerEtat(l.slug, nom, cible);
      res.writeHead(302, { Location: f.authUrl(cfg, urlRedirection(req, cfg, nom), etat) });
      return res.end();
    }
    /* le retour de la plateforme */
    const u = new URL(req.url, 'https://local');
    if (u.searchParams.get('error')) return dest('err', 'connexion annulée sur ' + f.nom + ' — réessaie quand tu veux');
    const etat = verifierEtat(u.searchParams.get('state'), nom);
    if (!etat || etat.s !== l.slug) return dest('err', 'session de connexion invalide ou expirée — recommence');
    const code = u.searchParams.get('code');
    if (!code) return dest('err', 'code manquant — recommence la connexion');
    if (!cfg) return dest('err', "app « " + nom + " » manquante côté Publio");
    let resultat;
    try { resultat = await f.echanger(cfg, urlRedirection(req, cfg, nom), code); }
    catch (e) { console.error('  ! oauth ' + nom + '/' + l.slug + ' : ' + (e && e.message)); return dest('err', e && e.message ? e.message : 'connexion refusée par ' + f.nom); }
    const db = tenantBase(l);
    const attendu = etat.c || (nom === 'meta' ? 'ig' : nom === 'tiktok' ? 'tt' : 'li');
    if (!({ meta:['ig','fb'], tiktok:['tt'], linkedin:['li'] }[nom] || []).includes(attendu)) return dest('err', 'réseau invalide');
    if (!resultat.cles || !resultat.cles[attendu]) return dest('err', attendu === 'ig' ? 'Aucun compte Instagram professionnel relié à une Page Facebook n’a été trouvé.' : 'Aucune Page Facebook accessible n’a été trouvée.');
    const arrives = [], rates = [], limites = [];
    for (const [canal, cles] of Object.entries(resultat.cles || {})){
      if (canal !== attendu) continue;
      if (!cles || !cles.access_token){ rates.push(canal); continue; }
      const bloqueCallback = reseauBloquePourStarter(l, db, canal);
      if (bloqueCallback){ limites.push(canal); continue; }
      const swCb = switchStarterStatus(l, db, canal);
      if (swCb.bloque){ limites.push(canal); continue; }
      const rc = tenantCles.ecrire(l.slug, canal, cles);
      if (rc && rc.erreur){ console.error('  ! clés ' + canal + '/' + l.slug + ' : ' + rc.erreur); rates.push(canal); continue; }
      let c2 = db.canaux.find(x => x.id === canal);
      if (c2){ c2.connecte = true; if (cles.compte) c2.compte = String(cles.compte).slice(0, 60); }
      else db.canaux.push({ id: canal, compte: String(cles.compte || 'compte connecté').slice(0, 60),
        reseau: RESEAU_ID[canal] || canal, connecte: true });
      enregistrerSwitchStarter(l, db, canal);
      journalTenant(l, 'canal « ' + canal + ' » connecté via OAuth');
      arrives.push(canal);
    }
    sauverTenant(l);
    if (limites.length)
      return dest(limites.length === Object.keys(resultat.cles || {}).length ? 'err' : 'ok',
        RESEAU_MSG(canauxConnectes(db)[0] ? (canauxConnectes(db)[0].compte || canauxConnectes(db)[0].id) : '')
        + ' Le changement de réseau est limité à un par 30 jours.'
        + (arrives.length ? ' (« ' + arrives.join(', ') + ' » connecté)' : ''));
    if (rates.length && !arrives.length)
      return dest('err', "jetons reçus mais pas enregistrés (" + rates.join(', ') + ") — réessaie ou contacte Publio");
    return dest('ok', arrives.length ? ('Compte ' + attendu.toUpperCase() + ' connecté.') : 'Aucun compte connecté.');
  }
  /* =============== fin de l'espace client =============== */

  /* ---------- le mot de passe ---------- */
  if (AUTH_ACTIVE && !ROUTES_OUVERTES.has(chemin)){
    const entete = String(req.headers.authorization || '');
    const jeton = lireCookie(req, 'publio')
      || (entete.match(/^Bearer\s+(.+)$/i) || [])[1];
    if (!jetonValide(jeton)){
      if (chemin.startsWith('/api/'))
        return json(res, 401, { ok:false, erreur:'connexion requise', connexion:true });
      res.writeHead(302, { Location:'/connexion' });
      return res.end();
    }
  }

  /* ---------- le partage d'accès : flotte vs interface ---------- */
  const sessInterface = interfaceDepuisReq(req);
  const peutFlotte = peutVoirFlotte(req);
  const FLOTTE = new Set(['/api/metriques', '/api/echecs', '/api/circuits', '/api/cles',
    '/api/plateformes', '/api/rafraichir-maintenant', '/api/locataires', '/api/clients']);
  const estReessai = /^\/api\/posts\/[\w-]+\/reessayer$/.test(chemin);
  const estCircuit = /^\/api\/circuits\/[\w-]+$/.test(chemin);
  if (FLOTTE.has(chemin) || estReessai || estCircuit){
    if (!peutFlotte) return json(res, 401, { ok:false, erreur:'réservé à l’interface admin.' });
  } else {
    const OUVERT = new Set(['/api/etat', '/api/regles', '/api/tester', '/api/evenement',
      '/api/posts', '/api/canaux', '/api/stats', '/api/bibliotheque']);
    if (OUVERT.has(chemin) || chemin.startsWith('/api/regles/')){
      if (!sessInterface && !peutFlotte)
        return json(res, 401, { ok:false, erreur:'connexion requise', connexion:true });
    }
  }

  /* ---------- l'état complet : ce que l'app télécharge ---------- */
  if (chemin === '/api/etat' && req.method === 'GET'){
    if (sessInterface && sessInterface.mode === 'client'){
      const db = tenantBase(sessInterface.locataire);
      return json(res, 200, {
        ok:true, canaux: db.canaux, regles: db.regles, posts: db.posts,
        stats: analysesAutoriseesClient(sessInterface.locataire) ? db.stats : {}, journal: db.journal.slice(0, 60), etat: db.etat,
        verrou: { automatisations: automatisationsBloquees(sessInterface.locataire) },
        limite: { postsMois: postsMois(db), max: limitesStarter(sessInterface.locataire) ? LIMITE_POSTS_STARTER : null },
        rattrapage: null,
        serveur: { vivant:true, version:2, pid:process.pid, horloge:new Date().toISOString() },
      });
    }
    return json(res, 200, {
      ok:true,
      canaux: DB.canaux,
      regles: DB.regles,
      posts: DB.posts,
      stats: DB.stats,
      journal: DB.journal.slice(0, 60),
      etat: DB.etat,
      rattrapage: DB.etat.dernierRattrapage || null,
      serveur: { vivant:true, depuis: DB.cree, version:DB.version,
                 pid:process.pid, horloge:new Date().toISOString() },
    });
  }

  if (chemin === '/api/sante' && req.method === 'GET'){
    return json(res, 200, { ok:true, vivant:true, pid:process.pid,
      demarrages:DB.etat.demarrages, actions:DB.etat.actions,
      dernierTick:DB.etat.dernierTick, regles:DB.regles.length });
  }

  /* ---------- la connexion ---------- */
  if (chemin === '/api/connexion' && req.method === 'POST'){
    const b = await lireCorps(req);
    if (motDePasseValide(b.mot_de_passe)){
      const securise = String(req.headers['x-forwarded-proto'] || '').includes('https');
      res.setHeader('Set-Cookie', 'publio=' + creerJeton()
        + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + JETON_DUREE_S + (securise ? '; Secure' : ''));
      return json(res, 200, { ok:true });
    }
    await new Promise((r) => setTimeout(r, 800));   // on ralentit le cassage
    return json(res, 401, { ok:false, erreur:'mot de passe incorrect' });
  }

  if (chemin === '/api/deconnexion' && req.method === 'POST'){
    res.setHeader('Set-Cookie', [
      'publio=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
      'publio_client=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
      'publio_projet=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
    ]);
    return json(res, 200, { ok:true });
  }

  if (chemin === '/connexion' && req.method === 'GET'){
    if (!AUTH_ACTIVE){ res.writeHead(302, { Location:'/app' }); return res.end(); }
    return envoyerHtml(req, res, CONNEXION_PAGE);
  }

  /* ---------- les métriques (une page pour l'admin) ---------- */
  if (chemin === '/api/metriques' && req.method === 'GET'){
    const memoire = process.memoryUsage();
    const postsParEtat = {};
    for (const p of DB.posts){ const e = p.etat || 'inconnu'; postsParEtat[e] = (postsParEtat[e] || 0) + 1; }
    const circuits = lireCircuits();
    const canauxAuRepos = Object.entries(circuits)
      .filter(([, c]) => c && c.ouvertJusqua && Date.now() < c.ouvertJusqua)
      .map(([canal]) => canal);

    /* le graphique : les actions (lignes avec "action") comptées jour par jour */
    const debutJour = new Date(); debutJour.setHours(0, 0, 0, 0); debutJour.setDate(debutJour.getDate() - 13);
    const compte = {};
    try{
      for (const ligne of fs.readFileSync(FICHIER_JOURNAL, 'utf8').split('\n')){
        if (!ligne.trim()) continue;
        try{
          const j = JSON.parse(ligne);
          if (!j.action) continue;                  // rattrapage, sauvegarde, test : hors graphique
          const d = new Date(j.t);
          if (d >= debutJour){
            const cle = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            compte[cle] = (compte[cle] || 0) + 1;
          }
        }catch(e){ /* ligne corrompue : on l'ignore */ }
      }
    }catch(e){ /* pas de journal : 14 jours à zéro */ }
    const actionsParJour = [];
    for (let i = 0; i < 14; i++){
      const d = new Date(debutJour); d.setDate(d.getDate() + i);
      const cle = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      actionsParJour.push({ jour: cle, label: d.getDate() + '/' + (d.getMonth() + 1), n: compte[cle] || 0 });
    }

    return json(res, 200, {
      ok:true,
      vivant:true,
      uptime_s: Math.round(process.uptime()),
      pid: process.pid,
      demarrages: DB.etat.demarrages,
      actions: DB.etat.actions,
      dernierTick: DB.etat.dernierTick,
      memoire_mb: Math.round(memoire.rss / 1024 / 1024),
      posts: postsParEtat,
      posts_total: DB.posts.length,
      regles: DB.regles.length,
      canaux_au_repos: canauxAuRepos,
      actions_par_jour: actionsParJour,
      auth_active: AUTH_ACTIVE, admin_barriere: ADMIN_AUTH,
    });
  }


  /* ---------- les clients — le back-office SaaS ---------- */
  if (chemin === '/api/clients' && req.method === 'GET'){
    const liste = DB.clients.slice().sort((a, b) => (b.cree || 0) - (a.cree || 0));
    return json(res, 200, { ok:true, clients:liste, resume:resumeClients() });
  }
  if (chemin === '/api/clients' && req.method === 'POST'){
    const r = await lireCorps(req);
    const c = { id:nouvClientId(), nom:'', email:'', entreprise:'', plan:'starter',
      statut:'essai', montant:0, debut:new Date().toISOString().slice(0, 10),
      renouvellement:'', notes:'', cree:Date.now() };
    const err = nettoyerClient(c, r, false);
    if (err) return json(res, 400, { ok:false, erreur:err });
    DB.clients.push(c);
    journaliser({ action:'client', texte:'client ajouté — ' + c.nom + ' · ' + c.plan });
    sauver(true);
    return json(res, 200, { ok:true, client:c });
  }
  const mClient = chemin.match(/^\/api\/clients\/([\w-]+)$/);
  if (mClient && req.method === 'PUT'){
    const c = DB.clients.find(x => x.id === mClient[1]);
    if (!c) return json(res, 404, { ok:false, erreur:'compte inconnu — il a peut-être été mis en corbeille ; recharge la page.' });
    const r = await lireCorps(req);
    const err = nettoyerClient(c, r, true);
    if (err) return json(res, 400, { ok:false, erreur:err });
    journaliser({ action:'client', texte:'client modifié — ' + c.nom });
    sauver(true);
    return json(res, 200, { ok:true, client:c });
  }
  if (mClient && req.method === 'DELETE'){
    const i = DB.clients.findIndex(x => x.id === mClient[1]);
    if (i < 0) return json(res, 404, { ok:false, erreur:'compte inconnu — il a peut-être été mis en corbeille ; recharge la page.' });
    const c = DB.clients.splice(i, 1)[0];
    journaliser({ action:'client', texte:'client supprimé — ' + c.nom });
    sauver(true);
    return json(res, 200, { ok:true });
  }

  /* ---------- la flotte — les locataires (SaaS) ---------- */
  if (chemin === '/api/locataires' && req.method === 'GET'){
    return json(res, 200, { ok:true, locataires: locataires.listeAvecSante(), resume: locataires.resume() });
  }
  if (chemin === '/api/locataires' && req.method === 'POST'){
    const r = await lireCorps(req);
    const reponse = locataires.creer(r);
    if (reponse.erreur) return json(res, 400, { ok:false, erreur: reponse.erreur });
    journaliser({ action:'locataire', texte:'locataire créé — ' + reponse.locataire.slug });
    sauver(true);
    return json(res, 200, { ok:true, locataire: reponse.locataire, motDePasseInitial: reponse.motDePasseInitial });
  }
  const mLoc = chemin.match(/^\/api\/locataires\/([\w-]+)$/);
  if (mLoc && req.method === 'PUT'){
    const r = await lireCorps(req);
    const reponse = locataires.maj(mLoc[1], r);
    if (reponse.erreur) return json(res, 404, { ok:false, erreur: reponse.erreur });
    journaliser({ action:'locataire', texte:'locataire modifié — ' + reponse.locataire.slug });
    return json(res, 200, { ok:true, locataire: reponse.locataire });
  }
  if (mLoc && req.method === 'DELETE'){
    const reponse = locataires.supprimer(mLoc[1]);
    if (reponse.erreur) return json(res, 404, { ok:false, erreur: reponse.erreur });
    journaliser({ action:'locataire', texte:'locataire mis en corbeille — ' + reponse.slug });
    return json(res, 200, { ok:true });
  }

  /* ---------- la supervision des plateformes ---------- */
  if (chemin === '/api/plateformes' && req.method === 'GET'){
    let cles = null;
    try { cles = JSON.parse(fs.readFileSync(process.env.PUBLIO_CLES || path.join(DOSSIER, '.cles.json'), 'utf8')); } catch(e){}
    const tous = lireCircuits();
    const pub = {};
    for (const p of DB.posts){ if (p.etat === 'publie') pub[p.canal] = (pub[p.canal] || 0) + 1; }
    return json(res, 200, DB.canaux.map(c => {
      const k = (cles && cles[c.id]) || null;
      const exp = k && k.token_expire ? Date.parse(k.token_expire) : NaN;
      const x = tous[c.id] || {};
      const repos = !!(x.ouvertJusqua && Date.now() < x.ouvertJusqua);
      return {
        canal:c.id, compte:c.compte, reseau:c.reseau || null,
        aDesCles: !!publication.clesDe(c.id),
        token_expire: (k && k.token_expire) || null,
        jours_avant_expiration: isFinite(exp) ? Math.floor((exp - Date.now()) / 86400000) : null,
        echecs: x.echecs || 0, repose: repos,
        reposJusqua: repos ? new Date(x.ouvertJusqua).toISOString() : null,
        publies: pub[c.id] || 0,
        rafraichi: DERNIER_RAFRAICHISSEMENT > 0 ? new Date(DERNIER_RAFRAICHISSEMENT).toISOString() : null,
      };
    }));
  }
  if (chemin === '/api/rafraichir-maintenant' && req.method === 'POST'){
    try{
      const r = await require('./rafraichir-tokens.js').rafraichirTout();
      DERNIER_RAFRAICHISSEMENT = Date.now();
      const n = ((r && r.resultats) || []).filter(x => x.fait).length;
      journaliser({ action:'rafraichissement', texte:'rafraîchissement manuel — ' + n + ' jeton(s) renouvelé(s)' });
      sauver(true);
      return json(res, 200, Object.assign({ ok:true }, r));
    }catch(e){ return json(res, 200, { ok:false, erreur:String((e && e.message) || e) }); }
  }

  /* ---------- la page d'administration — double entrée ---------- */
  if (chemin === '/connexion-admin' && req.method === 'GET'){
    if (ADMIN_AUTH && sessionAdmin(req)){ res.writeHead(302, { Location:'/admin' }); return res.end(); }
    return envoyerHtml(req, res, ADMIN_CONNEXION_PAGE.replace('window.__ADMIN_CONFIGURED = true;', 'window.__ADMIN_CONFIGURED = ' + String(ADMIN_AUTH) + ';'));
  }
  if (chemin === '/api/connexion-admin-etape1' && req.method === 'POST'){
    const b = await lireCorps(req);
    if (ADMIN_AUTH && mdpEgal(b.mot_de_passe, ADMIN_PASSES[0])){
      const securise = String(req.headers['x-forwarded-proto'] || '').includes('https');
      res.setHeader('Set-Cookie', 'publio_admin_etape1=' + creerJetonAdmin('etape1', DUREE_ADMIN_ETAPE_MS)
        + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=300' + (securise ? '; Secure' : ''));
      return json(res, 200, { ok:true });
    }
    await new Promise((r) => setTimeout(r, 800));
    return json(res, 401, { ok:false, erreur:'premier mot de passe incorrect' });
  }
  if (chemin === '/api/connexion-admin' && req.method === 'POST'){
    if (!etapeAdminPassed(req)) return json(res, 401, { ok:false, erreur:'première étape manquante — recommence depuis le début.' });
    const b = await lireCorps(req);
    if (ADMIN_AUTH && mdpEgal(b.mot_de_passe, ADMIN_PASSES[1])){
      const securise = String(req.headers['x-forwarded-proto'] || '').includes('https');
      res.setHeader('Set-Cookie', [
        'publio_admin_etape1=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
        'publio_admin=' + creerJetonAdmin('session', DUREE_ADMIN_SESSION_S * 1000)
          + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + DUREE_ADMIN_SESSION_S + (securise ? '; Secure' : ''),
      ]);
      return json(res, 200, { ok:true });
    }
    await new Promise((r) => setTimeout(r, 800));
    return json(res, 401, { ok:false, erreur:'deuxième mot de passe incorrect' });
  }
  if (chemin === '/api/deconnexion-admin' && req.method === 'POST'){
    res.setHeader('Set-Cookie', [
      'publio=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
      'publio_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
      'publio_admin_etape1=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
    ]);
    return json(res, 200, { ok:true });
  }
  if (chemin === '/admin' && req.method === 'GET'){
    if (!ADMIN_AUTH){
      return envoyerHtml(req, res, ADMIN_NON_CONFIGURE);
    }
    if (!sessionAdmin(req)){ res.writeHead(302, { Location:'/connexion-admin' }); return res.end(); }
    return envoyerHtml(req, res, ADMIN_PAGE);
  }

  /* ---------- les règles ---------- */
  if (chemin === '/api/regles' && req.method === 'GET') return json(res, 200, sessInterface && sessInterface.mode === 'client' ? tenantBase(sessInterface.locataire).regles : DB.regles);

  if (chemin === '/api/regles' && req.method === 'POST'){
    if (sessInterface && sessInterface.mode === 'client'){
      if (ESPACE_LECTURE_SEULE(sessInterface.locataire))
        return json(res, 403, { ok:false, verrouille:true, code:'lecture-seule', erreur: LECTURE_SEULE_MSG });
      if (automatisationsBloquees(sessInterface.locataire))
        return json(res, 403, { ok:false, verrouille:true, erreur: VERROU_MSG });
      const r0 = await lireCorps(req);
      if (!r0 || !r0.declencheur || !r0.action)
        return json(res, 400, { ok:false, erreur:'déclencheur ou action manquant' });
      const erreurMulti = verifierBrouillonMulti(r0);
      if (erreurMulti) return json(res,400,{ok:false,erreur:erreurMulti});
      const db = tenantBase(sessInterface.locataire);
      const canalRegle = String(r0.canaux || '');
      if (!canalRegle || !db.canaux.some(c=>c.id===canalRegle && c.connecte)) return json(res,400,{ok:false,erreur:'Choisis un canal connecté à ce projet.'});
      const regle = { id:'r' + crypto.randomBytes(16).toString('hex'), nom: String(r0.nom || 'Ma règle').slice(0, 80),
        actif: r0.actif !== false, canaux: canalRegle,
        declencheur: String(r0.declencheur).slice(0,80), action: String(r0.action).slice(0,80),
        p: (r0.p && typeof r0.p === 'object' && !Array.isArray(r0.p)) ? r0.p : {}, cree: new Date().toISOString() };
      db.regles.push(regle);
      if (!sauverTenant(sessInterface.locataire)){ db.regles.pop(); return json(res,500,{ok:false,erreur:'Impossible de sauvegarder la règle.'}); }
      journalTenant(sessInterface.locataire, 'règle « ' + regle.nom + ' » créée', { canal: regle.canaux });
      return json(res, 201, { ok:true, regle });
    }
    const r = await lireCorps(req);
    const err = regleValide(r);
    if (err) return json(res, 400, { ok:false, erreur:err });

    const regle = {
      id:'r' + Date.now(),
      nom: r.nom || 'Ma règle',
      actif: r.actif !== false,
      canaux: r.canaux,
      declencheur: r.declencheur,
      action: r.action,
      p: r.p || {},
      cree: new Date().toISOString(),
    };
    DB.regles.push(regle);
    sauver(true);
    return json(res, 201, { ok:true, regle });
  }

  const mRegle = chemin.match(/^\/api\/regles\/([\w-]+)$/);
  if (mRegle){
    if (sessInterface && sessInterface.mode === 'client'){
      if (ESPACE_LECTURE_SEULE(sessInterface.locataire))
        return json(res, 403, { ok:false, verrouille:true, code:'lecture-seule', erreur: LECTURE_SEULE_MSG });
      if (automatisationsBloquees(sessInterface.locataire))
        return json(res, 403, { ok:false, verrouille:true, erreur: VERROU_MSG });
      const db = tenantBase(sessInterface.locataire);
      const r = db.regles.find(x => x.id === mRegle[1]);
      if (!r) return json(res, 404, { ok:false, erreur:'règle inconnue — elle a peut-être été supprimée ; recharge la page.' });
      if (req.method === 'PUT'){
        const maj = await lireCorps(req);
        const nouveauCanal = maj.canaux === undefined ? r.canaux : String(maj.canaux || '');
        if (!nouveauCanal || !db.canaux.some(c=>c.id===nouveauCanal && c.connecte)) return json(res,400,{ok:false,erreur:'Choisis un canal connecté à ce projet.'});
        if ((maj.declencheur !== undefined && !String(maj.declencheur).trim()) || (maj.action !== undefined && !String(maj.action).trim())) return json(res,400,{ok:false,erreur:'Déclencheur et action requis.'});
        const erreurMulti = verifierBrouillonMulti(Object.assign({},r,maj),r);
        if (erreurMulti) return json(res,400,{ok:false,erreur:erreurMulti});
        const ancien = Object.assign({},r);
        if (maj.nom !== undefined) r.nom = String(maj.nom).slice(0, 80);
        if (maj.actif !== undefined) r.actif = !!maj.actif;
        if (maj.canaux !== undefined) r.canaux = nouveauCanal;
        if (maj.declencheur !== undefined) r.declencheur = String(maj.declencheur).slice(0,80);
        if (maj.action !== undefined) r.action = String(maj.action).slice(0,80);
        if (maj.p && typeof maj.p === 'object' && !Array.isArray(maj.p)) r.p = maj.p;
        if (!sauverTenant(sessInterface.locataire)){ Object.assign(r,ancien); return json(res,500,{ok:false,erreur:'Impossible de sauvegarder la règle.'}); }
        return json(res, 200, { ok:true, regle:r });
      }
      if (req.method === 'DELETE'){
        const ancien = db.regles;
        db.regles = db.regles.filter(x => x.id !== r.id);
        if (!sauverTenant(sessInterface.locataire)){ db.regles = ancien; return json(res,500,{ok:false,erreur:'Impossible de supprimer la règle.'}); }
        journalTenant(sessInterface.locataire, 'règle « ' + (r.nom || r.declencheur) + ' » supprimée');
        return json(res, 200, { ok:true });
      }
      return json(res, 405, { ok:false, erreur:'méthode non gérée sur cette route.' });
    }
    const r = DB.regles.find(x => x.id === mRegle[1]);
    if (!r) return json(res, 404, { ok:false, erreur:'règle inconnue — elle a peut-être été supprimée ; recharge la page.' });

    if (req.method === 'PUT'){
      const maj = await lireCorps(req);
      const fusion = Object.assign({}, r, maj);
      const err = verifierBrouillonMulti(fusion,r) || regleValide(fusion);
      if (err) return json(res, 400, { ok:false, erreur:err });
      Object.assign(r, maj);
      delete r._dernier;
      sauver(true);
      return json(res, 200, { ok:true, regle:r });
    }
    if (req.method === 'DELETE'){
      DB.regles = DB.regles.filter(x => x.id !== r.id);
      sauver(true);
      return json(res, 200, { ok:true });
    }
    return json(res, 200, r);
  }

  /* ---------- les posts ---------- */
  if (chemin === '/api/posts' && req.method === 'POST'){
    if (sessInterface && sessInterface.mode === 'client'){
      if (ESPACE_LECTURE_SEULE(sessInterface.locataire))
        return json(res, 403, { ok:false, verrouille:true, code:'lecture-seule', erreur: LECTURE_SEULE_MSG });
      const b = await lireCorps(req);
      const db = tenantBase(sessInterface.locataire);
      const brouillon = !!b.brouillon || b.etat === 'brouillon';
      if (!brouillon && limitePostsAtteinte(sessInterface.locataire, db))
        return json(res, 403, { ok:false, verrouille:true, code:'limite-posts',
          erreur: 'Ton pack Starter publie 10 posts par mois — tu as atteint ta limite. Passe sur Pro pour publier sans limite.' });
      const post = { id:'p' + Date.now(), canal: String(b.canal || ''),
        titre: String(b.titre || 'Sans titre').slice(0, 120),
        legende: String(b.legende || '').slice(0, 2200),
        jour: b.jour || new Date().getDate(), heure: b.heure || '09:00',
        etat: b.etat || (b.brouillon ? 'brouillon' : 'prog'), brouillon: !!b.brouillon,
        media: Array.isArray(b.media) ? b.media.slice(0, 10) : [],
        type: b.type || 'texte', cree: new Date().toISOString() };
      db.posts.push(post);
      journalTenant(sessInterface.locataire, 'nouveau post « ' + post.titre + ' »', { canal: post.canal });
      sauverTenant(sessInterface.locataire);
      return json(res, 201, { ok:true, post });
    }
    const b = await lireCorps(req);
    const post = {
      id:'p' + Date.now(),
      canal: b.canal || 'ig',
      titre: b.titre || 'Sans titre',
      legende: b.legende || '',
      jour: b.jour || new Date().getDate(),
      heure: b.heure || '09:00',
      etat: b.etat || (b.brouillon ? 'brouillon' : 'prog'),
      brouillon: !!b.brouillon,
      media: b.media || [],
      type: b.type || 'texte',
      cree: new Date().toISOString(),
    };
    DB.posts.push(post);
    sauver(true);
    journaliser({ canal:post.canal, texte:'nouveau post « ' + post.titre + ' »' });
    return json(res, 201, { ok:true, post });
  }

  /* ---------- les canaux ---------- */
  if (chemin === '/api/canaux' && req.method === 'PUT'){
    if (sessInterface && sessInterface.mode === 'client'){
      if (ESPACE_LECTURE_SEULE(sessInterface.locataire))
        return json(res, 403, { ok:false, verrouille:true, code:'lecture-seule', erreur: LECTURE_SEULE_MSG });
      const b = await lireCorps(req);
      const db = tenantBase(sessInterface.locataire);
      if (Array.isArray(b.canaux)){
        const connexes = b.canaux.filter(c => c && c.connecte).length;
        if (limitesStarter(sessInterface.locataire) && connexes > 1)
          return json(res, 409, { ok:false, verrouille:true, code:'limite-reseau',
            erreur: 'Starter : un seul réseau connecté. Déconnecte-en un pour garder celui-ci.' });
        db.canaux = b.canaux.slice(0, 20);
      }
      sauverTenant(sessInterface.locataire);
      return json(res, 200, { ok:true, canaux: db.canaux });
    }
    const b = await lireCorps(req);
    if (Array.isArray(b.canaux)){
      DB.canaux = b.canaux;
      sauver(true);
    }
    return json(res, 200, { ok:true, canaux:DB.canaux });
  }

  /* ---------- lancer un événement à la main (le simulateur) ---------- */
  if (chemin === '/api/evenement' && req.method === 'POST'){
    if (sessInterface && sessInterface.mode === 'client'){
      if (ESPACE_LECTURE_SEULE(sessInterface.locataire))
        return json(res, 403, { ok:false, verrouille:true, code:'lecture-seule', dit: LECTURE_SEULE_MSG });
      if (automatisationsBloquees(sessInterface.locataire))
        return json(res, 403, { ok:false, verrouille:true, dit: VERROU_MSG });
      const b = await lireCorps(req);
      const db = tenantBase(sessInterface.locataire);
      const genres = {
        commentaire:['commentaire','mot-cle','commentaire-li','commentaire-fb'],
        dm:['dm','message-fb'], mention:['mention'], negatif:['avis-negatif','avis-fb'],
        abonne:['nouvel-abonne','abonnes-seuil'], vue:['perf','reel-vues','thread-viral'],
      };
      const voulus = genres[b.kind] || [b.kind];
      const r = db.regles.find(x => voulus.includes(x.declencheur));
      if (!r) return json(res, 200, { ok:false, dit:'Aucune règle « ' + b.kind + ' » sur ce canal.' });
      return json(res, 200, { ok:false, dit:'Ta règle « ' + (r.nom || r.declencheur) + ' » est enregistrée — elle s’exécutera au prochain battement du moteur.', regle: r.id });
    }
    const b = await lireCorps(req);
    const canal = b.canal || 'ig';
    const regles = reglesDuCanal(canal);
    const genres = {
      commentaire:['commentaire','mot-cle','commentaire-li','commentaire-fb'],
      dm:['dm','message-fb'],
      mention:['mention'],
      negatif:['avis-negatif','avis-fb'],
      abonne:['nouvel-abonne','abonnes-seuil'],
      vue:['perf','reel-vues','thread-viral'],
    };
    const voulus = genres[b.kind] || [b.kind];
    const r = regles.find(x => voulus.includes(x.declencheur));
    if (!r) return json(res, 200, { ok:false, dit:'Aucune règle « ' + b.kind + ' » sur ce canal.' });

    /* on simule aussi la cause : une vue de plus, un abonné de plus */
    const st = statsDe(canal);
    if (b.kind === 'vue') st.vues += (b.n || 2400);
    if (b.kind === 'abonne') st.abon++;

    const action = await executer(r.declencheur, r.action, r.p, canal,
      { conversation: b.conversation || null });
    if (action.fait){
      DB.etat.actions++;
      journaliser({ canal, regleId:r.id, decl:r.declencheur, action:r.action, texte:action.dit });
    }
    sauver(true);
    return json(res, 200, { ok:action.fait, dit:action.dit, regle:r.id });
  }

  /* ---------- tester une règle tout de suite ---------- */
  if (chemin === '/api/tester' && req.method === 'POST'){
    if (sessInterface && sessInterface.mode === 'client'){
      if (ESPACE_LECTURE_SEULE(sessInterface.locataire))
        return json(res, 403, { ok:false, verrouille:true, code:'lecture-seule', dit: LECTURE_SEULE_MSG });
      if (automatisationsBloquees(sessInterface.locataire))
        return json(res, 403, { ok:false, verrouille:true, dit: VERROU_MSG });
      const b = await lireCorps(req);
      const db = tenantBase(sessInterface.locataire);
      const r = db.regles.find(x => x.id === b.regle);
      if (!r) return json(res, 404, { ok:false, dit:'règle inconnue — elle a peut-être été supprimée ; recharge la page.' });
      return json(res, 200, { ok:false, dit:'Ta règle « ' + (r.nom || r.declencheur) + ' » est bien enregistrée — le test branché sur le moteur arrive avec la mise en route des canaux.' });
    }
    const b = await lireCorps(req);
    const r = DB.regles.find(x => x.id === b.regle);
    if (!r) return json(res, 404, { ok:false, dit:'règle inconnue — elle a peut-être été supprimée ; recharge la page.' });
    const peut = laReglePeutAgir(r, r.canaux);
    const action = await executer(r.declencheur, r.action, r.p, r.canaux,
      { post:peut.post || prochainPostDuCanal(r.canaux) });
    if (action.fait){
      DB.etat.actions++;
      journaliser({ canal:r.canaux, regleId:r.id, decl:r.declencheur, action:r.action,
        texte:'test · ' + action.dit });
    }
    sauver(true);
    return json(res, 200, { ok:action.fait, dit:action.dit });
  }

  /* ---------- les envois en difficulté ---------- */
  if (chemin === '/api/echecs' && req.method === 'GET'){
    const enDifficulte = DB.posts
      .filter(p => p.etat === 'echoue' || p.etat === 'retente')
      .map(p => ({
        id:p.id, canal:p.canal, titre:p.titre,
        etat:p.etat, essais:p.essais || 0,
        erreur:p.derniereErreur || null,
        conseil:p.conseil || null,
        code:p.codeErreur || null,
        prochainEssai:p.prochainEssai || null,
        dernierEssai:p.dernierEssai || null,
      }));
    return json(res, 200, { ok:true, total:enDifficulte.length, posts:enDifficulte });
  }

  /* ---------- relancer un envoi à la main ---------- */
  const mReprise = chemin.match(/^\/api\/posts\/([\w-]+)\/reessayer$/);
  if (mReprise && req.method === 'POST'){
    const post = DB.posts.find(p => p.id === mReprise[1]);
    if (!post) return json(res, 404, { ok:false, erreur:'post inconnu — il a peut-être été supprimé ; recharge la page.' });

    const canalInfo = DB.canaux.find(c => c.id === post.canal);
    /* on remet le compteur à zéro : une relance manuelle est un nouveau départ */
    delete post.essais;
    post.etat = 'prog';
    post.prochainEssai = new Date().toISOString();

    const r = await envoyer(post, post.canal, canalInfo ? canalInfo.compte : post.canal);
    if (r.fait) DB.etat.actions++;
    journaliser({ canal:post.canal,
      texte:'relance manuelle · ' + r.dit });
    sauver(true);
    return json(res, 200, { ok:r.fait, dit:r.dit, post });
  }

  /* ---------- l'état des disjoncteurs ---------- */
  if (chemin === '/api/circuits' && req.method === 'GET'){
    const tous = lireCircuits();
    return json(res, 200, DB.canaux.map(c => {
      const x = tous[c.id] || {};
      const enPanne = x.ouvertJusqua && Date.now() < x.ouvertJusqua;
      return {
        canal:c.id, compte:c.compte,
        echecs:x.echecs || 0,
        repose: !!enPanne,
        reposJusqua: enPanne ? new Date(x.ouvertJusqua).toISOString() : null,
      };
    }));
  }

  /* ---------- remettre un canal en service à la main ---------- */
  const mCircuit = chemin.match(/^\/api\/circuits\/([\w-]+)$/);
  if (mCircuit && req.method === 'DELETE'){
    const tous = lireCircuits();
    delete tous[mCircuit[1]];
    ecrireCircuits(tous);
    journaliser({ canal:mCircuit[1], texte:'disjoncteur remis en service à la main' });
    return json(res, 200, { ok:true });
  }

  /* ---------- quels comptes ont des clés ? ---------- */
  if (chemin === '/api/cles' && req.method === 'GET'){
    return json(res, 200, DB.canaux.map(c => ({
      canal:c.id, compte:c.compte,
      aDesCles: !!publication.clesDe(c.id),
    })));
  }

  /* ---------- les statistiques ---------- */
  if (chemin === '/api/stats' && req.method === 'GET'){
    if (sessInterface && sessInterface.mode === 'client'){
      if (!analysesAutoriseesClient(sessInterface.locataire)) return json(res, 403, { ok:false, erreur:'Statistiques réservées au pack Agence.', verrouille:true });
      return json(res, 200, tenantBase(sessInterface.locataire).stats);
    }
    return json(res, 200, DB.stats);
  }

  /* ---------- la bibliothèque du constructeur (pour l'app) ---------- */
  if (chemin === '/api/bibliotheque' && req.method === 'GET'){
    return json(res, 200, {
      declencheurs: DECLENCHEURS,
      actions: ACTIONS,
      peut: PEUT,
    });
  }

  /* Pages éditoriales publiques : chemins strictement limités, pas d'accès générique aux fichiers. */
  const PAGES_PUBLIQUES = { '/produit':'produit.html', '/demarrer':'demarrer.html', '/packs':'packs.html', '/faq':'faq.html' };
  if ((req.method === 'GET' || req.method === 'HEAD') && Object.prototype.hasOwnProperty.call(PAGES_PUBLIQUES, chemin)){
    const page = path.join(DOSSIER, 'pages-publiques', PAGES_PUBLIQUES[chemin]);
    if (fs.existsSync(page)) return envoyerHtml(req, res, lireFrais(page).toString('utf8'));
    return json(res, 404, { ok:false, erreur:'Page indisponible.' });
  }

  /* ---------- la landing (publique) — puis /app : la plateforme ---------- */
  if (chemin === '/' || chemin === '/index.html'){
    const f = path.join(DOSSIER, 'landing.html');
    if (fs.existsSync(f)){
      return envoyerHtml(req, res, lireFrais(f).toString('utf8'));
    }
    res.writeHead(302, { Location:'/app' });
    return res.end();
  }
  if (chemin === '/app' || chemin === '/app-publio.html'){
    if (!sessInterface && !peutFlotte){ res.writeHead(302, { Location:'/connexion-client' }); return res.end(); }
    const app = path.join(DOSSIER, 'app-publio.html');
    if (fs.existsSync(app)){
      /* on glisse le pont juste avant </body> — le HTML vient du cache frais, pas du disque */
      let page = lireFrais(app).toString('utf8');
      if (sessInterface && sessInterface.mode === 'client'){
        const l = sessInterface.locataire;
        page = page.replace('<body>', '<body><script>window.PUBLIO_SESSION_CLIENT=true;</script>'+(agenceActive(l) ? gardeProjetHtml(l.projetId || 'principal',l.proprietaireSlug || l.slug) : ''));
      }
      page = page.replace(/<\/body>/i, PONT + '</body>');
      return envoyerHtml(req, res, page);
    }
    return json(res, 200, { ok:true, message:'Publio tourne. Interface absente.' });
  }
  /* la vraie plateforme, verrouillée par pack — aucun écran réécrit, juste les verrous */
  const mApercu = chemin.match(/^\/apercu-pack\/(starter|pro|agence)$/);
  if (mApercu && req.method === 'GET'){
    if (!sessInterface && !peutFlotte){ res.writeHead(302, { Location:'/connexion-client' }); return res.end(); }
    const app = path.join(DOSSIER, 'app-publio.html');
    if (fs.existsSync(app)){
      let page = lireFrais(app).toString('utf8');
      page = page.replace('<body>',
        '<body><script>window.PUBLIO_FORCER_PLAN = ' + JSON.stringify(mApercu[1]) + ';</script>');
      return envoyerHtml(req, res, page);
    }
    return json(res, 200, { ok:true, message:'Publio tourne. Interface absente.' });
  }

  /* ---------- les pages légales (servies depuis ../legal) ---------- */
  const LEGAL = { '/privacy':'privacy.html', '/terms':'terms.html', '/mentions':'mentions.html' };
  if (LEGAL[chemin]){
    const fLegal = path.join(DOSSIER, '..', 'legal', LEGAL[chemin]);
    if (fs.existsSync(fLegal)){
      return envoyerHtml(req, res, lireFrais(fLegal).toString('utf8'));
    }
  }

  /* Seules les ressources explicitement publiques sont servies : jamais les
     fichiers de code, données, configurations ou une page via un faux chemin. */
  const RESSOURCES_PUBLIQUES = new Set([
    '/publio-favicon.svg', '/login-photo.jpg', '/inscription-photo.jpg',
    '/final-abstract.jpg',
    '/coworking-v2-1.jpg', '/coworking-v2-2.jpg', '/coworking-v2-3.jpg'
  ]);
  if ((req.method === 'GET' || req.method === 'HEAD') && RESSOURCES_PUBLIQUES.has(chemin)){
    const f = path.join(DOSSIER, chemin.slice(1));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return servirFichier(req, res, f);
  }

  json(res, 404, { ok:false, erreur:'pas trouvé : ' + chemin });
}

/* la page /admin : autonome, aucune ressource externe,
   servie seulement si on passe le garde du mot de passe (si activé) */
const ADMIN_PAGE = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Publio — Interface admin</title>
<style>
:root{
  --sf:-apple-system,BlinkMacSystemFont,'SF Pro Text','Inter',system-ui,sans-serif;
  --display:'Space Grotesk',var(--sf);
  --papier:#FBF9F6; --encre:#14110F; --encre-2:#56504A; --encre-3:#8C847C;
  --trait:#E4DED7; --publio:#FF5A2B; --publio-pale:#FFF0EA; --publio-clair:#FF8A5B;
  --bleu:#007AFF; --vert:#34C759; --orange-s:#FF9500; --rouge:#FF3B30;
  --acc:#E8461A; --acc-pale:rgba(255,90,43,.10);
  --txt:#0B0D12; --txt-2:rgba(60,60,67,.62); --txt-3:rgba(60,60,67,.40);
  --hairline:rgba(60,60,67,.14);
  --r-s:8px; --r:12px; --r-l:16px; --r-xl:22px;
  --verre:rgba(255,255,255,.74); --bord:rgba(255,255,255,.98);
  --cerne:rgba(124,106,90,.14);
  --diffus:0 10px 32px rgba(120,100,80,.10), 0 2px 8px rgba(120,100,80,.06);
  --diffus-fort:0 30px 78px rgba(110,88,66,.22), 0 6px 20px rgba(110,88,66,.11);
  --ease:cubic-bezier(.32,.72,0,1);
}
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%}
body{font-family:var(--display);background:var(--papier);color:var(--txt);
  font-size:13px;line-height:1.42;overflow:hidden;
  -webkit-font-smoothing:antialiased;letter-spacing:-0.006em}
button{font:inherit;color:inherit;background:none;border:none;cursor:pointer}
::selection{background:rgba(255,90,43,.20)}
::-webkit-scrollbar{width:9px;height:9px}
::-webkit-scrollbar-thumb{background:rgba(60,60,67,.24);border-radius:9px;border:2px solid transparent;background-clip:content-box}
::-webkit-scrollbar-track{background:transparent}

/* ============ MONDE ============ */
.monde{position:fixed;inset:0;overflow:hidden;z-index:0;
  background:radial-gradient(72% 52% at 0% -8%, rgba(255,90,43,.075) 0%, transparent 62%),
    linear-gradient(180deg,#FBF9F6 0%,#F9F6F2 100%)}
.blob{position:absolute;border-radius:50%;filter:blur(110px);opacity:.42}
.b1{width:52vw;height:52vw;left:-18vw;top:-26vw;background:radial-gradient(circle,#FFD4C2 0%,#FFEBE1 55%,transparent 72%)}
.b2{width:44vw;height:44vw;right:-20vw;top:-16vw;background:radial-gradient(circle,#FFE2CE 0%,#FFF3E9 55%,transparent 72%)}
.b3{width:48vw;height:48vw;left:24vw;bottom:-34vw;background:radial-gradient(circle,#F0E7DB 0%,#F8F3EC 55%,transparent 72%)}

/* ============ FENÊTRE ============ */
.fenetre{position:relative;height:100vh;width:100%;max-width:100%;overflow:hidden;
  display:grid;grid-template-columns:238px minmax(0,1fr);
  grid-template-rows:auto minmax(0,1fr);
  grid-template-areas:"barre barre" "cote zone";
  gap:10px;padding:10px;transition:grid-template-columns .32s var(--ease);z-index:1}
.toolbar{grid-area:barre}.sidebar{grid-area:cote}.zone{grid-area:zone}
@media(min-width:981px){
  .fenetre.replie{grid-template-columns:74px minmax(0,1fr)}
  .fenetre.replie .sb-titre,
  .fenetre.replie .sb-item > span:not(.pastille):not(.plus),
  .fenetre.replie .sb-item .compte{display:none}
  .fenetre.replie .sb-item{justify-content:center;padding:0;height:36px}
  .fenetre.replie .sb-groupe{padding:0 12px;gap:1px}
  .fenetre.replie .feux{display:none}
  .fenetre.replie .sidebar{padding-top:16px}
  .fenetre.replie .sb-item svg{width:17px;height:17px}
  .fenetre.replie .sb-replier span{display:none}
  .fenetre.replie .sb-replier svg{transform:rotate(180deg)}
}

.verre{position:relative;background:var(--verre);
  -webkit-backdrop-filter:blur(30px) saturate(180%) brightness(1.04);
  backdrop-filter:blur(30px) saturate(180%) brightness(1.04);
  border:1px solid var(--bord);border-radius:var(--r-xl);
  box-shadow:var(--diffus),0 1px 0 rgba(255,255,255,1) inset,0 0 0 .5px var(--cerne);
  overflow:hidden}
.verre::before{content:"";position:absolute;inset:0;pointer-events:none;border-radius:inherit;
  background:linear-gradient(145deg,rgba(255,255,255,.85) 0%,transparent 34%);opacity:.9}

/* ============ BARRE ============ */
.toolbar{height:52px;display:flex;align-items:center;gap:11px;padding:0 14px;min-width:0;overflow:hidden}
.feux{display:flex;gap:8px;margin-right:2px;flex:0 0 auto;position:relative;z-index:2}
.feu{width:12px;height:12px;border-radius:50%;box-shadow:0 0 0 .5px rgba(0,0,0,.14) inset}
.f1{background:#FF5F57}.f2{background:#FEBC2E}.f3{background:#28C840}
#btn-nav{display:none;width:29px;height:29px;align-items:center;justify-content:center;border-radius:8px}
#btn-nav svg{width:16px;height:16px;stroke:currentColor;stroke-width:2;fill:none}
.titre{font-family:var(--display);font-size:13.5px;font-weight:700;letter-spacing:-.022em;color:var(--encre);position:relative;z-index:2;white-space:nowrap}
.sous{font-size:11px;color:var(--txt-3);margin-top:-2px;position:relative;z-index:2;white-space:nowrap}
.droite{margin-left:auto;display:flex;align-items:center;gap:8px;position:relative;z-index:2}
.maj{display:inline-flex;align-items:center;gap:7px;height:29px;padding:0 11px;border-radius:8px;
  font-size:12px;color:var(--txt-2);background:rgba(255,255,255,.6);
  box-shadow:0 1px 0 rgba(255,255,255,.9) inset,0 0 0 .5px var(--cerne)}
.maj i{width:8px;height:8px;border-radius:50%;background:var(--vert);
  box-shadow:0 0 0 .5px rgba(0,0,0,.08) inset;animation:pulse 2s infinite}
.maj.mort i{background:var(--rouge);animation:none}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(52,199,89,.4)}70%{box-shadow:0 0 0 7px rgba(52,199,89,0)}100%{box-shadow:0 0 0 0 rgba(52,199,89,0)}}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;
  height:29px;padding:0 13px;border-radius:8px;font-size:13px;font-weight:500;
  white-space:nowrap;text-decoration:none;transition:.16s var(--ease)}
.btn:active{transform:scale(.975)}
.btn-verre{background:rgba(255,255,255,.72);color:var(--txt);
  box-shadow:0 1px 0 rgba(255,255,255,1) inset,0 2px 8px rgba(76,90,130,.10),0 0 0 .5px var(--cerne)}
.btn-verre:hover{background:rgba(255,255,255,.92)}
.btn-accent{background:linear-gradient(180deg,#FF7A4D,#F04A18);color:#fff;
  border:1px solid rgba(255,255,255,.42);
  box-shadow:0 1px 0 rgba(255,255,255,.5) inset,0 4px 15px rgba(240,74,24,.34),0 1px 2px rgba(0,0,0,.08);
  font-weight:600;letter-spacing:-.008em}
.btn-accent:hover{filter:brightness(1.05)}

/* ============ SIDEBAR ============ */
.sidebar{display:flex;flex-direction:column;min-height:0;padding-top:14px;padding-bottom:10px}
.marque-sb{display:flex;align-items:center;gap:9px;flex:0 0 auto;text-decoration:none;
  color:var(--encre);position:relative;z-index:2;height:30px;padding:0 18px;margin-bottom:10px}
.marque-sb:hover{opacity:.75}
.marque-sb span{font-family:var(--display);font-size:17px;font-weight:700;letter-spacing:-.03em;line-height:1;white-space:nowrap}
.marque-sb i{font-style:normal;color:var(--publio)}
.marque-sb svg{width:24px;height:24px;flex:0 0 auto;filter:drop-shadow(0 2px 5px rgba(255,90,43,.30))}
.marque-sb em{font-style:normal;font-size:9px;font-weight:800;letter-spacing:.14em;
  color:var(--acc);background:var(--publio-pale);border-radius:5px;padding:2px 6px;margin-left:2px}
.sb-titre{padding:0 18px 7px;font-size:10.5px;font-weight:700;color:var(--txt-3);
  letter-spacing:.11em;text-transform:uppercase;position:relative;z-index:2}
.sb-groupe{padding:0 10px;display:flex;flex-direction:column;gap:2px;position:relative;z-index:2}
.sb-item{display:flex;align-items:center;gap:10px;height:30px;padding:0 9px;
  border-radius:9px;font-size:13px;width:100%;text-align:left;position:relative;
  color:var(--txt);text-decoration:none;transition:background .16s var(--ease)}
.sb-item svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.7;
  stroke-linecap:round;stroke-linejoin:round;flex:0 0 auto;opacity:.72}
.sb-item:hover{background:rgba(255,255,255,.62)}
.sb-item.actif{background:rgba(255,255,255,.92);font-weight:500;
  box-shadow:0 1px 0 rgba(255,255,255,1) inset,0 2px 8px rgba(76,90,130,.12),0 0 0 .5px var(--cerne)}
.sb-item.actif svg{opacity:1;stroke:var(--acc)}
.sb-item .compte{margin-left:auto;font-size:10.5px;color:var(--txt-3);
  font-variant-numeric:tabular-nums;font-weight:500;min-width:16px;text-align:right}
.sb-item.actif .compte{color:var(--acc);font-weight:600}
.sb-item .compte.alerte{background:var(--rouge);color:#fff;border-radius:9px;
  padding:1px 6px;font-weight:700;opacity:1}
.sb-item .pastille{width:8px;height:8px;border-radius:50%;flex:0 0 auto;
  box-shadow:0 0 0 .5px rgba(255,255,255,.9) inset,0 1px 3px rgba(0,0,0,.10)}
.pastille.ok{background:var(--vert)}.pastille.repos{background:var(--rouge)}
.sb-item .sous-txt{margin-left:auto;font-size:10.5px;color:var(--txt-3)}
.sb-sep{height:1px;margin:11px 18px;
  background:linear-gradient(90deg,transparent,rgba(60,60,67,.13),transparent)}
.sb-replier{margin:auto 10px 6px;height:30px;display:flex;align-items:center;gap:9px;
  padding:0 9px;border-radius:9px;font-size:12.5px;color:var(--txt-3);
  position:relative;z-index:2;width:calc(100% - 20px);
  transition:background .16s var(--ease),color .16s var(--ease)}
.sb-replier:hover{background:rgba(255,255,255,.62);color:var(--txt)}
.sb-replier svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.9;
  stroke-linecap:round;stroke-linejoin:round;transition:transform .32s var(--ease)}
.fenetre.replie .sb-replier{width:34px;margin:auto auto 6px;padding:0;justify-content:center}
.fenetre.replie .sb-replier svg{transform:rotate(180deg)}
.voile-nav{position:fixed;inset:0;background:rgba(30,38,60,.26);z-index:425;
  opacity:0;pointer-events:none;transition:opacity .28s var(--ease);
  -webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px)}
body.nav-ouvert .voile-nav{opacity:1;pointer-events:auto}

/* ============ ZONE / VUE ============ */
.zone{display:flex;flex-direction:column;min-width:0;min-height:0}
.vue{position:relative;flex:1;min-height:0;overflow-y:auto;padding:16px;
  display:flex;flex-direction:column;gap:14px;
  background:rgba(255,255,255,.46);
  -webkit-backdrop-filter:blur(30px) saturate(170%);backdrop-filter:blur(30px) saturate(170%);
  border:1px solid rgba(255,255,255,.9);border-radius:var(--r-xl);
  box-shadow:var(--diffus),0 1px 0 rgba(255,255,255,1) inset,0 0 0 .5px var(--cerne)}

/* les cartes internes : verre sur verre léger */
.carte{background:rgba(255,255,255,.78);border:1px solid rgba(255,255,255,.95);
  border-radius:var(--r-l);box-shadow:0 1px 0 rgba(255,255,255,1) inset,0 4px 14px rgba(76,90,130,.07),0 0 0 .5px var(--cerne);
  padding:15px 17px}
.carte-tete{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:11px}
.carte-titre{font-size:10.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--encre-2);opacity:.75}
.carte-note{font-size:11.5px;color:var(--acc);font-weight:600}

/* KPIs */
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.kpi{background:rgba(255,255,255,.78);border:1px solid rgba(255,255,255,.95);
  border-radius:var(--r-l);padding:14px 16px;position:relative;overflow:hidden;
  box-shadow:0 1px 0 rgba(255,255,255,1) inset,0 4px 14px rgba(76,90,130,.07),0 0 0 .5px var(--cerne)}
.kpi::after{content:'';position:absolute;right:-30px;top:-30px;width:88px;height:88px;border-radius:50%;
  background:radial-gradient(circle,var(--acc-pale),transparent 70%)}
.kpi .label{font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--txt-3)}
.kpi .valeur{font-family:var(--display);font-size:27px;font-weight:700;letter-spacing:-.03em;margin-top:6px;color:var(--encre)}
.kpi .sous-l{font-size:11.5px;color:var(--txt-3);margin-top:1px}
.kpi.alerte .valeur{color:var(--rouge)}

/* grille graphique + états */
.grille{display:grid;grid-template-columns:5fr 3fr;gap:12px}
.graph svg{width:100%;height:150px;display:block}
.graph .barre{transition:opacity .18s}
.graph .barre:hover{opacity:.7}

/* états */
.etats{display:flex;flex-direction:column;gap:11px;padding-top:2px}
.etat-ligne{display:grid;grid-template-columns:86px 1fr 34px;align-items:center;gap:10px;font-size:12px}
.etat-ligne span{color:var(--txt-2)}
.etat-ligne b{text-align:right;font-variant-numeric:tabular-nums}
.piste{height:9px;border-radius:6px;background:rgba(60,60,67,.09);overflow:hidden}
.piste > div{height:100%;border-radius:6px;transition:width .5s var(--ease)}

/* échecs */
.liste{display:flex;flex-direction:column;gap:10px}
.post{display:flex;align-items:center;justify-content:space-between;gap:16px;
  background:rgba(255,255,255,.85);border:1px solid rgba(255,255,255,.95);
  border-left:4px solid var(--rouge);border-radius:var(--r);padding:12px 15px;
  box-shadow:0 0 0 .5px var(--cerne)}
.post .t{font-weight:700;font-size:13px;color:var(--encre)}
.post .tag{font-size:10px;font-weight:800;color:#c0392b;background:#fdecea;
  border-radius:5px;padding:2px 6px;margin-left:7px;letter-spacing:.04em;text-transform:uppercase}
.post .m{font-size:12px;color:var(--txt-2);margin-top:4px;max-width:66ch;line-height:1.45}
.post .m b{color:var(--encre)}
.btn-agir{border:0;border-radius:9px;background:linear-gradient(180deg,#FF7A4D,#F04A18);
  color:#fff;font-weight:600;font-size:12.5px;padding:9px 15px;white-space:nowrap;
  box-shadow:0 1px 0 rgba(255,255,255,.5) inset,0 4px 12px rgba(240,74,24,.30)}
.btn-agir:hover{filter:brightness(1.05)}
.btn-agir:disabled{opacity:.6}
.vide{border:1px dashed var(--trait);border-radius:var(--r);padding:22px;text-align:center;color:var(--txt-3);font-size:12.5px}
.vide .ok{font-size:30px;display:block;margin-bottom:5px}
.vide b{color:#15803d}

/* canaux */
.circuits{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.circuit{border:1px solid rgba(255,255,255,.95);border-radius:var(--r);padding:13px 15px;
  display:flex;flex-direction:column;gap:7px;background:rgba(255,255,255,.78);
  box-shadow:0 0 0 .5px var(--cerne)}
.circuit.repos{border-color:#f3c0b8;background:#fff8f6}
.circuit .ligne1{display:flex;align-items:center;justify-content:space-between;gap:10px}
.circuit .nom{font-weight:700;font-size:13.5px;color:var(--encre);display:flex;align-items:center;gap:8px}
.circuit .compte{color:var(--txt-3);font-size:11px}
.circuit .infos{font-size:11px;color:var(--txt-2);line-height:1.5}
.pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:3px 10px;font-size:10.5px;font-weight:700}
.pill.ok{background:#e7f8ee;color:#15803d}
.pill.repos{background:#fdecea;color:#c0392b}
.btn-discret{align-self:flex-start;border:1px solid var(--trait);background:rgba(255,255,255,.7);border-radius:8px;
  font-size:11px;font-weight:600;padding:6px 10px}
.btn-discret:hover{border-color:var(--encre)}

/* journal */
.journal{background:#16130f;color:#f2eee9;border-radius:var(--r);
  padding:13px 16px;font-family:ui-monospace,'SF Mono',Menlo,monospace;
  font-size:11px;line-height:1.8;max-height:220px;overflow:auto}
.journal div b{color:#ffb59c;font-weight:600}
.journal .vide-j{color:#8a857e}

/* toast */
.toast{position:fixed;right:18px;bottom:18px;background:var(--encre);color:#FBF9F6;
  font-size:12px;border-radius:11px;padding:11px 15px;opacity:0;transform:translateY(6px);
  transition:opacity .25s,transform .25s;pointer-events:none;z-index:50;max-width:46ch}
.toast.on{opacity:1;transform:translateY(0)}

/* ============ SaaS : back-office clients + supervision plateformes ============ */
.saaskpis .kpi .valeur{color:var(--acc)}
.btn-sm{height:27px;font-size:12px;padding:0 11px;border-radius:7px}
.btn-xs{height:24px;padding:0 9px;font-size:11px;font-weight:600;border-radius:6px;border:1px solid var(--trait);background:#fff;white-space:nowrap}
.btn-xs:hover{border-color:var(--encre)}
.btn-xs.danger{color:#c0392b}.btn-xs.danger:hover{border-color:#c0392b}
.form-client{border:1px solid var(--trait);border-radius:var(--r);padding:12px;margin-bottom:12px;background:rgba(255,255,255,.6)}
.form-grille{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.form-grille input,.form-grille select{height:32px;border:1px solid var(--trait);border-radius:8px;padding:0 10px;font:inherit;font-size:12px;background:#fff;outline:none;min-width:0;color:var(--txt)}
.form-grille input:focus,.form-grille select:focus{border-color:var(--publio);box-shadow:0 0 0 2px var(--acc-pale)}
#f-nom{grid-column:span 2}#f-notes{grid-column:span 2}
.form-pied{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:9px;flex-wrap:wrap}
.form-aide{font-size:10.5px;color:var(--txt-3);max-width:56ch;line-height:1.45}
.form-pied-btns{display:flex;gap:8px}
.clients-tete{display:grid;grid-template-columns:minmax(0,1.7fr) .72fr .85fr .62fr .8fr auto;gap:10px;font-size:9px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--txt-3);padding:0 12px 6px}
.liste-clients{display:flex;flex-direction:column;gap:6px}
.client-row{display:grid;grid-template-columns:minmax(0,1.7fr) .72fr .85fr .62fr .8fr auto;gap:10px;align-items:center;background:rgba(255,255,255,.82);border-radius:var(--r);padding:9px 12px;box-shadow:0 0 0 .5px var(--cerne)}
.cl-nom b{display:block;font-size:12.5px;color:var(--encre);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cl-nom span{font-size:10.5px;color:var(--txt-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cl-mrr{font-variant-numeric:tabular-nums;font-size:12.5px}
.cl-renouv{font-size:11.5px;color:var(--txt-2)}
.pill-plan{background:var(--publio-pale);color:var(--acc)}
.st-actif{background:#e7f8ee;color:#15803d}.st-essai{background:#fff7ed;color:#b45309}
.st-suspendu{background:#fdecea;color:#c0392b}.st-annule{background:rgba(60,60,67,.09);color:var(--txt-3)}
.cl-actions{display:flex;gap:6px;justify-content:flex-end}
.plats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.plat{border:1px solid rgba(255,255,255,.95);border-radius:var(--r);padding:12px 14px;background:rgba(255,255,255,.78);box-shadow:0 0 0 .5px var(--cerne);display:flex;flex-direction:column;gap:8px}
.plat.repos{border-color:#f3c0b8;background:#fff8f6}
.plat-tete{display:flex;align-items:center;gap:8px}
.plat-tete b{font-size:13px;color:var(--encre)}
.plat-compte{font-size:11px;color:var(--txt-3);margin-right:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pill-cles.ok{background:#e7f8ee;color:#15803d}.pill-cles.ko{background:#fdecea;color:#c0392b}
.plat-expir-txt{font-size:11px;color:var(--txt-2);margin-bottom:4px;display:flex;justify-content:space-between;gap:8px}
.plat-expir-vide{font-size:10.5px;color:var(--txt-3);border:1px dashed var(--trait);border-radius:8px;padding:7px 9px;line-height:1.5}
.plat-expir-vide code{background:rgba(60,60,67,.08);border-radius:4px;padding:0 4px}
.plat-stats{font-size:11px;color:var(--txt-2)}
.plat-stats b{color:#c0392b}
@media(max-width:1150px){.plats{grid-template-columns:1fr 1fr}.form-grille{grid-template-columns:repeat(2,1fr)}#f-nom,#f-notes{grid-column:span 1}}
@media(max-width:980px){.plats{grid-template-columns:1fr}.clients-tete{display:none}.client-row{grid-template-columns:1fr auto;row-gap:6px}.cl-actions{grid-column:1/-1;justify-content:flex-start}}

.mdp-banniere{display:flex;align-items:center;gap:10px;background:#FFF7E8;border:1px solid #F2C879;border-radius:var(--r);padding:10px 13px;margin-bottom:12px;font-size:12px;color:#7a4a00}
.mdp-banniere code{background:#fff;border:1px solid #F2C879;border-radius:6px;padding:2px 8px;font-size:13px;letter-spacing:.04em;user-select:all}
.mdp-banniere b{white-space:nowrap}
.loc-tete,.loc-row{display:grid;grid-template-columns:minmax(0,1.5fr) .68fr .82fr .6fr minmax(0,1.35fr) auto;gap:10px;align-items:center}
.loc-row{background:rgba(255,255,255,.82);border-radius:var(--r);padding:9px 12px;box-shadow:0 0 0 .5px var(--cerne)}
.loc-sante{font-size:11px;color:var(--txt-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.loc-sante.ko{color:var(--txt-3);font-style:italic}
.loc-slug{font-size:10px;color:var(--txt-3);font-family:ui-monospace,'SF Mono',Menlo,monospace}
@media(max-width:980px){.loc-tete{display:none}.loc-row{grid-template-columns:1fr auto;row-gap:6px}}

/* ============ RESPONSIVE ============ */
@media(max-width:980px){
  #btn-nav{display:flex}
  .feux{display:none}
  .fenetre{grid-template-columns:minmax(0,1fr);grid-template-areas:"barre" "zone";padding:8px;gap:8px}
  .sidebar{position:fixed;top:0;left:0;bottom:0;width:250px;z-index:430;
    border-radius:0;transform:translateX(-105%);transition:transform .3s var(--ease);
    background:rgba(251,249,246,.92)}
  body.nav-ouvert .sidebar{transform:none;box-shadow:var(--diffus-fort)}
  .kpis{grid-template-columns:repeat(2,1fr)}
  .grille{grid-template-columns:1fr}
  .circuits{grid-template-columns:1fr}
  .droite .btn-accent{display:none}
  .maj{display:none}
}
</style>
</head>
<body>

<div class="monde" aria-hidden="true">
  <div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div>
</div>

<div class="fenetre" id="fenetre">

  <!-- ============ SIDEBAR ============ -->
  <aside class="sidebar verre" id="sidebar">
    <a class="marque-sb" href="/app" aria-label="Publio — Interface client">
      <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8.32" fill="#FF5A2B"/><g transform="translate(9.3,7.05) skewX(-11) scale(0.5)" fill="#F8F0E3"><rect width="11" height="36"/><path d="M0 0 H27.2 a9.2 10.3 0 0 1 0 20.6 H0 Z"/><path d="M11 4.6 A5.1 6.0 0 0 1 11 16.6 Z" fill="#FF5A2B"/></g>
      </svg>
      <span>Publio<i>.</i></span><em>ADMIN</em>
    </a>

    <div class="sb-titre">Tableau de bord</div>
    <div class="sb-groupe">
      <button class="sb-item actif" data-scroll="haut">
        <svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>
        <span>Vue d’ensemble</span>
      </button>
      <button class="sb-item" data-scroll="sec-echecs">
        <svg viewBox="0 0 24 24"><path d="M12 8v5M12 16.5h.01"/><circle cx="12" cy="12" r="9.2"/></svg>
        <span>Envois en échec</span><span class="compte" id="nb-side-echecs">0</span>
      </button>
      <button class="sb-item" data-scroll="sec-canaux">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M12 2v3.4M12 18.6V22M2 12h3.4M18.6 12H22M5 5l2.4 2.4M16.6 16.6 19 19M19 5l-2.4 2.4M7.4 16.6 5 19"/></svg>
        <span>Canaux</span><span class="compte" id="nb-side-canaux">0</span>
      </button>
      <button class="sb-item" data-scroll="sec-journal">
        <svg viewBox="0 0 24 24"><path d="M5 6.5h14M5 12h14M5 17.5h9"/></svg>
        <span>Journal</span>
      </button>
    </div>

    <div class="sb-titre">SaaS</div>
    <div class="sb-groupe">
      <button class="sb-item" data-scroll="sec-locataires">
        <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.4"/><path d="M3.5 20c.6-3.6 2.9-5.4 5.5-5.4s4.9 1.8 5.5 5.4M16 4.6a3.4 3.4 0 0 1 0 6.8M18.4 14.9c1.4 .9 2.1 2.6 2.4 5.1"/></svg>
        <span>Locataires</span><span class="compte" id="nb-side-locataires">0</span>
      </button>
      <button class="sb-item" data-scroll="sec-plateformes">
        <svg viewBox="0 0 24 24"><path d="M3 12h4l2.5-7L14 17l2.5-5H21"/></svg>
        <span>Plateformes</span>
      </button>
    </div>

    <div class="sb-sep"></div>
    <div class="sb-titre">Interface client</div>
    <div class="sb-groupe">
      <a class="sb-item" href="/app#calendrier">
        <svg viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="17" rx="3"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/></svg>
        <span>Calendrier</span>
      </a>
      <a class="sb-item" href="/app#file">
        <svg viewBox="0 0 24 24"><path d="M4 6.5h16M4 12h16M4 17.5h10"/></svg>
        <span>File</span>
      </a>
      <a class="sb-item" href="/app#auto">
        <svg viewBox="0 0 24 24"><path d="M13 2 4.5 13H11l-1 9 9-11.5h-6.5z"/></svg>
        <span>Automatisations</span>
      </a>
    </div>

    <div class="sb-sep"></div>
    <div class="sb-titre">Canaux</div>
    <div class="sb-groupe" id="sb-canaux"></div>

    <div class="sb-sep" id="sep-session" style="display:none"></div>
    <div class="sb-groupe" id="groupe-session" style="display:none">
      <button class="sb-item" id="btn-deconnexion">
        <svg viewBox="0 0 24 24"><path d="M14 12H3M7 8l-4 4 4 4M10 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H10"/></svg>
        <span>Se déconnecter</span>
      </button>
    </div>

    <button class="sb-replier" id="sb-replier" title="Replier la navigation">
      <svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>
      <span>Replier</span>
    </button>
  </aside>

  <!-- ============ BARRE ============ -->
  <header class="toolbar verre">
    <div class="feux"><span class="feu f1"></span><span class="feu f2"></span><span class="feu f3"></span></div>
    <button id="btn-nav" title="Afficher la navigation" aria-label="Afficher la navigation">
      <svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
    </button>
    <div>
      <div class="titre">Interface admin</div>
      <div class="sous" id="t-sous">connexion au moteur…</div>
    </div>
    <div class="droite">
      <span class="maj" id="maj"><i></i><span id="maj-le">—</span></span>
      <a class="btn btn-accent" href="/app">← Interface client</a>
    </div>
  </header>

  <!-- ============ ZONE ============ -->
  <div class="zone">
    <div class="vue" id="vue">

      <div class="kpis" id="kpis"></div>

      <div class="kpis saaskpis">
        <div class="kpi"><div class="label">MRR</div><div class="valeur" id="k-mrr">—</div><div class="sous-l">revenu récurrent mensuel</div></div>
        <div class="kpi"><div class="label">Clients actifs</div><div class="valeur" id="k-actifs">—</div><div class="sous-l">abonnements en cours</div></div>
        <div class="kpi"><div class="label">En essai</div><div class="valeur" id="k-essai">—</div><div class="sous-l">à convertir</div></div>
        <div class="kpi"><div class="label">Suspendus</div><div class="valeur" id="k-suspendus">—</div><div class="sous-l">accès coupé</div></div>
      </div>

      <section class="carte" id="sec-locataires">
        <div class="carte-tete"><span class="carte-titre">Locataires — la flotte SaaS</span>
          <button class="btn btn-verre btn-sm" id="btn-ajouter-locataire">+ Nouveau locataire</button></div>

        <div class="mdp-banniere" id="mdp-banniere" style="display:none">
          <b>Mot de passe initial</b> — affiché une seule fois, note-le maintenant :
          <code id="mdp-valeur"></code>
          <button type="button" class="btn-xs" id="mdp-fermer">OK, noté</button>
        </div>

        <form id="form-locataire" class="form-client" style="display:none" autocomplete="off">
          <div class="form-grille">
            <input id="l-nom" placeholder="Nom du client *" required maxlength="120">
            <input id="l-slug" placeholder="slug (auto si vide)" maxlength="31" pattern="[a-z0-9][a-z0-9-]{1,30}">
            <input id="l-email" type="email" placeholder="email@exemple.com" maxlength="160">
            <select id="l-plan">
              <option value="essai" selected>Plan · Essai</option>
              <option value="starter">Plan · Starter</option>
              <option value="pro">Plan · Individuel</option>
              <option value="agence">Plan · Agence</option>
            </select>
            <input id="l-montant" type="number" min="0" step="1" placeholder="Montant / mois">
            <input id="l-mdp" type="text" placeholder="Mot de passe (vide = généré)" autocomplete="new-password">
            <input id="l-renouvellement" type="date" title="Prochaine échéance de facturation">
            <input id="l-notes" placeholder="Notes (facultatif)" maxlength="500" style="grid-column: span 2">
          </div>
          <div class="form-pied">
            <span class="form-aide">Chaque locataire est isolé physiquement dans <code>locataires/…</code> (sa base, son journal). La connexion par client arrive en phase 2 — le registre, les rôles et le MRR sont prêts maintenant.</span>
            <span class="form-pied-btns">
              <button type="button" class="btn btn-verre btn-sm" id="l-annuler">Annuler</button>
              <button type="submit" class="btn btn-accent btn-sm" id="l-submit">Créer le locataire</button>
            </span>
          </div>
        </form>

        <div class="clients-tete loc-tete"><span>Locataire</span><span>Plan</span><span>Statut</span><span>Montant/mois</span><span>Santé</span><span></span></div>
        <div class="liste-clients" id="liste-locataires"><div class="vide">Chargement…</div></div>
      </section>

      <section class="carte" id="sec-plateformes">
        <div class="carte-tete"><span class="carte-titre">Plateformes — supervision</span>
          <button class="btn btn-verre btn-sm" id="btn-rafraichir">↻ Rafraîchir les jetons</button></div>
        <div class="plats" id="plats"><div class="vide">Chargement…</div></div>
      </section>

      <div class="grille">
        <div class="carte">
          <div class="carte-tete"><span class="carte-titre">Actions — 14 jours</span><span class="carte-note" id="total14"></span></div>
          <div class="graph" id="graph"></div>
        </div>
        <div class="carte">
          <div class="carte-tete"><span class="carte-titre">Posts par état</span></div>
          <div class="etats" id="etats"></div>
        </div>
      </div>

      <section class="carte" id="sec-echecs">
        <div class="carte-tete"><span class="carte-titre">Envois en échec</span><span class="carte-note" id="nbEchecs"></span></div>
        <div class="liste" id="echecs"><div class="vide">Chargement…</div></div>
      </section>

      <section class="carte" id="sec-canaux">
        <div class="carte-tete"><span class="carte-titre">Canaux</span><span class="carte-note">pastille rouge = en repos</span></div>
        <div class="circuits" id="circuits"></div>
      </section>

      <section class="carte" id="sec-journal">
        <div class="carte-tete"><span class="carte-titre">Journal</span><span class="carte-note" style="color:var(--txt-3)">20 dernières actions</span></div>
        <div class="journal" id="journal">…</div>
      </section>

    </div>
  </div>
</div>

<div class="voile-nav" id="voile-nav"></div>
<div class="toast" id="toast"></div>

<script>
const api = async (chemin, opt) => {
  const r = await fetch('/api' + chemin, Object.assign({headers:{'Content-Type':'application/json'}}, opt));
  if (r.status === 401){ location.href = '/connexion'; throw new Error('session expirée'); }
  return r.json();
};
const $ = (s) => document.querySelector(s);
const toast = (t) => { const el = $('#toast'); el.textContent = t; el.classList.add('on');
  setTimeout(() => el.classList.remove('on'), 4000); };
const esc = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const depuis = (t) => { if (!t) return 'jamais';
  const s = Math.max(0, Math.round((Date.now() - Number(t)) / 1000));
  if (s < 60) return 'il y a ' + s + ' s';
  const m = Math.floor(s / 60); if (m < 60) return 'il y a ' + m + ' min';
  const h = Math.floor(m / 60); if (h < 48) return 'il y a ' + h + ' h';
  return 'il y a ' + Math.floor(h / 24) + ' j'; };
const duree = (s) => { if (s < 3600) return Math.round(s / 60) + ' min';
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  if (h < 48) return h + ' h ' + m + ' min';
  return Math.floor(h / 24) + ' j ' + (h % 24 ? (h % 24) + ' h' : ''); };

const COUL_ETAT = { publie:'#34C759', retente:'#FF9500', echoue:'#FF3B30',
  prog:'#FF5A2B', brouillon:'#a8a29e', archive:'#d6d3d1' };
const LIB_ETAT = { publie:'publié', retente:'en retry', echoue:'échec',
  prog:'programmé', brouillon:'brouillon', archive:'archivé' };
const NOM_CANAL = { ig:'Instagram', fb:'Facebook', tt:'TikTok', li:'LinkedIn', th:'Threads' };
const PLAN_L = { essai:'Essai', starter:'Starter', pro:'Individuel', agence:'Agence' };
const STATUT_L = { essai:'En essai', actif:'Actif', suspendu:'Suspendu', annule:'Annulé' };

/* ---- repli de la sidebar (comme l'application) ---- */
const fenetre = $('#fenetre');
const CLE_REPLI = 'publio-admin-replie';
try{ if (localStorage.getItem(CLE_REPLI) === '1' && window.innerWidth > 980) fenetre.classList.add('replie'); }catch(e){}
$('#sb-replier').addEventListener('click', () => {
  fenetre.classList.toggle('replie');
  try{ localStorage.setItem(CLE_REPLI, fenetre.classList.contains('replie') ? '1' : '0'); }catch(e){}
});
const ouvrirNav = () => document.body.classList.add('nav-ouvert');
const fermerNav = () => document.body.classList.remove('nav-ouvert');
$('#btn-nav').addEventListener('click', () => document.body.classList.contains('nav-ouvert') ? fermerNav() : ouvrirNav());
$('#voile-nav').addEventListener('click', fermerNav);
document.querySelectorAll('[data-scroll]').forEach((b) => b.addEventListener('click', () => {
  fermerNav();
  document.querySelectorAll('[data-scroll]').forEach(x => x.classList.remove('actif'));
  b.classList.add('actif');
  const cible = b.dataset.scroll === 'haut' ? $('#vue') : document.getElementById(b.dataset.scroll);
  if (cible) $('#vue').scrollTo({ top: cible === $('#vue') ? 0 : cible.offsetTop - 14, behavior:'smooth' });
}));

function dessinerGraph(jours){
  const el = $('#graph');
  if (!jours.length){ el.innerHTML = '<div class="vide">Pas encore de données.</div>'; return; }
  const W = 560, H = 150, padB = 20, padT = 8;
  const max = Math.max.apply(null, jours.map(j => j.n).concat([1]));
  const pas = W / jours.length;
  const bw = Math.max(10, Math.floor(pas) - 7);
  let total = 0; let barres = '';
  for (let i = 0; i < jours.length; i++){
    const j = jours[i]; total += j.n;
    const h = Math.round((H - padB - padT) * j.n / max);
    const x = Math.round(i * pas + (pas - bw) / 2);
    const y = H - padB - h;
    barres += '<rect class="barre" x="' + x + '" y="' + y + '" width="' + bw + '" height="' + Math.max(h, j.n ? 4 : 0)
      + '" rx="4.5" fill="' + (j.n ? '#FF5A2B' : 'rgba(60,60,67,.12)') + '"><title>' + esc(j.label) + ' — ' + j.n + ' action(s)</title></rect>';
  }
  let labels = '';
  for (let i = 0; i < jours.length; i += 2){
    const cx = Math.round(i * pas + pas / 2);
    labels += '<text x="' + cx + '" y="' + (H - 5) + '" font-size="9" fill="var(--txt-3)" text-anchor="middle">' + esc(jours[i].label) + '</text>';
  }
  $('#total14').textContent = total + ' action' + (total > 1 ? 's' : '');
  el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="actions par jour">'
    + '<line x1="0" y1="' + (H - padB) + '" x2="' + W + '" y2="' + (H - padB) + '" stroke="var(--trait)" stroke-width="1"/>'
    + barres + labels + '</svg>';
}

async function charger(){
  try{
    const [met, ech, cir, etat, loc, plats] = await Promise.all([
      api('/metriques'), api('/echecs'), api('/circuits'), api('/etat'), api('/locataires'), api('/plateformes'),
    ]);

    $('#t-sous').textContent = 'Moteur vivant · démarrage n°' + met.demarrages + ' · battement ' + depuis(met.dernierTick);
    $('#maj').classList.remove('mort');
    const avecSession = !!met.auth_active || !!met.admin_barriere;
    $('#sep-session').style.display = avecSession ? 'block' : 'none';
    $('#groupe-session').style.display = avecSession ? 'flex' : 'none';
    $('#maj-le').textContent = 'à jour ' + new Date().toLocaleTimeString('fr-FR');

    const nbEch = ech.posts.length;
    $('#kpis').innerHTML =
      '<div class="kpi"><div class="label">En marche depuis</div><div class="valeur">' + esc(duree(met.uptime_s)) + '</div><div class="sous-l">démarrage n°' + met.demarrages + '</div></div>'
      + '<div class="kpi"><div class="label">Actions</div><div class="valeur">' + met.actions + '</div><div class="sous-l">depuis le début</div></div>'
      + '<div class="kpi' + (nbEch ? ' alerte' : '') + '"><div class="label">Envois en échec</div><div class="valeur">' + nbEch + '</div><div class="sous-l">' + (nbEch ? 'à traiter ci-dessous' : 'tout est passé ✓') + '</div></div>'
      + '<div class="kpi"><div class="label">Mémoire</div><div class="valeur">' + met.memoire_mb + ' Mo</div><div class="sous-l">' + met.posts_total + ' posts en base</div></div>';

    const badgeEch = $('#nb-side-echecs');
    badgeEch.textContent = nbEch;
    badgeEch.classList.toggle('alerte', nbEch > 0);

    dessinerGraph(met.actions_par_jour || []);

    const entrees = Object.entries(met.posts || {}).sort((a, b) => b[1] - a[1]);
    const totalPosts = entrees.reduce((acc, x) => acc + x[1], 0) || 1;
    $('#etats').innerHTML = entrees.map(([e, n]) =>
      '<div class="etat-ligne"><span>' + esc(LIB_ETAT[e] || e) + '</span>'
      + '<div class="piste"><div style="width:' + Math.round(100 * n / totalPosts) + '%;background:' + (COUL_ETAT[e] || '#a8a29e') + '"></div></div>'
      + '<b>' + n + '</b></div>'
    ).join('') || '<div class="vide">Aucun post en base.</div>';

    $('#nbEchecs').textContent = nbEch ? nbEch + ' à traiter' : '';
    const liste = $('#echecs');
    if (!nbEch){
      liste.innerHTML = '<div class="vide"><span class="ok">✓</span><b>Tout passe.</b><br>Aucun envoi en échec — si ça casse, c’est ici que tu le verras.</div>';
    } else {
      liste.innerHTML = ech.posts.map(p => (
        '<div class="post"><div>'
        + '<div class="t">' + esc(p.titre || '(sans titre)') + '<span class="tag">' + esc(p.canal) + ' · ' + esc(p.etat || '') + '</span></div>'
        + '<div class="m">' + esc(p.erreur || 'erreur inconnue — relance l’envoi pour obtenir la cause')
        + (p.conseil ? ' — <b>' + esc(p.conseil) + '</b>' : '')
        + (p.prochainEssai ? ' · prochain essai : ' + depuis(new Date(p.prochainEssai).getTime()) : '')
        + '</div></div>'
        + '<button class="btn-agir" data-retry="' + esc(p.id) + '">Réessayer</button>'
        + '</div>'
      )).join('');
    }

    $('#nb-side-canaux').textContent = cir.length;
    $('#circuits').innerHTML = cir.map(c => {
      const repos = !!c.repose;
      const reste = repos ? Math.max(0, Math.round((new Date(c.reposJusqua).getTime() - Date.now()) / 60000)) : 0;
      return '<div class="circuit' + (repos ? ' repos' : '') + '">'
        + '<div class="ligne1"><div><div class="nom"><span class="pastille ' + (repos ? 'repos' : 'ok') + '"></span>' + esc(NOM_CANAL[c.canal] || c.canal) + '</div>'
        + '<div class="compte">' + esc(c.compte || '') + '</div></div>'
        + '<span class="pill ' + (repos ? 'repos' : 'ok') + '">' + (repos ? 'en repos' : 'en service') + '</span></div>'
        + '<div class="infos">' + (repos
            ? '3 échecs de suite — se repose encore <b>' + reste + ' min</b>'
            : 'aucun blocage · ' + (c.echecs || 0) + ' échec' + ((c.echecs || 0) > 1 ? 's' : '') + ' récent' + ((c.echecs || 0) > 1 ? 's' : ''))
        + '</div>'
        + (repos ? '<button class="btn-discret" data-wake="' + esc(c.canal) + '">Remettre en service</button>' : '')
        + '</div>';
    }).join('');

    $('#sb-canaux').innerHTML = cir.map(c =>
      '<div class="sb-item" style="cursor:default"><span class="pastille ' + (c.repose ? 'repos' : 'ok') + '"></span>'
      + '<span>' + esc(NOM_CANAL[c.canal] || c.canal) + '</span>'
      + '<span class="sous-txt">' + (c.repose ? 'repos' : 'ok') + '</span></div>'
    ).join('');

    rendreLocataires(loc);
    rendrePlateformes(plats);

    const lignes = (etat.journal || []).slice(0, 20).map(j =>
      '<div>' + (j.action ? '<b>' + esc(j.action) + '</b> · ' : '') + esc(j.texte || '') + '</div>'
    ).join('');
    $('#journal').innerHTML = lignes || '<div class="vide-j">(rien pour l’instant)</div>';

  }catch(e){
    $('#t-sous').textContent = 'API injoignable — le moteur ne répond pas (port 4400). Redémarre « node moteur.js » puis recharge.';
    $('#maj').classList.add('mort');
    $('#maj-le').textContent = 'le moteur ne répond pas';
  }
}

document.addEventListener('click', async (e) => {
  const retry = e.target.closest('[data-retry]');
  if (retry){
    retry.disabled = true; retry.textContent = 'Envoi…';
    const r = await api('/posts/' + encodeURIComponent(retry.dataset.retry) + '/reessayer', { method:'POST' });
    toast(r.dit || (r.ok ? 'Envoyé.' : 'Échec de l’envoi — le détail exact est dans « Envois en échec »'));
    charger();
    return;
  }
  const wake = e.target.closest('[data-wake]');
  if (wake){
    await api('/circuits/' + encodeURIComponent(wake.dataset.wake), { method:'DELETE' });
    toast('Canal remis en service.');
    charger();
  }
});


/* ============ SaaS : les locataires ============ */
const STATUT_CLASSE = { essai:'st-essai', actif:'st-actif', suspendu:'st-suspendu', annule:'st-annule' };
let lastLocataires = [];
let editLocataire = null;

function rendreLocataires(data){
  const liste = (data && data.locataires) || [];
  const r = (data && data.resume) || {};
  $('#k-mrr').textContent = (r.mrrDZD || 0).toLocaleString('fr-FR') + ' DA' + (r.mrrEUR ? ' · ' + r.mrrEUR.toLocaleString('fr-FR') + ' €' : '');
  $('#k-actifs').textContent = r.actifs || 0;
  $('#k-essai').textContent = r.essai || 0;
  $('#k-suspendus').textContent = r.suspendus || 0;
  $('#nb-side-locataires').textContent = r.actifs || 0;
  lastLocataires = liste;
  if (!liste.length){
    $('#liste-locataires').innerHTML = '<div class="vide">Aucun locataire pour l’instant.<br>Clique « + Nouveau locataire » — tu crées le compte, le client se connecte dans sa bulle à lui.</div>';
    return;
  }
  $('#liste-locataires').innerHTML = liste.map(l => {
    const s = l.sante || {};
    let santeHtml;
    if (!s.base){ santeHtml = '<span class="loc-sante ko">pas encore amorcée</span>'; }
    else {
      santeHtml = '<span class="loc-sante" title="Dernière activité du moteur de ce locataire">'
        + (s.publies || 0) + ' publiés · ' + (s.regles || 0) + ' règles'
        + (s.derniere_activite ? ' · act. ' + depuis(new Date(s.derniere_activite).getTime()) : '')
        + '</span>';
    }
    return '<div class="loc-row">'
      + '<div class="cl-nom"><b>' + esc(l.nom) + '</b><span><span class="loc-slug">' + esc(l.slug) + '</span> · ' + esc(l.email || 'pas d’email') + '</span></div>'
      + '<span class="pill pill-plan">' + esc(PLAN_L[l.plan] || l.plan) + '</span>'
      + '<span class="pill ' + (STATUT_CLASSE[l.statut] || 'st-annule') + '">' + esc(STATUT_L[l.statut] || l.statut) + '</span>'
      + '<b class="cl-mrr">' + (Number(l.montant) || 0).toLocaleString('fr-FR') + (l.devise === 'DZD' ? ' DA' : ' €') + '</b>'
      + santeHtml
      + '<span class="cl-actions">'
      +   '<button class="btn-xs" data-edit-loc="' + esc(l.id) + '">Modifier</button>'
      +   '<button class="btn-xs" data-toggle-loc="' + esc(l.id) + '" data-vers="' + (l.statut === 'actif' ? 'suspendu' : 'actif') + '">' + (l.statut === 'actif' ? 'Suspendre' : 'Activer') + '</button>'
      +   '<button class="btn-xs danger" data-del-loc="' + esc(l.id) + '">Supprimer</button>'
      + '</span>'
      + '</div>';
  }).join('');
}

function resetFormLocataire(){
  editLocataire = null;
  const f = $('#form-locataire');
  f.reset();
  $('#l-plan').value = 'essai';
  $('#l-submit').textContent = 'Créer le locataire';
  $('#l-slug').disabled = false;
  f.style.display = 'none';
}

$('#btn-ajouter-locataire').addEventListener('click', () => {
  const f = $('#form-locataire');
  if (f.style.display !== 'none'){ resetFormLocataire(); return; }
  editLocataire = null;
  $('#l-submit').textContent = 'Créer le locataire';
  $('#l-slug').disabled = false;
  f.style.display = 'block';
  $('#l-nom').focus();
});
$('#l-annuler').addEventListener('click', resetFormLocataire);
$('#mdp-fermer').addEventListener('click', () => { $('#mdp-banniere').style.display = 'none'; });

$('#form-locataire').addEventListener('submit', async (e) => {
  e.preventDefault();
  const mdp = $('#l-mdp').value.trim();
  const corps = {
    nom: $('#l-nom').value, slug: $('#l-slug').value, email: $('#l-email').value,
    plan: $('#l-plan').value, montant: $('#l-montant').value, renouvellement: $('#l-renouvellement').value, notes: $('#l-notes').value,
  };
  if (mdp) corps.motDePasse = mdp;
  const btn = $('#l-submit'); btn.disabled = true;
  try{
    const r = editLocataire
      ? await api('/locataires/' + encodeURIComponent(editLocataire), { method:'PUT', body: JSON.stringify(corps) })
      : await api('/locataires', { method:'POST', body: JSON.stringify(corps) });
    if (!r.ok){ toast(r.erreur || 'Action refusée — recharge la page puis réessaie.'); return; }
    if (editLocataire){ toast('Locataire modifié.'); }
    else if (!mdp){
      $('#mdp-valeur').textContent = r.motDePasseInitial || '';
      $('#mdp-banniere').style.display = 'flex';
      toast('Locataire créé — mot de passe affiché ci-dessus, note-le.');
    } else { toast('Locataire créé.'); }
    resetFormLocataire();
    charger();
  } finally { btn.disabled = false; }
});

/* ============ SaaS : les plateformes ============ */
function rendrePlateformes(plats){
  const liste = plats || [];
  $('#plats').innerHTML = liste.map(p => {
    const ok = p.aDesCles;
    const j = (typeof p.jours_avant_expiration === 'number') ? p.jours_avant_expiration : null;
    let expir;
    if (j === null){
      expir = '<div class="plat-expir-vide">Échéance inconnue — ajoute <code>token_expire</code> dans <code>.cles.json</code> pour suivre la fin des jetons.</div>';
    } else if (j < 0){
      expir = '<div class="plat-expir-txt"><span>Jeton expiré depuis ' + (-j) + ' j</span><span>!</span></div><div class="piste"><div style="width:100%;background:var(--rouge)"></div></div>';
    } else {
      const pct = Math.max(2, Math.min(100, Math.round(j / 60 * 100)));
      const coul = j < 8 ? 'var(--rouge)' : j < 20 ? 'var(--orange-s)' : 'var(--vert)';
      expir = '<div class="plat-expir-txt"><span>Jeton : ' + j + ' j restants</span><span>' + esc((p.token_expire || '').slice(0, 10)) + '</span></div>'
        + '<div class="piste"><div style="width:' + pct + '%;background:' + coul + '"></div></div>';
    }
    const reste = p.repose ? Math.max(0, Math.round((new Date(p.reposJusqua).getTime() - Date.now()) / 60000)) : 0;
    const stats = (p.publies || 0) + ' publication' + ((p.publies || 0) > 1 ? 's' : '') + ' · '
      + (p.echecs || 0) + ' échec' + ((p.echecs || 0) > 1 ? 's' : '') + ' récent' + ((p.echecs || 0) > 1 ? 's' : '')
      + (p.repose ? ' · <b>en repos encore ' + reste + ' min</b>' : '');
    return '<div class="plat' + (p.repose ? ' repos' : '') + '">'
      + '<div class="plat-tete"><span class="pastille ' + (p.repose ? 'repos' : 'ok') + '"></span>'
      + '<b>' + esc(NOM_CANAL[p.canal] || p.canal) + '</b><span class="plat-compte">' + esc(p.compte || '') + '</span>'
      + '<span class="pill pill-cles ' + (ok ? 'ok' : 'ko') + '">' + (ok ? 'clés OK' : 'pas de clés') + '</span></div>'
      + expir
      + '<div class="plat-stats">' + stats + '</div>'
      + '</div>';
  }).join('') || '<div class="vide">Aucun canal configuré.</div>';
}

$('#btn-rafraichir').addEventListener('click', async (e) => {
  const btn = e.currentTarget; btn.disabled = true;
  try{
    const r = await api('/rafraichir-maintenant', { method:'POST' });
    const n = ((r && r.resultats) || []).filter(x => x.fait).length;
    toast(r && r.ok ? (n + ' jeton(s) renouvelé(s) — détails dans le journal.') : ('Échec du rafraîchissement — ' + ((r && r.erreur) || 'cause inconnue, voir les logs du moteur')));
    charger();
  } finally { btn.disabled = false; }
});

/* actions de ligne — la flotte (délégation) */
document.addEventListener('click', async (e) => {
  const ed = e.target.closest('[data-edit-loc]');
  if (ed){
    const l = lastLocataires.find(x => x.id === ed.dataset.editLoc);
    if (!l) return;
    editLocataire = l.id;
    $('#l-nom').value = l.nom || '';
    $('#l-slug').value = l.slug || ''; $('#l-slug').disabled = true;
    $('#l-email').value = l.email || '';
    $('#l-plan').value = l.plan || 'essai';
    $('#l-montant').value = l.montant != null ? l.montant : 0;
    $('#l-mdp').value = '';
    $('#l-renouvellement').value = l.renouvellement || '';
    $('#l-notes').value = l.notes || '';
    $('#l-submit').textContent = 'Enregistrer';
    $('#form-locataire').style.display = 'block';
    $('#l-nom').focus();
    return;
  }
  const bas = e.target.closest('[data-toggle-loc]');
  if (bas){
    const vers = bas.dataset.vers;
    const r = await api('/locataires/' + encodeURIComponent(bas.dataset.toggleLoc), { method:'PUT', body: JSON.stringify({ statut: vers }) });
    toast(r.ok ? (vers === 'actif' ? 'Locataire réactivé.' : 'Locataire suspendu.') : (r.erreur || 'Échec de l’action — consulte le journal pour le détail.'));
    charger();
    return;
  }
  const del = e.target.closest('[data-del-loc]');
  if (del){
    const l = lastLocataires.find(x => x.id === del.dataset.delLoc);
    if (!confirm('Mettre « ' + ((l && l.nom) || 'ce locataire') + ' » à la corbeille ? Rien n’est détruit : les fichiers sont gardés dans locataires/_supprimes/.')) return;
    const r = await api('/locataires/' + encodeURIComponent(del.dataset.delLoc), { method:'DELETE' });
    toast(r.ok ? 'Locataire mis en corbeille.' : (r.erreur || 'Échec de l’action — consulte le journal pour le détail.'));
    charger();
  }
});

$('#btn-deconnexion').addEventListener('click', async () => {
  try{ await fetch('/api/deconnexion-admin', { method:'POST' }); }catch(e){}
  location.href = '/connexion-admin';
});

charger();
setInterval(charger, 5000);
</script>
</body>
</html>`;

/* ==================================================================
   8. DÉMARRAGE
   ================================================================== */

/* ==================================================================
   LA SAUVEGARDE
   ------------------------------------------------------------------
   Une copie datée de publio.json (+ journal.jsonl) dans sauvegardes/,
   une fois au démarrage puis une fois par jour. On garde les 30 plus
   récentes. Si la base est perdue ou corrompue, on reprend au dernier
   backup — sans au-delà d'une journée de perdue.
   ================================================================== */

const FICHIER_BACKUPS = process.env.PUBLIO_BACKUPS || path.join(DOSSIER, 'sauvegardes');
const MAX_BACKUPS = 30;
let DERNIER_BACKUP = 0;   // en mémoire : la fréquence ne survit pas aux redémarrages, c'est voulu
let DERNIER_RAFRAICHISSEMENT = 0;   // idem pour les jetons

function faireBackup(){
  try{
    fs.mkdirSync(FICHIER_BACKUPS, { recursive: true });
    const horodatage = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const destination = path.join(FICHIER_BACKUPS, 'publio-' + horodatage + '.json');
    if (fs.existsSync(FICHIER_DB)) fs.copyFileSync(FICHIER_DB, destination);
    else fs.writeFileSync(destination, JSON.stringify(DB, null, 1));   // base neuve, jamais sauvegardée
    if (fs.existsSync(FICHIER_JOURNAL))
      fs.copyFileSync(FICHIER_JOURNAL, path.join(FICHIER_BACKUPS, 'journal-' + horodatage + '.jsonl'));
    /* la rotation : on garde MAX_BACKUPS paires (publio + journal) */
    const fichiers = fs.readdirSync(FICHIER_BACKUPS)
      .filter(f => f.startsWith('publio-') && f.endsWith('.json'))
      .sort();
    while (fichiers.length > MAX_BACKUPS){
      const vieux = fichiers.shift();
      try{ fs.unlinkSync(path.join(FICHIER_BACKUPS, vieux)); }catch(e){}
      try{ fs.unlinkSync(path.join(FICHIER_BACKUPS, vieux.replace('publio-', 'journal-').replace(/\.json$/, '.jsonl'))); }catch(e){}
    }
    DERNIER_BACKUP = Date.now();
    return true;
  }catch(e){
    console.log('  ! sauvegarde impossible : ' + (e.message || e));
    return false;
  }
}

/* ==================================================================
   LE MOT DE PASSE (optionnel, désactivé par défaut)
   ------------------------------------------------------------------
   Par défaut : tout est ouvert — pratique sur ta machine.
   Sur Internet, c'est la porte ouverte : n'importe qui peut modifier
   tes règles ou lire le journal.

   Pour l'activer :   PUBLIO_MOT_DE_PASSE=ton_mot_de_passe node moteur.js

   Quand il est actif :
     • /api/sante reste ouvert (le superviseur doit pouvoir l'interroger)
     • tout le reste exige le cookie de session (30 jours)
     • l'app se charge toujours, mais redirige vers /connexion sinon
   ================================================================== */

const MOT_DE_PASSE = process.env.PUBLIO_MOT_DE_PASSE || '';
const AUTH_ACTIVE = MOT_DE_PASSE.length > 0;
const JETON_DUREE_S = 30 * 24 * 3600;   // 30 jours

function creerJetonAvec(secret){
  const exp = Date.now() + JETON_DUREE_S * 1000;
  const base = Buffer.from(String(exp)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(base).digest('base64url');
  return base + '.' + sig;
}
function jetonValideAvec(secret, jeton){
  if (!secret || !jeton) return false;
  const i = String(jeton).lastIndexOf('.');
  if (i <= 0) return false;
  const base = jeton.slice(0, i), sig = jeton.slice(i + 1);
  const attendu = crypto.createHmac('sha256', secret).update(base).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(attendu);
  if (a.length !== b.length) return false;
  if (!crypto.timingSafeEqual(a, b)) return false;
  const exp = Number(Buffer.from(base, 'base64url').toString());
  return Number.isFinite(exp) && Date.now() < exp;
}
const creerJeton = () => creerJetonAvec(MOT_DE_PASSE);
const jetonValide = (j) => jetonValideAvec(MOT_DE_PASSE, j);

/* ==================================================================
   LA SESSION CLIENT — indépendante de l'admin, signée différemment.
   Le secret vit dans .secret (créé au premier démarrage, mode 600) :
   les sessions survivent aux redémarrages, sans dériver de l'admin.
   ================================================================== */
const SECRET_FICHIER = process.env.PUBLIO_SECRET_FILE || path.join(DOSSIER, '.secret');
const SECRET_CLIENT = (() => {
  try { return fs.readFileSync(SECRET_FICHIER, 'utf8').trim(); }
  catch (e) {
    try { const s2 = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(SECRET_FICHIER, s2, { mode: 0o600 }); return s2; }
    catch (e2) { console.warn('  .secret indisponible — sessions client perdues au redémarrage'); return crypto.randomBytes(32).toString('hex'); }
  }
})();
const DUREE_CLIENT_S = 30 * 24 * 3600;
function creerJetonClient(slug){
  const exp = Date.now() + DUREE_CLIENT_S * 1000;
  const base = Buffer.from(JSON.stringify({ role:'client', slug:String(slug), exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET_CLIENT).update(base).digest('base64url');
  return base + '.' + sig;
}
function jetonValideClient(jeton){
  try{
    const i = String(jeton || '').lastIndexOf('.');
    if (i <= 0) return null;
    const base = jeton.slice(0, i), sig = jeton.slice(i + 1);
    const attendu = crypto.createHmac('sha256', SECRET_CLIENT).update(base).digest('base64url');
    const a = Buffer.from(sig), b = Buffer.from(attendu);
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;
    const data = JSON.parse(Buffer.from(base, 'base64url').toString());
    if (!data || data.role !== 'client' || !data.slug) return null;
    if (!Number.isFinite(data.exp) || Date.now() >= data.exp) return null;
    return { slug: String(data.slug) };
  }catch(e){ return null; }
}
function clientProprietaire(req){
  const s3 = jetonValideClient(lireCookie(req, 'publio_client'));
  if (!s3) return null;
  return locataires.lire(s3.slug) || null;
}
/* Une miniature JPEG bornée, fournie par le navigateur après redimensionnement.
   Pas d'URL distante ni de SVG exécutable ; stockée dans la base privée du propriétaire. */
function photoProjetValide(photo){
  if(typeof photo !== 'string' || photo.length > 200000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(photo)) return false;
  const b64=photo.slice('data:image/jpeg;base64,'.length);
  const bytes=Buffer.from(b64,'base64');
  return bytes.length >= 4 && bytes.length <= 150000 && bytes.toString('base64')===b64 && bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff && bytes[bytes.length-2]===0xff && bytes[bytes.length-1]===0xd9;
}
function agenceActive(l){
  return !!l && String(l.plan).toLowerCase() === 'agence' && String(l.statut).toLowerCase() === 'actif';
}
function signerProjet(owner, id){
  const base = Buffer.from(JSON.stringify({owner, id, exp:Date.now()+DUREE_CLIENT_S*1000})).toString('base64url');
  return base + '.' + crypto.createHmac('sha256', SECRET_CLIENT).update('projet:'+base).digest('base64url');
}
function lireProjetSigne(jeton, owner){
  try {
    const parts=String(jeton || '').split('.'); if(parts.length!==2) return null;
    const attendu=crypto.createHmac('sha256', SECRET_CLIENT).update('projet:'+parts[0]).digest('base64url');
    const a=Buffer.from(parts[1]), b=Buffer.from(attendu);
    if(a.length!==b.length || !crypto.timingSafeEqual(a,b)) return null;
    const j=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
    return j.owner===owner && Number.isFinite(j.exp) && j.exp>Date.now() ? j.id : null;
  } catch(e){ return null; }
}
function clientDepuisReq(req){
  const owner = clientProprietaire(req);
  if (!owner) return null;
  if (!agenceActive(owner)) return owner;
  const id = lireProjetSigne(lireCookie(req,'publio_projet'),owner.slug);
  if (!id || id === 'principal') return Object.assign({},owner,{projetId:'principal', projetNom:tenantBase(owner).nomProjetPrincipal || 'Projet principal', proprietaireSlug:owner.slug});
  const db = tenantBase(owner);
  const p = Array.isArray(db.projetsAgence) && db.projetsAgence.find(x=>x.id===id && /^pr-[a-f0-9]{24}$/.test(x.id));
  if (!p) return Object.assign({},owner,{projetId:'principal', projetNom:db.nomProjetPrincipal || 'Projet principal', proprietaireSlug:owner.slug});
  return Object.assign({},owner,{slug:p.id,projetId:p.id,projetNom:p.nom,proprietaireSlug:owner.slug});
}

/* ==================================================================
   LE MULTI-TENANT — chaque client (locataire) a SA base physique :
   locataires/<slug>/publio.json (amorcée vide à la création). Une
   session client lit et écrit CHEZ ELLE — jamais dans la base de
   l'agence, jamais chez un voisin. La session studio (agence) sert
   la base globale, comme avant.
   ================================================================== */
const TENANT_DOSSIER = locataires.DOSSIER;
const TENANT_SLUG = /^[a-z0-9][a-z0-9-]{1,30}$/;
const tenantCache = new Map();
function tenantVide(){
  return { version: 2, cree: new Date().toISOString(),
    canaux: [], regles: [], posts: [], stats: {}, journal: [],
    etat: { dernierTick: 0, actions: 0, demarrages: 0 } };
}
function tenantBase(l){
  const slug = String((l && l.slug) || '');
  if (!TENANT_SLUG.test(slug)) return null;
  if (!tenantCache.has(slug)){
    let db = null;
    const dir = path.join(TENANT_DOSSIER, slug);
    try {
      db = JSON.parse(fs.readFileSync(path.join(dir, 'publio.json'), 'utf8'));
    } catch (e) {
      // Seul un projet entièrement nouveau peut partir d'une base vide.
      // Une base existante absente, illisible ou corrompue ne doit jamais
      // être remplacée silencieusement par une base vide.
      if (e.code === 'ENOENT' && !fs.existsSync(dir)) db = tenantVide();
      else {
        console.error('  ! données du projet indisponibles (' + slug + ') : ' + e.message);
        throw new Error('Données du projet indisponibles. Aucune modification enregistrée.');
      }
    }
    if (!db || typeof db !== 'object' || Array.isArray(db)) {
      console.error('  ! données du projet invalides (' + slug + ')');
      throw new Error('Données du projet indisponibles. Aucune modification enregistrée.');
    }
    db.canaux = Array.isArray(db.canaux) ? db.canaux : [];
    db.regles = Array.isArray(db.regles) ? db.regles : [];
    db.posts = Array.isArray(db.posts) ? db.posts : [];
    db.medias = Array.isArray(db.medias) ? db.medias : [];
    db.brouillonsComposeur = Array.isArray(db.brouillonsComposeur) ? db.brouillonsComposeur : [];
    db.journal = Array.isArray(db.journal) ? db.journal : [];
    db.stats = (db.stats && typeof db.stats === 'object') ? db.stats : {};
    db.etat = Object.assign(tenantVide().etat, db.etat || {});
    tenantCache.set(slug, db);
  }
  return tenantCache.get(slug);
}
function sauverTenant(l){
  const db = tenantBase(l); if (!db) return false;
  const dir = path.join(TENANT_DOSSIER, l.slug);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, 'publio.json.tmp');
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, path.join(dir, 'publio.json'));
    return true;
  } catch (e) { return false; }
}
function journalTenant(l, texte, extra){
  const db = tenantBase(l); if (!db) return;
  db.journal.unshift(Object.assign(
    { t: Date.now(), id: 'j' + Date.now() + Math.round(Math.random() * 1e4), texte: String(texte).slice(0, 300) },
    extra || {}));
  if (db.journal.length > 200) db.journal = db.journal.slice(0, 200);
  sauverTenant(l);
}
/* /app : session client, ou session studio quand l'agence active son mot de passe */
function interfaceDepuisReq(req){
  const client = clientDepuisReq(req);
  if (client) return { mode: 'client', locataire: client };
  if (AUTH_ACTIVE && jetonValide(lireCookie(req, 'publio'))) return { mode: 'agence', locataire: null };
  return null;
}
/* la flotte (/admin et ses API) : double barrière admin, ou session studio. Sinon 401. */
function peutVoirFlotte(req){
  if (ADMIN_AUTH && sessionAdmin(req)) return true;
  if (AUTH_ACTIVE && jetonValide(lireCookie(req, 'publio'))) return true;
  return false;
}

function lireCookie(req, nom){
  const brut = String(req.headers.cookie || '');
  for (const morceau of brut.split(';')){
    const i = morceau.indexOf('=');
    if (i > 0 && morceau.slice(0, i).trim() === nom)
      return decodeURIComponent(morceau.slice(i + 1).trim());
  }
  return null;
}
function motDePasseValide(candidat){
  if (!MOT_DE_PASSE) return false;
  const a = Buffer.from(String(candidat || ''));
  const b = Buffer.from(MOT_DE_PASSE);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/* inscriptions publiques : au plus 6 créations de compte par IP et par heure */
const INSCRIPTIONS = new Map();   // ip -> [timestamps]
function inscriptionAutorisee(ip){
  const maintenant = Date.now();
  const fenetre = 3600000, max = 6;
  const suite = (INSCRIPTIONS.get(ip) || []).filter(t => maintenant - t < fenetre);
  if (suite.length >= max) return false;
  suite.push(maintenant);
  INSCRIPTIONS.set(ip, suite);
  return true;
}

/* ==================================================================
   LA BARRIÈRE /admin — entrée double et séparée de l'interface client.
   Deux mots de passe, posés dans l'ordre : la page /connexion-admin
   demande d'abord le premier (cookie d'étape, 5 min), puis le second
   (session 12 h). Les API qui alimentent /admin restent inchangées —
   seule la page est verrouillée.
   Configuration, au choix :
     • PUBLIO_ADMIN_MOT_DE_PASSE_1 et PUBLIO_ADMIN_MOT_DE_PASSE_2 (env)
     • ou .admin-pass : deux lignes (premier mot de passe, second), mode 600
   Sans configuration : /admin refuse d'afficher la flotte.
   ================================================================== */
const FICHIER_ADMIN_PASS = process.env.PUBLIO_ADMIN_PASS_FILE || path.join(DOSSIER, '.admin-pass');
const lireAdminPasses = () => {
  const e1 = process.env.PUBLIO_ADMIN_MOT_DE_PASSE_1 || '', e2 = process.env.PUBLIO_ADMIN_MOT_DE_PASSE_2 || '';
  if (e1 && e2) return [e1, e2];
  try {
    const l = fs.readFileSync(FICHIER_ADMIN_PASS, 'utf8').split('\n').map(x => x.trim()).filter(Boolean);
    if (l.length >= 2) return [l[0], l[1]];
  } catch (e) {}
  return null;
};
const ADMIN_PASSES = lireAdminPasses();
const ADMIN_AUTH = !!ADMIN_PASSES;
const DUREE_ADMIN_ETAPE_MS = 5 * 60 * 1000, DUREE_ADMIN_SESSION_S = 12 * 3600;
function mdpEgal(candidat, ref){
  const a = Buffer.from(String(candidat || '')), b = Buffer.from(String(ref || ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
function cleAdmin(role){
  return crypto.createHash('sha256').update('publio-admin:' + role + ':' + (ADMIN_PASSES ? ADMIN_PASSES.join(':') : 'non-configure')).digest();
}
function creerJetonAdmin(role, dureeMs){
  const base = Buffer.from(JSON.stringify({ role, exp: Date.now() + dureeMs })).toString('base64url');
  const sig = crypto.createHmac('sha256', cleAdmin(role)).update(base).digest('base64url');
  return base + '.' + sig;
}
function jetonAdminValide(jeton, role){
  try{
    const i = String(jeton || '').lastIndexOf('.');
    if (i <= 0) return false;
    const base = jeton.slice(0, i), sig = jeton.slice(i + 1);
    const attendu = crypto.createHmac('sha256', cleAdmin(role)).update(base).digest('base64url');
    const a = Buffer.from(sig), b = Buffer.from(attendu);
    if (a.length !== b.length) return false;
    if (!crypto.timingSafeEqual(a, b)) return false;
    const d = JSON.parse(Buffer.from(base, 'base64url').toString());
    return !!(d && d.role === role && Number.isFinite(d.exp) && Date.now() < d.exp);
  }catch(e){ return false; }
}
const etapeAdminPassed = (req) => jetonAdminValide(lireCookie(req, 'publio_admin_etape1'), 'etape1');
const sessionAdmin = (req) => jetonAdminValide(lireCookie(req, 'publio_admin'), 'session');

const ROUTES_OUVERTES = new Set(['/', '/index.html', '/produit', '/demarrer', '/packs', '/faq',
  '/publio-favicon.svg', '/final-abstract.jpg', '/coworking-v2-1.jpg', '/coworking-v2-2.jpg', '/coworking-v2-3.jpg',
  '/login-photo.jpg', '/inscription-photo.jpg', '/privacy', '/terms', '/mentions',
  '/api/sante', '/connexion', '/api/connexion', '/api/deconnexion',
  '/connexion-client', '/espace', '/api/connexion-client', '/api/deconnexion-client', '/api/moi',
  '/inscription', '/api/inscription',
  '/api/mes-cles', '/api/mes-cles/ig', '/api/mes-cles/fb', '/api/mes-cles/tt', '/api/mes-cles/li', '/api/mes-cles/th',
  '/api/oauth/meta/start', '/api/oauth/meta/callback',
  '/api/oauth/tiktok/start', '/api/oauth/tiktok/callback',
  '/api/oauth/linkedin/start', '/api/oauth/linkedin/callback']);

/* /admin sans mots de passe configurés : fail-closed avec le mode d'emploi */
const ADMIN_NON_CONFIGURE = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Publio — Interface admin non configurée</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#FBF9F6;font-family:Inter,system-ui,sans-serif;color:#14110F;padding:24px}
  .carte{background:#fff;border:1px solid #E4DED7;border-radius:18px;padding:36px 32px;max-width:520px;box-shadow:0 12px 40px rgba(20,17,15,.08)}
  .logo{font-size:24px;font-weight:800;letter-spacing:-.03em}.logo span{color:#FF5A2B}
  h1{font-family:'Space Grotesk',Inter,sans-serif;font-size:19px;margin:18px 0 6px}
  p{font-size:13.5px;line-height:1.6;color:#56504A}
  pre{background:#14110F;color:#F8F0E3;border-radius:12px;padding:14px 16px;font-size:12.5px;overflow-x:auto;margin:14px 0}
  a{color:#FF5A2B;font-weight:600;text-decoration:none}
</style>
</head>
<body>
  <main class="carte">
    <div class="logo">Publio<span>.</span> <em style="font-style:normal;font-size:11px;letter-spacing:.18em;color:#8C847C;vertical-align:2px">ADMIN</em></div>
    <h1>Personne n'a encore les clés</h1>
    <p>La page d'administration est verrouillée par deux mots de passe, demandés dans l'ordre. Ils ne sont pas configurés — donc rien ne s'affiche ici.</p>
    <p style="margin-top:10px">Crée le fichier <code>.admin-pass</code> à côté de <code>moteur.js</code> — deux lignes, une par mot de passe :</p>
    <pre>openssl rand -base64 15 > premier
openssl rand -base64 15 > second
cat premier second > .admin-pass && chmod 600 .admin-pass</pre>
    <p>Puis redémarre le moteur. <a href="/">← Retour au site</a></p>
  </main>
</body>
</html>`;

/* la page de double entrée /connexion-admin : autonome, aucune ressource externe */
const ADMIN_CONNEXION_PAGE = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Publio — Interface admin</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#FBF9F6;font-family:Inter,system-ui,sans-serif;color:#14110F;padding:24px}
  .carte{background:#fff;border:1px solid #E4DED7;border-radius:18px;padding:38px 34px;width:min(380px,94vw);box-shadow:0 12px 40px rgba(20,17,15,.08)}
  .logo{font-size:26px;font-weight:800;letter-spacing:-.03em}.logo span{color:#FF5A2B}
  .pastille{display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.14em;color:#FF5A2B;background:#FFE9DF;border-radius:999px;padding:3px 10px;margin:10px 0 16px}
  h1{font-family:'Space Grotesk',Inter,sans-serif;font-size:20px;letter-spacing:-.02em;margin-bottom:4px}
  .sous{font-size:13px;color:#8C847C;margin-bottom:18px}
  label{display:block;font-size:12px;font-weight:600;letter-spacing:.04em;color:#56504A;margin:14px 0 6px}
  input{width:100%;border:1.5px solid #E4DED7;border-radius:11px;padding:12px 13px;font-size:15px;outline:none;transition:border-color .15s}
  input:focus{border-color:#FF5A2B}
  .err{display:none;background:#FDE8E6;color:#B42318;border:1px solid #F3C0B8;border-radius:11px;font-size:12.5px;padding:10px 12px;margin-top:12px}
  .btn{width:100%;margin-top:16px;background:#FF5A2B;color:#fff;border:0;border-radius:12px;padding:13px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit}
  .btn:hover{filter:brightness(1.05)} .btn:disabled{opacity:.6;cursor:default}
  .etapes{display:flex;gap:6px;margin-bottom:4px}
  .etapes i{flex:1;height:4px;border-radius:2px;background:#EDE8E1}
  .etapes i.on{background:#FF5A2B}
  .pied{margin-top:16px;font-size:11.5px;color:#8C847C;text-align:center}
  .pied a{color:#FF5A2B;text-decoration:none;font-weight:600}
  #non-configure{display:none}
  #non-configure pre{background:#14110F;color:#F8F0E3;border-radius:12px;padding:12px 14px;font-size:11.5px;overflow-x:auto;margin-top:12px}
</style>
</head>
<body>
<main class="carte">
  <div class="logo">Publio<span>.</span></div><span class="pastille">INTERFACE ADMIN</span>

  <div class="etapes" aria-hidden="true"><i id="seg-1" class="on"></i><i id="seg-2"></i></div>

  <div id="zone-etape-1">
    <h1>Premier mot de passe</h1>
    <p class="sous">Deux mots de passe, dans l'ordre. Celui-ci est la première clé.</p>
    <form id="form-etape-1" autocomplete="off">
      <label for="mdp-1">Mot de passe n°1</label>
      <input id="mdp-1" name="mot_de_passe" type="password" autocomplete="off" placeholder="••••••••••" autofocus required>
      <div class="err" id="err-1"></div>
      <button type="submit" class="btn" id="btn-1">Continuer →</button>
    </form>
  </div>

  <div id="zone-etape-2" style="display:none">
    <h1>Deuxième mot de passe</h1>
    <p class="sous">Encore un. Celui-ci ouvre la flotte.</p>
    <form id="form-etape-2" autocomplete="off">
      <label for="mdp-2">Mot de passe n°2</label>
      <input id="mdp-2" name="mot_de_passe" type="password" autocomplete="off" placeholder="••••••••••" required>
      <div class="err" id="err-2"></div>
      <button type="submit" class="btn" id="btn-2">Entrer dans l'administration</button>
    </form>
  </div>

  <div id="non-configure">
    <h1>Personne n'a encore les clés</h1>
    <p class="sous">Crée <code>.admin-pass</code> (deux lignes, mode 600) à côté de <code>moteur.js</code>, puis redémarre le moteur.</p>
    <pre>openssl rand -base64 15 > premier
openssl rand -base64 15 > second
cat premier second > .admin-pass && chmod 600 .admin-pass</pre>
  </div>

  <p class="pied"><a href="/">← Retour au site</a></p>
</main>

<script>
window.__ADMIN_CONFIGURED = true;
const $ = (s) => document.querySelector(s);
if (!window.__ADMIN_CONFIGURED){
  ['#zone-etape-1','#zone-etape-2','.etapes'].forEach(s => { const el = $(s); if (el) el.style.display = 'none'; });
  $('#non-configure').style.display = 'block';
}
async function envoyer(chemin, champ, errEl, btn){
  errEl.style.display = 'none'; btn.disabled = true;
  try{
    const r = await fetch(chemin, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ mot_de_passe: champ.value }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.ok) return { ok:true };
    errEl.textContent = d.erreur || 'Étape refusée — réessaie.'; errEl.style.display = 'block'; return { ok:false };
  }catch(e){
    errEl.textContent = 'Moteur injoignable — vérifie qu’il tourne sur le port 4400, puis recharge la page.'; errEl.style.display = 'block'; return { ok:false };
  }finally{ btn.disabled = false; }
}
$('#form-etape-1').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#btn-1'); const champ = $('#mdp-1');
  const r = await envoyer('/api/connexion-admin-etape1', champ, $('#err-1'), btn);
  if (!r.ok){ champ.select(); return; }
  $('#seg-2').classList.add('on');
  $('#zone-etape-1').style.display = 'none';
  $('#zone-etape-2').style.display = 'block';
  $('#mdp-2').focus();
});
$('#form-etape-2').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#btn-2'); const champ = $('#mdp-2');
  const r = await envoyer('/api/connexion-admin', champ, $('#err-2'), btn);
  if (!r.ok){ champ.select(); return; }
  location.href = '/admin';
});
</script>
</body>
</html>`;

/* la page de connexion : autonome, aucune ressource externe */
const CONNEXION_PAGE = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Publio — Interface client</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#FBF9F6;font-family:Inter,system-ui,sans-serif;color:#14110F}
  .carte{background:#fff;border:1px solid #E4DED7;border-radius:18px;
    padding:40px 36px;width:min(360px,92vw);box-shadow:0 12px 40px rgba(20,17,15,.08)}
  .logo{font-size:26px;font-weight:800;letter-spacing:-.03em}
  .logo span{color:#FF5A2B}
  p.sous{margin:6px 0 22px;font-size:13px;color:#6f6a64}
  input{width:100%;padding:13px 14px;border:1.5px solid #E4DED7;border-radius:12px;
    font-size:15px;outline:none;transition:border .15s}
  input:focus{border-color:#FF5A2B}
  button{width:100%;margin-top:12px;padding:13px;border:0;border-radius:12px;
    background:#FF5A2B;color:#fff;font-size:15px;font-weight:700;cursor:pointer}
  button:hover{background:#E8461A}
  .err{margin-top:12px;font-size:13px;color:#c0392b;min-height:1.2em}
</style>
</head>
<body>
  <form class="carte" id="f">
    <div class="logo">Publio<span>.</span></div>
    <p class="sous">Interface client — cette instance est protégée. Entre le mot de passe.</p>
    <input type="password" id="mdp" placeholder="Mot de passe" autofocus autocomplete="current-password">
    <button type="submit">Entrer</button>
    <div class="err" id="err"></div>
  </form>
<script>
  const f = document.getElementById('f'), err = document.getElementById('err');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const r = await fetch('/api/connexion', {
      method:'POST', headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ mot_de_passe: document.getElementById('mdp').value }),
    });
    if (r.ok) { location.href = '/app'; return; }
    err.textContent = 'Mot de passe incorrect.';
  });
</script>
</body>
</html>`;

/* ==================================================================
   LE VERROU DE PROCESS
   ------------------------------------------------------------------
   Si on lance « node moteur.js » deux fois, les deux écrivent dans
   publio.json et se marchent dessus : des posts disparaissent, le
   compteur s'affole, la base devient incohérente.
   On refuse donc de démarrer si un autre moteur tient le verrou.
   ================================================================== */

const FICHIER_VERROU = path.join(DOSSIER, 'moteur.lock');

function pidVivant(pid){
  if (!pid) return false;
  try{ process.kill(pid, 0); return true; }    // ne tue pas, teste seulement
  catch(e){ return e.code === 'EPERM'; }        // existe mais pas à nous
}

function prendreLeVerrou(){
  // Création exclusive : le moteur et la sauvegarde hors ligne se protègent
  // mutuellement. Un verrou abandonné exige une vérification manuelle.
  let fd;
  try { fd = fs.openSync(FICHIER_VERROU, 'wx', 0o600); }
  catch(e){
    if (e.code === 'EEXIST') {
      console.error('  ✋ verrou existant : moteur ou sauvegarde peut être actif.');
      console.error('  Vérifie les processus avant de supprimer un verrou abandonné : ' + FICHIER_VERROU);
      process.exit(1);
    }
    throw e;
  }
  const identifiant = require('crypto').randomBytes(16).toString('hex');
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid:process.pid, depuis:new Date().toISOString(),
      hote:require('os').hostname(), usage:'moteur', identifiant }, null, 1));
    fs.fsyncSync(fd);
  } catch(e){
    try { fs.closeSync(fd); } catch(_) {}
    try { fs.unlinkSync(FICHIER_VERROU); } catch(_) {}
    throw e;
  }
  const liberer = () => {
    try { fs.closeSync(fd); } catch(_) {}
    try {
      const info = JSON.parse(fs.readFileSync(FICHIER_VERROU, 'utf8'));
      if (info.identifiant === identifiant) fs.unlinkSync(FICHIER_VERROU);
    } catch(_) {}
  };
  // Le verrou reste tenu jusqu'à la fin de l'arrêt propre et de ses écritures.
  process.on('exit', liberer);
  return liberer;
}

/* ==================================================================
   LE DISJONCTEUR
   ------------------------------------------------------------------
   Si un réseau tombe, on ne balance pas 200 posts dans le vide.
   Trois échecs de suite sur un canal → on met ce canal au repos 1 h.
   Les autres canaux continuent normalement.
   ================================================================== */

const FICHIER_CIRCUIT = process.env.PUBLIO_CIRCUIT || path.join(DOSSIER, 'circuit.json');
const SEUIL_ECHECS = 3;
const REPOS_MS = 3600 * 1000;      // 1 h

function lireCircuits(){
  try{ return JSON.parse(fs.readFileSync(FICHIER_CIRCUIT, 'utf8')); }
  catch(e){ return {}; }
}
function ecrireCircuits(c){
  try{ fs.writeFileSync(FICHIER_CIRCUIT, JSON.stringify(c, null, 1)); }catch(e){}
}

/** le canal est-il au repos ? */
function canalEnPanne(canal){
  const c = lireCircuits()[canal];
  if (!c) return null;
  if (!c.ouvertJusqua) return null;
  if (Date.now() < c.ouvertJusqua) return c;
  /* le repos est fini : on referme le disjoncteur */
  const tous = lireCircuits();
  delete tous[canal];
  ecrireCircuits(tous);
  return null;
}

/** noter le résultat d'un envoi pour ce canal */
function noterEnvoi(canal, reussi){
  const tous = lireCircuits();
  const c = tous[canal] || { echecs:0, ouvertJusqua:null };
  if (reussi){
    c.echecs = 0;
    c.ouvertJusqua = null;
  } else {
    c.echecs = (c.echecs || 0) + 1;
    if (c.echecs >= SEUIL_ECHECS){
      c.ouvertJusqua = Date.now() + REPOS_MS;
      journaliser({ canal, texte:'disjoncteur · ' + c.echecs + ' échecs de suite, '
        + 'ce canal se repose 1 h' });
    }
  }
  tous[canal] = c;
  ecrireCircuits(tous);
  return c;
}

async function demarrer(){
  prendreLeVerrou();
  charger();

  const app = path.join(__dirname, '..', '..', 'monfork', 'site', 'app-publio.html');
  if (!fs.existsSync(path.join(DOSSIER, 'app-publio.html')) && fs.existsSync(app)){
    try{ fs.copyFileSync(app, path.join(DOSSIER, 'app-publio.html')); }catch(e){}
  }

  const srv = http.createServer((req, res) => {
    route(req, res).catch(e => {
      console.error('  ! ' + e.message);
      try{ json(res, 500, { ok:false, erreur:e.message }); }catch(_){}
    });
  });

  srv.on('error', (e) => {
    if (e.code === 'EADDRINUSE'){
      console.error('');
      console.error('  ✋ le port ' + PORT + ' est déjà pris.');
      console.error('     un autre moteur tourne probablement dessus.');
      console.error('');
      console.error('     pour le trouver :  lsof -i :' + PORT);
      console.error('     autre port     :  PORT=4401 node moteur.js');
      console.error('');
      process.exit(1);
    }
    console.error('  ! serveur : ' + e.message);
    process.exit(1);
  });

  srv.listen(PORT, process.env.PUBLIO_HOST || '0.0.0.0', async () => {
    console.log('');
    console.log('  ┌─────────────────────────────────────────────┐');
    console.log('  │  PUBLIO — le moteur tourne                  │');
    console.log('  └─────────────────────────────────────────────┘');
    console.log('');
    console.log('  adresse    http://localhost:' + PORT);
    console.log('  base       ' + FICHIER_DB);
    console.log('  règles     ' + DB.regles.length + ' · posts ' + DB.posts.length
      + ' · canaux ' + DB.canaux.length);
    console.log('  démarrage  n°' + DB.etat.demarrages);
    console.log('  mot de passe ' + (AUTH_ACTIVE ? 'activé (PUBLIO_MOT_DE_PASSE)' : 'désactivé — instance ouverte'));
    console.log('  interface admin  /admin — ' + (ADMIN_AUTH ? 'double mot de passe (.admin-pass)' : 'NON CONFIGURÉ — crée .admin-pass (2 lignes, chmod 600)'));
    console.log('');

    /* on sauvegarde l'état AVANT le rattrapage : si le rattrapage se passe mal,
       on peut revenir à ce moment précis */
    if (faireBackup()) journaliser({ texte:'sauvegarde créée au démarrage' });

    /* le rattrapage d'abord : on récupère le temps perdu */
    const r = await rattraper();
    if (r.heures){
      console.log('  rattrapage : ' + ditDuree(r.heures) + ' rejouées, '
        + r.actions + ' action(s)');
    } else {
      console.log('  rattrapage : rien à rejouer, on est à jour');
    }
    console.log('');

    /* puis le battement : toutes les secondes.
       On ne le lance pas si le précédent n'est pas fini : un envoi réseau
       peut durer plus d'une seconde. */
    let dernier = 0;
    let enCours = false;
    setInterval(async () => {
      if (enCours) return;
      if (Date.now() - dernier < 1000) return;
      dernier = Date.now();
      enCours = true;
      try{ await tic(); }catch(e){ console.error('  ! battement : ' + e.message); }
      enCours = false;
    }, 1000);

    /* filet de sécurité : si le process a été mis en pause (veille, surcharge),
       la veille de la minute suivante rattrape au lieu de sauter. */
    setInterval(async () => {
      const manquees = heuresManquees(DB.etat.dernierTick);
      if (manquees >= 1){
        const x = await rattraper();
        if (x.heures) console.log('  rattrapage de veille : ' + ditDuree(x.heures));
      }
    }, 60000);

    /* une sauvegarde complète toutes les 30 s, quoi qu'il arrive */
    setInterval(() => sauver(true), 30000);
  });

  const arreter = () => {
    console.log('\n  arrêt propre — sauvegarde en cours…');
    try{ sauver(true); }catch(e){}
    srv.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  };
  process.on('SIGINT', arreter);
  process.on('SIGTERM', arreter);
}

if (require.main === module) demarrer();

module.exports = {
  demarrer, executer, laReglePeutAgir, regleValide,
  DECLENCHEURS, PEUT,
  /* accès de test : on peut piloter le moteur sans le réseau */
  _test: {
    charger, faireTourner, rattraper, tic, reprendreLesEnvois, envoyer,
    prendreLeVerrou, canalEnPanne, noterEnvoi, lireCircuits, ecrireCircuits,
    faireBackup, FICHIER_BACKUPS, MAX_BACKUPS,
    creerJeton, jetonValide, motDePasseValide, lireCookie,
    creerJetonClient, jetonValideClient,
    creerJetonAvec, jetonValideAvec,
    SEUIL_ECHECS, REPOS_MS, FICHIER_VERROU, FICHIER_CIRCUIT,
    regles: () => DB.regles,
    clients: () => DB.clients, resumeClients, nettoyerClient,
    posts: () => DB.posts,
    journal: () => DB.journal,
    db: () => DB,
    horloge: (d) => { HORLOGE = d; },
  },
};
