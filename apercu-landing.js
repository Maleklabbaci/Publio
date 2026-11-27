'use strict';
// Aperçu strictement local de la landing, sans API ni authentification.
const http = require('http');
const fs = require('fs');
const path = require('path');
const pagesClient = require('./serveur/client-pages.js');
const dossier = path.join(__dirname, 'serveur');
const assets = new Set(['publio-favicon.svg', 'login-photo.jpg', 'inscription-photo.jpg', 'final-abstract.jpg', ...[1,2,3].map(i => `coworking-v2-${i}.jpg`)]);
const types = {'.html':'text/html; charset=utf-8','.jpg':'image/jpeg','.mp4':'video/mp4','.svg':'image/svg+xml'};
const port = Number(process.env.PORT || 4400);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT invalide');
http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
  if (pathname.startsWith('/api/')) { res.writeHead(503, {'Content-Type':'application/json'}); return res.end('{"ok":false,"erreur":"Aperçu uniquement"}'); }
  let fichier;
  if (pathname === '/' || pathname === '/index.html') fichier = path.join(dossier, 'landing.html');
  else if (['/produit','/demarrer','/packs','/faq'].includes(pathname)) fichier = path.join(dossier, 'pages-publiques', pathname.slice(1) + '.html');
  else if (['/terms','/privacy','/mentions'].includes(pathname)) fichier = path.join(__dirname, 'legal', ({'/terms':'terms.html','/privacy':'privacy.html','/mentions':'mentions.html'})[pathname]);
  else if (pathname === '/connexion-client' || pathname === '/inscription') {
    const page = pathname === '/connexion-client' ? pagesClient.LOGIN_PAGE : pagesClient.SIGNUP_PAGE;
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    return res.end(req.method === 'HEAD' ? undefined : page);
  }
  else if (assets.has(pathname.slice(1))) fichier = path.join(dossier, pathname.slice(1));
  else { res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'}); return res.end('Indisponible dans cet aperçu.'); }
  let st; try { st = fs.statSync(fichier); } catch (_) { res.writeHead(404); return res.end(); }
  let debut = 0, fin = st.size - 1, statut = 200;
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m || (!m[1] && !m[2])) { res.writeHead(416, {'Content-Range':`bytes */${st.size}`}); return res.end(); }
    if (m[1]) debut = Number(m[1]); else debut = Math.max(0, st.size - Number(m[2]));
    if (m[1] && m[2]) fin = Math.min(Number(m[2]), fin);
    if (!Number.isSafeInteger(debut) || !Number.isSafeInteger(fin) || debut > fin || debut >= st.size) { res.writeHead(416, {'Content-Range':`bytes */${st.size}`}); return res.end(); }
    statut = 206;
  }
  const h = {'Content-Type':types[path.extname(fichier)] || 'application/octet-stream','Content-Length':fin-debut+1,'Accept-Ranges':'bytes','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  if (statut === 206) h['Content-Range'] = `bytes ${debut}-${fin}/${st.size}`;
  res.writeHead(statut,h);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(fichier,{start:debut,end:fin}).on('error',()=>res.destroy()).pipe(res);
}).listen(port,'127.0.0.1',()=>console.log(`Aperçu local : http://127.0.0.1:${port} — API désactivée`));
