/** Médias privés : un dossier par client, identifiants aléatoires, jamais de chemin fourni par le navigateur. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MAX = 64 * 1024 * 1024;
const MIME = new Set(['image/jpeg','image/png','image/webp','video/mp4','video/quicktime']);
function valideSignature(b, mime) {
  if (mime === 'image/jpeg') return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mime === 'image/png') return b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
  if (mime === 'image/webp') return b.length >= 12 && b.toString('ascii',0,4) === 'RIFF' && b.toString('ascii',8,12) === 'WEBP';
  if (mime === 'video/mp4' || mime === 'video/quicktime') return b.length >= 12 && b.toString('ascii',4,8) === 'ftyp';
  return false;
}
async function recevoir(req, dossier) {
  const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!MIME.has(mime)) return { erreur:'Formats acceptés : JPEG, PNG, WebP, MP4 ou MOV.', code:415 };
  const longueur = Number(req.headers['content-length']);
  if (Number.isFinite(longueur) && longueur > MAX) return { erreur:'Le fichier dépasse 64 Mo.', code:413 };
  const id = crypto.randomBytes(16).toString('hex');
  const dir = path.join(dossier, 'medias');
  fs.mkdirSync(dir, {recursive:true, mode:0o700});
  const fichier = path.join(dir, id);
  let f, total = 0, debut = Buffer.alloc(0);
  try {
    f = await fs.promises.open(fichier, 'wx', 0o600);
    for await (const morceau of req) {
      total += morceau.length;
      if (total > MAX) throw Object.assign(new Error('Le fichier dépasse 64 Mo.'), {codeHTTP:413});
      if (debut.length < 16) debut = Buffer.concat([debut, morceau.subarray(0, 16 - debut.length)]);
      await f.writeFile(morceau);
    }
    if (!valideSignature(debut, mime)) throw Object.assign(new Error('Le fichier ne correspond pas au format indiqué.'), {codeHTTP:415});
    await f.close(); f = null;
    let nom = ''; try { nom = decodeURIComponent(String(req.headers['x-filename'] || '')); } catch (_) {}
    nom = nom.replace(/[\x00-\x1f\x7f/\\]/g, '').trim().slice(0, 160) || (mime.startsWith('video/') ? 'Vidéo' : 'Image');
    return { ok:true, media:{ id, nom, mime, taille:total, type:mime.startsWith('video/') ? 'video' : 'image', cree:new Date().toISOString() } };
  } catch(e) {
    if (f) try { await f.close(); } catch (_) {}
    try { await fs.promises.unlink(fichier); } catch (_) {}
    return { erreur:e.codeHTTP ? e.message : 'Impossible de sauvegarder ce fichier.', code:e.codeHTTP || 500 };
  }
}
function envoyer(req,res,dossier,media){
  if (!media || !/^[a-f0-9]{32}$/.test(media.id) || !MIME.has(media.mime)) return false;
  const fichier = path.join(dossier, 'medias', media.id);
  let st; try { st = fs.statSync(fichier); if (!st.isFile()) return false; } catch (_) { return false; }
  const headers = {'Content-Type':media.mime,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store', 'Accept-Ranges':'bytes', 'Content-Disposition':'inline'};
  let debut = 0, fin = st.size - 1, code = 200;
  if (req.headers.range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!m || (!m[1] && !m[2])) { res.writeHead(416, {'Content-Range':'bytes */'+st.size}); res.end(); return true; }
    if (!m[1]) { const n = Number(m[2]); debut = Math.max(st.size - n, 0); }
    else { debut = Number(m[1]); if (m[2]) fin = Math.min(Number(m[2]), fin); }
    if (debut >= st.size || debut > fin) { res.writeHead(416, {'Content-Range':'bytes */'+st.size}); res.end(); return true; }
    headers['Content-Range'] = `bytes ${debut}-${fin}/${st.size}`; code = 206;
  }
  headers['Content-Length'] = fin-debut+1;
  res.writeHead(code, headers);
  if (req.method === 'HEAD') res.end();
  else fs.createReadStream(fichier, {start:debut,end:fin}).on('error',()=>res.destroy()).pipe(res);
  return true;
}
module.exports = { recevoir, envoyer, valideSignature, MAX };
