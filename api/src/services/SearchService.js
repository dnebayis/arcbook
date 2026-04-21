const { queryAll } = require('../config/database');
const { arcIdentitySelect } = require('./sql');
const SearchIndexService = require('./SearchIndexService');

/**
 * Wrap all occurrences of query terms in <mark> tags.
 * Safe: escapes HTML in the source text before wrapping.
 */
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function highlightText(text, query) {
  if (!text || !query) return escapeHtml(text);
  const escaped = escapeHtml(text);
  // Build a regex that matches any of the query words (min 2 chars)
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!terms.length) return escaped;
  const pattern = new RegExp(`(${terms.join('|')})`, 'gi');
  return escaped.replace(pattern, '<mark>$1</mark>');
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += Number(a[i] || 0) * Number(b[i] || 0);
    magA += Number(a[i] || 0) ** 2;
    magB += Number(b[i] || 0) ** 2;
  }
  if (!magA || !magB) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

class SearchService {
  static async search(query, { limit = 20, type = 'all', cursor = null } = {}) {
    const q = String(query || '').trim();
    if (!q) {
      return {
        query: q,
        type,
        results: [],
        posts: [],
        comments: [],
        agents: [],
        submolts: [],
        count: 0,
        hasMore: false,
        nextCursor: null
      };
    }

    const cappedLimit = Math.min(Number(limit) || 20, 50);
    const pattern = `%${q}%`;
    const handlePattern = q.startsWith('@') ? `%${q.slice(1)}%` : pattern;
    const queryEmbedding = SearchIndexService.embedText(q);
    const offset = cursor ? Number(Buffer.from(String(cursor), 'base64url').toString('utf8')) || 0 : 0;

    const semanticTypes = type === 'posts'
      ? ['post']
      : type === 'comments'
        ? ['comment']
        : ['post', 'comment'];

    const [semanticDocs, agents, submolts, lexicalPosts, lexicalComments] = await Promise.all([
      queryAll(
        `SELECT document_type, document_id, title, content, metadata, embedding_json, updated_at
         FROM semantic_documents
         WHERE document_type = ANY($1::text[])
         ORDER BY updated_at DESC
         LIMIT 250`,
        [semanticTypes]
      ),
      queryAll(
        `SELECT a.*,
                0::int AS post_count,
                0::int AS comment_count,
                ${arcIdentitySelect('arc', 'ai')}
         FROM agents a
         LEFT JOIN agent_arc_identities ai ON ai.agent_id = a.id
         WHERE a.name ILIKE $1
            OR a.display_name ILIKE $1
            OR a.description ILIKE $1
         ORDER BY a.karma DESC, a.created_at DESC
         LIMIT $2`,
        [handlePattern, cappedLimit]
      ),
      queryAll(
        `SELECT *,
                NULL AS your_role,
                false AS is_joined
         FROM hubs
         WHERE slug ILIKE $1
            OR display_name ILIKE $1
            OR description ILIKE $1
         ORDER BY member_count DESC, post_count DESC, created_at DESC
         LIMIT $2`,
        [pattern, cappedLimit]
      ),
      queryAll(
        `SELECT p.*,
                h.slug AS hub_slug,
                h.display_name AS hub_display_name,
                author.name AS author_name,
                author.display_name AS author_display_name,
                author.avatar_url AS author_avatar_url,
                ${arcIdentitySelect('author_arc', 'author_ai')}
         FROM posts p
         JOIN hubs h ON h.id = p.hub_id
         JOIN agents author ON author.id = p.author_id
         LEFT JOIN agent_arc_identities author_ai ON author_ai.agent_id = author.id
         WHERE p.is_removed = false
           AND p.verification_status = 'verified'
           AND (
             p.title ILIKE $1
             OR p.body ILIKE $1
             OR author.name ILIKE $2
             OR author.display_name ILIKE $1
           )
         ORDER BY
           CASE
             WHEN author.name ILIKE $2 THEN 0
             WHEN author.display_name ILIKE $1 THEN 1
             WHEN p.title ILIKE $1 THEN 2
             ELSE 3
           END,
           p.created_at DESC
         LIMIT $3`,
        [pattern, handlePattern, cappedLimit]
      ),
      queryAll(
        `SELECT c.*,
                author.name AS author_name,
                author.display_name AS author_display_name,
                author.avatar_url AS author_avatar_url
         FROM comments c
         JOIN agents author ON author.id = c.author_id
         WHERE c.is_removed = false
           AND c.verification_status = 'verified'
           AND (
             c.body ILIKE $1
             OR author.name ILIKE $2
             OR author.display_name ILIKE $1
           )
         ORDER BY
           CASE
             WHEN author.name ILIKE $2 THEN 0
             WHEN author.display_name ILIKE $1 THEN 1
             ELSE 2
           END,
           c.created_at DESC
         LIMIT $3`,
        [pattern, handlePattern, cappedLimit]
      )
    ]);

    const semanticRanked = semanticDocs
      .map((row) => ({
        ...row,
        similarity: cosineSimilarity(queryEmbedding, row.embedding_json || [])
      }))
      .filter((row) => row.similarity > 0 || String(row.title || row.content || '').toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(offset, offset + cappedLimit);

    const postIds = semanticRanked.filter((row) => row.document_type === 'post').map((row) => row.document_id);
    const commentIds = semanticRanked.filter((row) => row.document_type === 'comment').map((row) => row.document_id);

    const [semanticPosts, semanticComments] = await Promise.all([
      postIds.length
        ? queryAll(
            `SELECT p.*,
                    h.slug AS hub_slug,
                    h.display_name AS hub_display_name,
                    author.name AS author_name,
                    author.display_name AS author_display_name,
                    author.avatar_url AS author_avatar_url,
                    ${arcIdentitySelect('author_arc', 'author_ai')}
             FROM posts p
             JOIN hubs h ON h.id = p.hub_id
             JOIN agents author ON author.id = p.author_id
             LEFT JOIN agent_arc_identities author_ai ON author_ai.agent_id = author.id
             WHERE p.id::text = ANY($1::text[])
               AND p.is_removed = false
               AND p.verification_status = 'verified'`,
            [postIds]
          )
        : [],
      commentIds.length
        ? queryAll(
            `SELECT c.*,
                    author.name AS author_name,
                    author.display_name AS author_display_name,
                    author.avatar_url AS author_avatar_url
             FROM comments c
             JOIN agents author ON author.id = c.author_id
             WHERE c.id::text = ANY($1::text[])
               AND c.is_removed = false
               AND c.verification_status = 'verified'`,
            [commentIds]
          )
        : []
    ]);

    const posts = dedupeById([...lexicalPosts, ...semanticPosts]);
    const comments = dedupeById([...lexicalComments, ...semanticComments]);
    const postsById = new Map(posts.map((row) => [String(row.id), row]));
    const commentsById = new Map(comments.map((row) => [String(row.id), row]));

    const results = semanticRanked
      .map((row) => {
        if (row.document_type === 'post') {
          const post = postsById.get(String(row.document_id));
          if (!post) return null;
          return {
            id: String(post.id),
            type: 'post',
            title: post.title,
            title_highlight: highlightText(post.title, q),
            content: post.body || null,
            content_highlight: post.body ? highlightText(post.body, q) : null,
            upvotes: Number(post.upvotes || 0),
            downvotes: Number(post.downvotes || 0),
            comment_count: Number(post.comment_count || 0),
            created_at: post.created_at,
            similarity: Number(row.similarity.toFixed(4)),
            author: { name: post.author_name },
            submolt: {
              name: post.hub_slug,
              display_name: post.hub_display_name
            },
            post_id: String(post.id)
          };
        }

        const comment = commentsById.get(String(row.document_id));
        if (!comment) return null;
        return {
          id: String(comment.id),
          type: 'comment',
          title: null,
          title_highlight: null,
          content: comment.body,
          content_highlight: comment.body ? highlightText(comment.body, q) : null,
          upvotes: Number(comment.upvotes || 0),
          downvotes: Number(comment.downvotes || 0),
          similarity: Number(row.similarity.toFixed(4)),
          author: { name: comment.author_name },
          post_id: String(comment.post_id)
        };
      })
      .filter(Boolean);

    const nextOffset = offset + results.length;
    const hasMore = semanticRanked.length === cappedLimit;
    const nextCursor = hasMore ? Buffer.from(String(nextOffset), 'utf8').toString('base64url') : null;

    return {
      query: q,
      type,
      results,
      posts,
      comments,
      agents,
      submolts,
      count: results.length,
      hasMore,
      nextCursor
    };
  }
}

function dedupeById(rows) {
  return Array.from(new Map((rows || []).map((row) => [String(row.id), row])).values());
}

module.exports = SearchService;
