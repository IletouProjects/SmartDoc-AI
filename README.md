# SmartDoc AI

Portail web SmartDoc AI pour déposer un PDF directement dans la plateforme, déclencher Make automatiquement et afficher le résultat final de l’analyse.

## Structure

- `index.html` : interface web
- `assets/smartdoc-waveform.png` : élément graphique de l'interface
- `api/upload.js` : réception du PDF et appel sécurisé du webhook Make
- `api/status.js` : lecture du statut et du résultat dans Airtable
- `vercel.json` : configuration légère pour Vercel
- `package.json` : dépendance serveur pour lire les formulaires multipart
- `MAKE_WORKFLOW.md` : fonctionnement du traitement documentaire

## Tester en local

Depuis ce dossier :

```bash
npm install
python -m http.server 4173
```

Puis ouvrir `http://localhost:4173`.

Pour tester aussi les routes `/api`, utiliser le déploiement Vercel ou la commande `vercel dev` après installation de Vercel CLI.

## Publier sur GitHub

Créer d'abord un dépôt vide dans l'organisation `IletouProjects`, par exemple `smartdoc-ai`, puis exécuter :

```bash
git init
git add .
git commit -m "Initial SmartDoc AI portal"
git branch -M main
git remote add origin https://github.com/IletouProjects/smartdoc-ai.git
git push -u origin main
```

Si le dépôt porte un autre nom, remplacer uniquement l'URL du remote.

## Variables Vercel

Dans les paramètres du projet Vercel, ajouter ces variables côté serveur :

```text
MAKE_WEBHOOK_URL=https://hook.eu1.make.com/....
AIRTABLE_TOKEN=pat_....
AIRTABLE_BASE_ID=appeKMMHs9aXnLeTe
AIRTABLE_DOCUMENTS_TABLE=Documents
AIRTABLE_ANALYSES_TABLE=Analyses IA
AIRTABLE_FILENAME_FIELD=Nom document
AIRTABLE_STATUS_FIELD=Statut
```

Ne jamais placer ces valeurs dans `index.html` ou dans un fichier JavaScript exécuté dans le navigateur.

## Déployer sur Vercel

Dans Vercel :

1. Importer le dépôt GitHub.
2. Choisir le framework `Other`.
3. Laisser la commande de build vide.
4. Laisser le répertoire de sortie par défaut.
5. Ajouter les variables d’environnement ci-dessus.
6. Cliquer sur `Deploy`.

Après le dépôt, la page interroge `/api/status` jusqu’à ce que le statut Airtable passe à `Analysé` et qu’une ligne `Analyses IA` soit liée au bon enregistrement `Documents`. Elle affiche ensuite le résumé, la catégorie, les points importants et le score de confiance. La surveillance couvre un cycle de 15 minutes du scénario Google Drive ; si la page est fermée avant la fin, il suffit de la recharger pour consulter le résultat enregistré dans Airtable.
