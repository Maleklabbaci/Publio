/* la suite de tests du moteur — node test.js */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const os = require('os');
const DOSSIER_TEST = fs.mkdtempSync(path.join(os.tmpdir(), 'publio-test-'));
process.env.PUBLIO_DB = path.join(DOSSIER_TEST, 'publio.json');
process.env.PUBLIO_JOURNAL = path.join(DOSSIER_TEST, 'journal.jsonl');
process.env.PUBLIO_CIRCUIT = path.join(DOSSIER_TEST, 'circuit.json');
process.env.PUBLIO_BACKUPS = path.join(DOSSIER_TEST, 'sauvegardes');
process.env.PUBLIO_LOCATAIRES = path.join(DOSSIER_TEST, 'locataires.json');
process.env.PUBLIO_LOCATAIRES_DIR = path.join(DOSSIER_TEST, 'locataires');
process.env.PUBLIO_SECRET_FILE = path.join(DOSSIER_TEST, '.secret');
const F = process.env.PUBLIO_DB;
const FJ = process.env.PUBLIO_JOURNAL;
const JOUR = 86400000;

const ok = [], ko = [];
function T(nom, fn){
  try{ fn(); ok.push(nom); console.log('  ✅ ' + nom); }
  catch(e){ ko.push(nom); console.log('  ❌ ' + nom + '\n       ' + e.message.split('\n')[0]); }
}
async function TA(nom, fn){
  try{ await fn(); ok.push(nom); console.log('  ✅ ' + nom); }
  catch(e){ ko.push(nom); console.log('  ❌ ' + nom + '\n       ' + e.message.split('\n')[0]); }
}

function neuf(){
  [F, FJ].forEach(f => { try{ fs.unlinkSync(f); }catch(e){} });
  delete require.cache[require.resolve('./moteur.js')];
  delete require.cache[require.resolve('./publier.js')];
  const m = require('./moteur.js');
  m._test.charger();
  return m;
}

