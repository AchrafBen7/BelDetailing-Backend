// src/routes/stripeWebhook.routes.js
import express from "express";
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { sendNotificationToUser } from "../services/onesignal.service.js";

const router = express.Router();

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("Missing STRIPE_SECRET_KEY for webhooks");
}
if (!process.env.STRIPE_WEBHOOK_SECRET) {
  console.warn("⚠️ STRIPE_WEBHOOK_SECRET is not set – webhooks won't be verified!");
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-11-17.clover",
});

// IMPORTANT : express.raw() uniquement sur ce endpoint
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];

    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      console.error("❌ STRIPE_WEBHOOK_SECRET missing");
      return res.status(500).send("Webhook secret not set");
    }

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("❌ Wrong signature", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log("📡 Webhook received:", event.type);

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;

          const bookingId = session.metadata?.bookingId;
          const paymentIntentId =
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id ?? null;

          if (!bookingId) {
            console.warn("⚠️ checkout.session.completed without bookingId");
            break;
          }

          console.log(
            `✅ Mark booking ${bookingId} as paid (PI=${paymentIntentId})`
          );

          await supabase
            .from("bookings")
            .update({
              payment_status: "paid",
              status: "paid",
              payment_intent_id: paymentIntentId,
            })
            .eq("id", bookingId);

          break;
        }

        case "payment_intent.succeeded": {
          const intent = event.data.object;
          const bookingId = intent.metadata?.bookingId;
          const orderId = intent.metadata?.orderId;
          const missionAgreementId = intent.metadata?.missionAgreementId;
          const paymentId = intent.metadata?.paymentId;
          const paymentType = intent.metadata?.paymentType;
          const type = intent.metadata?.type;
          const userId = intent.metadata?.userId ?? null;
          const amount = intent.amount / 100;
          const currency = intent.currency;

          await supabase.from("payment_transactions").insert({
            user_id: userId,
            stripe_object_id: intent.id,
            amount: amount,
            currency: currency,
            status: intent.status,
            type: "payment",
          });

          // ✅ Gérer les MISSION PAYMENTS
          if (missionAgreementId && paymentId) {
            console.log(`✅ PI succeeded for mission payment ${paymentId} (agreement: ${missionAgreementId})`);

            // Mettre à jour le statut du paiement de mission
            const { error: updateError } = await supabase
              .from("mission_payments")
              .update({
                status: "captured",
                stripe_charge_id: intent.latest_charge || null,
                captured_at: new Date().toISOString(),
              })
              .eq("id", paymentId);

            if (updateError) {
              console.error("[WEBHOOK] Error updating mission payment:", updateError);
            }

            // Si c'est le paiement d'acompte, activer le Mission Agreement
            if (paymentType === "deposit") {
              const { error: agreementError } = await supabase
                .from("mission_agreements")
                .update({
                  status: "active",
                })
                .eq("id", missionAgreementId)
                .eq("status", "draft");

              if (agreementError) {
                console.error("[WEBHOOK] Error activating mission agreement:", agreementError);
              }
            }

            // ✅ ENVOYER NOTIFICATION À LA COMPANY (paiement capturé)
            try {
              const { data: agreement } = await supabase
                .from("mission_agreements")
                .select("company_id, title")
                .eq("id", missionAgreementId)
                .single();

              if (agreement?.company_id) {
                await sendNotificationToUser({
                  userId: agreement.company_id,
                  title: "Paiement capturé",
                  message: `Le paiement de ${amount.toFixed(2)}€ pour "${agreement.title}" a été capturé`,
                  data: {
                    type: "mission_payment_captured",
                    mission_agreement_id: missionAgreementId,
                    payment_id: paymentId,
                    amount: amount,
                  },
                });
              }
            } catch (notifError) {
              console.error("[WEBHOOK] Notification send failed:", notifError);
            }

            // ✅ TRANSFERT AUTOMATIQUE VERS LE DETAILER (après capture)
            try {
              const { autoTransferOnPaymentCapture } = await import("../services/missionPayout.service.js");
              const { MISSION_COMMISSION_RATE } = await import("../config/commission.js");
              
              await autoTransferOnPaymentCapture(paymentId, MISSION_COMMISSION_RATE);
              console.log(`✅ [WEBHOOK] Auto-transfer triggered for payment ${paymentId}`);
            } catch (transferError) {
              console.error(`❌ [WEBHOOK] Auto-transfer failed for payment ${paymentId}:`, transferError);
              // Ne pas faire échouer le webhook, juste logger
            }

            // ✅ GÉNÉRATION AUTOMATIQUE DES FACTURES (company et detailer)
            try {
              const {
                generateCompanyInvoiceOnPaymentCapture,
                generateDetailerInvoiceOnPaymentCapture,
              } = await import("../services/missionInvoiceAuto.service.js");

              // Générer la facture pour la company
              await generateCompanyInvoiceOnPaymentCapture(paymentId);
              console.log(`✅ [WEBHOOK] Company invoice generated for payment ${paymentId}`);

              // Générer la facture de reversement pour le detailer
              await generateDetailerInvoiceOnPaymentCapture(paymentId);
              console.log(`✅ [WEBHOOK] Detailer invoice generated for payment ${paymentId}`);
            } catch (invoiceError) {
              console.error(`❌ [WEBHOOK] Auto-invoice generation failed for payment ${paymentId}:`, invoiceError);
              // Ne pas faire échouer le webhook, juste logger
            }
          }

          // ✅ Gérer les BOOKINGS
          if (bookingId || type === "booking") {
            console.log(`✅ PI succeeded for booking ${bookingId}`);

            await supabase
              .from("bookings")
              .update({
                payment_status: "paid",
                payment_intent_id: intent.id,
              })
              .eq("id", bookingId);

            // ✅ ENVOYER NOTIFICATION AU CUSTOMER (paiement réussi)
            try {
              if (userId) {
                await sendNotificationToUser({
                  userId: userId,
                  title: "Paiement confirmé",
                  message: `Votre paiement de ${amount.toFixed(2)}${currency === "eur" ? "€" : currency.toUpperCase()} a été confirmé`,
                  data: {
                    type: "payment_succeeded",
                    booking_id: bookingId,
                    transaction_id: intent.id,
                    amount: amount,
                  },
                });
              }
            } catch (notifError) {
              console.error("[WEBHOOK] Notification send failed:", notifError);
            }
          }
          
          // ✅ Gérer les ORDERS (e-commerce)
          if (orderId || type === "order") {
            console.log(`✅ PI succeeded for order ${orderId}`);

            await supabase
              .from("orders")
              .update({
                payment_status: "paid",
                status: "confirmed",
                payment_intent_id: intent.id,
              })
              .eq("id", orderId);

            // ✅ ENVOYER NOTIFICATION AU CUSTOMER (paiement réussi)
            try {
              if (userId) {
                // Récupérer le order_number pour la notification
                const { data: order } = await supabase
                  .from("orders")
                  .select("order_number")
                  .eq("id", orderId)
                  .single();

                await sendNotificationToUser({
                  userId: userId,
                  title: "Commande confirmée",
                  message: `Votre commande ${order?.order_number || orderId} a été confirmée. Montant: ${amount.toFixed(2)}${currency === "eur" ? "€" : currency.toUpperCase()}`,
                  data: {
                    type: "order_confirmed",
                    order_id: orderId,
                    order_number: order?.order_number,
                    transaction_id: intent.id,
                    amount: amount,
                  },
                });
              }
            } catch (notifError) {
              console.error("[WEBHOOK] Notification send failed:", notifError);
            }
          }

          if (!bookingId && !orderId && !missionAgreementId) {
            console.log("payment_intent.succeeded (no bookingId, orderId, or missionAgreementId), skipping");
          }

          break;
        }

        case "payment_intent.payment_failed": {
          const intent = event.data.object;
          const bookingId = intent.metadata?.bookingId;
          const orderId = intent.metadata?.orderId;
          const missionAgreementId = intent.metadata?.missionAgreementId;
          const paymentId = intent.metadata?.paymentId;
          const type = intent.metadata?.type;
          const userId = intent.metadata?.userId ?? null;

          // ✅ Gérer les MISSION PAYMENTS
          if (missionAgreementId && paymentId) {
            console.log(`❌ PI failed for mission payment ${paymentId} (agreement: ${missionAgreementId})`);

            // Mettre à jour le statut du paiement de mission
            const { error: updateError } = await supabase
              .from("mission_payments")
              .update({
                status: "failed",
                failure_reason: intent.last_payment_error?.message || "Payment failed",
                failed_at: new Date().toISOString(),
              })
              .eq("id", paymentId);

            if (updateError) {
              console.error("[WEBHOOK] Error updating mission payment:", updateError);
            }

            // ✅ ENVOYER NOTIFICATIONS (paiement échoué) → company + detailer
            try {
              const { sendNotificationWithDeepLink } = await import("../services/onesignal.service.js");
              const { data: agreement } = await supabase
                .from("mission_agreements")
                .select("company_id, detailer_id, title")
                .eq("id", missionAgreementId)
                .single();

              if (agreement) {
                // Notification à la company
                if (agreement.company_id) {
                  await sendNotificationWithDeepLink({
                    userId: agreement.company_id,
                    title: "Paiement échoué",
                    message: `Le paiement pour "${agreement.title || 'votre mission'}" a échoué. Veuillez vérifier votre moyen de paiement.`,
                    type: "mission_payment_failed",
                    id: paymentId,
                  });
                }
                
                // Notification au detailer
                if (agreement.detailer_id) {
                  await sendNotificationWithDeepLink({
                    userId: agreement.detailer_id,
                    title: "Paiement échoué",
                    message: `Le paiement pour "${agreement.title || 'votre mission'}" a échoué.`,
                    type: "mission_payment_failed",
                    id: paymentId,
                  });
                }
              }
            } catch (notifError) {
              console.error("[WEBHOOK] Notification send failed:", notifError);
            }
          }

          // ✅ Gérer les BOOKINGS
          if (bookingId || type === "booking") {
            console.log(`❌ PI failed for booking ${bookingId}`);

            await supabase
              .from("bookings")
              .update({
                payment_status: "failed",
              })
              .eq("id", bookingId);

            // ✅ ENVOYER NOTIFICATION AU CUSTOMER (paiement échoué)
            try {
              if (userId) {
                await sendNotificationToUser({
                  userId: userId,
                  title: "Paiement échoué",
                  message: "Votre paiement a échoué. Veuillez réessayer.",
                  data: {
                    type: "payment_failed",
                    booking_id: bookingId,
                    transaction_id: intent.id,
                  },
                });
              }
            } catch (notifError) {
              console.error("[WEBHOOK] Notification send failed:", notifError);
            }
          }
          
          // ✅ Gérer les ORDERS (e-commerce)
          if (orderId || type === "order") {
            console.log(`❌ PI failed for order ${orderId}`);

            await supabase
              .from("orders")
              .update({
                payment_status: "failed",
                status: "cancelled",
              })
              .eq("id", orderId);

            // ✅ ENVOYER NOTIFICATION AU CUSTOMER (paiement échoué)
            try {
              if (userId) {
                await sendNotificationToUser({
                  userId: userId,
                  title: "Paiement échoué",
                  message: "Votre paiement pour la commande a échoué. Veuillez réessayer.",
                  data: {
                    type: "payment_failed",
                    order_id: orderId,
                    transaction_id: intent.id,
                  },
                });
              }
            } catch (notifError) {
              console.error("[WEBHOOK] Notification send failed:", notifError);
            }
          }

          if (!bookingId && !orderId && !missionAgreementId) {
            console.log("payment_intent.failed (no bookingId, orderId, or missionAgreementId), skipping");
          }

          break;
        }
        
