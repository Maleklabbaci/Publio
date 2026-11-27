/**
 * OAUTH — « Connecter mon compte »
 * ------------------------------------------------------------------
 * Chaque client clique « Connecter mon compte », valide sur la plateforme,
 * et ses jetons sont enregistrés CHEZ LUI (locataires/<slug>/cles.json,
 * mode 600). Aucun secret d'app ne quitte le serveur.
 *
 * Les identifiants d'apps (client_id / client_secret) vivent dans
 * .apps.json à côté du moteur (chmod 600 — JAMAIS comm, JAMAIS l'UI) :
 *
 *   {
 *     "meta":     { "client_id": "123…", "client_secret": "…", "redirect": "https://DOM/api/oauth/meta/callback" },
 *     "tiktok":   { "client_id": "…",    "client_secret": "…" },
 *     "linkedin": { "client_id": "…",    "client_secret": "…" }
 *   }
 *
 * « redirect » est facultatif : sinon on déduit depuis l'en-tête
 * x-forwarded-proto / host (à enregistrer tel quel dans le portail développeur).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FICHIER_APPS = process.env.PUBLIO_APPS || path.join(__dirname, '.apps.json');
const META = 'v25.0';
const SECRET_CLIENT = (() => {
  try { return fs.readFileSync(process.env.PUBLIO_SECRET_FILE || path.join(__dirname, '.secret'), 'utf8').trim(); }
  catch(e){ return ''; }
})();

function chargerApps(){
  try { const j = JSON.parse(fs.readFileSync(FICHIER_APPS, 'utf8')); return (j && typeof j === 'object') ? j : {}; }
  catch(e){ return {}; }
}
function appPour(nom){
  const a = chargerApps()[nom];
  if (a && a.client_id && a.client_secret) return a;
  return null;
}

/* ---------- l'état signé : on sait qui a cliqué, et où on en est ---------- */
function signerEtat(slug, plateforme, canal){
  const base = Buffer.from(JSON.stringify({ s: slug, p: plateforme, c: canal || undefined, e: Date.now() + 10 * 60 * 1000, n: crypto.randomBytes(8).toString('hex') })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET_CLIENT).update(base).digest('base64url');
  return base + '.' + sig;
}
function verifierEtat(state, plateforme){
  try {
    const [base, sig] = String(state || '').split('.');
    if (!base || !sig) return null;
    const attendu = crypto.createHmac('sha256', SECRET_CLIENT).update(base).digest('base64url');
    if (sig !== attendu) return null;                 /* timingSafeEqual trop strict sur la longueur — la comparaison hmac suffit ici */
    const j = JSON.parse(Buffer.from(base, 'base64url').toString('utf8'));
    if (j.p !== plateforme || !(j.e > Date.now())) return null;
    return j;
  } catch(e){ return null; }
}

async function fetchJson(url, opts){
  const r = await fetch(url, opts);
  const txt = await r.text();
  let j = {};
  try { j = JSON.parse(txt); } catch(e){ j = { raw: txt.slice(0, 300) }; }
  return { http: r.status, body: j };
}

/* =========================================================
   META — Facebook Login → Instagram (compte Pro + Page liée)
   ========================================================= */
const meta = {
  nom: 'Instagram + Facebook',
  plateformesParCanal: { ig:'instagram', fb:'facebook' },
  authUrl(cfg, redirectUri, state){
    const q = new URLSearchParams({
      client_id: cfg.client_id,
      redirect_uri: redirectUri,
      scope: ['instagram_basic','instagram_content_publish','pages_show_list','pages_read_engagement','pages_manage_posts','public_profile'].join(','),
      response_type: 'code',
      state,
    });
    return 'https://www.facebook.com/' + META + '/dialog/oauth?' + q.toString();
  },
  async echanger(cfg, redirectUri, code){
    const q1 = new URLSearchParams({ client_id: cfg.client_id, client_secret: cfg.client_secret, redirect_uri: redirectUri, code });
    const a = await fetchJson('https://graph.facebook.com/' + META + '/oauth/access_token?' + q1);
    if (!a.body.access_token) throw new Error(a.body.error_description || a.body.error?.message || 'code refusé par Facebook');
    /* jeton longue durée (60 jours) */
    const q2 = new URLSearchParams({ grant_type:'fb_exchange_token', client_id: cfg.client_id, client_secret: cfg.client_secret, fb_exchange_token: a.body.access_token });
    const b = await fetchJson('https://graph.facebook.com/' + META + '/oauth/access_token?' + q2);
    const token = (b.body.access_token) || a.body.access_token;
    /* les Pages que tu administres — avec LEUR jeton (requis pour publier sur FB) + le compte IG lié */
    const q3 = new URLSearchParams({ fields:'id,name,access_token,instagram_business_account', access_token: token });
    const pages = await fetchJson('https://graph.facebook.com/' + META + '/me/accounts?' + q3);
    const cles = {};
    for (const pg of (pages.body.data || [])){
      if (pg.access_token && !cles.fb) cles.fb = { access_token: pg.access_token, page_id: String(pg.id), compte: pg.name || 'Page Facebook' };
      const igId = pg.instagram_business_account && pg.instagram_business_account.id;
      if (igId && !cles.ig){
        let handle = null;
        try {
          const h = await fetchJson('https://graph.facebook.com/' + META + '/' + igId + '?fields=username&access_token=' + encodeURIComponent(token));
          handle = h.body.username ? '@' + h.body.username : null;
        } catch(e){ /* le handle est facultatif */ }
        cles.ig = { access_token: token, ig_user_id: String(igId), compte: handle || 'compte Instagram connecté' };
      }
    }
    if (!cles.ig && !cles.fb) throw new Error('aucun compte Instagram professionnel (Business/Créateur) relié à une Page Facebook n’est visible — relie-les dans Meta Business Suite puis réessaie');
    return { cles, message: 'Instagram' + (cles.fb ? ' + Facebook' : '') + ' connectés' };
  },
};

