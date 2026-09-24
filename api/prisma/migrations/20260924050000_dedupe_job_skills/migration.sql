-- Data only, no schema change. The extractor's vocabulary listed 'forecasting'
-- twice, so a term could be stored twice on one posting (502 of 5,402 at the
-- time). Remove repeats, keeping the first occurrence's position — skill order
-- is the order they appear in the posting, and the UI shows the first six.
UPDATE "Job" SET "skills" = ARRAY(
  SELECT s FROM unnest("skills") WITH ORDINALITY AS t(s, i) GROUP BY s ORDER BY min(i)
) WHERE cardinality("skills") <> (SELECT count(DISTINCT s) FROM unnest("skills") AS u(s));

UPDATE "Job" SET "requiredSkills" = ARRAY(
  SELECT s FROM unnest("requiredSkills") WITH ORDINALITY AS t(s, i) GROUP BY s ORDER BY min(i)
) WHERE cardinality("requiredSkills") <> (SELECT count(DISTINCT s) FROM unnest("requiredSkills") AS u(s));
