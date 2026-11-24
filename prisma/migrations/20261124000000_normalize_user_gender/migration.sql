ALTER TABLE "users" ALTER COLUMN "gender" TYPE TEXT USING "gender"::text;

UPDATE "users"
SET "gender" = CASE
  WHEN NULLIF(BTRIM("gender"), '') IS NULL THEN NULL
  WHEN UPPER(REGEXP_REPLACE(BTRIM("gender"), '[[:space:]-]+', '_', 'g')) IN (
    'MALE', 'FEMALE', 'OTHER', 'NON_BINARY', 'PREFER_NOT_TO_SAY'
  ) THEN UPPER(REGEXP_REPLACE(BTRIM("gender"), '[[:space:]-]+', '_', 'g'))
  WHEN UPPER(BTRIM("gender")) IN ('MAN', 'BOY', 'M') THEN 'MALE'
  WHEN UPPER(BTRIM("gender")) IN ('WOMAN', 'GIRL', 'W', 'F') THEN 'FEMALE'
  WHEN UPPER(REGEXP_REPLACE(BTRIM("gender"), '[[:space:]-]+', '_', 'g')) = 'NONBINARY' THEN 'NON_BINARY'
  ELSE NULL
END
WHERE "gender" IS NOT NULL;

DO $$
BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_gender_valid" CHECK (
    "gender" IS NULL OR "gender" IN ('MALE', 'FEMALE', 'OTHER', 'NON_BINARY', 'PREFER_NOT_TO_SAY')
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
