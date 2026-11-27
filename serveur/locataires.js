/* ==============================================================
   locataires.js — le registre de la flotte SaaS Publio

   Un fichier locataires.json à côté du moteur : la liste des clients
   du service. Par locataire : id (slug), nom, email, plan, statut,
   montant et devise par mois, schema (version de sa base, pour les migrations),
   cree, notes.

   Les données de chaque locataire vivent dans locataires/<slug>/ :
   base, journal, circuit. L'isolation est PHYSIQUE, pas logique :
   une requête qui part en vrille ne peut pas lire ou écrire chez
   le voisin.

   Zéro dépendance. Écritures atomiques. Mots de passe hachés (scrypt).
   ============================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FICHIER = process.env.PUBLIO_LOCATAIRES || path.join(__dirname, 'locataires.json');
const DOSSIER = process.env.PUBLIO_LOCATAIRES_DIR || path.join(__dirname, 'locataires');
const CORBEILLE = path.join(DOSSIER, '_supprimes');
const SCHEMA = 2;   // version du schéma de base d'un locataire (v2 = le principe multi-tenant)

const PLANS = new Set(['essai', 'starter', 'pro', 'agence']);
const RESEAUX_OK = new Set(['ig', 'fb', 'tt', 'li', 'th', 'yt']);
const STATUTS = new Set(['essai', 'actif', 'suspendu', 'annule']);
const SLUG = /^[a-z0-9][a-z0-9-]{1,30}$/;

/* ---------- le fichier registre ---------- */
function charger(){
  try {
    const reg = JSON.parse(fs.readFileSync(FICHIER, 'utf8'));
    if (!reg || !Array.isArray(reg.locataires)) return { version: 1, locataires: [] };
    return reg;
  } catch (e) {
    return { version: 1, locataires: [] };
  }
}
function sauver(reg){
  fs.mkdirSync(path.dirname(FICHIER), { recursive: true });
  const tmp = FICHIER + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 1));
  fs.renameSync(tmp, FICHIER);
}
const pub = (l) => { const r = Object.assign({}, l); delete r.motDePasseHash; return r; };

/* ---------- hachage des mots de passe (scrypt, intégré à node) ---------- */
function hacher(mdp){
  const sel = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(mdp), sel, 32);
  return 'scrypt$' + sel.toString('hex') + '$' + h.toString('hex');
}
function verifier(mdp, stocke){
  try {
    const [algo, sel, attendu] = String(stocke || '').split('$');
    if (algo !== 'scrypt') return false;
    const h = crypto.scryptSync(String(mdp), Buffer.from(sel, 'hex'), 32);
    const a = Buffer.from(attendu, 'hex');
    return a.length === h.length && crypto.timingSafeEqual(a, h);
  } catch (e) { return false; }
}
function motDePasseInit(){
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  const b = crypto.randomBytes(12);
  for (let i = 0; i < 12; i++) s += alphabet[b[i] % alphabet.length];
  return s;
}

