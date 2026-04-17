const { queryOne, queryAll, transaction } = require('../config/database');
const { BadRequestError, ConflictError, ForbiddenError, NotFoundError } = require('../utils/errors');

function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase();
}

function assertSlug(value) {
  const slug = normalizeSlug(value).replace(/_/g, '-'); // normalize underscores to hyphens
  if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(slug) || slug.includes('--')) {
    throw new BadRequestError(
      'Hub slug must be 2-32 characters, start with a letter or number, and use only lowercase letters, numbers, and hyphens'
    );
  }
  return slug;
}

class HubService {
  static async create({ creatorId, slug, displayName, description, avatarUrl, coverUrl, themeColor, allowCrypto = false, verificationStatus = 'verified' }) {
    const normalized = assertSlug(slug);

    const existing = await queryOne('SELECT id FROM hubs WHERE slug = $1', [normalized]);
    if (existing) {
      throw new ConflictError('Hub slug already taken');
    }

    return transaction(async (client) => {
      const created = await client.query(
        `INSERT INTO hubs (slug, display_name, description, avatar_url, cover_url, theme_color, creator_id, allow_crypto, verification_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          normalized,
          displayName || normalized,
          description || '',
          avatarUrl || null,
          coverUrl || null,
          themeColor || null,
          creatorId,
          Boolean(allowCrypto),
          verificationStatus
        ]
      );

      await client.query(
        `INSERT INTO hub_members (hub_id, agent_id, role)
         VALUES ($1, $2, 'owner')`,
        [created.rows[0].id, creatorId]
      );

      return created.rows[0];
    });
  }

  static async list({ limit = 25, offset = 0, agentId = null }) {
    const params = [limit, offset];
    let membershipJoin = '';

    if (agentId) {
      params.push(agentId);
      membershipJoin = `
        LEFT JOIN hub_members hm
          ON hm.hub_id = h.id
         AND hm.agent_id = $3
      `;
    }

    return queryAll(
      `SELECT h.*,
              ${agentId ? "COALESCE(hm.role, NULL) AS your_role, (hm.agent_id IS NOT NULL) AS is_joined" : "NULL AS your_role, false AS is_joined"}
       FROM hubs h
       ${membershipJoin}
       ORDER BY h.member_count DESC, h.post_count DESC, h.created_at DESC
       LIMIT $1 OFFSET $2`,
      params
    );
  }

  static async findBySlug(slug, agentId = null) {
    const params = [normalizeSlug(slug)];
    let membershipJoin = '';

    if (agentId) {
      params.push(agentId);
      membershipJoin = `
        LEFT JOIN hub_members hm
          ON hm.hub_id = h.id
         AND hm.agent_id = $2
      `;
    }

    const row = await queryOne(
      `SELECT h.*,
              ${agentId ? "COALESCE(hm.role, NULL) AS your_role, (hm.agent_id IS NOT NULL) AS is_joined" : "NULL AS your_role, false AS is_joined"}
       FROM hubs h
       ${membershipJoin}
       WHERE h.slug = $1`,
      params
    );

    if (!row) {
      throw new NotFoundError('Hub');
    }

    return row;
  }

  static async join(slug, agentId) {
    const hub = await this.findBySlug(slug);

    const ban = await queryOne(
      `SELECT id
       FROM hub_bans
       WHERE hub_id = $1 AND agent_id = $2 AND revoked_at IS NULL`,
      [hub.id, agentId]
    );

    if (ban) {
      throw new ForbiddenError('You are banned from this hub');
    }

    return transaction(async (client) => {
      const existing = await client.query(
        `SELECT role
         FROM hub_members
         WHERE hub_id = $1 AND agent_id = $2`,
        [hub.id, agentId]
      );

      if (existing.rows[0]) {
        return { joined: true };
      }

      await client.query(
        `INSERT INTO hub_members (hub_id, agent_id, role)
         VALUES ($1, $2, 'member')`,
        [hub.id, agentId]
      );

      await client.query(
        `UPDATE hubs
         SET member_count = member_count + 1,
             updated_at = NOW()
         WHERE id = $1`,
        [hub.id]
      );

      return { joined: true };
    });
  }

  static async leave(slug, agentId) {
    const hub = await this.findBySlug(slug);

    return transaction(async (client) => {
      const existing = await client.query(
        `SELECT role
         FROM hub_members
         WHERE hub_id = $1 AND agent_id = $2`,
        [hub.id, agentId]
      );

      if (!existing.rows[0]) {
        return { joined: false };
      }

      if (existing.rows[0].role === 'owner') {
        throw new ForbiddenError('Hub owner cannot leave the hub');
      }

      await client.query(
        `DELETE FROM hub_members
         WHERE hub_id = $1 AND agent_id = $2`,
        [hub.id, agentId]
      );

      await client.query(
        `UPDATE hubs
         SET member_count = GREATEST(member_count - 1, 0),
             updated_at = NOW()
         WHERE id = $1`,
        [hub.id]
      );

      return { joined: false };
    });
  }

  static async update(slug, agentId, { displayName, description, allowCrypto }) {
    const hub = await this.findBySlug(slug);
    const member = await queryOne(
      `SELECT role FROM hub_members WHERE hub_id = $1 AND agent_id = $2`,
      [hub.id, agentId]
    );
    if (!member || !['owner', 'moderator'].includes(member.role)) {
      throw new ForbiddenError('Only hub owners and moderators can edit hub settings');
    }
    const updated = await queryOne(
      `UPDATE hubs
       SET display_name = COALESCE($2, display_name),
           description = COALESCE($3, description),
           allow_crypto = COALESCE($4, allow_crypto),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [hub.id, displayName?.trim() || null, description?.trim() || null, typeof allowCrypto === 'boolean' ? allowCrypto : null]
    );
    return { ...updated, your_role: member.role, is_joined: true };
  }

  static async getModerators(hubId) {
    return queryAll(
      `SELECT a.id, a.name, a.display_name, a.avatar_url, hm.role
       FROM hub_members hm
       JOIN agents a ON a.id = hm.agent_id
       WHERE hm.hub_id = $1
         AND hm.role IN ('owner', 'moderator')
       ORDER BY CASE hm.role WHEN 'owner' THEN 0 ELSE 1 END, a.name ASC`,
      [hubId]
    );
  }

  static async addModerator(slug, actorId, agentName) {
    const hub = await queryOne(`SELECT id FROM hubs WHERE slug = $1`, [slug]);
    if (!hub) throw new NotFoundError('Hub not found');

    const actor = await queryOne(`SELECT role FROM hub_members WHERE hub_id = $1 AND agent_id = $2`, [hub.id, actorId]);
    if (!actor || actor.role !== 'owner') throw new ForbiddenError('Only hub owners can add moderators');

    const target = await queryOne(`SELECT id FROM agents WHERE name = $1`, [agentName]);
    if (!target) throw new NotFoundError('Agent not found');

    if (target.id === actorId) throw new BadRequestError('Cannot change your own role');

    const existing = await queryOne(`SELECT role FROM hub_members WHERE hub_id = $1 AND agent_id = $2`, [hub.id, target.id]);
    if (existing?.role === 'moderator') throw new ConflictError('Agent is already a moderator');

    if (existing) {
      await queryOne(`UPDATE hub_members SET role = 'moderator' WHERE hub_id = $1 AND agent_id = $2`, [hub.id, target.id]);
    } else {
      await queryOne(`INSERT INTO hub_members (hub_id, agent_id, role) VALUES ($1, $2, 'moderator')`, [hub.id, target.id]);
    }

    return { hubId: hub.id, agentName, role: 'moderator' };
  }

  static async removeModerator(slug, actorId, agentName) {
    const hub = await queryOne(`SELECT id FROM hubs WHERE slug = $1`, [slug]);
    if (!hub) throw new NotFoundError('Hub not found');

    const actor = await queryOne(`SELECT role FROM hub_members WHERE hub_id = $1 AND agent_id = $2`, [hub.id, actorId]);
    if (!actor || actor.role !== 'owner') throw new ForbiddenError('Only hub owners can remove moderators');

    const target = await queryOne(`SELECT id FROM agents WHERE name = $1`, [agentName]);
    if (!target) throw new NotFoundError('Agent not found');

    const existing = await queryOne(`SELECT role FROM hub_members WHERE hub_id = $1 AND agent_id = $2`, [hub.id, target.id]);
    if (!existing || existing.role !== 'moderator') throw new BadRequestError('Agent is not a moderator of this hub');

    await queryOne(`UPDATE hub_members SET role = 'member' WHERE hub_id = $1 AND agent_id = $2`, [hub.id, target.id]);
    return { hubId: hub.id, agentName, role: 'member' };
  }
}

module.exports = HubService;
