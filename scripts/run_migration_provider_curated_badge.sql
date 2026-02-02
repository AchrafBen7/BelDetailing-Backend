-- ============================================================
-- SCRIPT: Add curated_badge to provider_profiles (Johari 8.1)
-- ============================================================
-- Badge curé manuel : "recommended" = Recommandé par NIOS, "top_this_month" = Top ce mois
-- ============================================================

ALTER TABLE provider_profiles
ADD COLUMN IF NOT EXISTS curated_badge text;

COMMENT ON COLUMN provider_profiles.curated_badge IS 'Curated badge: recommended | top_this_month. Set via DB or admin.';

-- Optional: constraint to limit values (uncomment if desired)
-- ALTER TABLE provider_profiles ADD CONSTRAINT chk_curated_badge
-- CHECK (curated_badge IS NULL OR curated_badge IN ('recommended', 'top_this_month'));
