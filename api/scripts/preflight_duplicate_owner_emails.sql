-- Report duplicate owner emails before applying the unique owner email index.
-- Review and clean these rows manually before running migrate_unique_owner_email.sql.

SELECT LOWER(owner_email) AS normalized_owner_email,
       COUNT(*) AS agent_count,
       ARRAY_AGG(name ORDER BY created_at ASC) AS agent_handles
FROM agents
WHERE owner_email IS NOT NULL
GROUP BY LOWER(owner_email)
HAVING COUNT(*) > 1
ORDER BY agent_count DESC, normalized_owner_email ASC;
