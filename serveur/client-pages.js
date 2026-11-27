/* ==============================================================
   client-pages.js — les pages de l'espace client Publio
   Autonomes (aucune ressource externe) : la connexion client
   et le tableau « mon profil / mon abonnement ».
   Le rendu s'appuie sur /api/moi — jamais sur des données en dur.
   ============================================================== */
'use strict';

const COMMUN_CSS = `
:root{
  --papier:#FBF9F6; --encre:#14110F; --encre-2:#56504A; --encre-3:#8C847C;
  --trait:#E4DED7; --publio:#FF5A2B; --publio-pale:#FFF0EA;
  --acc:#E8461A; --acc-pale:rgba(255,90,43,.10);
  --txt:#0B0D12; --txt-2:rgba(60,60,67,.62); --txt-3:rgba(60,60,67,.40);
  --vert:#34C759; --rouge:#FF3B30; --orange-s:#FF9500;
  --r:12px; --r-l:16px; --r-xl:22px;
  --verre:rgba(255,255,255,.74); --bord:rgba(255,255,255,.98);
  --cerne:rgba(124,106,90,.14);
  --diffus:0 10px 32px rgba(120,100,80,.10), 0 2px 8px rgba(120,100,80,.06);
  --ease:cubic-bezier(.32,.72,0,1);
}
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%}
body{font-family:'Space Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  background:var(--papier);color:var(--txt);font-size:13.5px;min-height:100vh;
  -webkit-font-smoothing:antialiased;letter-spacing:-0.006em}
.monde{position:fixed;inset:0;overflow:hidden;z-index:0;
  background:radial-gradient(72% 52% at 0% -8%, rgba(255,90,43,.09) 0%, transparent 62%),
    linear-gradient(180deg,#FBF9F6 0%,#F9F6F2 100%)}
.blob{position:absolute;border-radius:50%;filter:blur(110px);opacity:.45}
.b1{width:52vw;height:52vw;left:-18vw;top:-26vw;background:radial-gradient(circle,#FFD4C2 0%,#FFEBE1 55%,transparent 72%)}
.b2{width:44vw;height:44vw;right:-20vw;top:-16vw;background:radial-gradient(circle,#FFE2CE 0%,#FFF3E9 55%,transparent 72%)}
.b3{width:48vw;height:48vw;left:24vw;bottom:-34vw;background:radial-gradient(circle,#F0E7DB 0%,#F8F3EC 55%,transparent 72%)}
.barre{position:fixed;top:0;left:0;right:0;height:56px;z-index:10;display:flex;align-items:center;
  justify-content:space-between;padding:0 26px;gap:14px;
  background:rgba(251,249,246,.82);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);
  border-bottom:1px solid var(--trait)}
.logo{display:flex;align-items:center;gap:9px;text-decoration:none;color:var(--encre)}
.logo svg{width:24px;height:24px;filter:drop-shadow(0 2px 5px rgba(255,90,43,.30))}
.logo span{font-weight:700;font-size:17px;letter-spacing:-.03em}
.logo i{font-style:normal;color:var(--publio)}
.logo em{font-style:normal;font-size:9px;font-weight:800;letter-spacing:.14em;color:var(--acc);
  background:var(--publio-pale);border-radius:5px;padding:2px 6px;margin-left:2px}
.verre{position:relative;background:var(--verre);
  -webkit-backdrop-filter:blur(26px) saturate(170%);backdrop-filter:blur(26px) saturate(170%);
  border:1px solid var(--bord);border-radius:var(--r-xl);
  box-shadow:var(--diffus),0 1px 0 rgba(255,255,255,1) inset,0 0 0 .5px var(--cerne)}
.carte{background:rgba(255,255,255,.85);border-radius:var(--r-l);
  border:1px solid rgba(255,255,255,.95);
  box-shadow:0 1px 0 rgba(255,255,255,1) inset,0 4px 14px rgba(76,90,130,.07),0 0 0 .5px var(--cerne);
  padding:20px 22px}
.titre-carte{font-size:10.5px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;
  color:var(--txt-3);margin-bottom:14px}
.pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;
  padding:4px 12px;font-size:11.5px;font-weight:700}
.st-actif{background:#e7f8ee;color:#15803d}.st-essai{background:#fff7ed;color:#b45309}
.st-suspendu{background:#fdecea;color:#c0392b}.st-annule{background:rgba(60,60,67,.09);color:var(--txt-3)}
.pill-plan{background:var(--publio-pale);color:var(--acc)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;
  height:38px;padding:0 18px;border-radius:10px;font-size:13.5px;font-weight:600;
  border:none;cursor:pointer;font-family:inherit;transition:.16s var(--ease);white-space:nowrap}
.btn:active{transform:scale(.975)}
.btn-accent{background:linear-gradient(180deg,#FF7A4D,#F04A18);color:#fff;
  border:1px solid rgba(255,255,255,.42);
  box-shadow:0 1px 0 rgba(255,255,255,.5) inset,0 4px 15px rgba(240,74,24,.34)}
.btn-accent:hover{filter:brightness(1.05)}
.btn-verre{background:rgba(255,255,255,.72);color:var(--txt);
  box-shadow:0 1px 0 rgba(255,255,255,1) inset,0 0 0 .5px var(--cerne)}
.btn-verre:hover{background:#fff}
.btn-danger{background:#fff;color:#c0392b;box-shadow:0 0 0 1px #f3c0b8 inset}
.btn-danger:hover{background:#fdf0ee}
.banniere{display:flex;align-items:center;gap:12px;border-radius:var(--r);
  padding:13px 16px;font-size:13px;line-height:1.5;margin-bottom:16px}
.banniere.rouge{background:#fdecea;border:1px solid #f3c0b8;color:#8c2b1e}
.banniere.ambre{background:#fff7ed;border:1px solid #f2d8a7;color:#7a4a00}
.banniere b{display:block}
footer.bas{position:relative;z-index:1;text-align:center;color:var(--txt-3);
  font-size:11px;padding:18px 0 26px}
.spinner{width:15px;height:15px;border:2px solid rgba(240,74,24,.25);
  border-top-color:var(--acc);border-radius:50%;animation:tourne .8s linear infinite}
@keyframes tourne{to{transform:rotate(360deg)}}
`;

const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8.32" fill="#FF5A2B"/><g transform="translate(9.3,7.05) skewX(-11) scale(0.5)" fill="#F8F0E3"><rect width="11" height="36"/><path d="M0 0 H27.2 a9.2 10.3 0 0 1 0 20.6 H0 Z"/><path d="M11 4.6 A5.1 6.0 0 0 1 11 16.6 Z" fill="#FF5A2B"/></g></svg>`;

/* ---------- la page de connexion client ---------- */
const LOGIN_PAGE = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Publio — Espace client</title>
<style>${COMMUN_CSS}
/* ============ BON RETOUR — split écran, repris du style inscription ============ */
.fr{min-height:100vh;display:grid;grid-template-columns:minmax(380px,46%) 1fr}

/* ---- panneau gauche : la promesse ---- */
.marque-cote{position:relative;color:#FBF9F6;overflow:hidden;background:#14110F;
  padding:44px 48px;display:flex;flex-direction:column;gap:0}
.marque-cote::before{content:"";position:absolute;inset:0;
  background:url(/login-photo.jpg) 34% 42%/cover no-repeat;opacity:.62}
.marque-cote::after{content:"";position:absolute;inset:0;
  background:linear-gradient(180deg,rgba(10,9,8,.58) 0%,rgba(10,9,8,.14) 42%,rgba(10,9,8,.72) 100%)}
