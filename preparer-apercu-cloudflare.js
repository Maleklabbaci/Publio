'use strict';
// Prépare uniquement un aperçu public statique : aucun serveur ni compte réel.
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const out = path.join(root, 'publio-apercu');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const banner = `<div id="publio-apercu-notice" style="position:fixed;z-index:2147483647;bottom:12px;left:12px;right:12px;margin:auto;max-width:520px;padding:10px 14px;border-radius:12px;background:#19152b;color:white;font:13px/1.4 system-ui,sans-serif;box-shadow:0 4px 22px #0004;text-align:center">Aperçu : inscription, connexion et fonctions réelles désactivées. <button type="button" onclick="this.parentElement.remove()" aria-label="Fermer le message" style="border:0;background:transparent;color:white;font-size:18px;cursor:pointer;vertical-align:middle">×</button></div>`;
function page(source, target) {
  let html = fs.readFileSync(path.join(root, source), 'utf8');
  html = html.replace(/<head([^>]*)>/i, '<head$1><meta name="robots" content="noindex, nofollow">');
  html = html.replace(/<\/body>/i, banner + '</body>');
  const dest = path.join(out, target); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, html);
}
page('serveur/landing.html', 'index.html');
for (const name of ['produit', 'demarrer', 'packs', 'faq']) page(`serveur/pages-publiques/${name}.html`, `${name}.html`);
for (const name of ['terms', 'privacy', 'mentions']) page(`legal/${name}.html`, `${name}.html`);
for (const file of ['publio-favicon.svg','coworking-v2-1.jpg','coworking-v2-2.jpg','coworking-v2-3.jpg','final-abstract.jpg']) fs.copyFileSync(path.join(root,'serveur',file),path.join(out,file));
const unavailable = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Aperçu Publio</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f5fc;color:#1d1831;font:16px/1.6 system-ui,sans-serif}main{max-width:480px;margin:24px;padding:36px;border-radius:24px;background:white;box-shadow:0 12px 50px #30234818}small{color:#7658b8;font-weight:700;letter-spacing:.08em}h1{font-size:32px;line-height:1.15}a{display:inline-block;margin-top:12px;padding:12px 18px;border-radius:12px;color:white;background:#7452cf;text-decoration:none;font-weight:600}</style></head><body><main><small>PUBLIO · APERÇU</small><h1>Cet espace est en préparation.</h1><p>Ceci est un aperçu des pages publiques. L'inscription, la connexion et l'espace client ne sont pas encore disponibles en ligne.</p><p>Ne renseignez aucune donnée personnelle : il n'y a pas encore de compte actif sur cet aperçu.</p><a href="/">Retour à l'accueil</a></main></body></html>`;
for (const name of ['connexion-client', 'inscription', 'app']) fs.writeFileSync(path.join(out, `${name}.html`), unavailable);
fs.writeFileSync(path.join(out, '_headers'), '/*\n  X-Robots-Tag: noindex, nofollow\n  X-Content-Type-Options: nosniff\n');
console.log('Aperçu statique préparé dans publio-apercu/ ; comptes et API désactivés.');