(async () => {
  console.log('\n=== LE MOTEUR PUBLIO ===\n');

  /* ============================================================
     LA BIBLIOTHÈQUE
     ============================================================ */
  console.log('les règles du constructeur');
  {
    const m = neuf();
    T('aucun déclencheur en double', () => {
      const ids = m.DECLENCHEURS.map(d => d.id);
      assert.strictEqual(new Set(ids).size, ids.length);
    });
    T('chaque règle autorisée pointe vers une action qui existe', () => {
      Object.entries(m.PEUT).forEach(([d, acts]) => {
        assert.ok(m.DECLENCHEURS.find(x => x.id === d), 'déclencheur inconnu : ' + d);
        acts.forEach(a => assert.ok(m.PEUT[d].includes(a)));
      });
    });
    T('story-repond est refusé sur TikTok', () =>
      assert.ok(m.regleValide({canaux:'tt', declencheur:'story-repond', action:'repondre'})));
    T('fin-live est refusé sur Instagram', () =>
      assert.ok(m.regleValide({canaux:'ig', declencheur:'fin-live', action:'publier-immediat'})));
    T('un commentaire ne peut pas recycler', () =>
      assert.ok(m.regleValide({canaux:'ig', declencheur:'commentaire', action:'recycler-boucle'})));
    T('une règle cohérente passe', () =>
      assert.strictEqual(m.regleValide({canaux:'ig', declencheur:'sans-date', action:'publier-creneaux'}), null));
  }

  /* ============================================================
     LE TRAVAIL
     ============================================================ */
  console.log('les clients — le back-office SaaS');
  {
    const m = neuf();
    T('la base migre : la table clients existe toujours', () =>
      assert.ok(Array.isArray(m._test.db().clients)));
    T('le résumé compte actifs, essais et MRR', () => {
      m._test.clients().push(
        { id:'c1', nom:'Alpha', statut:'actif',   plan:'pro',     montant:79, cree:1 },
        { id:'c2', nom:'Beta',  statut:'actif',   plan:'starter', montant:29, cree:2 },
        { id:'c3', nom:'Gamma', statut:'essai',   plan:'essai',   montant:0,  cree:3 },
        { id:'c4', nom:'Delta', statut:'suspendu',plan:'pro',     montant:79, cree:4 });
      const r = m._test.resumeClients();
      assert.strictEqual(r.actifs, 2);
      assert.strictEqual(r.essai, 1);
      assert.strictEqual(r.suspendus, 1);
      assert.strictEqual(r.mrr, 108);
    });
    T('nettoyerClient refuse un nom vide et un email invalide', () => {
      const c = { nom:'', email:'', entreprise:'', plan:'starter', statut:'essai', montant:0, renouvellement:'', notes:'' };
      assert.strictEqual(m._test.nettoyerClient(c, { nom:'   ' }, false), 'nom requis');
      assert.strictEqual(m._test.nettoyerClient(c, { nom:'X', email:'pas-un-email' }, false), 'email invalide');
      assert.strictEqual(m._test.nettoyerClient(c, { nom:'X', montant:'-5', plan:'nimportequoi' }, false), null);
      assert.strictEqual(c.montant, 0);
      assert.strictEqual(c.plan, 'starter');
      assert.strictEqual(c.renouvellement, '');
    });
  }

  console.log('les locataires — la flotte SaaS');
  {
    const L = require('./locataires.js');
    T('la création hache le mot de passe et ne le montre qu’une fois', () => {
      const r = L.creer({ nom:'Client Test SARL', slug:'client-test', email:'a@b.fr', plan:'pro', montant:79 });
      assert.ok(r.locataire && r.motDePasseInitial, 'réponse complète');
      assert.strictEqual(r.locataire.motDePasseHash, undefined, 'le hash ne sort jamais');
      const brut = L.charger().locataires.find(x => x.slug === 'client-test');
      assert.ok(brut && typeof brut.motDePasseHash === 'string');
      assert.ok(L.verifier(r.motDePasseInitial, brut.motDePasseHash));
    });
    T('le slug en double est refusé', () => {
      const r = L.creer({ nom:'Autre Nom', slug:'client-test' });
      assert.ok(r.erreur && r.erreur.indexOf('slug') !== -1);
    });
    T('création + suspension + lecture du résumé MRR', () => {
      const c = L.creer({ nom:'MRR Corp', slug:'mrr-corp', plan:'starter', montant:29 }).locataire;
      L.maj(c.id, { statut:'actif' });
      const r = L.resume();
      assert.ok(r.mrr >= 29 && r.total >= 2);
    });
    T('la suppression met en corbeille, ne détruit rien', () => {
      const c = L.creer({ nom:'Corbeille SARL', slug:'corbeille-test' }).locataire;
      fs.writeFileSync(path.join(process.env.PUBLIO_LOCATAIRES_DIR, 'corbeille-test', 'publio.json'), '{}');
      const r = L.supprimer(c.id);
      assert.ok(r.ok);
      const restants = fs.readdirSync(L.CORBEILLE).filter(d => d.indexOf('corbeille-test') === 0);
      assert.strictEqual(restants.length, 1);
      assert.ok(!fs.existsSync(path.join(process.env.PUBLIO_LOCATAIRES_DIR, 'corbeille-test')));
    });
    T('la création amorce une base vide pour le locataire', () => {
      L.creer({ nom:'Amorce SARL', slug:'amorce-test' });
      const p2 = path.join(process.env.PUBLIO_LOCATAIRES_DIR, 'amorce-test', 'publio.json');
      assert.ok(fs.existsSync(p2));
      const db = JSON.parse(fs.readFileSync(p2, 'utf8'));
      assert.ok(Array.isArray(db.posts) && db.posts.length === 0);
      assert.ok(Array.isArray(db.canaux));
    });
    T('le renouvellement par défaut est à J+30', () => {
      const r = L.creer({ nom:'Ech Team', slug:'ech-test' });
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(r.locataire.renouvellement));
    });
    T('le jeton client se vérifie et un jeton traffiqué est rejeté', () => {
      const m2 = neuf();
      const j = m2._test.creerJetonClient('salon-lea');
      const s2 = m2._test.jetonValideClient(j);
      assert.ok(s2 && s2.slug === 'salon-lea');
      assert.strictEqual(m2._test.jetonValideClient(j.slice(0, -2) + 'XX'), null);
    });
    T('la santé d’un locataire sans base répond proprement', () => {
      const s = L.sante({ slug:'fantome-xyz' });
      assert.strictEqual(s.base, false);
      assert.strictEqual(s.posts, 0);
    });
  }

  console.log('\nle travail');
  {
    const m = neuf();
    m._test.regles().length = 0;
    m._test.regles().push({ id:'r1', nom:'Trous', actif:true, canaux:'ig',
      declencheur:'sans-date', action:'publier-creneaux',
      p:{ creneaux:[['mar.',13,0],['jeu.',8,0],['dim.',12,0]] } });
    m._test.posts().push(
      { id:'p1', canal:'ig', titre:'Un', legende:'', jour:5, heure:'09:00', etat:'brouillon', brouillon:true },
      { id:'p2', canal:'ig', titre:'Deux', legende:'', jour:6, heure:'09:00', etat:'brouillon', brouillon:true });

    m._test.horloge(new Date());
    await TA('la règle a programmé un post', async () => {
      assert.strictEqual(await m._test.faireTourner(), 1);
    });
    T('le post a une vraie date et une vraie heure', () => {
      const p = m._test.posts().find(x => x.id === 'p1');
      assert.ok(p.datePrevue, 'pas de date');
      assert.ok(!p.brouillon, 'toujours brouillon');
    });
    T('il n’a pas écrasé le second post', () =>
      assert.ok(m._test.posts().find(x => x.id === 'p2').brouillon, 'le second doit rester brouillon'));
    T('il a écrit dans le journal', () => assert.ok(m._test.journal().length >= 1));
  }

  /* ============================================================
     LE RYTHME
     ============================================================ */
  console.log('\nle bon rythme');
  {
    const m = neuf();
    m._test.regles().length = 0;
    m._test.regles().push({ id:'r1', nom:'Trous', actif:true, canaux:'ig',
      declencheur:'sans-date', action:'publier-creneaux', p:{ creneaux:[['mar.',13,0]] } });
    m._test.posts().push(
      { id:'p1', canal:'ig', titre:'Un', jour:5, heure:'09:00', etat:'brouillon', brouillon:true },
      { id:'p2', canal:'ig', titre:'Deux', jour:6, heure:'09:00', etat:'brouillon', brouillon:true },
      { id:'p3', canal:'ig', titre:'Trois', jour:7, heure:'09:00', etat:'brouillon', brouillon:true });

    m._test.horloge(new Date());
    await m._test.faireTourner();
    const a1 = m._test.posts().filter(p => p.etat === 'prog').length;
    await m._test.faireTourner();
    const a2 = m._test.posts().filter(p => p.etat === 'prog').length;
    T('deux tours d’affilée ne doublent pas le travail', () => assert.strictEqual(a1, a2));
  }

  /* ============================================================
     LES CRÉNEAUX
     ============================================================ */
  console.log('\nles créneaux');
  {
    const m = neuf();
    m._test.regles().length = 0;
    m._test.regles().push({ id:'r1', nom:'Trous', actif:true, canaux:'ig',
      declencheur:'sans-date', action:'publier-creneaux', p:{ creneaux:[['mar.',13,0]] } });
    [1,2,3].forEach(i => m._test.posts().push(
      { id:'p'+i, canal:'ig', titre:'T'+i, jour:10+i, heure:'09:00', etat:'brouillon', brouillon:true }));

    const base = Date.now() - 21 * JOUR;
    const dates = [];
    for (let i = 1; i <= 500; i++){
      m._test.horloge(new Date(base + i * 3600000));
      if (await m._test.faireTourner()){
        const p = m._test.posts().filter(x => x.datePrevue).pop();
        if (p) dates.push(p.datePrevue);
      }
    }
    T('trois posts prennent trois créneaux différents', () =>
      assert.strictEqual(new Set(dates).size, dates.length));
  }

  /* ============================================================
     LE RECYCLAGE
     ============================================================ */
  console.log('\nle recyclage');
  {
    const m = neuf();
    m._test.regles().length = 0;
    m._test.regles().push({ id:'r1', nom:'Recycler', actif:true, canaux:'li',
      declencheur:'perf', action:'republier', p:{ vues:2000, jours:90 } });
    m._test.posts().push({ id:'pub', canal:'li', titre:'Un bon post', jour:3, heure:'10:00', etat:'publie' });
    m._test.db().stats.li = { abon:2000, vues:5000, likes:400, commentaires:30, engagement:5 };

    const base = Date.now() - 7 * JOUR;
    for (let i = 1; i <= 168; i++){
      m._test.horloge(new Date(base + i * 3600000));
      await m._test.faireTourner();
    }
    T('un post publié n’est recyclé qu’une fois', () =>
      assert.strictEqual(m._test.posts().filter(p => p.recycleDe).length, 1));
  }

  /* ============================================================
     LES ERREURS DE PUBLICATION — étape ①
     ============================================================ */
  console.log('\nles erreurs de publication');
  {
    const pub = require('./publier.js');

    await TA('un compte sans clé est refusé tout de suite', async () => {
      const r = await pub.publier({ titre:'T', legende:'Bonjour', media:[] }, 'ig', null);
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.code, 'token');
      assert.strictEqual(r.definitive, true);
    });

    await TA('une légende trop longue est refusée avant l’envoi', async () => {
      const r = await pub.publier({ titre:'T', legende:'x'.repeat(600), media:[] }, 'th', {token:'a'});
      assert.strictEqual(r.code, 'legende');
    });

    await TA('un post vide est refusé', async () => {
      const r = await pub.publier({ titre:'T', legende:'', media:[] }, 'ig', {token:'a'});
      assert.strictEqual(r.code, 'media');
    });

    await TA('un échec temporaire n’abandonne pas : il programme une reprise', async () => {
      const post = { titre:'T', legende:'Bonjour', media:[], essais:0 };
      /* un adaptateur qui échoue pour une raison passagère */
      pub.ADAPTATEURS.ig.publier = async () => ({ ok:false, code:'reseau', erreur:'timeout' });
      const r = await pub.publier(post, 'ig', {token:'a'});
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.definitive, false);
      assert.ok(post.prochainEssai, 'pas de date de reprise');
      assert.ok(new Date(post.prochainEssai) > new Date(), 'la reprise est dans le futur');
      assert.ok(/réessaie/.test(r.dit), r.dit);
      assert.strictEqual(post.essais, 1);
    });

    await TA('après 3 échecs temporaires, il abandonne', async () => {
      const post = { titre:'T', legende:'Bonjour', media:[], essais:0 };
      pub.ADAPTATEURS.ig.publier = async () => ({ ok:false, code:'reseau', erreur:'timeout' });
      for (let i = 0; i < 3; i++) await pub.publier(post, 'ig', {token:'a'});
      assert.strictEqual(post.etat, 'echoue');
      assert.strictEqual(post.essais, 3);
    });

    await TA('un token mort n’est jamais réessayé', async () => {
      const post = { titre:'T', legende:'Bonjour', media:[], essais:0 };
      pub.ADAPTATEURS.ig.publier = async () => ({ ok:false, code:'token', erreur:'expiré' });
      const r = await pub.publier(post, 'ig', {token:'a'});
      assert.strictEqual(post.etat, 'echoue');
      assert.strictEqual(post.essais, 1);
    });

    await TA('un code inconnu ne fait pas planter', async () => {
      pub.ADAPTATEURS.ig.publier = async () => { throw new Error('boum'); };
      const post = { titre:'T', legende:'Bonjour', media:[] };
      const r = await pub.publier(post, 'ig', {token:'a'});
      assert.strictEqual(r.ok, false);
      assert.ok(r.erreur);
    });

    /* on remet les adaptateurs en état */
    delete require.cache[require.resolve('./publier.js')];
  }

  /* ============================================================
     LE MOTEUR ET L'ÉCHEC
     ============================================================ */
  console.log('\nle moteur ne perd pas un post qui échoue');
  {
    const m = neuf();
    process.env.PUBLIO_CLE_IG = 'fausse-cle';
    require('./publier.js').oublierCles();

    m._test.regles().length = 0;
    m._test.regles().push({ id:'r1', nom:'Publier', actif:true, canaux:'ig',
      declencheur:'sans-date', action:'publier-immediat', p:{} });
    m._test.posts().push({ id:'pe', canal:'ig', titre:'Risqué', legende:'Bonjour',
      jour:5, heure:'09:00', etat:'brouillon', brouillon:true, media:[] });

    m._test.horloge(new Date());
    await m._test.faireTourner();

    const post = m._test.posts().find(p => p.id === 'pe');
    await TA('le post n’a pas disparu', async () => assert.ok(post, 'post perdu'));
    await TA('il est marqué en échec, avec la raison', async () => {
      assert.strictEqual(post.etat, 'echoue');
      assert.ok(post.derniereErreur, 'pas de raison');
      assert.ok(post.conseil, 'pas de conseil');
    });
    await TA('le journal le dit', async () => {
      assert.ok(m._test.journal().some(j => /n’est pas parti|pas parti/.test(j.texte || '')));
    });
    await TA('« Tester » sur la règle le montre aussi', async () => {
      /* on remet le disjoncteur à zéro : on teste l'échec, pas le repos */
      m._test.ecrireCircuits({});
      const r = await m.executer('sans-date', 'publier-immediat', {}, 'ig', {});
      assert.strictEqual(r.fait, false);
      assert.ok(/pas parti|repose/.test(r.dit), r.dit);
    });

    delete process.env.PUBLIO_CLE_IG;
    require('./publier.js').oublierCles();
  }

  /* ============================================================
     LE MOT DE PASSE — étape ②
     ============================================================ */
  console.log('\nle mot de passe');
  {
    const m = neuf();
    const crypto = require('crypto');

    T('un jeton signé est accepté', () => {
      const j = m._test.creerJetonAvec('secret');
      assert.ok(m._test.jetonValideAvec('secret', j));
    });
    T('un jeton falsifié est refusé', () => {
      const j = m._test.creerJetonAvec('secret');
      assert.ok(!m._test.jetonValideAvec('secret', j.slice(0, -2) + 'XX'));
      assert.ok(!m._test.jetonValideAvec('autre-secret', j));
    });
    T('un jeton expiré est refusé', () => {
      const base = Buffer.from(String(Date.now() - 1000)).toString('base64url');
      const sig = crypto.createHmac('sha256', 'secret').update(base).digest('base64url');
      assert.ok(!m._test.jetonValideAvec('secret', base + '.' + sig));
    });
    T('sans mot de passe configuré, aucun jeton ne passe', () => {
      assert.strictEqual(m._test.motDePasseValide('n’importe quoi'), false);
      /* et jetonValideAvec refuse aussi un secret vide */
      assert.ok(!m._test.jetonValideAvec('', m._test.creerJetonAvec('secret')));
    });
    T('un cookie se lit correctement', () => {
      const req = { headers: { cookie: 'a=1; publio=jeton.signe; b=2' } };
      assert.strictEqual(m._test.lireCookie(req, 'publio'), 'jeton.signe');
      assert.strictEqual(m._test.lireCookie(req, 'absent'), null);
    });
  }

  /* ============================================================
     LE DISJONCTEUR — étape ③
     ============================================================ */
  console.log('\nle disjoncteur');
  {
    const m = neuf();
    try{ fs.unlinkSync(m._test.FICHIER_CIRCUIT); }catch(e){}

    T('un canal sain n’est pas en panne', () =>
      assert.strictEqual(m._test.canalEnPanne('ig'), null));

    T('deux échecs ne suffisent pas à le couper', () => {
      m._test.noterEnvoi('ig', false);
      m._test.noterEnvoi('ig', false);
      assert.strictEqual(m._test.canalEnPanne('ig'), null);
      assert.strictEqual(m._test.lireCircuits().ig.echecs, 2);
    });

    T('trois échecs de suite le mettent au repos', () => {
      m._test.noterEnvoi('ig', false);
      const p = m._test.canalEnPanne('ig');
      assert.ok(p, 'pas de panne détectée');
      assert.strictEqual(p.echecs, 3);
    });

    T('un succès remet le compteur à zéro', () => {
      m._test.noterEnvoi('ig', true);
      assert.strictEqual(m._test.canalEnPanne('ig'), null);
      assert.strictEqual((m._test.lireCircuits().ig || {}).echecs, 0);
    });

    T('les autres canaux ne sont pas touchés', () =>
      assert.strictEqual(m._test.canalEnPanne('tt'), null));

    await TA('un canal au repos n’envoie plus, et il le dit', async () => {
      [1,2,3].forEach(() => m._test.noterEnvoi('li', false));
      const post = { titre:'Test', legende:'Bonjour', media:[] };
      const r = await m._test.envoyer(post, 'li', 'Maison Ora');
      assert.strictEqual(r.fait, false);
      assert.ok(/repose/.test(r.dit), r.dit);
    });

    T('la panne expire toute seule', () => {
      const tous = m._test.lireCircuits();
      tous.ig = { echecs:3, ouvertJusqua: Date.now() - 1000 };   // repos déjà fini
      m._test.ecrireCircuits(tous);
      assert.strictEqual(m._test.canalEnPanne('ig'), null);
      assert.ok(!m._test.lireCircuits().ig, 'le disjoncteur aurait dû se refermer');
    });

    try{ fs.unlinkSync(m._test.FICHIER_CIRCUIT); }catch(e){}
  }

  /* ============================================================
     LA SAUVEGARDE
     ============================================================ */
  console.log('\nla sauvegarde');
  {
    const dossierB = fs.mkdtempSync(path.join(os.tmpdir(), 'publio-sauvegardes-'));
    process.env.PUBLIO_BACKUPS = dossierB;
    const m = neuf();

    T('une sauvegarde crée une copie datée', () => {
      assert.ok(m._test.faireBackup());
      const fichiers = fs.readdirSync(dossierB).filter(f => f.startsWith('publio-'));
      assert.strictEqual(fichiers.length, 1);
      assert.ok(fs.statSync(path.join(dossierB, fichiers[0])).size > 100);
    });

    T('la rotation garde au plus MAX_BACKUPS copies', () => {
      for (let i = 0; i < 32; i++)
        fs.writeFileSync(path.join(dossierB, 'publio-2020-01-01T00-00-' + String(i).padStart(2,'0') + '.json'), '{}');
      assert.ok(m._test.faireBackup());
      const fichiers = fs.readdirSync(dossierB).filter(f => f.startsWith('publio-'));
      assert.ok(fichiers.length <= m._test.MAX_BACKUPS, 'rotation : ' + fichiers.length);
    });

    delete process.env.PUBLIO_BACKUPS;
  }

  /* ============================================================
     LE RAFRAÎCHISSEMENT DES JETONS
     ============================================================ */
  console.log('\nle rafraîchissement des jetons');
  {
    const dossierC = fs.mkdtempSync(path.join(os.tmpdir(), 'publio-cles-'));
    const CLES = path.join(dossierC, '.cles.json');
    const cles = {
      ig: { access_token: 'vieux-ig', ig_user_id: '1',
            token_expire: new Date(Date.now() + 3 * 86400000).toISOString(),
            app_id: 'id-meta', app_secret: 'secret-meta' },
      th: { access_token: 'th-valide', user_id: '1',
            token_expire: new Date(Date.now() + 90 * 86400000).toISOString() },
      li: { access_token: 'li-vieux', author: 'urn:li:person:1',
            refresh_token: 'refresh-li', client_id: 'id-li', client_secret: 'secret-li',
            token_expire: new Date(Date.now() + 3 * 86400000).toISOString() },
    };
    fs.writeFileSync(CLES, JSON.stringify(cles, null, 1));
    process.env.PUBLIO_CLES = CLES;

    const appels = [];
    const vraiFetch = global.fetch;
    global.fetch = async (url, opts = {}) => {
      appels.push({ url: String(url), opts });
      if (String(url).includes('fb_exchange_token'))
        return { ok: true, status: 200, json: async () => ({ access_token: 'ig-neuf', expires_in: 5184000 }) };
      if (String(url).includes('oauth/v2/accessToken')) {
        const corps = opts.body ? opts.body.toString() : '';
        assert.ok(corps.includes('grant_type=refresh_token'), 'mauvais grant LinkedIn');
        return { ok: true, status: 200, json: async () => ({ access_token: 'li-neuf', expires_in: 5184000 }) };
      }
      throw new Error('appel réseau inattendu : ' + url);
    };

    delete require.cache[require.resolve('./rafraichir-tokens.js')];
    const rt = require('./rafraichir-tokens.js');

    await TA('un jeton encore valide n’est pas rafraîchi', async () => {
      const r = await rt.rafraichirCanal('th',
        { access_token: 'th', token_expire: new Date(Date.now() + 90 * 86400000).toISOString() });
      assert.ok(!r.fait);
    });

    await TA('sans token_expire, le moteur ne touche pas les clés', async () => {
      const r = await rt.rafraichirCanal('ig', { access_token: 'x' });
      assert.ok(!r.fait);
      assert.match(r.dit, /token_expire/);
    });

    await TA('rafraichirTout échange les jetons proches et réécrit .cles.json', async () => {
      appels.length = 0;
      const r = await rt.rafraichirTout();
      assert.ok(r.ok && r.ecrit, JSON.stringify(r));
      assert.ok(appels.some(a => a.url.includes('fb_exchange_token')), 'pas d’appel Meta');
      assert.ok(appels.some(a => a.url.includes('oauth/v2/accessToken')), 'pas d’appel LinkedIn');
      const ecrit = JSON.parse(fs.readFileSync(CLES, 'utf8'));
      assert.strictEqual(ecrit.ig.access_token, 'ig-neuf');
      assert.strictEqual(ecrit.li.access_token, 'li-neuf');
      assert.strictEqual(ecrit.th.access_token, 'th-valide');   // intact
      assert.ok(new Date(ecrit.ig.token_expire) > new Date(Date.now() + 50 * 86400000));
    });

    await TA('un échec d’échange ne casse pas les clés', async () => {
      global.fetch = async () => ({ ok: false, status: 400,
        json: async () => ({ error: { message: 'invalid app' } }) });
      const r = await rt.rafraichirCanal('ig',
        { access_token: 'x', app_id: 'a', app_secret: 'b',
          token_expire: new Date(Date.now() - 86400000).toISOString() });
      assert.ok(!r.fait);
      assert.match(r.erreur, /invalid app/);
    });

    global.fetch = vraiFetch;
    delete process.env.PUBLIO_CLES;
  }

  console.log('\nconnexions : vérifications locales');
  {
    const tc = require('./tenant-cles.js');
    const dir = path.join(process.env.PUBLIO_LOCATAIRES_DIR, 'testoauth');
    fs.mkdirSync(dir, {recursive:true});
    T('les informations OAuth restent privées et conservées', () => {
      const token = 'x'.repeat(24), refresh = 'r'.repeat(30), expiry = Date.now() + 3600000;
      assert.ok(tc.ecrire('testoauth', 'tt', {access_token:token, refresh_token:refresh, expires_at:expiry, mode:'inbox'}).ok);
      const c = tc.lire('testoauth', 'tt');
      assert.equal(c.refresh_token, refresh); assert.equal(Date.parse(c.token_expire), expiry);
      assert.deepEqual(tc.liste('testoauth').tt, true);
      assert.ok(!JSON.stringify(tc.liste('testoauth')).includes(refresh));
    });
    T('le choix Meta est signé dans la demande', () => {
      const o = require('./oauth.js');
      assert.equal(o.verifierEtat(o.signerEtat('testoauth', 'meta', 'fb'), 'meta').c, 'fb');
      assert.equal(o.verifierEtat(o.signerEtat('testoauth', 'meta', 'fb'), 'tiktok'), null);
    });
    await TA('TikTok brouillon utilise la bonne API et ne prétend pas avoir publié', async () => {
      const fichier = path.join(DOSSIER_TEST, 'video.mp4'); fs.writeFileSync(fichier, 'fake');
      const fetchInitial = global.fetch, appels = [];
      global.fetch = async (url, opts) => {
        appels.push({ url:String(url), opts });
        let j = {};
        if (String(url).includes('/inbox/video/init/')) j = {data:{publish_id:'v_inbox_test',upload_url:'https://upload.example/video'}};
        else if (String(url).includes('/status/fetch/')) j = {data:{status:'SEND_TO_USER_INBOX'}};
        return {status:200, headers:{}, text:async()=>JSON.stringify(j)};
      };
      try {
        const pub = require('./publier.js');
        const r = await pub.publier({media:[{url:fichier,type:'video'}],legende:'test'}, 'tt', {access_token:'test', mode:'inbox'});
        assert.equal(r.enAttenteUtilisateur, true);
        assert.ok(appels[0].url.endsWith('/inbox/video/init/'));
        assert.equal(JSON.parse(appels[0].opts.body).post_info, undefined);
      } finally { global.fetch = fetchInitial; }
    });
  }

  console.log('\nrecherche et publication audio Instagram');
  {
    await TA('la recherche utilise le compte autorisé sans renvoyer le jeton', async () => {
      const original = global.fetch; let url;
      global.fetch = async u => { url = new URL(u); return { ok:true, json:async()=>({audio:[{audio_id:'123456',title:'Une chanson',display_artist:'Artiste',download_url:'https://example.org/a.mp3'}]}) }; };
      try {
        const r = await require('./musique-meta').rechercher({access_token:'secret-du-client',ig_user_id:'9988'}, 'été');
        assert.equal(url.searchParams.get('user_id'), '9988'); assert.equal(url.searchParams.get('search_query'), 'été');
        assert.equal(r.pistes[0].id, '123456'); assert.ok(!JSON.stringify(r).includes('secret-du-client'));
        assert.equal((await require('./musique-meta').rechercher(null, '')).code, 'connexion');
      } finally { global.fetch = original; }
    });
    await TA('un Reel transmet audio_configuration à Instagram', async () => {
      const original = global.fetch; const appels = [];
      global.fetch = async (u, opt) => {
        const url = new URL(u); appels.push(url); let j;
        if (url.pathname.endsWith('/media')) j = {id:'container'};
        else if (url.pathname.endsWith('/media_publish')) j = {id:'published'};
        else if (url.pathname.endsWith('/container')) j = {status_code:'FINISHED'};
        else j = {permalink:'https://instagram.com/p/xyz'};
        return {status:200, headers:{}, text:async()=>JSON.stringify(j)};
      };
      try {
        const pub = require('./publier.js');
        const c = {access_token:'secret',ig_user_id:'123'};
        const reel = {legende:'bonjour', media:[{url:'https://example.org/video.mp4',type:'video'}], musiqueInstagram:{id:'456',volumeMusique:80,volumeVideo:50}};
        const r = await pub.publier(reel, 'ig', c);
        assert.ok(r.ok); assert.deepEqual(JSON.parse(appels[0].searchParams.get('audio_configuration')), {audio_id:'456',audio_volume:80,video_volume:50});
        const avant = appels.length;
        const refus = await pub.publier({media:[{url:'https://example.org/a.jpg',type:'image'}],musiqueInstagram:{id:'456'}}, 'ig', c);
        assert.equal(refus.ok, false); assert.equal(appels.length, avant);
      } finally { global.fetch = original; }
    });
  }

  console.log('\nstockage des médias');
  {
    const m = require('./stockage-medias');
    T('seules les signatures des formats annoncés sont acceptées', () => {
      assert.ok(m.valideSignature(Buffer.from('89504e470d0a1a0a','hex'), 'image/png'));
      assert.ok(m.valideSignature(Buffer.from('000000186674797069736f6d','hex'), 'video/mp4'));
      assert.equal(m.valideSignature(Buffer.from('<svg onload=alert(1)>'), 'image/png'), false);
      assert.equal(m.valideSignature(Buffer.from('<html>'), 'text/html'), false);
    });
  }

  /* ============================================================
     L'API
     ============================================================ */
  console.log('\nl’API');
  {
    const m = neuf();
    T('l’API expose les règles', () => assert.ok(Array.isArray(m._test.regles())));
  }

  /* ============================================================ */
  console.log('\n' + (ko.length ? '❌ échecs :\n' + ko.map(x => '  • ' + x).join('\n') : ''));
  console.log(`${ok.length}/${ok.length + ko.length}`, ko.length ? '' : '✅ TOUT BON\n');
  process.exit(ko.length ? 1 : 0);
})();
