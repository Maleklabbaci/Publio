'use strict';
// Vérifications statiques des quatre pages publiques, sans serveur ni données réelles.
const assert=require('assert'),fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..'),landing=fs.readFileSync(path.join(root,'landing.html'),'utf8');
const expected={produit:['Produit','product-hero','/inscription'],demarrer:['Démarrer','start-hero','/inscription'],packs:['Packs','pricing-hero','/faq'],faq:['FAQ','faq-hero','/packs']};
for(const [nom,[titre,hero,cta]] of Object.entries(expected)){
  assert(landing.includes(`href="/${nom}"`),'navigation landing : '+nom);
  const html=fs.readFileSync(path.join(root,'pages-publiques',nom+'.html'),'utf8');
  assert(html.includes(`<title>${titre} — Publio</title>`));
  assert(html.includes(`href="/${nom}" aria-current="page"`));
  assert(html.includes(`class="${hero}"`) || html.includes(`class="${hero} `),'hero : '+nom);
  assert(html.includes(`href="${cta}"`));
  assert(html.includes('en préparation')||html.includes('En préparation'));
  assert(!html.includes('href="#produit"')&&!html.includes('href="#demarrer"'));
}
const faq=fs.readFileSync(path.join(root,'pages-publiques','faq.html'),'utf8');assert(faq.includes('id="faq-recherche"')&&faq.includes('aria-live="polite"'));
console.log('OK navigation, heroes distincts et contenu des pages publiques.');