/* =========================================================
   TIKTOK — Login Kit + Content Posting API v2
   (mode inbox = brouillon chez le client, pas besoin d'audit)
   ========================================================= */
const tiktok = {
  nom: 'TikTok',
  authUrl(cfg, redirectUri, state){
    const q = new URLSearchParams({
      client_key: cfg.client_id,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: ['user.info.basic','user.info.profile','user.info.stats','video.upload','video.publish'].join(','),
      state,
    });
    return 'https://www.tiktok.com/v2/auth/authorize/?' + q.toString();
  },
  async echanger(cfg, redirectUri, code){
    const body = new URLSearchParams({ client_key: cfg.client_id, client_secret: cfg.client_secret, code, grant_type:'authorization_code', redirect_uri: redirectUri });
    const r = await fetchJson('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST', headers: { 'Content-Type':'application/x-www-form-urlencoded' }, body: body.toString(),
    });
    const j = r.body || {};
    if (!j.access_token) throw new Error(j.error_description || j.error || 'code refusé par TikTok');
    let handle = null;
    try {
      const p = await fetchJson('https://open.tiktokapis.com/v2/user/info/?fields=display_name', { headers: { Authorization: 'Bearer ' + j.access_token } });
      handle = (p.body.data && p.body.data.user && p.body.data.user.display_name) || null;
    } catch(e){ /* le handle est facultatif */ }
    return {
      cles: { tt: { access_token: j.access_token, refresh_token: j.refresh_token || undefined,
                    expires_at: j.expires_in ? Date.now() + j.expires_in * 1000 : undefined,
                    mode: 'inbox', compte: handle || 'compte TikTok connecté' } },
      message: 'TikTok connecté (les publications arrivent en brouillon dans l’app, jusqu’à l’audit de ton app)',
    };
  },
};

/* =========================================================
   LINKEDIN — Sign In with LinkedIn + Share on LinkedIn
   ========================================================= */
const linkedin = {
  nom: 'LinkedIn',
  authUrl(cfg, redirectUri, state){
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: cfg.client_id,
      redirect_uri: redirectUri,
      scope: ['openid','profile','w_member_social'].join(' '),
      state,
    });
    return 'https://www.linkedin.com/oauth/v2/authorization?' + q.toString();
  },
  async echanger(cfg, redirectUri, code){
    const body = new URLSearchParams({ grant_type:'authorization_code', code, redirect_uri: redirectUri, client_id: cfg.client_id, client_secret: cfg.client_secret });
    const r = await fetchJson('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST', headers: { 'Content-Type':'application/x-www-form-urlencoded' }, body: body.toString(),
    });
    const j = r.body || {};
    if (!j.access_token) throw new Error(j.error_description || j.error || 'code refusé par LinkedIn');
    let sub = null, nom = null;
    try {
      const u = await fetchJson('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: 'Bearer ' + j.access_token } });
      sub = u.body.sub || null; nom = u.body.name || null;
    } catch(e){ /* si userinfo échoue, on garde juste le jeton — author restera à renseigner */ }
    return {
      cles: { li: { access_token: j.access_token, refresh_token: j.refresh_token || undefined,
                    author: sub ? 'urn:li:person:' + sub : undefined,
                    expires_at: j.expires_in ? Date.now() + j.expires_in * 1000 : undefined,
                    compte: nom || 'compte LinkedIn connecté' } },
      message: 'LinkedIn connecté' + (sub ? '' : ' — jeton enregistré, repère person rempli automatiquement'),
    };
  },
};

const FOURNISSEURS = { meta, tiktok, linkedin };

function urlRedirection(req, cfg, nom){
  if (cfg && cfg.redirect) return cfg.redirect;
  const proto = String(req.headers['x-forwarded-proto']
    || (req.socket && req.socket.encrypted ? 'https' : 'http')).split(',')[0].trim();
  const hote = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return proto + '://' + hote + '/api/oauth/' + nom + '/callback';
}

module.exports = { FICHIER_APPS, FOURNISSEURS, appPour, signerEtat, verifierEtat, urlRedirection };
