const { queryAll } = require('../config/database');
const { arcIdentitySelect } = require('./sql');
const SearchIndexService = require('./SearchIndexService');

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
    const queryEmbedding = SearchIndexService.embedText(q);
    const offset = cursor ? Number(Buffer.from(String(cursor), 'base64url').toString('utf8')) || 0 : 0;

    const semanticTypes = type === 'posts'
      ? ['post']
      : type === 'comments'
        ? ['comment']
        : ['post', 'comment'];

    const [semanticDocs, agents, submolts] = await Promise.all([
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
        [q.startsWith('@') ? `%${q.slice(1)}%` : pattern, cappedLimit]
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

    const [posts, comments] = await Promise.all([
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
            content: post.body || null,
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
          content: comment.body,
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

module.exports = SearchService;
