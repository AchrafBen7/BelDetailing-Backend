-- Migration: Create or replace offers_with_counts view
-- Date: 2026-01-24
-- Description: Vue qui inclut le nombre de candidatures et toutes les catégories pour chaque offre

-- Supprimer la vue si elle existe déjà
DROP VIEW IF EXISTS offers_with_counts;

-- Créer la vue avec le nombre de candidatures
-- Note: Si la colonne categories n'existe pas, elle sera NULL (géré côté backend)
-- Note: Si company_name/company_logo_url existent déjà dans offers, on les remplace par celles de company_profiles (plus à jour)
CREATE VIEW offers_with_counts AS
SELECT 
    o.id,
    o.title,
    o.category,
    o.categories, -- Support multiple categories (peut être NULL si la colonne n'existe pas)
    o.description,
    o.vehicle_count,
    o.price_min,
    o.price_max,
    o.city,
    o.postal_code,
    o.lat,
    o.lng,
    o.type,
    o.status,
    o.contract_id,
    o.created_at,
    o.created_by,
    -- Nombre total de candidatures pour cette offre
    COALESCE(
        (SELECT COUNT(*) 
         FROM applications a 
         WHERE a.offer_id = o.id 
         AND a.status != 'withdrawn'), -- Exclure les candidatures retirées
        0
    ) AS applications_count,
    -- Nombre de candidatures acceptées
    COALESCE(
        (SELECT COUNT(*) 
         FROM applications a 
         WHERE a.offer_id = o.id 
         AND a.status = 'accepted'),
        0
    ) AS accepted_applications_count,
    -- Flag pour indiquer si une candidature est acceptée
    EXISTS(
        SELECT 1 
        FROM applications a 
        WHERE a.offer_id = o.id 
        AND a.status = 'accepted'
    ) AS has_accepted_application,
    -- Infos de la company (depuis company_profiles via users)
    -- Si company_name/company_logo_url existent dans offers, elles seront écrasées par celles de company_profiles (plus à jour)
    cp.legal_name AS company_name,
    cp.logo_url AS company_logo_url
FROM offers o
LEFT JOIN users u ON u.id = o.created_by
LEFT JOIN company_profiles cp ON cp.user_id = u.id;

-- Commentaire pour documenter la vue
COMMENT ON VIEW offers_with_counts IS 'Vue enrichie des offres avec le nombre de candidatures, le nombre de candidatures acceptées, un flag pour les offres avec candidature acceptée, et les infos de la company';

-- Index pour optimiser les requêtes (si nécessaire)
-- Les index sur la table offers existent déjà
