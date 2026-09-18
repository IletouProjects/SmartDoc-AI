const DEFAULT_DOCUMENTS_TABLE = 'Documents';
const DEFAULT_ANALYSES_TABLE = 'Analyses IA';

function normalizeFieldName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

function getField(fields, names) {
  const source = fields || {};
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(source, name)) return source[name];
  }

  const normalizedNames = names.map(normalizeFieldName);
  const matchingKey = Object.keys(source).find((key) => normalizedNames.includes(normalizeFieldName(key)));
  if (matchingKey) return source[matchingKey];
  return null;
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function parseDate(value) {
  if (!value) return 0;
  if (Array.isArray(value)) return Math.max(0, ...value.map(parseDate));
  if (value && typeof value === 'object') {
    return parseDate(value.start || value.date || value.value);
  }

  const text = String(value).trim();
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return parsed;

  // Airtable peut renvoyer une date au format local français, par exemple
  // « 18/9/2026 6:01pm ». Date.parse() ne l'interprète pas toujours.
  const localMatch = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i);
  if (!localMatch) return 0;

  let [, day, month, year, hours = '0', minutes = '0', seconds = '0', meridiem] = localMatch;
  let hour = Number(hours);
  if (meridiem) {
    const lowerMeridiem = meridiem.toLowerCase();
    if (lowerMeridiem === 'pm' && hour < 12) hour += 12;
    if (lowerMeridiem === 'am' && hour === 12) hour = 0;
  }
  return new Date(Number(year), Number(month) - 1, Number(day), hour, Number(minutes), Number(seconds)).getTime() || 0;
}

function escapeFormulaValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function sortDate(record) {
  const fields = record.fields || {};
  const values = [
    'Dernière modification',
    'Derniere modification',
    'Date analyse',
    'Date création',
    'Date creation',
    'Date reception',
  ].map((name) => getField(fields, [name]));
  return Math.max(parseDate(record.createdTime), ...values.map(parseDate));
}

