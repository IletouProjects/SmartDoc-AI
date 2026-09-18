const DEFAULT_DOCUMENTS_TABLE = 'Documents';
const DEFAULT_ANALYSES_TABLE = 'Analyses IA';

function getField(fields, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(fields, name)) return fields[name];
  }
  return null;
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function escapeFormulaValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function sortDate(record) {
  const fields = record.fields || {};
  const value = getField(fields, ['Dernière modification', 'Date analyse', 'Date création', 'Date reception']);
  return Date.parse(value || record.createdTime || '') || 0;
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
  if (!Array.isArray(value)) return value ? [String(value)] : [];
  return value.map((item) => (typeof item === 'string' ? item : item.id)).filter(Boolean);
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

    if (!documents.length) {
      return response.status(200).json({ status: 'processing', stage: 'waiting_for_make', filename, message: 'Document reçu. En attente du traitement Make…' });
    }

    const document = [...documents].sort((a, b) => sortDate(b) - sortDate(a))[0];
    const documentFields = document.fields || {};
    const statusField = process.env.AIRTABLE_STATUS_FIELD || 'Statut';
    const currentStatus = getField(documentFields, [statusField, 'Statut version']) || 'En traitement';
    const lastUpdate = sortDate(document);
    const isFresh = !since || !lastUpdate || lastUpdate >= since - 60000;
    const normalizedStatus = normalize(currentStatus);

    if (normalizedStatus.includes('erreur') || normalizedStatus.includes('echec')) {
      return response.status(200).json({ status: 'error', filename, message: 'Le traitement Make a signalé une erreur.', documentStatus: currentStatus });
    }

    if (!isFresh || !normalizedStatus.includes('analyse')) {
      return response.status(200).json({ status: 'processing', stage: 'analyzing', filename, documentStatus: currentStatus, version: getField(documentFields, ['Version actuelle']) || 1, message: `Traitement en cours · statut : ${currentStatus}` });
    }

    const analyses = await airtableList(analysesTable, { maxRecords: '100' });
    const relatedAnalyses = analyses.filter((record) => {
      const linked = getField(record.fields || {}, ['Document lié', 'Document lie']);
      return linkedRecordIds(linked).includes(document.id);
    }).sort((a, b) => sortDate(b) - sortDate(a));
    const analysisFields = relatedAnalyses[0]?.fields || {};

    return response.status(200).json({
      status: 'completed',
      filename,
      documentStatus: currentStatus,
      version: getField(documentFields, ['Version actuelle']) || getField(analysisFields, ['Version analysée', 'Version analysee']) || 1,
      analysis: {
        category: getField(analysisFields, ['Catégorie détectée', 'Categorie detectee', 'categorie']),
        summary: getField(analysisFields, ['Résumé IA', 'Resume IA', 'resume']),
        keyPoints: getField(analysisFields, ['Points importants', 'points_importants']),
        verification: getField(analysisFields, ['Vérification humaine', 'Verification humaine', 'Vérification', 'verification']),
        confidence: getField(analysisFields, ['Score confiance IA', 'score_confiance']),
      },
    });
  } catch (error) {
    console.error('Status error:', error);
    return response.status(502).json({ error: error.message || 'Impossible de récupérer le statut Airtable.' });
  }
};