case "setup_intent.succeeded": {
  const setupIntent = event.data.object;

  const customerId = setupIntent.customer;
  const paymentMethodId = setupIntent.payment_method;

  if (!customerId || !paymentMethodId) break;

  // ✅ NE PAS re-attach
  // Stripe l’a déjà fait

  // Juste définir comme carte par défaut
  await stripe.customers.update(customerId, {
    invoice_settings: {
      default_payment_method: paymentMethodId,
    },
  });

  break;
}
        case "refund.succeeded": {
          const refund = event.data.object;
          const paymentIntentId = refund.payment_intent;
          const refundAmount = refund.amount / 100;
          const currency = refund.currency;

          await supabase.from("payment_transactions").insert({
            user_id: refund.metadata?.userId ?? null,
            stripe_object_id: refund.id,
            amount: -refundAmount,
            currency: currency,
            status: refund.status,
            type: "refund",
          });

          if (!paymentIntentId) {
            console.log("refund event without payment_intent, skipping");
            break;
          }

          console.log(
            `💸 Refund detected for payment_intent ${paymentIntentId}`
          );

          // Récupérer le booking pour connaître le customer_id
          const { data: booking } = await supabase
            .from("bookings")
            .select("id, customer_id")
            .eq("payment_intent_id", paymentIntentId)
            .maybeSingle();

          await supabase
            .from("bookings")
            .update({
              payment_status: "refunded",
              status: "cancelled", // ou "refunded" selon ta logique
            })
            .eq("payment_intent_id", paymentIntentId);

          // ✅ ENVOYER NOTIFICATION AU CUSTOMER (remboursement effectué)
          try {
            const userId = booking?.customer_id || refund.metadata?.userId;
            if (userId) {
              await sendNotificationToUser({
                userId: userId, // Customer reçoit la notification
                title: "Remboursement effectué",
                message: `Votre remboursement de ${refundAmount.toFixed(2)}${currency === "eur" ? "€" : currency.toUpperCase()} a été effectué`,
                data: {
                  type: "refund_processed",
                  booking_id: booking?.id ?? null,
                  transaction_id: refund.id,
                  amount: refundAmount,
                },
              });
            }
          } catch (notifError) {
            console.error("[WEBHOOK] Notification send failed:", notifError);
            // ⚠️ Ne pas bloquer le webhook si la notification échoue
          }

          break;
        }

        case "charge.refunded":
        case "charge.refund.updated": {
          // Selon l'event que tu actives
          const chargeOrRefund = event.data.object;
          const paymentIntentId = chargeOrRefund.payment_intent;

          if (!paymentIntentId) {
            console.log("refund event without payment_intent, skipping");
            break;
          }

          console.log(
            `💸 Refund detected for payment_intent ${paymentIntentId}`
          );

          // Récupérer le booking pour connaître le customer_id
          const { data: booking } = await supabase
            .from("bookings")
            .select("id, customer_id, price")
            .eq("payment_intent_id", paymentIntentId)
            .maybeSingle();

          const refundAmount = chargeOrRefund.amount_refunded 
            ? chargeOrRefund.amount_refunded / 100 
            : (booking?.price || 0);

          await supabase
            .from("bookings")
            .update({
              payment_status: "refunded",
              status: "cancelled", // ou "refunded" selon ta logique
            })
            .eq("payment_intent_id", paymentIntentId);

          // ✅ ENVOYER NOTIFICATION AU CUSTOMER (remboursement effectué)
          try {
            if (booking?.customer_id) {
              await sendNotificationToUser({
                userId: booking.customer_id, // Customer reçoit la notification
                title: "Remboursement effectué",
                message: `Votre remboursement de ${refundAmount.toFixed(2)}€ a été effectué`,
                data: {
                  type: "refund_processed",
                  booking_id: booking.id,
                  transaction_id: chargeOrRefund.id,
                  amount: refundAmount,
                },
              });
            }
          } catch (notifError) {
            console.error("[WEBHOOK] Notification send failed:", notifError);
            // ⚠️ Ne pas bloquer le webhook si la notification échoue
          }

          break;
        }

        case "payout.paid": {
          const payout = event.data.object;

          await supabase.from("payment_transactions").insert({
            user_id: payout.metadata?.providerUserId ?? null,
            stripe_object_id: payout.id,
            amount: payout.amount / 100,
            currency: payout.currency,
            status: payout.status,
            type: "payout",
          });

          break;
        }

        case "transfer.created": {
          const transfer = event.data.object;
          const missionAgreementId = transfer.metadata?.missionAgreementId;
          const paymentId = transfer.metadata?.paymentId;

          console.log(`✅ [WEBHOOK] Transfer created: ${transfer.id} to ${transfer.destination}`);

          // Enregistrer le transfer dans payment_transactions
          if (missionAgreementId && paymentId) {
            // Récupérer le detailer_id depuis le Mission Agreement
            const { data: agreement } = await supabase
              .from("mission_agreements")
              .select("detailer_id")
              .eq("id", missionAgreementId)
              .single();

            if (agreement?.detailer_id) {
              await supabase.from("payment_transactions").insert({
                user_id: agreement.detailer_id,
                stripe_object_id: transfer.id,
                amount: transfer.amount / 100,
                currency: transfer.currency,
                status: "pending",
                type: "payout",
              });
            }
          }

          break;
        }

        case "transfer.paid": {
          const transfer = event.data.object;
          const missionAgreementId = transfer.metadata?.missionAgreementId;
          const paymentId = transfer.metadata?.paymentId;

          console.log(`✅ [WEBHOOK] Transfer paid: ${transfer.id} to ${transfer.destination}`);

          // Le transfert a été payé au detailer
          if (paymentId) {
            // Mettre à jour payment_transactions
            await supabase
              .from("payment_transactions")
              .update({
                status: "paid",
              })
              .eq("stripe_object_id", transfer.id);

            // ✅ ENVOYER NOTIFICATION AU DETAILER (paiement reçu)
            try {
              if (missionAgreementId) {
                const { data: agreement } = await supabase
                  .from("mission_agreements")
                  .select("detailer_id, title")
                  .eq("id", missionAgreementId)
                  .single();

                if (agreement?.detailer_id) {
                  await sendNotificationToUser({
                    userId: agreement.detailer_id,
                    title: "Paiement reçu",
                    message: `Vous avez reçu ${(transfer.amount / 100).toFixed(2)}€ pour "${agreement.title}"`,
                    data: {
                      type: "mission_payout_received",
                      mission_agreement_id: missionAgreementId,
                      payment_id: paymentId,
                      amount: transfer.amount / 100,
                    },
                  });
                }
              }
            } catch (notifError) {
              console.error("[WEBHOOK] Notification send failed:", notifError);
            }
          }

          break;
        }

        case "transfer.failed": {
          const transfer = event.data.object;
          const missionAgreementId = transfer.metadata?.missionAgreementId;
          const paymentId = transfer.metadata?.paymentId;

          console.error(`❌ [WEBHOOK] Transfer failed: ${transfer.id} to ${transfer.destination}`);

          // Le transfert a échoué
          if (paymentId) {
            // Mettre à jour payment_transactions
            await supabase
              .from("payment_transactions")
              .update({
                status: "failed",
              })
              .eq("stripe_object_id", transfer.id);

            // ✅ ENVOYER NOTIFICATION AU DETAILER (échec transfert)
            try {
              if (missionAgreementId) {
                const { data: agreement } = await supabase
                  .from("mission_agreements")
                  .select("detailer_id, title")
                  .eq("id", missionAgreementId)
                  .single();

                if (agreement?.detailer_id) {
                  await sendNotificationToUser({
                    userId: agreement.detailer_id,
                    title: "Échec du virement",
                    message: `Le virement pour "${agreement.title}" a échoué. Veuillez vérifier vos informations bancaires.`,
                    data: {
                      type: "mission_payout_failed",
                      mission_agreement_id: missionAgreementId,
                      payment_id: paymentId,
                    },
                  });
                }
              }
            } catch (notifError) {
              console.error("[WEBHOOK] Notification send failed:", notifError);
            }
          }

          break;
        }

        case "account.updated": {
          const account = event.data.object;
          console.log(`📝 [WEBHOOK] Connected Account updated: ${account.id}`);

          // Mettre à jour le statut du compte connecté dans provider_profiles si nécessaire
          // (charges_enabled, payouts_enabled, etc.)
          if (account.metadata?.provider_user_id) {
            // Optionnel : mettre à jour provider_profiles avec le nouveau statut
          }

          break;
        }

        default:
          console.log(`ℹ️ Unhandled event type ${event.type}`);
      }

      res.json({ received: true });
    } catch (err) {
      console.error("💥 Webhook handler error:", err);
      res.status(500).send("Webhook handler error");
    }
  }
);

export default router;
