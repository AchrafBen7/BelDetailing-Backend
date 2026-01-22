-- ============================================================
-- MIGRATION: Orders Table (Customer Shop - Dropshipping)
-- ============================================================
-- Date: 2025-01-15
-- Description: Création de la table orders pour le système de boutique intégrée
-- ============================================================
-- IMPORTANT: Les orders utilisent une logique différente des bookings:
-- - Paiement direct (pas de gel)
-- - Pas de transfert vers provider
-- - Logique dropshipping (NIOS reçoit l'argent directement)
-- ============================================================

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_number VARCHAR(50) NOT NULL UNIQUE,
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'confirmed', 'shipped', 'delivered', 'cancelled'
  total_amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'eur',
  payment_intent_id VARCHAR(255),
  payment_status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'paid', 'failed', 'refunded'
  shipping_address JSONB, -- { street, city, postal_code, country, name, phone }
  items JSONB NOT NULL, -- [{ product_id, name, price, quantity, image_url }]
  supplier_id UUID REFERENCES users(id) ON DELETE SET NULL, -- Fournisseur du produit (si applicable)
  tracking_number VARCHAR(255), -- Numéro de suivi d'expédition
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);

-- RLS Policies
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own orders"
  ON orders FOR SELECT
  USING (auth.uid() = customer_id);

CREATE POLICY "Users can create their own orders"
  ON orders FOR INSERT
  WITH CHECK (auth.uid() = customer_id);

-- Admins peuvent tout voir
CREATE POLICY "Admins can view all orders"
  ON orders FOR SELECT
  USING (auth.role() = 'admin');

-- ============================================================
-- COMMENTAIRES
-- ============================================================
-- orders.status:
-- - pending: Commande créée, en attente de paiement
-- - confirmed: Paiement confirmé, commande validée
-- - shipped: Produit expédié par le fournisseur
-- - delivered: Produit livré au client
-- - cancelled: Commande annulée

-- orders.payment_status:
-- - pending: En attente de paiement
-- - paid: Paiement effectué (direct, pas de gel)
-- - failed: Échec du paiement
-- - refunded: Remboursement effectué

-- Logique différente des bookings:
-- - Pas de commission_rate (NIOS garde tout le montant)
-- - Pas de transfert vers provider (dropshipping)
-- - Paiement direct via Stripe (pas de capture différée)
