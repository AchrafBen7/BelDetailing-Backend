// src/services/order.service.js
import { randomUUID } from "node:crypto";
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { refundPayment } from "./payment.service.js";

export async function getOrders(userId) {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("customer_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}

export async function getOrderDetail(orderId, userId) {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .eq("customer_id", userId)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Récupérer une commande par son order_number (public, pour le tracking)
 */
export async function getOrderByOrderNumber(orderNumber) {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("order_number", orderNumber)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    const err = new Error("Order not found");
    err.statusCode = 404;
    throw err;
  }
  return data;
}

export async function createOrderService({ customerId, items, shippingAddress }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Items are required");
  }

  if (!shippingAddress) {
    throw new Error("Shipping address is required");
  }

  let totalAmount = 0;
  const orderItems = [];

  for (const item of items) {
    const productId = item?.product?.id || item?.product_id;
    const quantity = item?.quantity || 1;

    if (!productId || quantity <= 0) {
      throw new Error("Invalid item payload");
    }

    const { data: product, error } = await supabase
      .from("products")
      .select("*")
      .eq("id", productId)
      .single();

    if (error || !product) {
      throw new Error(`Product ${productId} not found`);
    }

    const unitPrice = product.promo_price ?? product.price;
    const totalPrice = unitPrice * quantity;

    orderItems.push({
      id: item.id || randomUUID(),
      product_id: product.id,
      product_name: product.name,
      product_image_url: product.image_url,
      quantity,
      unit_price: unitPrice,
      total_price: totalPrice,
    });

    totalAmount += totalPrice;
  }

  const { data, error } = await supabase
    .from("orders")
    .insert({
      customer_id: customerId,
      items: orderItems,
      total_amount: totalAmount,
      shipping_address: shippingAddress,
      status: "pending",
      payment_status: "pending",
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function cancelOrderService(orderId, userId) {
  const order = await getOrderDetail(orderId, userId);

  if (!order) {
    throw new Error("Order not found");
  }

  if (order.status !== "pending") {
    throw new Error("Only pending orders can be cancelled");
  }

  if (order.payment_intent_id && order.payment_status === "paid") {
    const refunded = await refundPayment(order.payment_intent_id);
    if (!refunded) {
      throw new Error("Stripe refund failed");
    }
  }

  const { error } = await supabase
    .from("orders")
    .update({
      status: "cancelled",
      payment_status: order.payment_intent_id ? "refunded" : "pending",
    })
    .eq("id", orderId);

  if (error) throw error;
  return true;
}

/**
 * Mettre à jour le tracking_number et carrier d'une commande
 * Appelé quand une commande est expédiée
 */
export async function updateOrderTracking(orderId, trackingNumber, carrier, supplierId) {
  const { data, error } = await supabase
    .from("orders")
    .update({
      tracking_number: trackingNumber,
      carrier: carrier,
      supplier_id: supplierId || null,
      status: "shipped",
      shipped_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

/**
 * Mettre à jour le statut d'une commande (ex: delivered)
 */
export async function updateOrderStatus(orderId, status) {
  const { data, error } = await supabase
    .from("orders")
    .update({
      status: status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}
