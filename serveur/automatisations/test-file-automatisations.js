'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {creerFile}=require('./file-automatisations');
const dossier=fs.mkdtempSync(path.join(os.tmpdir(),'publio-file-auto-'));
try {
  const f=creerFile(dossier), r={compte:'agence',projet:'client-a',reseau:'ig',evenement:'comment-123',regle:'r1',action:'repondre-prive',donnees:{commentaireId:'123'}};
  assert.equal(f.ajouter(r).ajoute,true);assert.equal(f.ajouter(r).ajoute,false);
  assert.equal(f.ajouter({...r,projet:'client-b'}).ajoute,true);
  assert.equal(f.ajouter({...r,compte:'autre'}).ajoute,true);
  assert.equal(f.ajouter({...r,regle:'r2'}).ajoute,true);
  assert.equal(f.liste('agence','client-a').length,2);assert.equal(f.liste('agence','client-b').length,1);
  assert.equal(f.liste('agence','inexistant').length,0);
  assert.equal(f.obtenir(r).etat,'en_attente');assert.equal(f.demarrer(r).demarre,true);
  assert.equal(f.demarrer(r).demarre,false);
  assert.equal(creerFile(dossier).obtenir(r).etat,'en_cours'); // redémarrage : jamais de relance implicite
  assert.equal(creerFile(dossier).demarrer(r).demarre,false);
  assert.equal(f.terminer(r,'incertain').etat,'incertain');assert.equal(f.demarrer(r).demarre,false);
  assert.throws(()=>f.terminer(r,'confirme'));
  let autre={...r,regle:'r2'};assert(f.demarrer(autre).demarre);assert.equal(f.terminer(autre,'confirme').etat,'confirme');
  assert.throws(()=>f.ajouter({...r,reseau:'toto'}));assert.throws(()=>f.ajouter({...r,donnees:{t:'x'.repeat(40000)}}));
  const repertoire=fs.readdirSync(dossier)[0];assert.equal(fs.statSync(path.join(dossier,repertoire)).mode & 0o077,0);
  const fichier=fs.readdirSync(path.join(dossier,repertoire)).find(x=>x.endsWith('.json'));
  assert.equal(fs.statSync(path.join(dossier,repertoire,fichier)).mode & 0o077,0);
  console.log('OK file autonome : isolation, dédoublonnage, état persistant, verrouillage et échec fermé après interruption. Aucun appel réseau.');
} finally {fs.rmSync(dossier,{recursive:true,force:true})}
