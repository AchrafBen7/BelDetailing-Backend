// src/routes/stripeWebhook.routes.js
import express from "express";
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "../config/supabase.js";
import { sendNotificationToUser } from "../services/onesignal.service.js";
import { tryValidateReferralCustomerFirstPaidBooking } from "../services/referral.service.js";

const router = express.Router();

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("Missing STRIPE_SECRET_KEY for webhooks");
}
if (!process.env.STRIPE_WEBHOOK_SECRET) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("STRIPE_WEBHOOK_SECRET is required in production — webhooks cannot be verified without it!");
  }
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

        case "payment_intent.processing": {
          // ✅ SEPA ASYNCHRONE : Le prélèvement est envoyé à la banque
          const intent = event.data.object;
          const missionAgreementId = intent.metadata?.missionAgreementId;
          const paymentId = intent.metadata?.paymentId;
          const paymentType = intent.metadata?.paymentType;
          const type = intent.metadata?.type;

          // ✅ Gérer les MISSION PAYMENTS SEPA
          if (missionAgreementId && paymentId && type === "mission_immediate_capture") {
            console.log(`⏳ [WEBHOOK] PaymentIntent processing for mission payment ${paymentId} (agreement: ${missionAgreementId})`);
            console.log(`ℹ️ [WEBHOOK] SEPA payment order sent to bank, waiting for confirmation (2-5 days)`);

            // Mettre à jour le statut du paiement de mission à "processing"
            const { error: updateError } = await supabase
              .from("mission_payments")
              .update({
                status: "processing", // ✅ Statut SEPA : prélèvement envoyé à la banque
                stripe_charge_id: intent.latest_charge || null,
              })
              .eq("id", paymentId);

            if (updateError) {
              console.error("[WEBHOOK] Error updating mission payment to processing:", updateError);
            } else {
              console.log(`✅ [WEBHOOK] Mission payment ${paymentId} updated to "processing" status`);
            }

            // ✅ ENVOYER NOTIFICATION À LA COMPANY (prélèvement envoyé)
            try {
              const { data: agreement } = await supabase
                .from("mission_agreements")
                .select("company_id, title")
                .eq("id", missionAgreementId)
                .single();

              if (agreement?.company_id) {
                await sendNotificationToUser({
                  userId: agreement.company_id,
                  title: "Prélèvement SEPA envoyé",
                  message: `Le prélèvement de ${(intent.amount / 100).toFixed(2)}€ pour "${agreement.title}" a été envoyé à votre banque. Confirmation sous 2-5 jours.`,
                  data: {
                    type: "mission_payment_processing",
                    mission_agreement_id: missionAgreementId,
                    payment_id: paymentId,
                    amount: intent.amount / 100,
                  },
                });
              }
            } catch (notifError) {
              console.error("[WEBHOOK] Notification send failed:", notifError);
            }
          }

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

          // ✅ Gérer les PAIEMENTS DE VALIDATION SEPA (1€ test)
          if (type === "sepa_mandate_validation" && intent.metadata?.isTestPayment === "true") {
            console.log(`🔄 [WEBHOOK] PaymentIntent succeeded for SEPA validation: ${intent.id}`);
            console.log(`📋 [WEBHOOK] Amount: ${amount}€, User: ${userId}`);
            
            try {
              const { refundSepaValidationPayment } = await import("../services/sepaMandateValidation.service.js");
              const refundResult = await refundSepaValidationPayment(intent.id);
              
              if (refundResult.alreadyRefunded) {
                console.log(`ℹ️ [WEBHOOK] Validation payment already refunded: ${refundResult.refundId}`);
              } else if (refundResult.notValidationPayment) {
                console.log(`ℹ️ [WEBHOOK] Payment is not a validation payment`);
              } else {
                console.log(`✅ [WEBHOOK] Validation payment refunded successfully: ${refundResult.refundId}`);
                console.log(`📋 [WEBHOOK] Refund amount: ${refundResult.amount}€`);
              }
            } catch (refundError) {
              console.error(`❌ [WEBHOOK] Error refunding validation payment:`, refundError);
              // Ne pas bloquer le webhook, juste logger l'erreur
              // Le remboursement pourra être fait manuellement si nécessaire
            }
            
            // Ne pas continuer avec les autres handlers pour les paiements de validation
            break;
          }

          // ✅ Gérer les MISSION PAYMENTS
          if (missionAgreementId && paymentId) {
            console.log(`✅ [WEBHOOK] PI succeeded for mission payment ${paymentId} (agreement: ${missionAgreementId})`);
            console.log(`✅ [WEBHOOK] SEPA payment confirmed - money received (2-5 days after processing)`);

            // ✅ Gérer les paiements combinés (acompte + commission)
            if (paymentType === "combined") {
              const commissionPaymentId = intent.metadata?.commissionPaymentId;
              const depositPaymentId = intent.metadata?.depositPaymentId;
              const depositAmount = parseFloat(intent.metadata?.depositAmount || "0");
              
              // Mettre à jour les deux paiements
              if (commissionPaymentId) {
                await supabase
                  .from("mission_payments")
                  .update({
                    status: "succeeded",
                    stripe_charge_id: intent.latest_charge || null,
                    captured_at: new Date().toISOString(),
                  })
                  .eq("id", commissionPaymentId);
              }
              
              if (depositPaymentId) {
                await supabase
                  .from("mission_payments")
                  .update({
                    status: "succeeded",
                    stripe_charge_id: intent.latest_charge || null,
                    captured_at: new Date().toISOString(),
                  })
                  .eq("id", depositPaymentId);
              }

              // ✅ CRITICAL: Mettre à jour le payment_status de la mission
              await supabase
                .from("mission_agreements")
                .update({
                  payment_status: "succeeded", // ✅ Paiement réussi
                  status: "active", // ✅ Mission active
                  updated_at: new Date().toISOString(),
                })
                .eq("id", missionAgreementId);
              
              // ✅ NOUVEAU : Créer automatiquement les PaymentIntents pour les paiements programmés
              // Maintenant que le mandate a été utilisé en on-session, les paiements off_session sont autorisés
              console.log(`🔄 [WEBHOOK] First on-session payment succeeded - creating PaymentIntents for scheduled payments`);
              
              const { data: scheduledPayments, error: scheduledError } = await supabase
                .from("mission_payments")
                .select("*")
                .eq("mission_agreement_id", missionAgreementId)
                .eq("status", "pending")
                .not("type", "in", '("commission","deposit")');
              
              if (scheduledError) {
                console.error(`❌ [WEBHOOK] Failed to fetch scheduled payments:`, scheduledError);
              } else if (scheduledPayments && scheduledPayments.length > 0) {
                console.log(`🔄 [WEBHOOK] Found ${scheduledPayments.length} scheduled payments to authorize`);
                
                const { createPaymentIntentForMission } = await import("../services/missionPaymentStripe.service.js");
                
                for (const payment of scheduledPayments) {
                  try {
                    await createPaymentIntentForMission({
                      missionAgreementId,
                      paymentId: payment.id,
                      amount: payment.amount,
                      type: payment.type,
                    });
                    console.log(`✅ [WEBHOOK] PaymentIntent created for ${payment.type} payment ${payment.id}`);
                  } catch (err) {
                    console.error(`❌ [WEBHOOK] Failed to create PaymentIntent for ${payment.id}:`, err.message);
                    // Ne pas bloquer si un paiement échoue - le cron job réessaiera
                  }
                }
              } else {
                console.log(`ℹ️ [WEBHOOK] No scheduled payments to authorize`);
              }
              
              // ✅ Vérifier si on est à J+1 pour créer le transfer de l'acompte
              const { data: agreement } = await supabase
                .from("mission_agreements")
                .select("start_date, stripe_connected_account_id")
                .eq("id", missionAgreementId)
                .single();
              
              if (agreement?.start_date) {
                const startDate = new Date(agreement.start_date);
                const jPlusOne = new Date(startDate.getTime() + 24 * 60 * 60 * 1000); // J+1
                const now = new Date();
                
                if (now >= jPlusOne && depositPaymentId) {
                  // ✅ On est à J+1, créer le transfer
                  console.log(`🔄 [WEBHOOK] J+1 reached, creating Transfer for deposit payment ${depositPaymentId}`);
                  
                  try {
                    const { createTransferToDetailer } = await import("../services/missionPayout.service.js");
                    const transferResult = await createTransferToDetailer({
                      missionAgreementId: missionAgreementId,
                      paymentId: depositPaymentId,
                      amount: depositAmount,
                      commissionRate: 0, // Pas de commission (déjà capturée)
                    });
                    
                    console.log(`✅ [WEBHOOK] Deposit transferred to detailer: ${transferResult.id}, amount: ${transferResult.amount}€`);
                    
                    const transferExecutedAt = new Date().toISOString();
                    
                    await supabase
                      .from("mission_payments")
                      .update({
                        status: "transferred",
                        transferred_at: transferExecutedAt,
                        stripe_transfer_id: transferResult.id,
                      })
                      .eq("id", depositPaymentId);

                    // ✅ CRITICAL: Mettre à jour les colonnes d'audit de la mission
                    await supabase
                      .from("mission_agreements")
                      .update({
                        transfer_executed_at: transferExecutedAt,
                        transfer_id: transferResult.id,
                        updated_at: transferExecutedAt,
                      })
                      .eq("id", missionAgreementId);
                  } catch (transferError) {
                    console.error(`❌ [WEBHOOK] Transfer failed for deposit payment ${depositPaymentId}:`, transferError);
                    // Le transfer sera retenté via cron job
                  }
                } else {
                  console.log(`ℹ️ [WEBHOOK] Not yet J+1 (start: ${startDate.toISOString()}, J+1: ${jPlusOne.toISOString()}, now: ${now.toISOString()}). Transfer will be created via cron job.`);
                }
              }
            } else {
              // ✅ Mettre à jour le statut du paiement de mission à "succeeded" (argent reçu)
              const { error: updateError } = await supabase
                .from("mission_payments")
                .update({
                  status: "succeeded", // ✅ Statut SEPA : argent réellement reçu
                  stripe_charge_id: intent.latest_charge || null,
                  captured_at: new Date().toISOString(), // ✅ Timestamp de réception
                })
                .eq("id", paymentId);

              if (updateError) {
                console.error("[WEBHOOK] Error updating mission payment:", updateError);
              }
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
            // ⚠️ IMPORTANT : Pour les paiements d'acompte (deposit), la commission est déjà capturée séparément
            // Donc on ne doit PAS déduire de commission sur l'acompte (commissionRate: 0)
            try {
              const { createTransferToDetailer } = await import("../services/missionPayout.service.js");
              
              // Récupérer le paiement pour vérifier son type
              const { data: payment } = await supabase
                .from("mission_payments")
                .select("id, type, amount, status, stripe_payment_intent_id")
                .eq("id", paymentId)
                .single();
              
              if (payment && (payment.status === "succeeded" || payment.status === "processing") && paymentType === "deposit") {
                // ✅ Pour l'acompte : Transfer complet sans commission (commission déjà capturée séparément)
                console.log(`🔄 [WEBHOOK] Creating Transfer for deposit payment ${paymentId} (no commission, already captured separately)`);
                
                const transferResult = await createTransferToDetailer({
                  missionAgreementId: missionAgreementId,
                  paymentId: paymentId,
                  amount: payment.amount,
                  commissionRate: 0, // ✅ Pas de commission sur l'acompte (déjà capturée séparément)
                });
                
                console.log(`✅ [WEBHOOK] Deposit transferred to detailer: ${transferResult.id}, amount: ${transferResult.amount}€`);
                
                const transferExecutedAt = new Date().toISOString();
                
                // Mettre à jour le statut du paiement à "transferred"
                await supabase
                  .from("mission_payments")
                  .update({
                    status: "transferred",
                    transferred_at: transferExecutedAt,
                    stripe_transfer_id: transferResult.id,
                  })
                  .eq("id", paymentId);

                // ✅ CRITICAL: Mettre à jour les colonnes d'audit de la mission
                await supabase
                  .from("mission_agreements")
                  .update({
                    transfer_executed_at: transferExecutedAt,
                    transfer_id: transferResult.id,
                    updated_at: transferExecutedAt,
                  })
                  .eq("id", missionAgreementId);
              } else if (payment && (payment.status === "succeeded" || payment.status === "processing") && paymentType !== "deposit" && paymentType !== "commission") {
                // ✅ Pour les autres paiements (installment, final, monthly) : Transfer avec commission
                const { MISSION_COMMISSION_RATE } = await import("../config/commission.js");
                const { autoTransferOnPaymentCapture } = await import("../services/missionPayout.service.js");
                
                await autoTransferOnPaymentCapture(paymentId, MISSION_COMMISSION_RATE);
                console.log(`✅ [WEBHOOK] Auto-transfer triggered for payment ${paymentId} (with commission)`);
              } else {
                console.log(`ℹ️ [WEBHOOK] Skipping transfer for payment ${paymentId} (type: ${paymentType}, status: ${payment?.status})`);
              }
            } catch (transferError) {
              console.error(`❌ [WEBHOOK] Auto-transfer failed for payment ${paymentId}:`, transferError);
              // Ne pas faire échouer le webhook, juste logger
              // Le Transfer sera retenté via cron job si nécessaire
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

            // ✅ Mettre à jour le revenu annuel pour les provider_passionate
            try {
              const { data: booking } = await supabase
                .from("bookings")
                .select("provider_id, price")
                .eq("id", bookingId)
                .single();
              
              if (booking) {
                const { data: providerUser } = await supabase
                  .from("users")
                  .select("role")
                  .eq("id", booking.provider_id)
                  .single();
                
                if (providerUser?.role === "provider_passionate") {
                  const { data: providerProfile } = await supabase
                    .from("provider_profiles")
                    .select("annual_revenue_current, annual_revenue_year")
                    .eq("user_id", booking.provider_id)
                    .single();
                  
                  if (providerProfile) {
                    const currentYear = new Date().getFullYear();
                    const isNewYear = providerProfile.annual_revenue_year !== currentYear;
                    
                    await supabase
                      .from("provider_profiles")
                      .update({
                        annual_revenue_current: isNewYear 
                          ? booking.price 
                          : (providerProfile.annual_revenue_current || 0) + booking.price,
                        annual_revenue_year: currentYear,
                      })
                      .eq("user_id", booking.provider_id);
                    
                    console.log(`✅ [WEBHOOK] Annual revenue updated for provider_passionate ${booking.provider_id}: ${isNewYear ? booking.price : (providerProfile.annual_revenue_current || 0) + booking.price}€`);
                  }
                }
              }
            } catch (revenueError) {
              console.error("[WEBHOOK] Error updating annual revenue:", revenueError);
              // Ne pas faire échouer le webhook, juste logger
            }

            // ✅ Parrainage: si c'est la 1ère résa payée du customer, valider le referral
            try {
              if (userId) await tryValidateReferralCustomerFirstPaidBooking(userId);
            } catch (refErr) {
              console.warn("[WEBHOOK] Referral validation failed (non-blocking):", refErr.message);
            }

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

        case "payment_intent.requires_payment_method": {
          const intent = event.data.object;
          const missionAgreementId = intent.metadata?.missionAgreementId;
          const paymentId = intent.metadata?.paymentId;

          // ✅ Gérer les MISSION PAYMENTS
          if (missionAgreementId && paymentId) {
            console.log(`⚠️ PI requires_payment_method for mission payment ${paymentId} (agreement: ${missionAgreementId})`);

            // Mettre à jour le statut du paiement de mission
            await supabase
              .from("mission_payments")
              .update({
                status: "failed",
                failure_reason: "Payment method required. Please update your payment method.",
                failed_at: new Date().toISOString(),
              })
              .eq("id", paymentId);

            // ✅ CRITICAL: Mettre à jour le payment_status de la mission
            await supabase
              .from("mission_agreements")
              .update({
                payment_status: "requires_payment_method",
                status: "agreement_fully_confirmed", // ✅ Retour au statut précédent
                updated_at: new Date().toISOString(),
              })
              .eq("id", missionAgreementId);

            // ✅ ENVOYER NOTIFICATION À LA COMPANY
            try {
              const { sendNotificationWithDeepLink } = await import("../services/onesignal.service.js");
              const { data: agreement } = await supabase
                .from("mission_agreements")
                .select("company_id, title")
                .eq("id", missionAgreementId)
                .single();

              if (agreement?.company_id) {
                await sendNotificationWithDeepLink({
                  userId: agreement.company_id,
                  title: "Mise à jour du moyen de paiement requise",
                  message: `Votre moyen de paiement pour "${agreement.title || 'votre mission'}" doit être mis à jour.`,
                  type: "mission_payment_requires_method",
                  id: missionAgreementId,
                });
              }
            } catch (notifError) {
              console.error("[WEBHOOK] Notification send failed:", notifError);
            }
          }

          break;
        }

        case "payment_intent.canceled": {
          const intent = event.data.object;
          const missionAgreementId = intent.metadata?.missionAgreementId;
          const paymentId = intent.metadata?.paymentId;

          // ✅ Gérer les MISSION PAYMENTS
          if (missionAgreementId && paymentId) {
            console.log(`⚠️ PI canceled for mission payment ${paymentId} (agreement: ${missionAgreementId})`);

            // Mettre à jour le statut du paiement de mission
            await supabase
              .from("mission_payments")
              .update({
                status: "failed",
                failure_reason: "Payment canceled",
                failed_at: new Date().toISOString(),
              })
              .eq("id", paymentId);

            // ✅ CRITICAL: Mettre à jour le payment_status de la mission
            await supabase
              .from("mission_agreements")
              .update({
                payment_status: "canceled",
                status: "agreement_fully_confirmed", // ✅ Retour au statut précédent
                updated_at: new Date().toISOString(),
              })
              .eq("id", missionAgreementId);

            // ✅ ENVOYER NOTIFICATION À LA COMPANY
            try {
              const { sendNotificationWithDeepLink } = await import("../services/onesignal.service.js");
              const { data: agreement } = await supabase
                .from("mission_agreements")
                .select("company_id, title")
                .eq("id", missionAgreementId)
                .single();

              if (agreement?.company_id) {
                await sendNotificationWithDeepLink({
                  userId: agreement.company_id,
                  title: "Paiement annulé",
                  message: `Le paiement pour "${agreement.title || 'votre mission'}" a été annulé.`,
                  type: "mission_payment_canceled",
                  id: missionAgreementId,
                });
              }
            } catch (notifError) {
              console.error("[WEBHOOK] Notification send failed:", notifError);
            }
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

            // ✅ CRITICAL: Mettre à jour le payment_status de la mission
            // Si le paiement échoue, la mission ne peut PAS démarrer
            await supabase
              .from("mission_agreements")
              .update({
                payment_status: "payment_failed", // ✅ Statut d'échec
                status: "agreement_fully_confirmed", // ✅ Retour au statut précédent (pas active sans paiement)
                updated_at: new Date().toISOString(),
              })
              .eq("id", missionAgreementId);

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

  console.log("🔄 [WEBHOOK] setup_intent.succeeded - START");
  console.log("📦 [WEBHOOK] Setup Intent ID:", setupIntent.id);
  console.log("📦 [WEBHOOK] Setup Intent status:", setupIntent.status);
  console.log("📦 [WEBHOOK] Setup Intent customer:", setupIntent.customer);
  console.log("📦 [WEBHOOK] Setup Intent payment_method:", setupIntent.payment_method);
  console.log("📦 [WEBHOOK] Setup Intent mandate:", setupIntent.mandate); // ✅ IMPORTANT : Le mandate peut être ici !

  const customerId = setupIntent.customer;
  const paymentMethodId = setupIntent.payment_method;

  if (!customerId || !paymentMethodId) {
    console.warn("⚠️ [WEBHOOK] Missing customerId or paymentMethodId");
    console.warn("⚠️ [WEBHOOK] customerId:", customerId, "paymentMethodId:", paymentMethodId);
    break;
  }

  console.log("✅ [WEBHOOK] Setup Intent succeeded:", setupIntent.id);
  console.log("📦 [WEBHOOK] Customer:", customerId, "Payment Method:", paymentMethodId);

  // Récupérer le payment method pour déterminer le type
  try {
    console.log("🔄 [WEBHOOK] Retrieving payment method:", paymentMethodId);
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
    console.log("✅ [WEBHOOK] Payment method retrieved");
    console.log("📦 [WEBHOOK] Payment method type:", paymentMethod.type);
    console.log("📦 [WEBHOOK] Payment method ID:", paymentMethod.id);
    console.log("📦 [WEBHOOK] Payment method customer:", paymentMethod.customer);

    if (paymentMethod.type === "sepa_debit") {
      console.log("✅ [WEBHOOK] Payment method is SEPA Debit");
      console.log("📦 [WEBHOOK] SEPA Debit details:", JSON.stringify(paymentMethod.sepa_debit, null, 2));
      
      // ✅ GESTION SEPA MANDATE
      // ⚠️ IMPORTANT : Le mandate peut être dans le Setup Intent OU dans le Payment Method
      // Pour les Setup Intents SEPA, Stripe met souvent le mandate directement dans le Setup Intent
      let mandateId = setupIntent.mandate || paymentMethod.sepa_debit?.mandate;
      console.log("📦 [WEBHOOK] Mandate ID from Setup Intent:", setupIntent.mandate);
      console.log("📦 [WEBHOOK] Mandate ID from Payment Method:", paymentMethod.sepa_debit?.mandate);
      console.log("📦 [WEBHOOK] Final mandate ID:", mandateId);
      
      // Si pas de mandate immédiatement, attendre et réessayer (max 3 tentatives)
      if (!mandateId) {
        console.log("⚠️ [WEBHOOK] SEPA has no mandate yet, waiting...");
        
        for (let attempt = 0; attempt < 3; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // Attendre 2 secondes
          
          // Recharger le Setup Intent ET le payment method
          const refreshedSetupIntent = await stripe.setupIntents.retrieve(setupIntent.id);
          const refreshedPaymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
          
          mandateId = refreshedSetupIntent.mandate || refreshedPaymentMethod.sepa_debit?.mandate;
          
          if (mandateId) {
            console.log(`✅ [WEBHOOK] SEPA mandate found after ${attempt + 1} attempt(s):`, mandateId);
            break;
          }
        }
      }
      
      if (mandateId) {
        console.log("✅ [WEBHOOK] SEPA mandate found:", mandateId);
        
        // Récupérer le mandate pour vérifier son statut
        const mandate = await stripe.mandates.retrieve(mandateId);
        console.log("📦 [WEBHOOK] Mandate status:", mandate.status);
        
        // Le mandate peut être "pending" ou "active"
        // On accepte "active" et "pending" (pending signifie que l'utilisateur a accepté mais que la banque n'a pas encore validé)
        if (mandate.status === "active" || mandate.status === "pending") {
          console.log(`✅ [WEBHOOK] SEPA mandate is ${mandate.status}`);
          
          // Trouver l'utilisateur par son stripe_customer_id
          const { data: user } = await supabase
            .from("users")
            .select("id, email, role")
            .eq("stripe_customer_id", customerId)
            .single();
          
          if (user && user.role === "company") {
            console.log("✅ [WEBHOOK] Company found, checking if validation needed:", user.id);
            console.log("📋 [WEBHOOK] Company email:", user.email);
            
            // ✅ Vérifier si la validation 1€ a déjà été faite
            const { checkIfSepaValidationNeeded, validateSepaMandateWithTestPayment } = await import("../services/sepaMandateValidation.service.js");
            console.log("🔄 [WEBHOOK] Checking validation status for company:", user.id);
            const validationStatus = await checkIfSepaValidationNeeded(user.id);
            console.log("📋 [WEBHOOK] Validation status result:", JSON.stringify(validationStatus, null, 2));
            
            if (validationStatus.needsValidation) {
              console.log("🔄 [WEBHOOK] Validation needed, triggering 1€ test payment...");
              console.log("📋 [WEBHOOK] PaymentMethod ID:", paymentMethodId);
              console.log("📋 [WEBHOOK] Mandate ID:", mandateId);
              try {
                const validationResult = await validateSepaMandateWithTestPayment(
                  user.id,
                  paymentMethodId,
                  mandateId
                );
                console.log("✅ [WEBHOOK] Validation payment created successfully");
                console.log("📋 [WEBHOOK] PaymentIntent ID:", validationResult.paymentIntentId);
                console.log("📋 [WEBHOOK] Status:", validationResult.status);
                console.log("📋 [WEBHOOK] Requires client confirmation:", validationResult.requiresClientConfirmation);
                
                // Notification avec info sur la validation
                await sendNotificationToUser({
                  userId: user.id,
                  title: "Mandat SEPA configuré",
                  message: "Votre mandat SEPA a été configuré. Un paiement test de 1€ sera effectué pour valider le mandat (ce montant sera remboursé automatiquement).",
                  data: {
                    type: "sepa_mandate_activated",
                    mandate_id: mandateId,
                    payment_method_id: paymentMethodId,
                    mandate_status: mandate.status,
                    validation_payment_intent_id: validationResult.paymentIntentId,
                  },
                });
              } catch (validationError) {
                console.error("❌ [WEBHOOK] Error triggering validation payment:", validationError);
                console.error("❌ [WEBHOOK] Error details:", {
                  message: validationError.message,
                  type: validationError.type,
                  code: validationError.code,
                  statusCode: validationError.statusCode,
                  stack: validationError.stack,
                });
                // Ne pas bloquer le webhook, juste logger l'erreur
                // L'utilisateur pourra déclencher la validation manuellement via l'endpoint
                
                // Notification standard sans validation
                await sendNotificationToUser({
                  userId: user.id,
                  title: "Mandat SEPA configuré",
                  message: mandate.status === "active" 
                    ? "Votre mandat SEPA a été activé avec succès. Vous pouvez maintenant créer des offres."
                    : "Votre mandat SEPA est en attente de validation. Vous pouvez créer des offres, mais les paiements seront traités une fois le mandat activé.",
                  data: {
                    type: "sepa_mandate_activated",
                    mandate_id: mandateId,
                    payment_method_id: paymentMethodId,
                    mandate_status: mandate.status,
                  },
                });
              }
            } else {
              console.log("ℹ️ [WEBHOOK] Validation not needed (reason:", validationStatus.reason, ")");
              // Notification standard
              await sendNotificationToUser({
                userId: user.id,
                title: "Mandat SEPA configuré",
                message: mandate.status === "active" 
                  ? "Votre mandat SEPA a été activé avec succès. Vous pouvez maintenant créer des offres."
                  : "Votre mandat SEPA est en attente de validation. Vous pouvez créer des offres, mais les paiements seront traités une fois le mandat activé.",
                data: {
                  type: "sepa_mandate_activated",
                  mandate_id: mandateId,
                  payment_method_id: paymentMethodId,
                  mandate_status: mandate.status,
                },
              });
            }
          }
        } else {
          console.warn(`⚠️ [WEBHOOK] SEPA mandate status is not active/pending: ${mandate.status}`);
        }
      } else {
        console.warn("⚠️ [WEBHOOK] SEPA payment method has no mandate after retries");
      }
    } else if (paymentMethod.type === "card") {
      // ✅ GESTION CARTE (comportement existant)
  // Juste définir comme carte par défaut
  await stripe.customers.update(customerId, {
    invoice_settings: {
      default_payment_method: paymentMethodId,
    },
  });
      console.log("✅ [WEBHOOK] Card set as default payment method");
    }
  } catch (error) {
    console.error("❌ [WEBHOOK] Error processing setup_intent.succeeded:", error);
    console.error("❌ [WEBHOOK] Error details:", {
      message: error.message,
      stack: error.stack,
      type: error.type,
      code: error.code,
    });
  }

  console.log("🔄 [WEBHOOK] setup_intent.succeeded - END");
  break;
}

        case "mandate.updated": {
          const mandate = event.data.object;
          console.log("✅ [WEBHOOK] Mandate updated:", mandate.id, "status:", mandate.status);
          
          // Si le mandate devient actif, envoyer une notification
          if (mandate.status === "active" && mandate.type === "sepa_debit") {
            // Trouver le customer via le payment method
            const paymentMethodId = mandate.payment_method;
            if (paymentMethodId) {
              try {
                const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
                const customerId = paymentMethod.customer;
                
                if (customerId) {
                  const { data: user } = await supabase
                    .from("users")
                    .select("id, email, role")
                    .eq("stripe_customer_id", customerId)
                    .single();
                  
                  if (user && user.role === "company") {
                    console.log("✅ [WEBHOOK] Sending notification: mandate became active");
                    await sendNotificationToUser({
                      userId: user.id,
                      title: "Mandat SEPA activé",
                      message: "Votre mandat SEPA a été activé avec succès. Vous pouvez maintenant créer des offres.",
                      data: {
                        type: "sepa_mandate_activated",
                        mandate_id: mandate.id,
                        payment_method_id: paymentMethodId,
                      },
                    });
                  }
                }
              } catch (error) {
                console.error("❌ [WEBHOOK] Error processing mandate.updated:", error);
              }
            }
          }
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
