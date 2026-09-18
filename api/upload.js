const Busboy = require('busboy');
const crypto = require('node:crypto');

const MAX_FILE_SIZE = 8 * 1024 * 1024;

function parseMultipart(request) {
  return new Promise((resolve, reject) => {
    const contentType = request.headers['content-type'] || '';
    if (!contentType.startsWith('multipart/form-data')) {
      reject(new Error('Le formulaire doit être envoyé au format multipart/form-data.'));
      return;
    }

    const parser = Busboy({
      headers: request.headers,
      limits: { files: 1, fileSize: MAX_FILE_SIZE, fields: 10 },
    });
    const fields = {};
    let uploadedFile = null;
    let fileTooLarge = false;

    parser.on('field', (name, value) => {
      fields[name] = value;
    });

    parser.on('file', (fieldName, stream, info) => {
      const chunks = [];
      const { filename, mimeType } = info;

      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('limit', () => {
        fileTooLarge = true;
      });
      stream.on('end', () => {
        uploadedFile = {
          fieldName,
          filename,
          mimeType,
          buffer: Buffer.concat(chunks),
        };
      });
    });

    parser.on('error', reject);
    parser.on('finish', () => {
      if (fileTooLarge) {
        reject(new Error('Le fichier dépasse la limite de 8 Mo.'));
        return;
      }
      if (!uploadedFile || !uploadedFile.buffer.length) {
        reject(new Error('Aucun fichier PDF n’a été reçu.'));
        return;
      }
      resolve({ fields, file: uploadedFile });
    });

    request.pipe(parser);
  });
}

function cleanFilename(filename) {
  let cleaned = String(filename || 'document.pdf')
    .replace(/[\\/\0]/g, '')
    .trim();
  cleaned = cleaned.replace(/(?:\.pdf)+$/i, '.pdf');
  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`;
}

async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Méthode non autorisée.' });
  }

  if (!process.env.MAKE_WEBHOOK_URL) {
    return response.status(500).json({ error: 'MAKE_WEBHOOK_URL n’est pas configurée dans Vercel.' });
  }

  try {
    const { fields, file } = await parseMultipart(request);
    const filename = cleanFilename(file.filename);
    const isPdf = file.mimeType === 'application/pdf' || filename.endsWith('.pdf');
    if (!isPdf) {
      return response.status(400).json({ error: 'Seuls les fichiers PDF sont acceptés.' });
    }

    const jobId = fields.jobId || crypto.randomUUID();
    const form = new FormData();
    form.append('file', new Blob([file.buffer], { type: 'application/pdf' }), filename);
    form.append('filename', filename);
    form.append('mimeType', 'application/pdf');
    form.append('jobId', jobId);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let webhookResponse;
    try {
      webhookResponse = await fetch(process.env.MAKE_WEBHOOK_URL, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!webhookResponse.ok) {
      const errorText = await webhookResponse.text().catch(() => '');
      console.error('Make webhook error:', webhookResponse.status, errorText);
      return response.status(502).json({ error: 'Make n’a pas accepté le document.' });
    }

    return response.status(202).json({
      accepted: true,
      status: 'processing',
      jobId,
      filename,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      return response.status(202).json({
        accepted: true,
        status: 'processing',
        message: 'Le scénario Make a été lancé. Le statut sera vérifié dans Airtable.',
      });
    }
    console.error('Upload error:', error);
    return response.status(400).json({ error: error.message || 'Le dépôt n’a pas pu être traité.' });
  }
}

handler.config = {
  api: {
    bodyParser: false,
  },
};

module.exports = handler;
