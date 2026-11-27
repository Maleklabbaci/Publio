# Publio

Projet en cours : landing et pages publiques, interface client, moteur Node.js, base des automatisations et compte local de test.

**Pas prêt pour une mise en production.** Les connexions aux réseaux sociaux, la publication programmée, l’exécution réelle des automatisations, les statistiques réelles, la boîte de réception réelle et les paiements restent en préparation ou soumis à permissions et tests. Les données et écrans de démonstration ne sont pas des résultats réels. Les pages juridiques sont provisoires.

## Ce que contient ce ZIP

- `serveur/` : code de l’application, pages HTML, images utilisées, logos, scripts et tests.
- `legal/` : pages juridiques provisoires utilisées par le serveur.
- `compte-test.js` : démarrage d’une instance locale séparée pour tester le compte fictif.
- `apercu-landing.js` : aperçu des pages publiques sans API.
- `.gitignore` : exclusions des données locales et secrets.

Les anciennes vidéos du hero, fichiers de création, captures, secrets, bases, journaux, sauvegardes et données clientes ne sont pas inclus. Le ZIP ne constitue **pas une sauvegarde des données**. Les fonctionnalités non terminées restent présentes comme chantier : ne pas les confondre avec des fichiers parasites.

## Tester le compte localement

Avec Node.js 20 ou plus, dans le dossier décompressé :

```sh
node compte-test.js
```

Sur la même machine, ouvre `http://127.0.0.1:4405/connexion-client`.

- Email : `test@publio.test`
- Mot de passe : `PublioTest2026!`

La commande crée une instance et des données fictives dans `.publio-test/`, séparées des données normales ; le dossier est ignoré par Git. Le compte représente une **Agence fictive**, sans réseau connecté ni paiement réel. Stopper le serveur avec `Ctrl+C`. La commande écoute uniquement en local par défaut ; ne pas utiliser ce compte ou ses identifiants en production, et ne pas y mettre de données personnelles. `--apercu` expose l’instance sur le réseau et doit être réservé à un environnement de démonstration isolé.

## Voir uniquement les pages publiques

```sh
node apercu-landing.js
```

Ouvre `http://127.0.0.1:4400`. Cet aperçu montre les pages et formulaires, mais désactive l’authentification et les API.

Les pages `/produit`, `/demarrer`, `/packs` et `/faq` sont générées avec :

```sh
node serveur/generer-pages-publiques.js
```

Relance cette commande après modification du style ou de la navigation de `serveur/landing.html`, ou du générateur.

## Vérifications

```sh
cd serveur
node test.js
node tests/pages-publiques.test.js
node tests/gestion-stockage.test.js
node tests/sauvegarde-complete.test.js
node tests/verrou-sauvegarde.test.js
```

Ces tests ne remplacent pas un audit de sécurité, une validation des réseaux ou des paiements. Avant tout lancement : configuration, sécurité, HTTPS, hébergement, sauvegardes, droits et documents juridiques doivent être vérifiés.

## Téléverser sur GitHub

Décompresse d’abord le ZIP, puis téléverse **son contenu** dans le dépôt en conservant les dossiers. GitHub ne décompresse pas automatiquement un ZIP téléversé comme fichier. Vérifie que les fichiers cachés comme `.gitignore` sont aussi inclus. Ne publie pas de mots de passe personnels, clés API, bases clients ou sauvegardes. Le compte fictif est réservé au test local et ne doit pas être activé en production.

Les logos des réseaux et photos ont des conditions d’utilisation : consulter `serveur/logos-reseaux/SOURCES.md`, `serveur/PHOTOS-SOURCES.md` et `serveur/ICONES-SOURCES.md`, puis vérifier les droits avant lancement.
