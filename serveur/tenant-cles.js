/**
 * LES CLÉS RÉSEAUX DES LOCATAIRES
 * ------------------------------------------------------------------
 * Un fichier `cles.json` par client, rangé dans locataires/<slug>/,
 * en mode 600 (lisible uniquement par le propriétaire).
 * Jamais mélangé avec les clés de l'agence (.cles.json), jamais
 * renvoyé par l'API — le client ne voit que « connecté / pas connecté ».
 *
 *     ig : { access_token, ig_user_id, compte? }
 *     fb : { access_token, page_id, compte? }
 *     tt : { access_token, mode: 'inbox'|'direct', compte? }  (inbox = brouillon, pas d'audit TikTok requis)
 *     li : { access_token, author: 'urn:li:person:…'|'urn:li:organization:…', compte? }
 *     th : { access_token, user_id, compte? }
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DOSSIER = process.env.PUBLIO_LOCATAIRES_DIR || path.join(__dirname, 'locataires');
const SLUG = /^[a-z0-9][a-z0-9-]{1,30}$/;

const CHAMPS = {
  ig: ['access_token', 'ig_user_id'],
  fb: ['access_token', 'page_id'],
  tt: ['access_token'],
  li: ['access_token', 'author'],
  th: ['access_token', 'user_id'],
};
const RESEAU = { ig:'instagram', fb:'facebook', tt:'tiktok', li:'linkedin', th:'threads' };

function chemin(slug){
  return path.join(DOSSIER, String(slug), 'cles.json');
}
function lireTout(slug){
  if (!SLUG.test(String(slug || ''))) return {};
  try { const j = JSON.parse(fs.readFileSync(chemin(slug), 'utf8')); return (j && typeof j === 'object') ? j : {}; }
  catch(e){ return {}; }
}
/** les clés d'un canal — null si absentes ou slug invalide */
function lire(slug, canal){
  if (!CHAMPS[canal]) return null;
  return lireTout(slug)[canal] || null;
}
/** ce qu'on a le droit de montrer au client : des booléens, rien d'autre */
function liste(slug){
  const tout = lireTout(slug);
  const out = {};
  for (const canal of Object.keys(CHAMPS)){
    out[canal] = !!(tout[canal] && typeof tout[canal].access_token === 'string'
      && tout[canal].access_token.length >= 20);
  }
  return out;
}
function valider(canal, corps){
  if (!CHAMPS[canal]) return 'canal inconnu « ' + canal + ' »';
  const c = corps || {};
  if (typeof c.access_token !== 'string' || c.access_token.trim().length < 20)
    return 'access_token manquant ou trop court — colle le token complet (20 caractères minimum)';
  for (const champ of CHAMPS[canal]){
    if (champ === 'access_token') continue;
    if (typeof c[champ] !== 'string' || !c[champ].trim())
      return champ + ' manquant — '
        + (champ === 'ig_user_id' ? 'l’id du compte Instagram (ex : 17841…)'
          : champ === 'page_id' ? 'l’id de la Page Facebook (ex : 123456789…)'
          : champ === 'user_id' ? 'l’id du compte Threads (ex : 17841…)'
          : 'l’identifiant LinkedIn (ex : urn:li:person:Ab…)');
  }
  if (canal === 'li' && !/^urn:li:(person|organization):/.test(String(c.author || '').trim()))
    return 'author doit ressembler à « urn:li:person:Ab… » ou « urn:li:organization:123… »';
  return null;
}
function ecrire(slug, canal, corps){
  if (!SLUG.test(String(slug || ''))) return { erreur:'compte invalide' };
  const erreur = valider(canal, corps);
  if (erreur) return { erreur };
  const c = {};
  for (const champ of CHAMPS[canal]) c[champ] = String(corps[champ]).trim();
  if (corps.compte) c.compte = String(corps.compte).trim().slice(0, 80);
  // Conserver les informations OAuth nécessaires au renouvellement, sur le serveur uniquement.
  if (typeof corps.refresh_token === 'string' && corps.refresh_token.trim()) c.refresh_token = corps.refresh_token.trim();
  const expiration = Number(corps.expires_at);
  if (Number.isFinite(expiration) && expiration > 0) c.expires_at = expiration;
  if (typeof corps.token_expire === 'string' && Number.isFinite(Date.parse(corps.token_expire))) c.token_expire = new Date(corps.token_expire).toISOString();
  else if (c.expires_at) c.token_expire = new Date(c.expires_at).toISOString();
  if (canal === 'tt') c.mode = (corps.mode === 'direct') ? 'direct' : 'inbox';
  const tout = lireTout(slug);
  tout[canal] = c;
  const tmp = chemin(slug) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(tout, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, chemin(slug));
  try { fs.chmodSync(chemin(slug), 0o600); } catch(e){ /* chmod best-effort */ }
  return { ok:true };
}
function supprimer(slug, canal){
  if (!SLUG.test(String(slug || '')) || !CHAMPS[canal]) return false;
  const tout = lireTout(slug);
  if (!tout[canal]) return false;
  delete tout[canal];
  const tmp = chemin(slug) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(tout, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, chemin(slug));
  try { fs.chmodSync(chemin(slug), 0o600); } catch(e){}
  return true;
}

module.exports = { lire, liste, ecrire, supprimer, CHAMPS, RESEAU };
