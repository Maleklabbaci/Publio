'use strict';
// Reconstruit les fichiers HTML de test locaux à partir des sources Publio.
// Ne contient ni secrets ni données clients. Ne déploie rien.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'), out=path.join(__dirname,'tests','assets-locaux');
fs.mkdirSync(out,{recursive:true});
const pages=require(path.join(root,'serveur','client-pages.js'));
for(const [name,file] of [['LOGIN_PAGE','login.html'],['SIGNUP_PAGE','signup.html'],['ESPACE_PAGE','espace.html']])fs.writeFileSync(path.join(out,file),pages[name]);
for(const file of ['app-publio.html','login-photo.jpg','inscription-photo.jpg','publio-favicon.svg'])fs.copyFileSync(path.join(root,'serveur',file),path.join(out,file==='app-publio.html'?'app.html':file));
console.log('Fichiers pour tests locaux créés ; ne pas déployer les configurations de test.');