/* ---------- les opérations ---------- */
function liste(){
  return charger().locataires.map(pub).sort((a, b) => (b.cree || 0) - (a.cree || 0));
}
function lire(idOuSlug){
  return charger().locataires.find(l => l.id === idOuSlug || l.slug === idOuSlug) || null;
}
function slugifier(nom){
  const s = String(nom || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28);
  return s || 'locataire';
}
function creer(corps){
  corps = corps && typeof corps === 'object' ? corps : {};
  const nom = String(corps.nom || '').trim();
  if (!nom || nom.length < 2) return { erreur: 'nom requis — au moins 2 caractères' };
  const reg = charger();
  let slug = String(corps.slug || '').trim() || slugifier(nom);
  if (!SLUG.test(slug)) return { erreur: 'slug invalide (minuscules, chiffres, tirets ; 2-31 caractères)' };
  if (reg.locataires.some(l => l.slug === slug)) return { erreur: 'ce slug est déjà pris : ' + slug };
  const email = String(corps.email || '').trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { erreur: 'email invalide' };
  const plan = PLANS.has(corps.plan) ? corps.plan : 'essai';
  const montant = Math.max(0, Math.min(1000000, Math.round(Number(corps.montant) || 0)));
  const mdp = String(corps.motDePasse || '').trim() || motDePasseInit();
  const reseaux = Array.isArray(corps.reseaux)
    ? [...new Set(corps.reseaux.map(x => String(x).trim().toLowerCase()).filter(x => RESEAUX_OK.has(x)))].slice(0, 8)
    : [];
  const l = {
    id: 't' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'),
    slug, nom: nom.slice(0, 120), email: email.slice(0, 160),
    plan, statut: 'essai', montant, devise:'DZD',
    schema: SCHEMA,
    motDePasseHash: hacher(mdp),
    renouvellement: (typeof corps.renouvellement === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(corps.renouvellement.trim()))
      ? corps.renouvellement.trim()
      : new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    notes: String(corps.notes || '').slice(0, 500),
    reseaux,
    cree: Date.now(),
  };
  fs.mkdirSync(path.join(DOSSIER, slug), { recursive: true });
  /* amorce : la base vide du locataire — prête pour le moteur de la phase 2,
     et la santé/backup peuvent déjà s'appuyer dessus */
  const base = path.join(DOSSIER, slug, 'publio.json');
  if (!fs.existsSync(base)){
    fs.writeFileSync(base, JSON.stringify({
      version: 2, cree: new Date().toISOString(),
      canaux: [], regles: [], posts: [], stats: {}, journal: [],
      etat: { dernierTick: 0, actions: 0, demarrages: 0 },
    }, null, 1));
  }
  reg.locataires.push(l);
  sauver(reg);
  return { locataire: pub(l), motDePasseInitial: mdp };
}
function maj(id, corps){
  corps = corps && typeof corps === 'object' ? corps : {};
  const reg = charger();
  const l = reg.locataires.find(x => x.id === id || x.slug === id);
  if (!l) return { erreur: 'locataire inconnu' };
  if (corps.nom !== undefined){ const v = String(corps.nom).trim(); if (!v) return { erreur: 'nom requis' }; l.nom = v.slice(0, 120); }
  if (corps.email !== undefined){
    const v = String(corps.email).trim();
    if (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return { erreur: 'email invalide' };
    l.email = v.slice(0, 160);
  }
  if (corps.plan !== undefined) l.plan = PLANS.has(corps.plan) ? corps.plan : l.plan;
  if (corps.statut !== undefined){
    if (!STATUTS.has(corps.statut)) return { erreur: 'statut inconnu : ' + corps.statut };
    l.statut = corps.statut;
  }
  if (corps.montant !== undefined){ const v = Number(corps.montant); if (isFinite(v)) l.montant = Math.max(0, Math.min(1000000, Math.round(v))); }
  if (corps.notes !== undefined) l.notes = String(corps.notes).slice(0, 500);
  if (corps.renouvellement !== undefined){ const v = String(corps.renouvellement).trim(); l.renouvellement = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : l.renouvellement; }
  if (corps.motDePasse){ l.motDePasseHash = hacher(String(corps.motDePasse)); }
  sauver(reg);
  return { locataire: pub(l) };
}
function supprimer(id){
  const reg = charger();
  const i = reg.locataires.findIndex(x => x.id === id || x.slug === id);
  if (i < 0) return { erreur: 'locataire inconnu' };
  const [l] = reg.locataires.splice(i, 1);
  /* jamais de destruction : la corbeille garde tout, horodatée */
  try {
    fs.mkdirSync(CORBEILLE, { recursive: true });
    const src = path.join(DOSSIER, l.slug);
    if (fs.existsSync(src)) fs.renameSync(src, path.join(CORBEILLE, l.slug + '-' + Date.now()));
  } catch (e) { /* la corbeille échoue ? on retire quand même du registre, rien n'est effacé */ }
  sauver(reg);
  return { ok: true, slug: l.slug };
}
/* ---------- la santé d'un locataire, calculée en direct ---------- */
function tailleDossier(d){
  let total = 0;
  try { for (const f of fs.readdirSync(d)) { try { total += fs.statSync(path.join(d, f)).size; } catch(e){} } } catch(e){}
  return total;
}
function sante(l){
  const d = path.join(DOSSIER, l.slug);
  const out = { slug: l.slug, base: false, posts: 0, publies: 0, regles: 0,
    derniere_activite: null, taille_ko: Math.round(tailleDossier(d) / 1024) };
  try {
    const db = JSON.parse(fs.readFileSync(path.join(d, 'publio.json'), 'utf8'));
    out.base = true;
    out.posts = (db.posts || []).length;
    out.publies = (db.posts || []).filter(p => p.etat === 'publie').length;
    out.regles = (db.regles || []).length;
    const t = db.etat && db.etat.dernierTick;
    if (t) out.derniere_activite = new Date(t).toISOString();
  } catch (e) { /* base absente : locataire pas encore amorcé */ }
  return out;
}
function listeAvecSante(){
  return liste().map(l => Object.assign({}, l, { sante: sante(l) }));
}
function resume(){
  const l = charger().locataires;
  const actif = l.filter(x => x.statut === 'actif');
  return {
    total: l.length,
    actifs: actif.length,
    essai: l.filter(x => x.statut === 'essai').length,
    suspendus: l.filter(x => x.statut === 'suspendu').length,
    annules: l.filter(x => x.statut === 'annule').length,
    mrr: actif.reduce((s, x) => s + (Number(x.montant) || 0), 0),
    mrrDZD: actif.filter(x=>x.devise==='DZD').reduce((s,x)=>s+(Number(x.montant)||0),0),
    mrrEUR: actif.filter(x=>x.devise!=='DZD').reduce((s,x)=>s+(Number(x.montant)||0),0),
  };
}
/* ---------- les migrations (socle — phase 2 les utilisera à plein) ---------- */
function migrerTout(){
  const reg = charger();
  const faits = [];
  for (const l of reg.locataires){
    if ((l.schema || 1) < SCHEMA){ l.schema = SCHEMA; faits.push(l.slug); }
  }
  if (faits.length) sauver(reg);
  return faits;
}

module.exports = {
  FICHIER, DOSSIER, CORBEILLE, SCHEMA, PLANS, STATUTS,
  charger, liste, listeAvecSante, lire, creer, maj, supprimer,
  hacher, verifier, resume, sante, migrerTout, slugifier,
};
