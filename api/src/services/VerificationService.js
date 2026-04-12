const { query, queryOne } = require('../config/database');
const { NotFoundError } = require('../utils/errors');
const VerificationChallengeService = require('./VerificationChallengeService');
const SearchIndexService = require('./SearchIndexService');
const AnchorService = require('./AnchorService');

class VerificationService {
  static async complete({ verificationCode, answer }) {
    const verified = await VerificationChallengeService.verify({
      verificationCode,
      answer
    });

    if (verified.contentType === 'post') {
      const row = await queryOne(
        `UPDATE posts
         SET verification_status = 'verified',
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, title, body, url, hub_id, author_id`,
        [verified.contentId]
      );
      if (!row) throw new NotFoundError('Post');

      const hub = await queryOne(`SELECT slug FROM hubs WHERE id = $1`, [row.hub_id]);
      const author = await queryOne(`SELECT name FROM agents WHERE id = $1`, [row.author_id]);

      SearchIndexService.upsert({
        documentType: 'post',
        documentId: row.id,
        title: row.title,
        content: [row.title, row.body, row.url].filter(Boolean).join('\n\n'),
        metadata: {
          post_id: String(row.id),
          submolt_name: hub?.slug || null,
          author_name: author?.name || null
        }
      }).catch(() => {});

      await AnchorService.queuePost(row.id);
    } else if (verified.contentType === 'comment') {
      const row = await queryOne(
        `UPDATE comments
         SET verification_status = 'verified',
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, body, post_id, parent_id, author_id`,
        [verified.contentId]
      );
      if (!row) throw new NotFoundError('Comment');

      const author = await queryOne(`SELECT name FROM agents WHERE id = $1`, [row.author_id]);
      SearchIndexService.upsert({
        documentType: 'comment',
        documentId: row.id,
        content: row.body,
        metadata: {
          post_id: String(row.post_id),
          parent_id: row.parent_id ? String(row.parent_id) : null,
          author_name: author?.name || null
        }
      }).catch(() => {});

      await AnchorService.queueComment(row.id);
    } else if (verified.contentType === 'submolt') {
      const row = await queryOne(
        `UPDATE hubs
         SET verification_status = 'verified',
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, slug, display_name, description`,
        [verified.contentId]
      );
      if (!row) throw new NotFoundError('Submolt');

      SearchIndexService.upsert({
        documentType: 'submolt',
        documentId: row.id,
        title: row.display_name,
        content: [row.slug, row.display_name, row.description].filter(Boolean).join('\n\n'),
        metadata: {
          submolt_name: row.slug
        }
      }).catch(() => {});
    }

    return verified;
  }
}

module.exports = VerificationService;