.mc-haut{position:relative;z-index:2;display:flex;align-items:center;justify-content:space-between}
.mc-logo{display:flex;align-items:center;gap:10px;text-decoration:none;color:#FBF9F6}
.mc-logo svg{width:30px;height:30px}
.mc-logo span{font-weight:700;font-size:19px;letter-spacing:-.035em}
.mc-logo i{font-style:normal;color:var(--publio)}
.mc-url{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:rgba(251,249,246,.82);font-weight:700}
.mc-corps{position:relative;z-index:2;margin-top:auto;margin-bottom:auto;padding:48px 0}
.mc-kicker{font-size:10px;letter-spacing:.26em;text-transform:uppercase;color:#FF8A5C;font-weight:800;margin-bottom:18px}
.mc-titre{font-size:clamp(38px,4.6vw,56px);line-height:1.02;letter-spacing:-.045em;font-weight:700;margin:0 0 18px;max-width:12ch}
.mc-titre em{font-style:normal;color:#FF6B3D}
.mc-sous{font-size:15px;line-height:1.55;color:rgba(251,249,246,.62);max-width:38ch;margin-bottom:30px}
.mc-liste{display:flex;flex-direction:column;gap:14px}
.mc-item{display:flex;gap:12px;align-items:flex-start;font-size:13.5px;color:rgba(251,249,246,.85);line-height:1.45}
.mc-item b{color:#FBF9F6;font-weight:600}
.mc-item .coche{flex:0 0 20px;width:20px;height:20px;border-radius:6px;background:rgba(10,9,8,.35);
  border:1px solid rgba(255,255,255,.35);display:flex;align-items:center;justify-content:center;margin-top:1px}
.mc-item .coche svg{width:11px;height:11px;stroke:#FF8A5C;stroke-width:3;fill:none;stroke-linecap:round;stroke-linejoin:round}
.mc-bas{position:relative;z-index:2;font-size:11px;color:rgba(251,249,246,.55);display:flex;justify-content:space-between;gap:14px;align-items:center;flex-wrap:wrap}
.mc-bas b{color:#FBF9F6;font-weight:700}
.mc-bas a{color:rgba(251,249,246,.75);text-decoration:underline;text-underline-offset:2px}

/* ---- panneau droit : la carte de connexion ---- */
.zone{position:relative;z-index:1;display:flex;align-items:center;justify-content:center;
  padding:48px 28px;
  background:
    radial-gradient(72% 52% at 104% -10%, rgba(255,90,43,.10) 0%, transparent 60%),
    radial-gradient(56% 42% at -6% 108%, rgba(255,90,43,.07) 0%, transparent 62%),
    var(--papier)}
.carte-f{width:100%;max-width:420px}

.cf-logo{display:flex;flex-direction:column;align-items:center;gap:13px;margin-bottom:26px}
.cf-logo svg{width:54px;height:54px;filter:drop-shadow(0 6px 16px rgba(255,90,43,.35))}
.cf-tag{font-size:9.5px;font-weight:800;letter-spacing:.22em;text-transform:uppercase;
  color:var(--acc);background:var(--publio-pale);border-radius:999px;padding:5px 13px}

.titre{font-size:clamp(30px,3.3vw,38px);letter-spacing:-.04em;line-height:1.07;text-align:center;
  font-weight:700;margin:0 0 10px}
.titre b{font-weight:700;color:var(--publio)}
.sous-titre{text-align:center;color:var(--txt-2);font-size:13px;line-height:1.55;margin-bottom:6px}

.lbl{display:block;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;
  color:var(--txt-3);margin:16px 0 7px 2px}
.champ{width:100%;height:54px;border:1.5px solid var(--trait);border-radius:14px;
  padding:0 16px;font:inherit;font-size:16px;background:#fff;outline:none;color:var(--encre);
  transition:border-color .15s,box-shadow .15s}
.champ::placeholder{color:var(--txt-3)}
.champ:focus{border-color:var(--publio);box-shadow:0 0 0 4px var(--acc-pale)}

.erreur{display:none;background:#fdecea;border:1px solid #f3c0b8;color:#8c2b1e;
  border-radius:var(--r);padding:10px 13px;font-size:12.5px;margin-top:14px;line-height:1.5}

.cta{width:100%;height:54px;margin-top:20px;border:0;border-radius:14px;cursor:pointer;
  font:inherit;font-size:15.5px;font-weight:650;color:#fff;letter-spacing:-.01em;
  background:linear-gradient(180deg,#FF6A3D 0%,#F0511D 100%);
  box-shadow:0 3px 9px rgba(240,74,24,.27),inset 0 1px 0 rgba(255,255,255,.28);
  display:flex;align-items:center;justify-content:center;gap:10px;transition:filter .15s,transform .15s}
.cta:hover{filter:brightness(1.04)}
.cta:active{transform:scale(.985)}
.cta:disabled{opacity:.7;cursor:default}
.cta svg{width:17px;height:17px;stroke:#fff;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}

.invite{margin-top:20px;text-align:center;font-size:13px;color:var(--txt-2)}
.invite a{color:var(--acc);font-weight:700;text-decoration:none}
.invite a:hover{text-decoration:underline;text-underline-offset:2px}

.aide{margin-top:14px;text-align:center;font-size:11px;color:var(--txt-3);line-height:1.7}
.aide a{color:inherit;text-decoration:underline;text-underline-offset:2px}

@media (max-width:900px){
  .fr{grid-template-columns:minmax(0,1fr)}
  .marque-cote{padding:20px 24px}
  .mc-corps{margin:0;padding:18px 0 4px}
  .mc-titre{font-size:27px}
  .mc-sous{display:none}
  .mc-liste{display:none}
  .mc-bas{display:none}
  .mc-url{display:none}
  .zone{padding:26px 20px 44px}
}
</style>
</head>
<body>
<div class="fr">

  <!-- Photo : Amar Preciado — licence Pexels · https://www.pexels.com/photo/a-ring-light-and-a-smartphone-8799698/ -->
  <aside class="marque-cote" aria-hidden="true">
    <div class="mc-haut">
      <a class="mc-logo" href="/">${LOGO}<span>Publio<i>.</i></span></a>
      <span class="mc-url">publio.app</span>
    </div>
    <div class="mc-corps">
      <div class="mc-kicker">Ravi de te revoir</div>
      <h1 class="mc-titre">Reprends où <em>tu t'es arrêté.</em></h1>
      <p class="mc-sous">Tes posts planifiés, tes automatisations et tes stats — tout est resté exactement en place.</p>
      <div class="mc-liste">
        <div class="mc-item"><span class="coche"><svg viewBox="0 0 24 24"><path d="m5 12 5 5L20 7"/></svg></span><span><b>Ton calendrier t'attend</b> — rien n'a bougé depuis ta dernière visite.</span></div>
        <div class="mc-item"><span class="coche"><svg viewBox="0 0 24 24"><path d="m5 12 5 5L20 7"/></svg></span><span><b>Instagram, Facebook, TikTok, LinkedIn et YouTube</b> — connexions en préparation.</span></div>
        <div class="mc-item"><span class="coche"><svg viewBox="0 0 24 24"><path d="m5 12 5 5L20 7"/></svg></span><span><b>Un espace séparé</b> pour chaque projet Agence.</span></div>
      </div>
    </div>
    <div class="mc-bas"><span><b>Publio</b> — l'outil de publication qui travaille pendant que tu publies.</span><span><a href="/terms">CGU</a> · <a href="/privacy">Confidentialité</a></span></div>
  </aside>

  <main class="zone">
    <form class="carte-f" id="form-connexion" autocomplete="on">
      <div class="cf-logo">${LOGO}<span class="cf-tag">Espace client</span></div>
      <h1 class="titre">Bon <b>retour.</b></h1>
      <p class="sous-titre">Reconnecte-toi — ton tableau de bord n'a pas changé.</p>

      <label class="lbl" for="email">Email</label>
      <input class="champ" id="email" name="email" type="email" autocomplete="email" required placeholder="toi@exemple.fr" aria-label="Email">

      <label class="lbl" for="mdp">Mot de passe</label>
      <input class="champ" id="mdp" name="mot_de_passe" type="password" autocomplete="current-password" required placeholder="••••••••••••" aria-label="Mot de passe">

      <div class="erreur" id="erreur"></div>

      <button type="submit" class="cta" id="btn-connexion">Se connecter<svg viewBox="0 0 24 24"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></button>

      <p class="invite">Nouveau ici ? <a href="/inscription">Crée ton compte en 30 secondes</a></p>
      <p class="aide">Mot de passe oublié ? Contacte ton interlocuteur Publio.</p>
    </form>
  </main>
</div>

<script>
const form = document.getElementById('form-connexion');
const erreur = document.getElementById('erreur');
const btn = document.getElementById('btn-connexion');
const emailEl = document.getElementById('email');
const mdpEl = document.getElementById('mdp');
function diagnosticEmail(v){
  if (!v) return 'Renseigne ton email — ex : toi@exemple.fr';
  if (/\\s/.test(v)) return 'Pas d’espaces dans une adresse email.';
  const at = v.indexOf('@');
  if (at === -1) return 'Il manque le @ — ex : toi@exemple.fr';
  if (v.indexOf('@', at + 1) !== -1) return 'Un seul @ suffit.';
  const avant = v.slice(0, at), apres = v.slice(at + 1);
  if (!avant) return 'Il manque le nom avant le @.';
  if (!apres) return 'Il manque le domaine après le @ — ex : exemple.fr';
  if (apres.indexOf('.') === -1) return 'Il manque l’extension après le @ — ex : exemple.fr';
  return 'ok';
}
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  erreur.style.display = 'none';
  const dEmail = diagnosticEmail(emailEl.value.trim());
  if (dEmail !== 'ok'){ erreur.textContent = dEmail; erreur.style.display = 'block'; emailEl.focus(); return; }
  if (!mdpEl.value){ erreur.textContent = 'Renseigne ton mot de passe.'; erreur.style.display = 'block'; mdpEl.focus(); return; }
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Connexion…';
  try{
    const r = await fetch('/api/connexion-client', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ email: emailEl.value, mot_de_passe: mdpEl.value }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.ok){ location.href = '/espace'; return; }
    erreur.textContent = data.erreur || 'Email ou mot de passe incorrect — vérifie les deux et réessaie.';
    erreur.style.display = 'block';
  }catch(e2){
    erreur.textContent = 'Le serveur est injoignable — réessaie dans un instant.';
    erreur.style.display = 'block';
  }finally{
    btn.disabled = false;
    btn.innerHTML = 'Se connecter<svg viewBox="0 0 24 24"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';
  }
});
</script>
</body>
</html>`;

/* ---------- l'espace client : la fenêtre avec sidebar ---------- */
const ESPACE_PAGE = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Publio — Mon espace</title>
<style>${COMMUN_CSS}
/* ---------- fenêtre Publio ---------- */
html,body{height:100%}
.fenetre{position:relative;z-index:1;height:100vh;display:grid;
  grid-template-columns:236px minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);
  grid-template-areas:"barre barre" "cote zone";gap:12px;padding:12px}
.toolbar{grid-area:barre}.sidebar{grid-area:cote}.zone{grid-area:zone}
.verre{border-radius:var(--r-xl)}
.toolbar{position:relative;height:52px;display:flex;align-items:center;gap:11px;
  padding:0 14px;overflow:hidden}
.feux{display:flex;gap:8px;flex:0 0 auto;position:relative;z-index:2}
.feu{width:12px;height:12px;border-radius:50%;box-shadow:0 0 0 .5px rgba(0,0,0,.14) inset}
.f1{background:#FF5F57}.f2{background:#FEBC2E}.f3{background:#28C840}
#btn-nav{display:none;width:29px;height:29px;align-items:center;justify-content:center;border-radius:8px;
  background:transparent;border:none;cursor:pointer;color:var(--txt)}
#btn-nav svg{width:17px;height:17px;stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round}
.titre{font-size:13.5px;font-weight:700;letter-spacing:-.02em;position:relative;z-index:2}
.sous{font-size:11px;color:var(--txt-3);margin-top:-2px;position:relative;z-index:2}
.droite{margin-left:auto;display:flex;align-items:center;gap:8px;position:relative;z-index:2}

/* ---------- sidebar ---------- */
.sidebar{display:flex;flex-direction:column;min-height:0;padding-top:14px;padding-bottom:12px}
.marque-sb{display:flex;align-items:center;gap:9px;text-decoration:none;color:var(--encre);
  position:relative;z-index:2;height:30px;padding:0 18px;margin-bottom:12px}
.marque-sb:hover{opacity:.75}
.marque-sb span{font-weight:700;font-size:17px;letter-spacing:-.03em;white-space:nowrap}
.marque-sb i{font-style:normal;color:var(--publio)}
.marque-sb svg{width:24px;height:24px;filter:drop-shadow(0 2px 5px rgba(255,90,43,.30))}
.marque-sb em{font-style:normal;font-size:9px;font-weight:800;letter-spacing:.14em;
  color:var(--acc);background:var(--publio-pale);border-radius:5px;padding:2px 6px;margin-left:2px}
.sb-titre{padding:0 18px 7px;font-size:10.5px;font-weight:700;color:var(--txt-3);
  letter-spacing:.11em;text-transform:uppercase;position:relative;z-index:2}
.sb-groupe{padding:0 10px;display:flex;flex-direction:column;gap:2px;position:relative;z-index:2}
.sb-item{display:flex;align-items:center;gap:10px;height:32px;padding:0 9px;border-radius:9px;
  font-size:13px;width:100%;text-align:left;color:var(--txt);border:none;background:transparent;
  cursor:pointer;font-family:inherit;transition:background .16s var(--ease)}
.sb-item svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.7;
  stroke-linecap:round;stroke-linejoin:round;flex:0 0 auto;opacity:.72}
.sb-item:hover{background:rgba(255,255,255,.62)}
.sb-item.actif{background:rgba(255,255,255,.92);font-weight:500;
  box-shadow:0 1px 0 rgba(255,255,255,1) inset,0 2px 8px rgba(76,90,130,.12),0 0 0 .5px var(--cerne)}
.sb-item.actif svg{opacity:1;stroke:var(--acc)}
.bientot{margin-left:auto;font-size:9px;font-weight:800;letter-spacing:.09em;
  color:var(--acc);background:var(--publio-pale);border-radius:5px;padding:2px 6px;text-transform:uppercase}
.sb-sep{height:1px;margin:12px 18px;background:linear-gradient(90deg,transparent,rgba(60,60,67,.13),transparent)}
.espace-user{margin-top:auto;display:flex;align-items:center;gap:10px;position:relative;z-index:2;
  padding:10px 14px;border-top:1px solid var(--trait)}
.eu-avatar{width:37px;height:37px;border-radius:11px;flex:0 0 auto;display:flex;align-items:center;
  justify-content:center;color:#fff;font-size:13px;font-weight:800;
  background:linear-gradient(145deg,#FF7A4D,#F04A18);box-shadow:0 3px 10px rgba(240,74,24,.30)}
.eu-nom{font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.eu-plan{font-size:10.5px;color:var(--txt-3);margin-top:1px}

/* ---------- zone ---------- */
.zone{display:flex;flex-direction:column;min-width:0;min-height:0}
.vue{position:relative;flex:1;min-height:0;overflow-y:auto;padding:18px;
  display:flex;flex-direction:column;gap:16px;
  background:rgba(255,255,255,.46);border:1px solid rgba(255,255,255,.9);
  border-radius:var(--r-xl);box-shadow:var(--diffus),0 1px 0 rgba(255,255,255,1) inset,0 0 0 .5px var(--cerne)}
.entete{display:flex;align-items:center;gap:16px}
.avatar-grand{width:64px;height:64px;border-radius:18px;flex:0 0 auto;
  background:linear-gradient(145deg,#FF7A4D,#F04A18);color:#fff;display:flex;
  align-items:center;justify-content:center;font-size:23px;font-weight:800;
  box-shadow:0 6px 18px rgba(240,74,24,.35)}
.entete h1{font-size:24px;letter-spacing:-.03em}
.entete p{color:var(--txt-2);font-size:12.5px;margin-top:2px}
.grille{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.ligne{display:flex;justify-content:space-between;align-items:center;gap:12px;
  padding:11px 0;border-bottom:1px solid rgba(60,60,67,.08)}
.ligne:last-child{border-bottom:none;padding-bottom:2px}
.ligne .k{color:var(--txt-3);font-size:12px}
.ligne .v{font-weight:600;font-size:13px;text-align:right}
.prix{font-size:30px;font-weight:800;letter-spacing:-.03em}
.prix small{font-size:12px;font-weight:600;color:var(--txt-3)}
.renouvellement{display:flex;align-items:center;gap:8px;margin-top:12px;
  font-size:12px;color:var(--txt-2);background:var(--publio-pale);
  border-radius:var(--r);padding:9px 12px}
.note{font-size:11px;color:var(--txt-3);line-height:1.6;margin-top:14px;
  border-top:1px solid rgba(60,60,67,.08);padding-top:12px}
.chargement{display:flex;align-items:center;gap:10px;color:var(--txt-2);padding:40px 0}
.voile-nav{position:fixed;inset:0;background:rgba(30,38,60,.26);z-index:25;
  opacity:0;pointer-events:none;transition:opacity .28s var(--ease)}
body.nav-ouvert .voile-nav{opacity:1;pointer-events:auto}
@media(max-width:980px){
  .fenetre{grid-template-columns:minmax(0,1fr);grid-template-areas:"barre" "zone";padding:8px;gap:8px}
  .sidebar{position:fixed;top:0;left:0;bottom:0;width:252px;z-index:30;border-radius:0;
    transform:translateX(-105%);transition:transform .3s var(--ease);
    background:rgba(251,249,246,.92);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px)}
  body.nav-ouvert .sidebar{transform:none;box-shadow:0 30px 78px rgba(110,88,66,.25)}
  #btn-nav{display:flex}
  .feux{display:none}
  .grille{grid-template-columns:1fr}
}
</style>
</head>
<body>
<div class="monde" aria-hidden="true"><div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div></div>

<div class="fenetre">

  <!-- ============ SIDEBAR ============ -->
  <aside class="sidebar verre">
    <a class="marque-sb" href="/espace" aria-label="Publio — mon espace">
      ${LOGO}
      <span>Publio<i>.</i></span><em>MON ESPACE</em>
    </a>

    <div class="sb-titre">Mon compte</div>
    <div class="sb-groupe">
      <button class="sb-item actif" data-scroll="haut">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c.8-4 3.6-6 7.5-6s6.7 2 7.5 6"/></svg>
        <span>Profil</span>
      </button>
      <button class="sb-item" data-scroll="carte-abonnement">
        <svg viewBox="0 0 24 24"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6.5 15h4"/></svg>
        <span>Abonnement</span>
      </button>
      <a class="sb-item" href="/app" style="text-decoration:none;color:inherit">
        <svg viewBox="0 0 24 24"><path d="M13 2 4.5 13H11l-1 9 9-11.5h-6.5z"/></svg>
        <span>Publication</span><span style="margin-left:auto;font-size:11px;color:var(--acc,#ff5a2b)">→</span>
      </a>
      <button class="sb-item" data-scroll="carte-reseaux">
        <svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 1 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 1 0 7 7l1.7-1.7"/></svg>
        <span>Mes réseaux</span>
      </button>
    </div>

    <div class="sb-sep"></div>
    <div class="sb-titre">Session</div>
    <div class="sb-groupe">
      <button class="sb-item" id="btn-deconnexion">
        <svg viewBox="0 0 24 24"><path d="M14 12H3M7 8l-4 4 4 4M10 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H10" transform="translate(0 0) scale(1) translate(0 0)"/></svg>
        <span>Se déconnecter</span>
      </button>
    </div>

    <div class="espace-user">
      <div class="eu-avatar" id="eu-avatar">?</div>
      <div style="min-width:0">
        <div class="eu-nom" id="eu-nom">Chargement…</div>
        <div class="eu-plan" id="eu-plan">—</div>
      </div>
    </div>
  </aside>

  <!-- ============ BARRE ============ -->
  <header class="toolbar verre">
    <div class="feux"><span class="feu f1"></span><span class="feu f2"></span><span class="feu f3"></span></div>
    <button id="btn-nav" aria-label="Afficher la navigation"><svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
    <div>
      <div class="titre">Mon espace</div>
      <div class="sous" id="t-sous">Profil &amp; abonnement</div>
    </div>
    <div class="droite"><span class="pill st-actif" id="t-statut">…</span></div>
  </header>

  <!-- ============ ZONE ============ -->
  <div class="zone">
    <div class="vue" id="vue">
      <div class="chargement" id="chargement"><span class="spinner"></span> Chargement de ton espace…</div>
      <div id="contenu" style="display:none;flex-direction:column;gap:16px"></div>
    </div>
  </div>
</div>

<div class="voile-nav" id="voile-nav"></div>

<script>
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const PLAN_L = { essai:'Essai', starter:'Starter', pro:'Individuel', agence:'Agence' };
const STATUT_L = { essai:'En essai', actif:'Actif', suspendu:'Suspendu', annule:'Annulé' };
const STATUT_CLASSE = { essai:'st-essai', actif:'st-actif', suspendu:'st-suspendu', annule:'st-annule' };
let PLAN_ACTUEL = null; /* plan du client connecté — setté par charger() */
const dateFr = (iso) => { if (!iso) return '—'; const d = new Date(String(iso).length === 10 ? iso + 'T00:00:00' : iso); return isNaN(d) ? '—' : d.toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' }); };

/* repli/navigation mobile */
const ouvrirNav = () => document.body.classList.add('nav-ouvert');
const fermerNav = () => document.body.classList.remove('nav-ouvert');
$('#btn-nav').addEventListener('click', () => document.body.classList.contains('nav-ouvert') ? fermerNav() : ouvrirNav());
$('#voile-nav').addEventListener('click', fermerNav);
const vue = $('#vue');
document.querySelectorAll('[data-scroll]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('[data-scroll]').forEach(x => x.classList.remove('actif'));
  b.classList.add('actif');
  fermerNav();
  const cible = b.dataset.scroll === 'haut' ? null : document.getElementById(b.dataset.scroll);
  vue.scrollTo({ top: cible ? cible.offsetTop - 14 : 0, behavior:'smooth' });
}));

$('#btn-deconnexion').addEventListener('click', async () => {
  try{ await fetch('/api/deconnexion-client', { method:'POST' }); }catch(e){}
  location.href = '/connexion-client';
});

async function charger(){
  try{
    const r = await fetch('/api/moi');
    if (r.status === 401){ location.href = '/connexion-client'; return; }
    const d = await r.json();
    if (r.status === 401){ location.href = '/connexion-client'; return; }
    if (!d.ok){ throw new Error(d.erreur || 'réponse sans détail'); }
    const p = d.profil, a = d.abonnement;
    PLAN_ACTUEL = String(a.plan || 'starter').toLowerCase();
    const q = d.quota; /* rempli uniquement pour Starter (10 posts/mois) */
    const initiales = String(p.nom || '?').trim().split(/\\s+/).slice(0, 2).map(m => m[0] || '').join('').toUpperCase();

    $('#eu-avatar').textContent = initiales;
    $('#eu-nom').textContent = p.nom || '—';
    $('#eu-plan').textContent = 'Plan ' + (PLAN_L[a.plan] || a.plan) + ' · ' + (Number(a.montant) || 0).toLocaleString('fr-FR') + (a.devise === 'DZD' ? ' DA/mois' : ' €/mois');
    $('#t-statut').textContent = STATUT_L[a.statut] || a.statut;
    $('#t-statut').className = 'pill ' + (STATUT_CLASSE[a.statut] || 'st-annule');
    $('#t-sous').textContent = 'Profil & abonnement — ' + esc(p.slug);

    let banniere = '';
    if (a.statut === 'suspendu'){
      banniere = '<div class="banniere rouge"><b>Ton compte est suspendu.</b>Contacte ton interlocuteur Publio pour le réactiver — ta configuration est conservée.</div>';
    } else if (a.statut === 'annule'){
      banniere = '<div class="banniere rouge"><b>Ton abonnement est résilié.</b>Ton espace est en lecture seule. Pour repartir, contacte Publio.</div>';
    } else if (a.statut === 'essai'){
      banniere = '<div class="banniere ambre"><b>Tu es en essai.</b>Ton abonnement de départ t’attend chez Publio quand tu veux passer au plan supérieur.</div>';
    }

    $('#contenu').innerHTML =
      banniere
      + '<div class="entete"><div class="avatar-grand">' + esc(initiales) + '</div>'
      + '<div><h1>' + esc(p.nom) + '</h1><p>Espace <b>' + esc(p.slug) + '</b> · client Publio depuis le ' + dateFr(p.membreISO) + '</p></div>'
      + '</div>'
      + '<div class="grille">'
      +   '<section class="carte" id="carte-profil"><div class="titre-carte">Mon profil</div>'
      +     '<div class="ligne"><span class="k">Nom</span><span class="v">' + esc(p.nom) + '</span></div>'
      +     '<div class="ligne"><span class="k">Email</span><span class="v">' + esc(p.email || '—') + '</span></div>'
      +     '<div class="ligne"><span class="k">Identifiant d’espace</span><span class="v" style="font-family:ui-monospace,Menlo,monospace">' + esc(p.slug) + '</span></div>'
      +     '<div class="ligne"><span class="k">Client depuis</span><span class="v">' + dateFr(p.membreISO) + '</span></div>'
      +     '<div class="note">Tes informations ne sont modifiables que par Publio — c’est voulu : personne ne peut se faire passer pour toi.</div>'
      +   '</section>'
      +   '<section class="carte" id="carte-abonnement"><div class="titre-carte">Mon abonnement</div>'
      +     '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px">'
      +       '<div class="prix">' + (Number(a.montant) || 0).toLocaleString('fr-FR') + (a.devise === 'DZD' ? ' DA' : ' €') + '<small> / mois</small></div>'
      +       '<span class="pill ' + (STATUT_CLASSE[a.statut] || 'st-annule') + '">' + esc(STATUT_L[a.statut] || a.statut) + '</span>'
      +     '</div>'
      +     '<div style="display:flex;gap:8px;margin-top:12px"><span class="pill pill-plan">Plan · ' + esc(PLAN_L[a.plan] || a.plan) + '</span></div>'
      +     (q ? '<div class="ligne"><span class="k">Posts ce mois-ci</span><span class="v"><b>' + esc(String(q.postsMois)) + ' / ' + esc(String(q.max)) + '</b></span></div>' : '')
      +     '<div class="renouvellement"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4.5" width="18" height="17" rx="3"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/></svg>Prochaine échéance : <b>' + dateFr(a.renouvellement) + '</b></div>'
      +     '<div class="note">Pour changer de plan, suspendre ou résilier : contacte ton interlocuteur Publio. Paiement et factures passent par lui.</div>'
      +   '</section>'
      + '</div>'
      + '<section class="carte" id="carte-reseaux"><div class="titre-carte">Mes réseaux</div>'
      + '<p id="reseaux-note" style="display:none;background:var(--publio-pale);color:var(--acc);border-radius:10px;padding:8px 12px;font-size:12px;line-height:1.5;margin:6px 0 12px">Starter : un seul réseau inclus, et un seul changement tous les 30 jours. Déconnecte le tien pour en choisir un autre — ou passe sur Pro.</p>'
      + '<p style="color:var(--txt-2);line-height:1.65;margin-bottom:12px"><b>Un clic, une confirmation, c’est branché.</b> La plateforme elle-même te demande d’autoriser — rien à coller, rien à taper. Le moteur publiera avec <b>ton</b> compte, jamais celui d’un autre. Tes jetons restent cachés sur le serveur.</p>'
      +   '<div id="reseaux-flash" style="display:none;margin-bottom:10px;padding:10px 12px;border-radius:10px;font-size:12.5px;line-height:1.5"></div>'
      +   '<div id="reseaux-liste" style="display:flex;flex-direction:column;gap:10px"></div>'
      + '</section>'
      + '<section class="carte" id="carte-publication"><div class="titre-carte">Ton espace de publication</div>'
      +   '<p style="color:var(--txt-2);line-height:1.65">Ton calendrier, ta file, tes règles et tes statistiques t’attendent — rattachés à <b>' + esc(p.slug) + '</b>, jamais mélangés avec un autre compte.</p>'
      +   '<a class="btn btn-accent" href="/app" style="display:inline-flex;width:auto;margin-top:12px;text-decoration:none">Ouvrir l’interface de publication<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>'
      + '</section>';
    $('#chargement').style.display = 'none';
    $('#contenu').style.display = 'flex';
    initialiserReseaux();
    if (location.hash){
      const cible = document.getElementById(location.hash.slice(1));
      if (cible) vue.scrollTo({ top: cible.offsetTop - 16, behavior:'smooth' });
    }
  }catch(e){
    $('#chargement').innerHTML = '<span style="color:#c0392b">Impossible de charger ton espace (' + ((e && e.message) || e) + '). Recharge la page — si ça persiste, contacte Publio.</span>';
  }
}
/* ===== Mes réseaux — « Connecter mon compte » (OAuth) ===== */
const OAUTH_DE = { ig:'meta', fb:'meta', tt:'tiktok', li:'linkedin' };
const CFG_RESEAUX = [
  { id:'ig', nom:'Instagram', aide:'Compte Pro (Business/Créateur) + Page Facebook liée obligatoire.' },
  { id:'fb', nom:'Facebook', aide:'Une Page Facebook que tu gères.' },
  { id:'tt', nom:'TikTok', aide:'Publications en brouillon chez toi jusqu’à l’audit de l’app TikTok.' },
  { id:'li', nom:'LinkedIn', aide:'Publication sur ton profil (Share on LinkedIn).' },
  { id:'yt', nom:'YouTube', aide:'Connexion et publication bientôt disponibles.', bientot:true },
];
function carteReseau(cfg){
  return '<div class="reseau" style="border:1px solid var(--trait);border-radius:14px;padding:11px 13px;display:flex;align-items:center;gap:12px">'
    + '<div style="min-width:0"><b>' + esc(cfg.nom) + '</b>'
    +   '<div style="font-size:11.5px;color:var(--txt-2);line-height:1.45;margin-top:2px">' + esc(cfg.aide) + '</div></div>'
    +   '<span class="pill" id="pill-' + esc(cfg.id) + '" style="margin-left:auto;font-size:10.5px;letter-spacing:.04em;white-space:nowrap">…</span>'
    +   (cfg.bientot ? '<span style="margin-left:auto;font-size:12px;color:var(--txt-2);white-space:nowrap">Bientôt disponible</span>' : '<button class="btn btn-accent" data-oauth="' + OAUTH_DE[cfg.id] + '" data-canal="' + esc(cfg.id) + '" type="button" style="width:auto;height:36px;font-size:12.5px;white-space:nowrap">Connecter mon compte</button>')
    +   '<button class="btn btn-danger" data-deconn="' + esc(cfg.id) + '" type="button" style="display:none;width:auto;height:36px;font-size:12.5px;white-space:nowrap">Déconnecter</button>'
    + '</div>';
}
let cibleReseaux, flashReseaux;
function messageFlash(ok, texte){
  flashReseaux.textContent = texte;
  flashReseaux.style.background = ok ? '#e7f8ee' : '#fdecea';
  flashReseaux.style.color = ok ? '#15803d' : '#c0392b';
  flashReseaux.style.display = 'block';
}
async function rafraichirReseaux(){
  const d = await fetch('/api/mes-cles').then(r => r.json()).catch(() => null);
  const etat = (d && d.ok && d.canaux) || {};
  const connectes = Object.keys(etat).filter(k => etat[k]).length;
  CFG_RESEAUX.forEach(cfg => {
    const connecte = !!etat[cfg.id];
    const pill = $('#pill-' + cfg.id);
    pill.textContent = connecte ? 'connecté' : 'non connecté';
    pill.style.background = connecte ? '#e7f8ee' : '#f4f1ec';
    pill.style.color = connecte ? '#15803d' : 'var(--txt-2)';
    document.querySelector('[data-deconn="' + cfg.id + '"]').style.display = connecte ? 'inline-flex' : 'none';
    /* starter : un seul réseau — les autres boutons « Connecter » se verrouillent */
    const btn = document.querySelector('[data-oauth="' + OAUTH_DE[cfg.id] + '"][data-canal="' + cfg.id + '"]') ||
                document.querySelector('[data-oauth][data-canal="' + cfg.id + '"]');
    const estStarter = PLAN_ACTUEL === 'starter' || PLAN_ACTUEL === 'essai';
    const bloque = estStarter && connectes >= 1 && !connecte;
    if (btn){ btn.disabled = bloque; btn.style.opacity = bloque ? '.5' : '1';
      btn.title = bloque ? 'Starter : un seul réseau, un changement tous les 30 jours.' : ''; }
  });
  const note = $('#reseaux-note');
  if (note) note.style.display = (PLAN_ACTUEL === 'starter' || PLAN_ACTUEL === 'essai') ? 'block' : 'none';
}
function initialiserReseaux(){
  cibleReseaux = $('#reseaux-liste'); flashReseaux = $('#reseaux-flash');
  cibleReseaux.innerHTML = CFG_RESEAUX.map(carteReseau).join('');
  rafraichirReseaux();
{
  const q = new URLSearchParams(location.search);
  if (q.get('reseaux')){
    messageFlash(q.get('reseaux') === 'ok', q.get('msg') || (q.get('reseaux') === 'ok' ? 'Compte connecté.' : 'La connexion a été refusée ou a échoué — réessaie.'));
    const carte = document.getElementById('carte-reseaux');
    if (carte && vue) vue.scrollTo({ top: carte.offsetTop - 16 });
  }
}
cibleReseaux.addEventListener('click', async (e) => {
  const go = e.target.closest('[data-oauth]');
  if (go){ window.location.href = '/api/oauth/' + go.dataset.oauth + '/start?canal=' + encodeURIComponent(go.dataset.canal) + (window.PUBLIO_PROJET_ACTIF ? '&projet=' + encodeURIComponent(window.PUBLIO_PROJET_ACTIF) : ''); return; }
  const off = e.target.closest('[data-deconn]');
  if (off && !off.disabled){
    off.disabled = true; off.textContent = 'Déconnexion…';
    await fetch('/api/mes-cles/' + off.dataset.deconn, { method:'DELETE' }).catch(() => null);
    off.disabled = false; off.textContent = 'Déconnecter';
    messageFlash(true, 'Compte déconnecté — le moteur ne publie plus dessus.');
    rafraichirReseaux();
  }
});
}

charger();
</script>
</body>
</html>`;

const SIGNUP_PAGE = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Publio — Créer ton compte</title>
<style>${COMMUN_CSS}
/* ============ REJOINS PUBLIO — split écran, 1 question à la fois ============ */
.fr{min-height:100vh;display:grid;grid-template-columns:minmax(380px,46%) 1fr}

/* ---- panneau gauche : la promesse ---- */
.marque-cote{position:relative;color:#FBF9F6;overflow:hidden;background:#14110F;
  padding:44px 48px;display:flex;flex-direction:column;gap:0}
.marque-cote::before{content:"";position:absolute;inset:0;
  background:url(/inscription-photo.jpg) 62% 12%/cover no-repeat;opacity:.28}
.marque-cote::after{content:"";position:absolute;inset:0;
  background:linear-gradient(180deg,rgba(10,9,8,.62) 0%,rgba(10,9,8,.30) 40%,rgba(10,9,8,.74) 100%)}
.mc-haut{position:relative;z-index:2;display:flex;align-items:center;justify-content:space-between}
.mc-logo{display:flex;align-items:center;gap:10px;text-decoration:none;color:#FBF9F6}
.mc-logo svg{width:30px;height:30px}
.mc-logo span{font-weight:700;font-size:19px;letter-spacing:-.035em}
.mc-logo i{font-style:normal;color:var(--publio)}
.mc-url{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:rgba(251,249,246,.82);font-weight:700}
.mc-corps{position:relative;z-index:2;margin-top:auto;margin-bottom:auto;padding:48px 0}
.mc-kicker{font-size:10px;letter-spacing:.26em;text-transform:uppercase;color:#FF8A5C;font-weight:800;margin-bottom:18px}
.mc-titre{font-size:clamp(38px,4.6vw,56px);line-height:1.02;letter-spacing:-.045em;font-weight:700;margin:0 0 18px;max-width:11ch}
.mc-titre em{font-style:normal;color:#FF6B3D}
.mc-sous{font-size:15px;line-height:1.55;color:rgba(251,249,246,.62);max-width:38ch;margin-bottom:30px}
.mc-liste{display:flex;flex-direction:column;gap:14px}
.mc-item{display:flex;gap:12px;align-items:flex-start;font-size:13.5px;color:rgba(251,249,246,.85);line-height:1.45}
.mc-item b{color:#FBF9F6;font-weight:600}
.mc-item .coche{flex:0 0 20px;width:20px;height:20px;border-radius:6px;background:rgba(10,9,8,.35);
  border:1px solid rgba(255,255,255,.35);display:flex;align-items:center;justify-content:center;margin-top:1px}
.mc-item .coche svg{width:11px;height:11px;stroke:#FF8A5C;stroke-width:3;fill:none;stroke-linecap:round;stroke-linejoin:round}
.mc-bas{position:relative;z-index:2;font-size:11px;color:rgba(251,249,246,.55);display:flex;justify-content:space-between;gap:14px;align-items:center}
.mc-bas b{color:#FBF9F6;font-weight:700}

/* ---- panneau droit : 1 question à la fois ---- */
.zone{display:flex;align-items:center;justify-content:center;padding:56px 32px;position:relative;z-index:1}
.carte-f{width:100%;max-width:430px}
.cf-haut{display:flex;align-items:center;justify-content:space-between;margin-bottom:34px}
.cf-compteur{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--txt-3)}
.cf-compteur b{color:var(--acc)}
.retour{display:none;align-items:center;gap:6px;background:none;border:0;font:inherit;font-size:12.5px;
  color:var(--txt-3);cursor:pointer;padding:6px 8px;border-radius:8px;transition:.15s}
.retour:hover{color:var(--encre);background:rgba(20,17,15,.05)}
.retour svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.retour.visible{display:inline-flex}

.progres{display:flex;gap:6px;margin-bottom:34px}
.segment{flex:1;height:4px;border-radius:2px;background:var(--trait);overflow:hidden}
.segment::after{content:"";display:block;height:100%;width:100%;background:linear-gradient(90deg,#FF6B3D,#F0511D);
  transform-origin:left;transform:scaleX(0);transition:transform .45s var(--ease)}
.segment.fait::after{transform:scaleX(1)}

.etape-vue{display:none}
.etape-vue.on{display:block;animation:etape-entre .4s var(--ease) both}
@keyframes etape-entre{0%{opacity:0;transform:translateY(14px)}100%{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.etape-vue.on{animation:none}}

.question{font-size:clamp(26px,3vw,33px);letter-spacing:-.04em;font-weight:700;line-height:1.12;margin:0 0 8px}
.precision{font-size:13px;color:var(--txt-2);margin-bottom:22px;line-height:1.5}

.champ{width:100%;height:56px;border:1.5px solid var(--trait);border-radius:14px;
  padding:0 16px;font:inherit;font-size:17px;background:#fff;outline:none;color:var(--encre);
  transition:border-color .15s,box-shadow .15s}
.champ::placeholder{color:var(--txt-3)}
.champ:focus{border-color:var(--publio);box-shadow:0 0 0 4px var(--acc-pale)}
.aide-champ{font-size:11.5px;color:var(--txt-3);margin-top:8px;min-height:16px}
.aide-champ.ok{color:var(--vert);font-weight:600}

.cta{width:100%;height:52px;margin-top:14px;border:0;border-radius:14px;cursor:pointer;
  font:inherit;font-size:15.5px;font-weight:650;color:#fff;letter-spacing:-.01em;
  background:linear-gradient(180deg,#FF6A3D 0%,#F0511D 100%);
  box-shadow:0 3px 9px rgba(240,74,24,.27),inset 0 1px 0 rgba(255,255,255,.28);
  display:flex;align-items:center;justify-content:center;gap:10px;transition:filter .15s,transform .15s}
.cta:hover{filter:brightness(1.04)}
.cta:active{transform:scale(.985)}
.cta:disabled{opacity:.7;cursor:default}
.cta svg{width:17px;height:17px;stroke:#fff;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}

.duo-label{display:block;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--txt-3);margin:0 0 6px 2px}
.champ-mini{height:52px;font-size:16px}
.reseaux{display:flex;flex-wrap:wrap;gap:10px;margin:4px 0 4px}
.reseau{display:inline-flex;align-items:center;gap:9px;height:46px;padding:0 16px 0 8px;border-radius:999px;
  border:1.5px solid var(--trait);background:#fff;font:inherit;font-size:13px;font-weight:600;color:var(--encre-2);
  cursor:pointer;transition:border-color .15s,background .15s,box-shadow .15s,transform .15s}
.reseau:hover{border-color:var(--publio)}
.reseau:active{transform:scale(.97)}
.rq-ico{width:28px;height:28px;border-radius:9px;display:grid;place-items:center;font-style:normal}
.rq-ico svg{display:block}
.rq-ig{background:#E1306C}.rq-fb{background:#0866FF}.rq-tt{background:#000000}.rq-li{background:#0A66C2}.rq-th{background:#000000}.rq-yt{background:#FF0000}
.reseau.choisi{border-color:var(--publio);background:var(--publio-pale);color:var(--acc);box-shadow:0 0 0 3px var(--acc-pale)}
.reseau.choisi::after{content:"✓";font-weight:800;margin-left:2px}
.touche{display:flex;align-items:center;justify-content:center;gap:7px;margin-top:16px;
  font-size:10.5px;color:var(--txt-3)}
.touche kbd{background:#fff;border:1px solid var(--trait);border-bottom-width:2px;border-radius:6px;
  font:600 10.5px/1 ui-monospace,SFMono-Regular,Menlo,monospace;padding:3px 7px;color:var(--txt-2)}

.essai{display:inline-flex;align-items:center;gap:7px;background:var(--publio-pale);color:var(--acc);
  border-radius:999px;padding:5px 13px;font-size:11px;font-weight:700;margin-bottom:18px}
.essai svg{width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}

.erreur{display:none;background:#fdecea;border:1px solid #f3c0b8;color:#8c2b1e;
  border-radius:var(--r);padding:10px 13px;font-size:12.5px;margin-top:14px}

.lien-bas{text-align:center;font-size:12px;color:var(--txt-3);margin-top:22px;line-height:1.6}
.lien-bas a{color:var(--acc);font-weight:700;text-decoration:none}
.lien-bas a:hover{text-decoration:underline}

@media (max-width:900px){
  .fr{grid-template-columns:minmax(0,1fr)}
  .marque-cote{padding:20px 24px}
  .mc-corps{margin:0;padding:18px 0 4px}
  .mc-titre{font-size:27px;max-width:none}
  .mc-sous{display:none}
  .mc-liste{display:none}
  .mc-bas{display:none}
  .mc-url{display:none}
  .zone{padding:28px 20px 44px}
}
</style>
</head>
<body>
<div class="fr">

  <!-- Photo : Ron Lach — licence Pexels · https://www.pexels.com/photo/person-using-black-smartphone-8371391/ -->
  <aside class="marque-cote" aria-hidden="true">
    <div class="mc-haut">
      <a class="mc-logo" href="/">${LOGO}<span>Publio<i>.</i></span></a>
      <span class="mc-url">publio.app</span>
    </div>
    <div class="mc-corps">
      <div class="mc-kicker">Planifie. Publie. Respire.</div>
      <h1 class="mc-titre">Publie <em>sans y penser.</em></h1>
      <p class="mc-sous">Tes brouillons et médias dans un seul tableau de bord. Connexions, publication et statistiques réelles en préparation.</p>
      <div class="mc-liste">
        <div class="mc-item"><span class="coche"><svg viewBox="0 0 24 24"><path d="m5 12 5 5L20 7"/></svg></span><span><b>30 jours d'essai</b>, sans carte bancaire.</span></div>
        <div class="mc-item"><span class="coche"><svg viewBox="0 0 24 24"><path d="m5 12 5 5L20 7"/></svg></span><span><b>Instagram, Facebook, TikTok et LinkedIn</b> — un seul écran.</span></div>
        <div class="mc-item"><span class="coche"><svg viewBox="0 0 24 24"><path d="m5 12 5 5L20 7"/></svg></span><span><b>Tes données restent chez toi</b> — socle open-source.</span></div>
      </div>
    </div>
    <div class="mc-bas"><span><b>Publio</b> — l'outil de publication qui travaille pendant que tu publies.</span></div>
  </aside>

  <main class="zone">
    <form class="carte-f" id="form-inscription" autocomplete="on" novalidate>

      <div class="cf-haut">
        <span class="cf-compteur">Étape <b id="etape-num">1</b> / 4</span>
        <button type="button" class="retour" id="btn-retour"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>Retour</button>
      </div>

      <div class="progres" aria-hidden="true">
        <div class="segment fait" data-s="1"></div>
        <div class="segment" data-s="2"></div>
        <div class="segment" data-s="3"></div>
        <div class="segment" data-s="4"></div>
      </div>

      <span class="essai"><svg viewBox="0 0 24 24"><path d="M13 2 4.5 13.5H11L9.5 22 18 10.5h-6.5L13 2Z"/></svg>30 jours d'essai — sans carte bancaire</span>

      <section class="etape-vue on" data-etape="1" aria-label="Ton nom">
        <h2 class="question">Comment<br>t'appelles-tu&nbsp;?</h2>
        <p class="precision">Le nom que verra ton équipe — et toi.</p>
        <input class="champ" id="nom" name="nom" type="text" autocomplete="name" required maxlength="120" placeholder="Salon Léa, Atelier Nord…" aria-label="Nom">
        <p class="aide-champ" id="aide-nom"></p>
      </section>

      <section class="etape-vue" data-etape="2" aria-label="Ton email">
        <h2 class="question">Ton email,<br>simplement.</h2>
        <p class="precision">C'est là qu'arrivent tes accès et tes factures. Rien d'autre.</p>
        <input class="champ" id="email" name="email" type="email" autocomplete="email" required inputmode="email" placeholder="toi@exemple.fr" aria-label="Email">
        <p class="aide-champ" id="aide-email"></p>
      </section>

      <section class="etape-vue" data-etape="3" aria-label="Ton mot de passe">
        <h2 class="question">Un mot de passe<br>solide.</h2>
        <p class="precision">8 caractères minimum — confirme-le juste en dessous.</p>
        <label class="duo-label" for="mdp">Mot de passe</label>
        <input class="champ champ-mini" id="mdp" name="mot_de_passe" type="password" autocomplete="new-password" required minlength="8" placeholder="••••••••••••" aria-label="Mot de passe">
        <label class="duo-label" for="mdp2" style="margin-top:12px">Confirme-le</label>
        <input class="champ champ-mini" id="mdp2" name="mot_de_passe_confirmation" type="password" autocomplete="new-password" required minlength="8" placeholder="••••••••••••" aria-label="Confirme ton mot de passe">
        <p class="aide-champ" id="aide-mdp">8 caractères minimum, avec des lettres et des chiffres</p>
      </section>

      <section class="etape-vue" data-etape="4" aria-label="Tes réseaux">
        <h2 class="question">Quels réseaux<br>utilises-tu&nbsp;?</h2>
        <p class="precision">Coche ceux qui comptent pour toi — on les retrouve à l'ouverture de ton espace.</p>
        <div class="reseaux" id="reseaux-choix">
          <button type="button" class="reseau" data-r="ig" aria-pressed="false"><i class="rq-ico rq-ig"><svg viewBox="0 0 24 24" fill="#fff" width="15" height="15" aria-hidden="true"><path d="M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077"/></svg></i>Instagram</button>
          <button type="button" class="reseau" data-r="fb" aria-pressed="false"><i class="rq-ico rq-fb"><svg viewBox="0 0 24 24" fill="#fff" width="15" height="15" aria-hidden="true"><path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z"/></svg></i>Facebook</button>
          <button type="button" class="reseau" data-r="tt" aria-pressed="false"><i class="rq-ico rq-tt"><svg viewBox="0 0 24 24" fill="#fff" width="15" height="15" aria-hidden="true"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg></i>TikTok</button>
          <button type="button" class="reseau" data-r="li" aria-pressed="false"><i class="rq-ico rq-li"><svg viewBox="0 0 24 24" fill="#fff" width="15" height="15" aria-hidden="true"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h0z"/></svg></i>LinkedIn</button>
          <button type="button" class="reseau" data-r="th" aria-pressed="false"><i class="rq-ico rq-th"><svg viewBox="0 0 24 24" fill="#fff" width="15" height="15" aria-hidden="true"><path d="M18.263 11.097c-.03-3.486-1.92-5.586-5.111-5.586-2.13 0-3.922.963-4.863 2.499l2.062 1.438c.535-.843 1.272-1.543 2.628-1.543 1.528 0 2.318.85 2.544 2.431a15 15 0 0 0-2.236-.173c-4.125 0-6.068 1.867-6.068 4.336s1.943 3.99 4.804 3.99c3.139 0 5.013-2.115 5.781-4.735.798.361 1.348 1.204 1.348 2.47 0 3.387-3.907 5.232-7.22 5.232-4.885 0-8.077-3.207-8.077-8.424 0-6.392 4.223-10.487 9.9-10.487 3.808 0 5.69 1.671 6.97 3.914l2.108-1.475C21.44 2.078 18.331 0 13.663 0 6.227 0 1.168 5.277 1.168 12.934c0 7 4.953 11.066 10.856 11.066 4.878 0 9.809-2.846 9.809-7.716 0-2.545-1.46-4.231-3.569-5.187m-6.33 4.855c-1.077 0-2.026-.512-2.026-1.453 0-1.483 1.822-1.934 3.606-1.934.678 0 1.34.045 1.927.173-.422 1.927-1.671 3.215-3.508 3.214Z"/></svg></i>Threads</button>
          <button type="button" class="reseau" data-r="yt" aria-pressed="false"><i class="rq-ico rq-yt"><svg viewBox="0 0 24 24" fill="#fff" width="17" height="17" aria-hidden="true"><path d="M21.6 7.1a2.7 2.7 0 0 0-1.9-1.9C18 4.75 12 4.75 12 4.75s-6 0-7.7.45a2.7 2.7 0 0 0-1.9 1.9A28 28 0 0 0 2 12a28 28 0 0 0 .4 4.9 2.7 2.7 0 0 0 1.9 1.9c1.7.45 7.7.45 7.7.45s6 0 7.7-.45a2.7 2.7 0 0 0 1.9-1.9A28 28 0 0 0 22 12a28 28 0 0 0-.4-4.9ZM10 15.5v-7L16 12l-6 3.5Z"/></svg></i>YouTube</button>
        </div>
        <p class="aide-champ" id="aide-reseaux">Optionnel — tu peux aussi les choisir plus tard. La connexion YouTube n'est pas encore disponible.</p>
      </section>

      <div class="erreur" id="erreur"></div>

      <button type="submit" class="cta" id="btn-inscription"><span id="cta-texte">Continuer</span><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
      <div class="touche"><kbd>Entrée</kbd> pour continuer</div>

      <p class="lien-bas">Déjà un compte ? <a href="/connexion-client">Se connecter</a><br>Ton essai démarre à la création — on t'accompagne le premier mois.</p>
      <p class="lien-bas" style="margin-top:8px;font-size:11px;opacity:.72">En créant ton compte, tu acceptes nos <a href="/terms" style="color:#FF5A2B;text-decoration:none;font-weight:600">CGU</a> et notre <a href="/privacy" style="color:#FF5A2B;text-decoration:none;font-weight:600">politique de confidentialité</a>.</p>
    </form>
  </main>
</div>

<script>
const vues = Array.from(document.querySelectorAll('.etape-vue'));
const segments = Array.from(document.querySelectorAll('.segment'));
const compteur = document.getElementById('etape-num');
const retour = document.getElementById('btn-retour');
const ctaTexte = document.getElementById('cta-texte');
const erreur = document.getElementById('erreur');
const btn = document.getElementById('btn-inscription');
const form = document.getElementById('form-inscription');
let etape = 1;

const champs = { 1: document.getElementById('nom'), 2: document.getElementById('email'), 3: document.getElementById('mdp') };
const aides = { 1: document.getElementById('aide-nom'), 2: document.getElementById('aide-email'), 3: document.getElementById('aide-mdp') };
const mdp2 = document.getElementById('mdp2');
const aideRes = document.getElementById('aide-reseaux');
const choix = new Set();

function valideEmail(v){ return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(v); }

function diagnosticEmail(v){
  if (!v) return '';
  if (/\\s/.test(v)) return 'Pas d’espaces dans une adresse email.';
  const at = v.indexOf('@');
  if (at === -1) return 'Il manque le @ — ex : toi@exemple.fr';
  if (v.indexOf('@', at + 1) !== -1) return 'Un seul @ suffit.';
  const avant = v.slice(0, at), apres = v.slice(at + 1);
  if (!avant) return 'Il manque le nom avant le @.';
  if (!apres) return 'Il manque le domaine après le @ — ex : exemple.fr';
  if (apres.indexOf('.') === -1) return 'Il manque l’extension après le @ — ex : exemple.fr';
  const ext = apres.split('.').pop();
  if (ext.length < 2) return 'L’extension après le point est trop courte.';
  if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]{2,}$/.test(v)) return 'Cette adresse n’est pas valide.';
  return 'ok';
}

function diagnosticMdp(v){
  if (!v) return '';
  if (v.length < 8){ const r = 8 - v.length; return 'Encore ' + r + ' caractère' + (r > 1 ? 's' : '') + ' — 8 minimum'; }
  if (!/[A-Za-zÀ-ÿ]/.test(v)) return 'Ajoute au moins une lettre.';
  if (!/[0-9]/.test(v)) return 'Ajoute au moins un chiffre.';
  return 'ok';
}

function verifier(n){
  if (n === 3){
    const raw = champs[3].value;
    const d = diagnosticMdp(raw);
    if (d !== 'ok'){ aides[3].textContent = d || '8 caractères minimum, avec des lettres et des chiffres'; aides[3].classList.remove('ok'); return false; }
    const m2 = mdp2.value;
    if (!m2){ aides[3].textContent = 'Confirme-le juste en dessous.'; aides[3].classList.remove('ok'); return false; }
    if (m2 !== raw){ aides[3].textContent = 'Les deux mots de passe ne correspondent pas.'; aides[3].classList.remove('ok'); return false; }
    aides[3].textContent = 'Solide — ça correspond.'; aides[3].classList.add('ok'); return true;
  }
  const v = (champs[n].value || '').trim();
  if (n === 1){ const ok = v.length >= 2; aides[n].textContent = ok ? '' : 'Dis-nous ton nom ou ta marque.'; aides[n].classList.toggle('ok', ok && v.length > 0); return ok; }
  if (n === 2){ const d = diagnosticEmail(v); const ok = d === 'ok'; aides[n].textContent = ok ? 'Parfait.' : d; aides[n].classList.toggle('ok', ok); return ok; }
  return true;
}

function aller(n){
  etape = Math.min(4, Math.max(1, n));
  vues.forEach(v => v.classList.toggle('on', +v.dataset.etape === etape));
  segments.forEach(s => s.classList.toggle('fait', +s.dataset.s <= etape));
  compteur.textContent = etape;
  retour.classList.toggle('visible', etape > 1);
  ctaTexte.textContent = etape === 4 ? 'Créer mon compte' : 'Continuer';
  erreur.style.display = 'none';
  const c = champs[etape];
  if (c && c.focus) c.focus({ preventScroll: true });
}

retour.addEventListener('click', () => aller(etape - 1));

new Map([[champs[1], 1], [champs[2], 2], [champs[3], 3], [mdp2, 3]]).forEach((n, c) => {
  c.addEventListener('input', () => verifier(n));
  c.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && etape < 4){ e.preventDefault(); if (verifier(etape)) aller(etape + 1); }
  });
});

document.querySelectorAll('#reseaux-choix .reseau').forEach(b => {
  b.addEventListener('click', () => {
    const id = b.dataset.r;
    if (choix.has(id)) choix.delete(id); else choix.add(id);
    const on = choix.has(id);
    b.classList.toggle('choisi', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    aideRes.textContent = choix.size
      ? choix.size + (choix.size > 1 ? ' réseaux choisis.' : ' réseau choisi.')
      : 'Optionnel — tu peux aussi les choisir plus tard.';
  });
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  erreur.style.display = 'none';
  if (etape < 4){ if (verifier(etape)) aller(etape + 1); return; }
  if (!verifier(3)){ aller(3); return; }

  btn.disabled = true;
  ctaTexte.textContent = 'Création du compte…';
  try{
    const r = await fetch('/api/inscription', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        nom: champs[1].value,
        email: champs[2].value,
        mot_de_passe: champs[3].value,
        reseaux: [...choix],
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.ok){ location.href = '/espace'; return; }
    erreur.textContent = data.erreur || 'La création a échoué — réessaie.';
    erreur.style.display = 'block';
  }catch(e2){
    erreur.textContent = 'Le serveur est injoignable — réessaie dans un instant.';
    erreur.style.display = 'block';
  }finally{
    btn.disabled = false;
    ctaTexte.textContent = 'Créer mon compte';
  }
});

</script>
</body>
</html>`;

module.exports = { LOGIN_PAGE, ESPACE_PAGE, SIGNUP_PAGE };
