'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {verifierSignature,extraireCommentaires,correspondMotCle} = require('./automatisation-instagram');
const secret = 'secret-de-test', signe = corps => 'sha256='+crypto.createHmac('sha256',secret).update(corps).digest('hex');
const corps = Buffer.from(JSON.stringify({object:'instagram',entry:[{id:'123',changes:[
  {field:'comments',value:{id:'456',from:{id:'789',username:'exemple'},media:{id:'111'},text:'Quel est le PRIX ?'}},
  {field:'comments',value:{id:'457',from:{id:'123'},media:{id:'111'},text:'auto réponse'}},
  {field:'comments',value:{id:'458',from:{id:'789'},text:'sans média'}},
  {field:'comments',value:{id:'460',from:{id:'789',self_ig_scoped_id:'789'},media:{id:'111'},text:'auto réponse'}},
  {field:'messages',value:{id:'459'}}
]}]}));
assert(verifierSignature(corps,signe(corps),secret));
assert(!verifierSignature(corps,signe(corps),'autre'));
assert(!verifierSignature(Buffer.from('modifié'),signe(corps),secret));
assert(!verifierSignature(corps,'sha256=00',secret));
assert(!verifierSignature(corps,signe(corps),''));
assert(!verifierSignature(corps.toString(),signe(corps),secret));
assert.equal(extraireCommentaires(corps,'sha256='+('0'.repeat(64)),secret).ok,false);
let nonJson=Buffer.from('{');assert.equal(extraireCommentaires(nonJson,signe(nonJson),secret).ok,false);
let fb=Buffer.from('{"object":"page","entry":[]}');assert.equal(extraireCommentaires(fb,signe(fb),secret).ok,false);
const resultat=extraireCommentaires(corps,signe(corps),secret);
assert.equal(resultat.evenements.length,1);
assert.deepEqual(resultat.evenements[0],{canal:'ig',compteId:'123',commentaireId:'456',auteurId:'789',mediaId:'111',texte:'Quel est le PRIX ?'});
assert(correspondMotCle(resultat.evenements[0].texte,'prix'));
assert(correspondMotCle('Café','CAFE\u0301'));
assert(!correspondMotCle('bonjour',''));
assert(!correspondMotCle('bonjour','.*'));
console.log('OK : signature brute, événements Instagram filtrés, auto-commentaires exclus, mots-clés littéraux. Aucun envoi réel.');
const {preparerReponsePrivee}=require('./automatisation-instagram');
const req=preparerReponsePrivee({connexion:'facebook',compteId:'123',commentaireId:'456',texte:'Voici le catalogue',accessToken:'token-test'});
assert.equal(req.url,'https://graph.facebook.com/v25.0/123/messages');
assert.deepEqual(JSON.parse(req.options.body),{recipient:{comment_id:'456'},message:{text:'Voici le catalogue'}});
assert.equal(req.options.headers.Authorization,'Bearer token-test');
assert(!req.url.includes('token-test'));
for (const valeurs of [{connexion:'exemple.com'},{compteId:'../456'},{commentaireId:'https://exemple.com'},{texte:' '},{accessToken:'\r\nX:oui'}]){
  assert.throws(()=>preparerReponsePrivee(Object.assign({connexion:'facebook',compteId:'123',commentaireId:'456',texte:'Bonjour',accessToken:'test'},valeurs)));
}
console.log('OK construction requête Instagram, aucun appel réseau.');
