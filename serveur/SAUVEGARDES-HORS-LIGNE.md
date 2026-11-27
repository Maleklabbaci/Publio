# Sauvegarde chiffrée à froid — version initiale

Cet outil est **manuel**, non branché à une interface et non automatisé. Testé uniquement sur des données fictives isolées, il n'est pas encore un dispositif de sauvegarde de production validé. Python 3 et Node.js 20+ sont nécessaires.

## Précautions indispensables

- Arrêter proprement le moteur et **tout autre processus écrivant dans ces données**, empêcher leur redémarrage pendant l'opération et vérifier qu'ils sont arrêtés. Le verrou `serveur/moteur.lock`, maintenant créé de façon exclusive par le moteur et l'outil, protège seulement les processus utilisant ce même fichier sur un système de fichiers fiable ; il ne protège pas les anciennes versions, copies séparées, autres machines ou éditeurs externes. Ne jamais effacer un verrou actif. Après arrêt brutal, vérifier tous les processus et l'origine du verrou avant de le supprimer manuellement.
- Exécuter l'outil avec **les mêmes variables d'environnement de chemins** que le moteur (`PUBLIO_DB`, `PUBLIO_LOCATAIRES`, `PUBLIO_LOCATAIRES_DIR`, `PUBLIO_SECRET_FILE`, `PUBLIO_JOURNAL`, `PUBLIO_CIRCUIT`, `PUBLIO_APPS`, `PUBLIO_CLES`, `PUBLIO_ADMIN_PASS_FILE`, `PUBLIO_AUTOMATISATIONS_DIR`). Sans elles, les chemins par défaut du dossier `serveur` sont utilisés. Contrôler soigneusement la configuration effective. La base, le registre, le répertoire locataires et le fichier secret sont obligatoires ; les autres sources sont prises si présentes.
- La sauvegarde inclut ces fichiers et les locataires, médias et clés qu'ils contiennent. Elle **n'inclut pas le code, les variables d'environnement ou secrets configurés uniquement dans l'environnement**, les sauvegardes historiques, ressources externes ou données stockées ailleurs. Prévoir séparément leur sauvegarde et une procédure de déploiement adaptée. Il faut vérifier la liste des sources figurant dans `MANIFEST.json` après restauration ; la présence et le contenu métier ne sont pas certifiés par cet outil.
- Choisir un dossier privé hors des données sources. **Conserver une copie chiffrée hors machine et la clé séparément**, avec accès restreints et copies redondantes. Sans la clé, les archives sont irrécupérables. Ne pas mettre la clé dans un dépôt ni la transmettre par messagerie non sécurisée.
- Prévoir suffisamment d'espace libre : à la restauration, une archive temporaire **en clair** et les fichiers extraits sont écrits dans un dossier privé sur le disque de destination ; ils peuvent subsister en cas d'arrêt brutal. Utiliser un disque chiffré et vérifier/nettoyer les dossiers `.publio-restore-*` et `.publio-backup-*.part` uniquement après avoir confirmé l'arrêt du processus. La suppression habituelle ne garantit pas l'effacement physique sur SSD ou stockage distant.

## Commandes opérateur (exemples à adapter, chemins absolus)

Depuis `serveur`, avec des dossiers privés et existants :

```sh
# Une seule fois : clé de 32 octets, fichier créé en mode privé.
node sauvegarde-complete.js cle --cle /chemin/prive/cle-publio

# Après arrêt complet des écritures : une nouvelle archive à chaque fois.
node sauvegarde-complete.js creer --cle /chemin/prive/cle-publio --sortie /chemin/prive/sauvegarde-2026-11-20.pbk

# Restauration de test vers un chemin qui ne doit pas déjà exister.
node sauvegarde-complete.js restaurer --cle /chemin/prive/cle-publio --archive /chemin/prive/sauvegarde-2026-11-20.pbk --destination /chemin/prive/restauration-test
```

La restauration est isolée : elle **ne remet pas l'application en service**, n'écrase pas les données actives et ne replace pas automatiquement les données dans les chemins configurés. Comparer le manifeste et les données, vérifier les comptes et médias, puis concevoir et répéter une procédure de remise en service sur une installation isolée avant toute intervention réelle. Protéger ou supprimer les copies de test selon la politique de sécurité.

## Tests effectués et limites

`node tests/sauvegarde-complete.test.js` crée et restaure un jeu fictif (bases, deux projets, médias, clés, file externe) ; vérifie l'altération, une clé incorrecte, des permissions, le verrou, des chemins et des liens refusés. `node tests/verrou-sauvegarde.test.js` vérifie le refus du moteur en présence d'un verrou sauvegarde ou illisible. Ces tests ne couvrent pas toutes les pannes, gros volumes, interruptions, environnements et configurations. Un exercice de restauration complet, la supervision, l'automatisation, la rétention et le stockage hors site restent à organiser avant lancement. L'ancien mécanisme de sauvegarde du moteur n'est pas remplacé : il ne garantit pas une copie complète des données clients et médias.
