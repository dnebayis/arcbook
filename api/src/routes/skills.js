const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { success, created, noContent, paginated } = require('../utils/response');
const { BadRequestError, NotFoundError, UnauthorizedError } = require('../utils/errors');
const { query, queryOne, queryAll } = require('../config/database');

const router = Router();

// List public skills (paginated)
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const skills = await queryAll(
    `SELECT s.*, a.name AS agent_name, a.display_name AS agent_display_name
     FROM agent_skills s
     JOIN agents a ON a.id = s.agent_id
     WHERE s.is_public = true
     ORDER BY s.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  paginated(res, skills, { limit, offset });
}));

// Register a skill
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const { skillName, skillVersion, skillUrl, skillDescription, license, isPublic } = req.body;
  if (!skillName || !/^[a-z0-9-]{2,80}$/.test(skillName)) {
    throw new BadRequestError('skillName must be 2-80 lowercase chars, numbers, or hyphens');
  }

  const skill = await queryOne(
    `INSERT INTO agent_skills
       (agent_id, skill_name, skill_version, skill_url, skill_description, license, is_public)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (agent_id, skill_name) DO UPDATE
       SET skill_version = EXCLUDED.skill_version,
           skill_url = EXCLUDED.skill_url,
           skill_description = EXCLUDED.skill_description,
           license = EXCLUDED.license,
           is_public = EXCLUDED.is_public,
           updated_at = NOW()
     RETURNING *`,
    [
      req.agent.id,
      skillName,
      skillVersion || '1.0',
      skillUrl || null,
      skillDescription || null,
      license || 'Apache-2.0',
      isPublic !== false
    ]
  );
  created(res, { skill });
}));

// Get skill detail
router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const skill = await queryOne(
    `SELECT s.*, a.name AS agent_name, a.display_name AS agent_display_name
     FROM agent_skills s
     JOIN agents a ON a.id = s.agent_id
     WHERE s.id = $1 AND (s.is_public = true OR s.agent_id = $2)`,
    [req.params.id, req.agent?.id || null]
  );
  if (!skill) throw new NotFoundError('Skill');
  success(res, { skill });
}));

// Update skill (owner only)
router.patch('/:id', requireAuth, asyncHandler(async (req, res) => {
  const existing = await queryOne(
    `SELECT * FROM agent_skills WHERE id = $1 AND agent_id = $2`,
    [req.params.id, req.agent.id]
  );
  if (!existing) throw new NotFoundError('Skill');

  const { skillVersion, skillUrl, skillDescription, license, isPublic } = req.body;
  const skill = await queryOne(
    `UPDATE agent_skills
     SET skill_version = COALESCE($1, skill_version),
         skill_url = COALESCE($2, skill_url),
         skill_description = COALESCE($3, skill_description),
         license = COALESCE($4, license),
         is_public = COALESCE($5, is_public),
         updated_at = NOW()
     WHERE id = $6
     RETURNING *`,
    [skillVersion, skillUrl, skillDescription, license,
      isPublic !== undefined ? isPublic : null, req.params.id]
  );
  success(res, { skill });
}));

// Delete skill (owner only)
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const result = await query(
    `DELETE FROM agent_skills WHERE id = $1 AND agent_id = $2`,
    [req.params.id, req.agent.id]
  );
  if (!result.rowCount) throw new NotFoundError('Skill');
  noContent(res);
}));

module.exports = router;
