# Déclenchement et fin du traitement SmartDoc AI

## 1. Nouveau déclenchement automatique

Le dépôt se fait maintenant directement depuis le portail Vercel. La fonction `/api/upload` reçoit le PDF et appelle le webhook Make conservé dans la variable privée `MAKE_WEBHOOK_URL`.

Dans Make :

```text
Webhooks → Custom webhook
```

Créer un webhook, copier son URL dans Vercel, puis cliquer sur `Re-determine data structure` avec un premier dépôt depuis la plateforme. Make doit détecter les champs suivants :

- `file` : fichier PDF ;
- `filename` : nom du fichier ;
- `mimeType` : type MIME ;
- `jobId` : identifiant de suivi.

Le scénario n’a plus besoin de commencer par `Watch Files in a Folder` pour le dépôt direct.

Ajouter ensuite, si l’archivage Google Drive est conservé :

```text
Custom webhook
        ↓
Google Drive → Upload a File
        ↓
Conversion / extraction du texte
```

Le fichier reçu par le webhook doit être mappé dans le champ fichier du module Google Drive. Les étapes d’extraction, Iterator, Text aggregator, Make AI Toolkit et Airtable peuvent rester après cette étape.

Pour tester, activer `Run once` dans Make puis déposer un PDF dans le portail. En production, le webhook déclenche Make au moment de la réception, sans attendre le cycle de 15 minutes.

## 2. Parcours du fichier

```text
Plateforme Vercel
        ↓
Custom webhook Make
        ↓
Archivage / conversion en Google Docs
        ↓
Récupération du texte
        ↓
Extraction du contenu avec Iterator + Text aggregator
        ↓
Analyse Make AI Toolkit
        ↓
Recherche du document dans Airtable
        ↓
Nouvelle version ou nouveau document
        ↓
Création de l'analyse IA
```

## 3. Comment l’interface sait que c’est terminé

Après l’envoi, l’interface appelle régulièrement `/api/status` avec le nom du fichier. Cette route lit Airtable côté serveur et ne divulgue aucune clé au navigateur.

La réponse passe à `completed` lorsque :

- `Documents` contient le fichier et son statut `Analysé` ;
- `Versions` contient la version créée ou incrémentée ;
- `Analyses IA` contient le résumé, la catégorie, les points importants, la vérification et le score de confiance.

Pour rendre l'état encore plus explicite, conserver ces valeurs dans `Documents.Statut` :

- `En attente` : fichier reçu mais pas encore enregistré ;
- `En traitement` : scénario en cours ;
- `Analysé` : traitement terminé ;
- `Erreur` : échec à vérifier.

Pour éviter qu’un ancien document du même nom soit considéré comme terminé, la route compare également la date de mise à jour Airtable avec l’heure du dépôt.

## 4. Notification de fin recommandée

Dans la branche réussie, conserver ou ajouter :

```text
Airtable → Update a Record (Statut = Analysé)
        ↓
Gmail → Send an Email
```

Le mail est optionnel : l’interface affiche déjà le résultat dès que le statut Airtable est final. Une route d’erreur peut mettre `Statut = Erreur` et envoyer une alerte.
