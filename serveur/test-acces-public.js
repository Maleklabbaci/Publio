'use strict';
// Test HTTP non destructif contre un serveur Publio démarré (PORT=4403 par défaut).
const assert = require('assert');
const base = process.env.PUBLIO_URL_TEST || 'http://127.0.0.1:4403';
(async () => {
  for (const chemin of ['/moteur.js', '/oauth.js', '/client-pages.js', '/locataires.json', '/publio.json', '/.secret', '/automatisations/file-automatisations.js', '/autre/app-publio.html', '/autre/moteur.js']) {
    const r = await fetch(base + chemin, {redirect:'manual'});
    assert.strictEqual(r.status, 404, chemin + ' ne doit pas être public');
  }
  for (const chemin of ['/publio-favicon.svg', '/login-photo.jpg', '/inscription-photo.jpg', '/final-abstract.jpg', '/coworking-v2-1.jpg', '/coworking-v2-2.jpg', '/coworking-v2-3.jpg']) {
    const r = await fetch(base + chemin, {method:'HEAD', redirect:'manual'});
    assert.strictEqual(r.status, 200, chemin + ' doit rester accessible');
  }
  console.log('OK ressources publiques, code serveur et données non exposés, faux chemins refusés.');
})().catch(e => { console.error(e); process.exitCode = 1; });
