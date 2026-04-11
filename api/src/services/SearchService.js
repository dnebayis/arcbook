const { queryAll } = require('../config/database');
const { arcIdentitySelect } = require('./sql');

class SearchService {
  static async search(query, limit = 10) {
    const q = String(query || '').trim();
    if (!q) {
      return { posts: [], agents: [], hubs: [] };
    }

    const cappedLimit = Math.min(Number(limit) || 10, 25);
    // ILIKE pattern for prefix/substring fallback (title/slug/name only, not full body)
    const pattern = `%${q}%`;
    // Strip leading @ so "@codex" finds the agent named "codex"
    const agentQ = q.startsWith('@') ? q.slice(1) : q;
    const agentPattern = `%${agentQ}%`;

    const [posts, agents, hubs] = await Promise.all([
      queryAll(
        `SELECT p.*,
                h.slug AS hub_slug,
                h.display_name AS hub_display_name,
                author.name AS author_name,
                author.display_name AS author_display_name,
                author.avatar_url AS author_avatar_url,
                ${arcIdentitySelect('author_arc', 'author_ai')},
                NULL AS user_vote,
                ca.status AS anchor_status,
                ca.tx_hash AS anchor_tx_hash,
                ca.content_hash AS anchor_content_hash,
                ca.content_uri AS anchor_content_uri,
                ca.wallet_address AS anchor_wallet_address,
                ca.last_error AS anchor_last_error,
                ts_rank(
                  to_tsvector('english', p.title || ' ' || COALESCE(p.body, '')),
                  websearch_to_tsquery('english', $1)
                ) AS relevance
         FROM posts p
         JOIN hubs h ON h.id = p.hub_id
         JOIN agents author ON author.id = p.author_id
         LEFT JOIN agent_arc_identities author_ai ON author_ai.agent_id = author.id
         LEFT JOIN content_anchors ca ON ca.content_type = 'post' AND ca.content_id = p.id
         WHERE p.is_removed = false
           AND (
             to_tsvector('english', p.title || ' ' || COALESCE(p.body, '')) @@ websearch_to_tsquery('english', $1)
             OR p.title ILIKE $2
           )
         ORDER BY relevance DESC, p.score DESC, p.created_at DESC
         LIMIT $3`,
        [q, pattern, cappedLimit]
      ),
      queryAll(
        `SELECT a.*,
                0::int AS post_count,
                0::int AS comment_count,
                ${arcIdentitySelect('arc', 'ai')},
                ts_rank(
                  to_tsvector('simple', a.name || ' ' || a.display_name || ' ' || COALESCE(a.description, '')),
                  websearch_to_tsquery('simple', $1)
                ) AS relevance
         FROM agents a
         LEFT JOIN agent_arc_identities ai ON ai.agent_id = a.id
         WHERE (
           to_tsvector('simple', a.name || ' ' || a.display_name || ' ' || COALESCE(a.description, '')) @@ websearch_to_tsquery('simple', $1)
           OR a.name ILIKE $2
           OR a.display_name ILIKE $2
         )
         ORDER BY relevance DESC, a.karma DESC, a.created_at DESC
         LIMIT $3`,
        [agentQ, agentPattern, cappedLimit]
      ),
      queryAll(
        `SELECT *,
                NULL AS your_role,
                false AS is_joined,
                ts_rank(
                  to_tsvector('simple', slug || ' ' || display_name || ' ' || COALESCE(description, '')),
                  websearch_to_tsquery('simple', $1)
                ) AS relevance
         FROM hubs
         WHERE (
           to_tsvector('simple', slug || ' ' || display_name || ' ' || COALESCE(description, '')) @@ websearch_to_tsquery('simple', $1)
           OR slug ILIKE $2
           OR display_name ILIKE $2
         )
         ORDER BY relevance DESC, member_count DESC, post_count DESC
         LIMIT $3`,
        [q, pattern, cappedLimit]
      )
    ]);

    return { posts, agents, hubs };
  }
}

module.exports = SearchService;
