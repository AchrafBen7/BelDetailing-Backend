// src/controllers/order.controller.js
import {
  getOrders,
  getOrderDetail,
  getOrderByOrderNumber,
  createOrderService,
  cancelOrderService,
  updateOrderTracking,
  updateOrderStatus,
} from "../services/order.service.js";
import { createPaymentIntentForOrder } from "../services/payment.service.js";
import { supabaseAdmin as supabase } from "../config/supabase.js";

export async function listOrders(req, res) {
  try {
    const items = await getOrders(req.user.id);
    return res.json({ data: items });
  } catch (err) {
    console.error("[ORDERS] list error:", err);
    return res.status(500).json({ error: "Could not fetch orders" });
  }
}

export async function getOrder(req, res) {
  try {
    const { id } = req.params;
    const order = await getOrderDetail(id, req.user.id);

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    return res.json({ data: order });
  } catch (err) {
    console.error("[ORDERS] get error:", err);
    return res.status(500).json({ error: "Could not fetch order" });
  }
}

/**
 * GET /api/v1/orders/number/:orderNumber
 * Récupérer une commande par son order_number (public, pour le tracking)
 */
export async function getOrderByNumber(req, res) {
  try {
    const { orderNumber } = req.params;

    if (!orderNumber) {
      return res.status(400).json({ error: "orderNumber is required" });
    }

    const order = await getOrderByOrderNumber(orderNumber);
    return res.json({ data: order });
  } catch (err) {
    console.error("[ORDERS] getByNumber error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || "Could not fetch order" });
  }
}

/**
 * POST /api/v1/orders/payment-intent
 * Crée un PaymentIntent pour une commande (sans créer la commande)
 */
export async function createOrderPaymentIntent(req, res) {
  try {
    const customerId = req.user.id;
    const { items, shipping_address } = req.body;

    // Calculer le montant total sans créer la commande
    let totalAmount = 0;
    for (const item of items) {
      const productId = item?.product?.id || item?.product_id;
      const quantity = item?.quantity || 1;

      const { data: product, error } = await supabase
        .from("products")
        .select("*")
        .eq("id", productId)
        .single();

      if (error || !product) {
        return res.status(404).json({ error: `Product ${productId} not found` });
      }

      const unitPrice = product.promo_price ?? product.price;
      totalAmount += unitPrice * quantity;
    }

    // Récupérer le customer
    const { data: customer, error: customerError } = await supabase
      .from("users")
      .select("id, email, phone, stripe_customer_id")
      .eq("id", customerId)
      .single();

    if (customerError || !customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    // Créer le PaymentIntent (sans orderId car la commande n'existe pas encore)
    const intent = await createPaymentIntentForOrder({
      amount: totalAmount,
      currency: "eur",
      user: customer,
      orderId: null, // Pas encore de commande
    });

    return res.status(200).json({
      data: {
        payment_intent_id: intent.id,
        client_secret: intent.clientSecret,
        amount: totalAmount,
      },
    });
  } catch (err) {
    console.error("[ORDERS] createPaymentIntent error:", err);
    return res.status(500).json({ error: "Could not create payment intent" });
  }
}

/**
 * POST /api/v1/orders
 * Crée une commande après confirmation du paiement
 */
export async function createOrder(req, res) {
  try {
    const customerId = req.user.id;
    const { items, shipping_address, payment_intent_id } = req.body;

    // ✅ VÉRIFIER QUE LE PAIEMENT EST BIEN CONFIRMÉ
    if (!payment_intent_id) {
      return res.status(400).json({ error: "payment_intent_id is required" });
    }

    // Vérifier le statut du PaymentIntent via Stripe
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-11-17.clover",
    });

    const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent_id);

    if (paymentIntent.status !== "succeeded") {
      return res.status(400).json({
        error: `Payment not confirmed. Status: ${paymentIntent.status}`,
      });
    }

    // ✅ Maintenant créer la commande
    const order = await createOrderService({
      customerId,
      items,
      shippingAddress: shipping_address,
    });

    // Mettre à jour la commande avec le payment_intent_id et le statut "paid"
    const { data: updatedOrder, error: updateError } = await supabase
      .from("orders")
      .update({
        payment_intent_id: paymentIntent.id,
        payment_status: "paid",
        status: "confirmed",
      })
      .eq("id", order.id)
      .select("*")
      .single();

    if (updateError) throw updateError;

    return res.status(201).json({
      data: {
        order: updatedOrder,
      },
    });
  } catch (err) {
    console.error("[ORDERS] create error:", err);
    return res.status(500).json({ error: "Could not create order" });
  }
}

export async function cancelOrder(req, res) {
  try {
    const { id } = req.params;
    await cancelOrderService(id, req.user.id);
    return res.json({ success: true });
  } catch (err) {
    console.error("[ORDERS] cancel error:", err);
    return res.status(500).json({ error: err.message || "Could not cancel order" });
  }
}

/**
 * PATCH /api/v1/orders/:id/tracking
 * Mettre à jour le tracking_number et carrier d'une commande (admin/supplier)
 */
export async function updateOrderTrackingController(req, res) {
  try {
    const { id } = req.params;
    const { tracking_number, carrier, supplier_id } = req.body;

    // Validation
    if (!tracking_number || !carrier) {
      return res.status(400).json({ 
        error: "tracking_number and carrier are required" 
      });
    }

    // Vérifier que la commande existe et appartient au customer (ou admin)
    const order = await getOrderDetail(id, req.user.id);
    if (!order && req.user.role !== "admin") {
      return res.status(404).json({ error: "Order not found" });
    }

    // Mettre à jour le tracking
    const updated = await updateOrderTracking(
      id,
      tracking_number,
      carrier,
      supplier_id
    );

    return res.json({ data: updated });
  } catch (err) {
    console.error("[ORDERS] updateTracking error:", err);
    return res.status(500).json({ error: err.message || "Could not update tracking" });
  }
}

/**
 * PATCH /api/v1/orders/:id/status
 * Mettre à jour le statut d'une commande (ex: delivered)
 */
export async function updateOrderStatusController(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: "status is required" });
    }

    // Validation du statut
    const validStatuses = ["pending", "confirmed", "preparing", "shipped", "delivered", "cancelled", "refunded"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    // Vérifier que la commande existe et appartient au customer (ou admin)
    const order = await getOrderDetail(id, req.user.id);
    if (!order && req.user.role !== "admin") {
      return res.status(404).json({ error: "Order not found" });
    }

    // Mettre à jour le statut
    const updated = await updateOrderStatus(id, status);

    return res.json({ data: updated });
  } catch (err) {
    console.error("[ORDERS] updateStatus error:", err);
    return res.status(500).json({ error: err.message || "Could not update status" });
  }
}
