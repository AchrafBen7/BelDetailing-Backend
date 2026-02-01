-- Customer profile: service à domicile + conditions à domicile (pour le détailer) + photo de profil
ALTER TABLE customer_profiles
  ADD COLUMN IF NOT EXISTS service_at_home boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS home_water boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS home_electricity boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS home_space boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS avatar_url text;

COMMENT ON COLUMN customer_profiles.avatar_url IS 'Photo de profil (URL après upload)';
COMMENT ON COLUMN customer_profiles.service_at_home IS 'Le client souhaite un service à domicile';
COMMENT ON COLUMN customer_profiles.home_water IS 'Accès à l''eau à domicile (si service à domicile)';
COMMENT ON COLUMN customer_profiles.home_electricity IS 'Accès à l''électricité à domicile';
COMMENT ON COLUMN customer_profiles.home_space IS 'Espace suffisant pour travailler à domicile';
