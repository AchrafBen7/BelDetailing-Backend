-- ============================================================
-- MIGRATION: ready_soon status + service steps template
-- ============================================================
-- ready_soon: statut de booking (15 min avant le début)
-- steps_template: étapes prédéfinies au niveau du service (héritées par les bookings)
-- ============================================================

-- 1) Colonne steps_template sur services (JSONB, optionnel)
-- Structure: [ { "id": "s1", "label": "Arrivée", "order": 1, "percentage": 20 }, ... ]
ALTER TABLE services
ADD COLUMN IF NOT EXISTS steps_template JSONB;

COMMENT ON COLUMN services.steps_template IS 'Étapes de progression du service (template). Max 6. Héritées par les bookings au démarrage.';

-- 2) Pas de contrainte sur bookings.status : ready_soon est une simple valeur texte déjà acceptée.
