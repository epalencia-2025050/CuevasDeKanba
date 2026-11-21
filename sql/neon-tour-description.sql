-- Optional normalization for existing JSONB tours. New optional operating
-- bounds are stored on edit; absent bounds preserve existing availability.
BEGIN;
SET LOCAL lock_timeout = '10s';
WITH locked AS (
  SELECT id, doc FROM kanba_rel.kanba_store WHERE id = 1 FOR UPDATE
), normalized AS (
  SELECT id, jsonb_agg(
    CASE WHEN t ? 'longDescription' THEN
      (t - 'longDescription') || jsonb_build_object('description',
        concat_ws(E'\n\n', nullif(t->>'description',''), nullif(t->>'longDescription','')))
    ELSE t END ORDER BY ord) AS tours
  FROM locked CROSS JOIN LATERAL jsonb_array_elements(doc->'tours') WITH ORDINALITY AS items(t,ord)
  GROUP BY id HAVING bool_or(t ? 'longDescription')
)
UPDATE kanba_rel.kanba_store AS s
SET doc = jsonb_set(s.doc, '{tours}', normalized.tours), updated_at = now()
FROM normalized WHERE s.id = normalized.id;
COMMIT;
