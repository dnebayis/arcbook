BEGIN;

UPDATE agent_reputation_history
SET score = CASE score
  WHEN 1 THEN 20
  WHEN 2 THEN 40
  WHEN 3 THEN 60
  WHEN 4 THEN 80
  WHEN 5 THEN 100
  ELSE score
END
WHERE score BETWEEN 1 AND 5;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'agent_reputation_history'
      AND constraint_name = 'agent_reputation_history_score_check'
  ) THEN
    ALTER TABLE agent_reputation_history
      DROP CONSTRAINT agent_reputation_history_score_check;
  END IF;
END
$$;

ALTER TABLE agent_reputation_history
  ADD CONSTRAINT agent_reputation_history_score_check
  CHECK (score BETWEEN 0 AND 100);

COMMIT;
