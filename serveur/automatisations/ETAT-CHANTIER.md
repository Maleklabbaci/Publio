# Chantier automatisations — état réel

## Préparé et partiellement branché

- `automatisation-instagram.js` : vérification HMAC des webhooks sur octets bruts, extraction prudente de commentaires, recherche littérale de mot-clé et construction d'une requête Meta de réponse privée, sans appel réseau.
- `file-automatisations.js` : file locale autonome avec isolation compte/projet, dédoublonnage événement/règle, états persistants, verrou local ; une action en cours après redémarrage n'est jamais réessayée automatiquement.
- Tests : `node automatisations/test-automatisation-instagram.js` et `node automatisations/test-file-automatisations.js`.

Le moteur importe ces modules. `/webhooks/meta/instagram` vérifie le challenge et la signature si les deux variables serveur `PUBLIO_META_WEBHOOK_VERIFY_TOKEN` et `PUBLIO_META_APP_SECRET` sont configurées. **Même signés, les événements reçoivent un 503 : ils ne sont pas acceptés, enregistrés ou exécutés**, car aucun worker réel n'est prêt. `/api/automatisations/statut` est réservé à la session et ne renvoie que les compteurs du projet actif ; une notice dans l'interface indique que rien n'est traité. La file n'est pas encore alimentée par les webhooks. Aucun envoi réel. Les règles clients et la programmation réelle restent indisponibles. Les tests locaux et 60 tests généraux ne valent pas validation réseau. Le serveur local a été redémarré pour charger ce code ; configuration Meta absente.

## À construire avant de brancher Instagram

- Endpoint Meta : challenge, signature du corps brut et taille limitée réalisés ; reste à traiter le rejeu et les erreurs et à raccorder une réception durable avant réponse de succès. HTTPS et configuration extérieure restent nécessaires.
- Associer de façon vérifiée l'identifiant du compte externe à un seul projet autorisé ; rejeter les collisions, tenir compte des déconnexions et de l'état/plan du compte.
- Import des bonnes permissions, App Review, token valide et renouvellement ; sélection explicite de la Page. Consentement et contrôles de l'utilisateur.
- Véritable date du commentaire depuis une source autorisée : au plus 7 jours, règle différente pour Live. Une seule réponse privée globale par commentaire, même si plusieurs règles correspondent. Exclure les événements propres, rediffusions et doublons.
- Appel réel avec résultats confirmés/refusés/incertains ; pas de répétition aveugle si l'API a peut-être déjà effectué l'action. Gestion des limites et statut visible exact.
- Sécurité : ne jamais exposer jetons, contenus de messages ou journaux au mauvais projet ; rétention/suppression des données, reprise supervisée des verrouillages et droits d'accès. La file est mono-machine et doit être remplacée ou renforcée pour plusieurs serveurs ; aucun jeton ne doit y être stocké.
- Tests multi-projets, simultanéité, crash, reprise, expirations, signature et refus ; puis tests officiels et validation Meta avant activation.

## Autres canaux

Facebook, TikTok, LinkedIn, Threads et YouTube : les règles évoquées dans la recherche restent à concevoir et développer individuellement, selon permissions et capacités officielles. TikTok : ne pas promettre commentaires ou messages automatiques sans accès spécifique confirmé. YouTube : connexion et adaptateur manquants, respecter consentement explicite. La programmation a ses propres prérequis : file durable, médias accessibles de manière sûre, résultats par réseau, fuseaux et protection contre doublons.
