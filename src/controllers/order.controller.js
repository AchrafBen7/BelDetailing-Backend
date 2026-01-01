// src/controllers/order.controller.js
import {
  getOrders,
  getOrderDetail,
  createOrderService,
  cancelOrderService,
} from "../services/order.service.js";
import { createPaymentIntent } from "../services/payment.service.js";
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

export async function createOrder(req, res) {
  try {
    const customerId = req.user.id;
    const { items, shipping_address } = req.body;

    const order = await createOrderService({
      customerId,
      items,
      shippingAddress: shipping_address,
    });

    const { data: customer, error: customerError } = await supabase
      .from("users")
      .select("id, email, phone, stripe_customer_id")
      .eq("id", customerId)
      .single();

    if (customerError || !customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const intent = await createPaymentIntent({
      amount: order.total_amount,
      currency: "eur",
      user: customer,
    });

    const { data: updatedOrder, error: updateError } = await supabase
      .from("orders")
      .update({ payment_intent_id: intent.id })
      .eq("id", order.id)
      .select("*")
      .single();

    if (updateError) throw updateError;

    return res.status(201).json({
      data: {
        order: updatedOrder,
        client_secret: intent.clientSecret,
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
