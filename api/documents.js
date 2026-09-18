const DEFAULT_DOCUMENTS_TABLE = 'Documents';

function getField(fields, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(fields, name)) return fields[name];
  }
  return null;
}

function toText(value) {
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(' · ');
  if (value && typeof value === 'object') return value.name || value.id || '';
  return value === undefined || value === null ? '' : String(value);
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

function sortDate(record) {
  const fields = record.fields || {};
  const value = getField(fields, [
    'Dernière modification',
    'Derniere modification',
    'Date création',
    'Date creation',
    'Date reception',
  ]);
  return Date.parse(value || record.createdTime || '') || 0;
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Méthode non autorisée.' });
  }

  if (!process.env.AIRTABLE_BASE_ID || !process.env.AIRTABLE_TOKEN) {
    return response.status(500).json({ error: 'AIRTABLE_BASE_ID ou AIRTABLE_TOKEN n’est pas configuré dans Vercel.' });
  }

  try {
    const documentsTable = process.env.AIRTABLE_DOCUMENTS_TABLE || DEFAULT_DOCUMENTS_TABLE;
    const records = await airtableList(documentsTable, {
      maxRecords: '100',
    });

    const documents = records
      .map((record) => {
        const fields = record.fields || {};
        return {
          id: record.id,
          name: toText(getField(fields, ['Nom document', 'Nom fichier'])) || 'Document sans nom',
          category: toText(getField(fields, ['Type document', 'Catégorie détectée', 'Categorie detectee'])) || '—',
          version: toText(getField(fields, ['Version actuelle'])) || '1',
          status: toText(getField(fields, ['Statut', 'Statut version'])) || 'En traitement',
          updatedAt: sortDate(record),
        };
      })
      .filter((document) => document.name && document.name !== 'Document sans nom')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 10);

    response.setHeader('Cache-Control', 'no-store, max-age=0');
    return response.status(200).json({ documents });
  } catch (error) {
    console.error('Documents error:', error);
    return response.status(502).json({ error: error.message || 'Impossible de récupérer les documents Airtable.' });
  }
};
