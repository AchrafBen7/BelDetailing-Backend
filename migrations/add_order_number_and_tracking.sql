-- Migration: Ajouter order_number, carrier et shipped_at à la table orders
-- Date: 2025-01-XX

-- 1. Ajouter order_number (format: NIOS-YYYY-XXXXX)
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
-- Format: NIOS-YYYY-NNNNN (ex: NIOS-2024-00001)
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TRIGGER AS $func$
DECLARE
  year_part VARCHAR(4);
  sequence_num INTEGER;
  order_num VARCHAR(50);
BEGIN
  -- Si order_number existe déjà, ne pas le regénérer
  IF NEW.order_number IS NOT NULL THEN
    RETURN NEW;
  END IF;
  
  -- Extraire l'année de created_at
  year_part := TO_CHAR(NEW.created_at, 'YYYY');
  
  -- Compter les orders de cette année
  SELECT COALESCE(MAX(CAST(SUBSTRING(order_number FROM 11) AS INTEGER)), 0) + 1
  INTO sequence_num
  FROM orders
  WHERE order_number LIKE 'NIOS-' || year_part || '-%'
    AND order_number ~ '^NIOS-[0-9]{4}-[0-9]+$';
  
  -- Générer le order_number (format: NIOS-YYYY-NNNNN, padding à 5 chiffres)
  order_num := 'NIOS-' || year_part || '-' || LPAD(sequence_num::TEXT, 5, '0');
  
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
-- Utiliser une sous-requête pour éviter les window functions dans UPDATE
WITH numbered_orders AS (
  SELECT 
    id,
    'NIOS-' || TO_CHAR(created_at, 'YYYY') || '-' || LPAD(
      ROW_NUMBER() OVER (PARTITION BY TO_CHAR(created_at, 'YYYY') ORDER BY created_at)::TEXT,
      5, '0'
    ) AS new_order_number
  FROM orders
  WHERE order_number IS NULL
)
UPDATE orders
SET order_number = numbered_orders.new_order_number
FROM numbered_orders
WHERE orders.id = numbered_orders.id
  AND orders.order_number IS NULL;
