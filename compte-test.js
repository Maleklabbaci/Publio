'use strict';
/* Démarrage explicitement local d'une instance de démonstration ISOLÉE.
   Ne touche jamais au registre de la vraie instance. Pas pour la production. */
const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');
const racine = __dirname;
const origine = path.join(racine, 'serveur');
const dossierTest = path.join(racine, '.publio-test');
const serveurTest = path.join(dossierTest, 'serveur');
const legalTest = path.join(dossierTest, 'legal');
const email = 'test@publio.test';
const motDePasse = 'PublioTest2026!';
const bind = process.argv.includes('--apercu') ? '0.0.0.0' : '127.0.0.1';
const port = Number(process.env.PUBLIO_TEST_PORT || 4405);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PUBLIO_TEST_PORT invalide');
// Ne recopie que le code et les images nécessaires, jamais les données, comptes ou secrets.
fs.mkdirSync(serveurTest, {recursive:true});
for (const entry of fs.readdirSync(origine, {withFileTypes:true})) {
  if (!entry.isFile() || !/\.(js|html|jpg|svg)$/i.test(entry.name)) continue;
  fs.copyFileSync(path.join(origine, entry.name), path.join(serveurTest, entry.name));
}
for (const nom of ['automatisations', 'pages-publiques']) {
  const source = path.join(origine, nom), destination = path.join(serveurTest, nom);
  fs.mkdirSync(destination,{recursive:true});
  for (const entry of fs.readdirSync(source,{withFileTypes:true})) {
    if (entry.isFile() && /\.(js|html)$/i.test(entry.name)) fs.copyFileSync(path.join(source, entry.name), path.join(destination, entry.name));
  }
}
fs.mkdirSync(legalTest, {recursive:true});
for (const nom of ['terms.html','privacy.html','mentions.html']) fs.copyFileSync(path.join(racine,'legal',nom),path.join(legalTest,nom));
// Aucune configuration ni clé de l'environnement utilisateur dans ce processus.
for (const key of Object.keys(process.env)) if (key.startsWith('PUBLIO_')) delete process.env[key];
const registre = path.join(serveurTest,'locataires.json');
if (fs.existsSync(registre)) {
  let data; try { data = JSON.parse(fs.readFileSync(registre,'utf8')); } catch (_) { throw new Error('Registre de test illisible : rien n’a été modifié.'); }
  if (!data || !Array.isArray(data.locataires)) throw new Error('Registre de test invalide : rien n’a été modifié.');
}
const locataires = require(path.join(serveurTest,'locataires.js'));
const tous = locataires.charger().locataires;
let compte = tous.find(x => String(x.email || '').trim().toLowerCase() === email);
if (!compte) {
  if (tous.some(x=>x.slug==='publio-test')) throw new Error('Le nom publio-test existe déjà dans les données de test ; aucun compte modifié.');
  const r = locataires.creer({slug:'publio-test',nom:'Compte de test',email,motDePasse,plan:'agence',montant:0,notes:'Compte fictif local, jamais pour la production',reseaux:[]});
  if (r.erreur) throw new Error(r.erreur);
  const maj=locataires.maj('publio-test',{statut:'actif',plan:'agence'});
  if (maj.erreur) throw new Error(maj.erreur);
  compte = locataires.lire('publio-test');
} else if (compte.slug !== 'publio-test' || !locataires.verifier(motDePasse,compte.motDePasseHash)) {
  throw new Error('Le compte de test existant ne correspond pas aux identifiants attendus. Aucun compte modifié.');
}
console.log('\n=== PUBLIO — COMPTE DE TEST ISOLÉ ===');
console.log('Adresse : http://127.0.0.1:'+port+'/connexion-client');
console.log('Email : '+email+'\nMot de passe : '+motDePasse);
console.log('Compte fictif Agence ; aucune connexion réelle configurée.');
console.log('Données de test : '+dossierTest);
console.log('Ne pas utiliser en production ni stocker de vraies données dans ce compte.');
if(bind==='0.0.0.0') console.log('ATTENTION : aperçu réseau activé ; toute personne ayant son URL peut essayer ce compte.');
const env = {...process.env,PORT:String(port),PUBLIO_HOST:bind};
const enfant=spawn(process.execPath,[path.join(serveurTest,'moteur.js')],{env,stdio:'inherit'});
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{if(!enfant.killed)enfant.kill(signal)});
enfant.on('error',e=>{console.error('Impossible de démarrer : '+e.message);process.exitCode=1});
enfant.on('exit',(code,signal)=>{if(code)process.exitCode=code;else if(signal&&!['SIGINT','SIGTERM'].includes(signal))process.exitCode=1});
