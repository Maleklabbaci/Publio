'use strict';
// Régression : les regex sont intégrées dans des gabarits HTML JavaScript.
// Une barre oblique oubliée dans le gabarit changeait /\s/ en /s/ côté navigateur.
const assert = require('assert');
const vm = require('vm');
const { LOGIN_PAGE, SIGNUP_PAGE } = require('./client-pages');
for (const [nom, html] of [['connexion', LOGIN_PAGE], ['inscription', SIGNUP_PAGE]]) {
  const extrait = html.match(/function diagnosticEmail\(v\)\{[\s\S]*?\n\}/);
  assert(extrait, `diagnostic email absent : ${nom}`);
  const contexte = {};
  vm.runInNewContext(extrait[0], contexte);
  for (const email of ['sarah@exemple.test', 'sami@studio.fr', 'test@example.com']) {
    assert.strictEqual(contexte.diagnosticEmail(email), 'ok', `${nom} : ${email}`);
  }
  assert.notStrictEqual(contexte.diagnosticEmail('sarah @exemple.test'), 'ok');
  assert.notStrictEqual(contexte.diagnosticEmail('sarah-sans-arobase.test'), 'ok');
  if (nom === 'inscription') {
    assert.notStrictEqual(contexte.diagnosticEmail('sarah@exempleXtest'), 'ok');
    assert.notStrictEqual(contexte.diagnosticEmail('sarah@exemple.c'), 'ok');
  }
}
assert(SIGNUP_PAGE.includes("ctaTexte.textContent = 'Création du compte…'"));
assert(!SIGNUP_PAGE.includes("btn.innerHTML = '<span id=\"cta-texte\">"));
console.log('OK pages client : validation email générée et texte du bouton d’inscription après erreur.');
