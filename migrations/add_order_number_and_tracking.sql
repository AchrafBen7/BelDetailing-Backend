-- Migration: Ajouter order_number, carrier et shipped_at à la table orders
-- Date: 2025-01-XX

-- 1. Ajouter order_number (format: NIOS-YYYY-XXXXX avec code aléatoire alphanumérique)
-- Exemples: NIOS-2024-A3F9K, NIOS-2025-B2C8D, NIOS-2026-7E5F1
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS order_number VARCHAR(50) UNIQUE;

-- 2. Ajouter carrier (transporteur: bpost, dhl, dpd, etc.)
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS carrier VARCHAR(50);

-- 3. Ajouter shipped_at (date d'expédition)
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;

-- 4. Index pour les recherches par order_number
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);

-- 5. Index pour les recherches par tracking_number
CREATE INDEX IF NOT EXISTS idx_orders_tracking_number ON orders(tracking_number) 
WHERE tracking_number IS NOT NULL;

-- 6. Fonction SQL pour générer le order_number automatiquement
-- Format: NIOS-YYYY-XXXXX (ex: NIOS-2024-A3F9K) avec code aléatoire alphanumérique
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TRIGGER AS $func$
DECLARE
  year_part VARCHAR(4);
  random_code VARCHAR(6);
  order_num VARCHAR(50);
  max_attempts INTEGER := 10;
  attempt INTEGER := 0;
  exists_check INTEGER;
BEGIN
  -- Si order_number existe déjà, ne pas le regénérer
  IF NEW.order_number IS NOT NULL THEN
    RETURN NEW;
  END IF;
  
  -- Extraire l'année de created_at
  year_part := TO_CHAR(NEW.created_at, 'YYYY');
  
  -- Générer un code aléatoire alphanumérique (5-6 caractères)
  -- Utiliser les caractères: 0-9, A-Z (sans I, O pour éviter confusion)
  LOOP
    attempt := attempt + 1;
    
    -- Générer un code aléatoire de 5 caractères
    random_code := UPPER(
      SUBSTRING(
        MD5(RANDOM()::TEXT || EXTRACT(EPOCH FROM NOW())::TEXT || NEW.id::TEXT),
        1, 5
      )
    );
    
    -- Remplacer les caractères ambigus (I, O) par des chiffres
    random_code := REPLACE(REPLACE(random_code, 'I', '1'), 'O', '0');
    
    -- Vérifier l'unicité (si le code existe déjà, on réessaie)
    SELECT COUNT(*)
    INTO exists_check
    FROM orders
    WHERE order_number = 'NIOS-' || year_part || '-' || random_code;
    
    -- Si unique ou max tentatives atteint, on sort
    EXIT WHEN exists_check = 0 OR attempt >= max_attempts;
  END LOOP;
  
  -- Si après max_attempts on n'a pas trouvé un code unique, ajouter un suffixe numérique
  IF exists_check > 0 THEN
    random_code := random_code || LPAD((RANDOM() * 1000)::INTEGER::TEXT, 3, '0');
  END IF;
  
  -- Générer le order_number (format: NIOS-YYYY-XXXXX)
  order_num := 'NIOS-' || year_part || '-' || random_code;
  
  NEW.order_number := order_num;
  
  RETURN NEW;
END;
$func$ LANGUAGE plpgsql;

-- 7. Trigger pour générer automatiquement order_number à l'insertion
DROP TRIGGER IF EXISTS trigger_generate_order_number ON orders;
CREATE TRIGGER trigger_generate_order_number
  BEFORE INSERT ON orders
  FOR EACH ROW
  EXECUTE FUNCTION generate_order_number();

-- 8. Mettre à jour les orders existants sans order_number
-- Utiliser une fonction pour générer des codes aléatoires uniques
CREATE OR REPLACE FUNCTION generate_random_order_code(year_part TEXT, order_id UUID) RETURNS TEXT AS $$
DECLARE
  random_code VARCHAR(6);
  max_attempts INTEGER := 10;
  attempt INTEGER := 0;
  exists_check INTEGER;
BEGIN
  LOOP
    attempt := attempt + 1;
    
    -- Générer un code aléatoire
    random_code := UPPER(
      SUBSTRING(
        MD5(RANDOM()::TEXT || EXTRACT(EPOCH FROM NOW())::TEXT || order_id::TEXT),
        1, 5
      )
    );
    
    -- Remplacer les caractères ambigus
    random_code := REPLACE(REPLACE(random_code, 'I', '1'), 'O', '0');
    
    -- Vérifier l'unicité
    SELECT COUNT(*)
    INTO exists_check
    FROM orders
    WHERE order_number = 'NIOS-' || year_part || '-' || random_code;
    
    EXIT WHEN exists_check = 0 OR attempt >= max_attempts;
  END LOOP;
  
  -- Si toujours pas unique, ajouter un suffixe
  IF exists_check > 0 THEN
    random_code := random_code || LPAD((RANDOM() * 1000)::INTEGER::TEXT, 3, '0');
  END IF;
  
  RETURN random_code;
END;
$$ LANGUAGE plpgsql;

-- Mettre à jour les orders existants
WITH numbered_orders AS (
  SELECT 
    id,
    TO_CHAR(created_at, 'YYYY') AS year_part,
    'NIOS-' || TO_CHAR(created_at, 'YYYY') || '-' || generate_random_order_code(
      TO_CHAR(created_at, 'YYYY'),
      id
    ) AS new_order_number
  FROM orders
  WHERE order_number IS NULL
)
UPDATE orders
SET order_number = numbered_orders.new_order_number
FROM numbered_orders
WHERE orders.id = numbered_orders.id
  AND orders.order_number IS NULL;

-- Nettoyer la fonction temporaire si nécessaire (optionnel)
-- DROP FUNCTION IF EXISTS generate_random_order_code(TEXT, UUID);