async function airtableList(table, params = {}) {
  const baseId = process.env.AIRTABLE_BASE_ID;
  const token = process.env.AIRTABLE_TOKEN;
  const url = new URL(`https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(table)}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  const airtableResponse = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await airtableResponse.json().catch(() => ({}));
  if (!airtableResponse.ok) {
    throw new Error(data.error?.message || 'Airtable n’a pas répondu correctement.');
  }
  return data.records || [];
}

function linkedRecordIds(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value.id ? [String(value.id)] : [];
  }
  if (!Array.isArray(value)) return value ? [String(value)] : [];
  return value.map((item) => (typeof item === 'string' ? item : item.id)).filter(Boolean);
}

function normalizedFilename(value) {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  // Le module Google Drive peut ajouter l'extension alors que Make la reçoit
  // déjà dans le nom. « document.pdf.pdf » doit donc correspondre à
  // « document.pdf » pour le suivi du même dépôt.
  return normalized.replace(/(?:\.pdf)+$/, '.pdf');
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Méthode non autorisée.' });
  }

  const filename = String(request.query.filename || '').trim();
  const since = Date.parse(String(request.query.since || '')) || 0;
  if (!filename) return response.status(400).json({ error: 'Le nom du fichier est requis.' });
  if (!process.env.AIRTABLE_BASE_ID || !process.env.AIRTABLE_TOKEN) {
    return response.status(500).json({ error: 'AIRTABLE_BASE_ID ou AIRTABLE_TOKEN n’est pas configuré dans Vercel.' });
  }

  try {
    const documentsTable = process.env.AIRTABLE_DOCUMENTS_TABLE || DEFAULT_DOCUMENTS_TABLE;
    const analysesTable = process.env.AIRTABLE_ANALYSES_TABLE || DEFAULT_ANALYSES_TABLE;
    const filenameField = process.env.AIRTABLE_FILENAME_FIELD || 'Nom document';
    const escapedFilename = escapeFormulaValue(filename);
    const documents = await airtableList(documentsTable, {
      filterByFormula: `{${filenameField}} = "${escapedFilename}"`,
      maxRecords: '20',
    });

    // Si Make/Airtable a normalisé les accents ou les espaces du nom, on
    // essaie une correspondance normalisée avant de conclure que Make n'a
    // encore rien créé.
    let matchingDocuments = documents;
    if (!matchingDocuments.length) {
      const recentDocuments = await airtableList(documentsTable, { maxRecords: '100' });
      const normalizedTarget = normalizedFilename(filename);
      matchingDocuments = recentDocuments.filter((record) => {
        const value = getField(record.fields || {}, [filenameField, 'Nom document', 'Nom fichier']);
        return normalizedFilename(value) === normalizedTarget;
      });
    }

    if (!matchingDocuments.length) {
      return response.status(200).json({ status: 'processing', stage: 'waiting_for_make', filename, message: 'Document reçu. En attente du traitement Make…' });
    }

    const document = [...matchingDocuments].sort((a, b) => sortDate(b) - sortDate(a))[0];
    const documentFields = document.fields || {};
    const statusField = process.env.AIRTABLE_STATUS_FIELD || 'Statut';
    const currentStatus = getField(documentFields, [statusField, 'Statut version']) || 'En traitement';
    const normalizedStatus = normalize(currentStatus);

    if (normalizedStatus.includes('erreur') || normalizedStatus.includes('echec')) {
      return response.status(200).json({ status: 'error', filename, message: 'Le traitement Make a signalé une erreur.', documentStatus: currentStatus });
    }

    if (!normalizedStatus.includes('analyse')) {
      return response.status(200).json({ status: 'processing', stage: 'analyzing', filename, documentStatus: currentStatus, version: getField(documentFields, ['Version actuelle']) || 1, message: `Traitement en cours · statut : ${currentStatus}` });
    }

    const analyses = await airtableList(analysesTable, { maxRecords: '100' });
    const relatedAnalyses = analyses.filter((record) => {
      const linked = getField(record.fields || {}, ['Document lié', 'Document lie']);
      return linkedRecordIds(linked).includes(document.id);
    }).sort((a, b) => sortDate(b) - sortDate(a));

    // La date « Dernière modification » peut ne pas changer lorsque Make
    // écrit dans les tables liées. L'activité de l'analyse nouvellement
    // créée est donc également utilisée pour reconnaître le nouveau dépôt.
    const latestActivity = Math.max(sortDate(document), ...relatedAnalyses.map(sortDate));
    const isFresh = !since || (latestActivity > 0 && latestActivity >= since - 60000);
    if (!isFresh) {
      return response.status(200).json({
        status: 'processing',
        stage: 'waiting_for_fresh_result',
        filename,
        documentStatus: currentStatus,
        version: getField(documentFields, ['Version actuelle']) || 1,
        message: 'Le document existe déjà. En attente du résultat de cette nouvelle version…',
      });
    }

    if (!relatedAnalyses.length) {
      return response.status(200).json({
        status: 'processing',
        stage: 'waiting_for_analysis',
        filename,
        documentStatus: currentStatus,
        version: getField(documentFields, ['Version actuelle']) || 1,
        message: 'Le document est marqué comme analysé. En attente du détail de l’analyse IA…',
      });
    }

    const analysisFields = relatedAnalyses[0]?.fields || {};

    return response.status(200).json({
      status: 'completed',
      filename,
      documentId: document.id,
      analysisId: relatedAnalyses[0].id,
      documentStatus: currentStatus,
      version: getField(documentFields, ['Version actuelle']) || getField(analysisFields, ['Version analysée', 'Version analysee']) || 1,
      analysis: {
        category: getField(analysisFields, ['Catégorie détectée', 'Categorie detectee', 'Categorie Detectee', 'categorie']),
        summary: getField(analysisFields, ['Résumé IA', 'Resume IA', 'resume']),
        keyPoints: getField(analysisFields, ['Points importants', 'points_importants']),
        verification: getField(analysisFields, [
          'Vérification humaine',
          'Verification humaine',
          'Vérification',
          'verification',
          'Points de vigilance IA',
          'Points vigilance IA',
          'Verification IA',
        ]),
        confidence: getField(analysisFields, ['Score confiance IA', 'score_confiance']),
      },
    });
  } catch (error) {
    console.error('Status error:', error);
    return response.status(502).json({ error: error.message || 'Impossible de récupérer le statut Airtable.' });
  }
};
