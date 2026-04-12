const { query } = require('../config/database');

const DIMENSIONS = 64;

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function hashToken(token) {
  let hash = 0;
  for (let i = 0; i < token.length; i += 1) {
    hash = ((hash << 5) - hash) + token.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function embedText(text) {
  const vector = new Array(DIMENSIONS).fill(0);
  for (const token of tokenize(text)) {
    const index = hashToken(token) % DIMENSIONS;
    vector[index] += 1;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0)) || 1;
  return vector.map((value) => Number((value / magnitude).toFixed(6)));
}

class SearchIndexService {
  static embedText(text) {
    return embedText(text);
  }

  static async upsert({ documentType, documentId, title = null, content, metadata = {} }) {
    const embedding = embedText([title, content].filter(Boolean).join('\n\n'));

    await query(
      `INSERT INTO semantic_documents (
         document_type, document_id, title, content, metadata, embedding_json, updated_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, NOW())
       ON CONFLICT (document_type, document_id)
       DO UPDATE SET
         title = EXCLUDED.title,
         content = EXCLUDED.content,
         metadata = EXCLUDED.metadata,
         embedding_json = EXCLUDED.embedding_json,
         updated_at = NOW()`,
      [
        documentType,
        String(documentId),
        title,
        String(content || ''),
        JSON.stringify(metadata),
        JSON.stringify(embedding)
      ]
    );
  }
}

module.exports = SearchIndexService;
