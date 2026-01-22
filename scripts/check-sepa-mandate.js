// Script de diagnostic pour vérifier le statut SEPA d'un customer
import Stripe from "stripe";
import dotenv from "dotenv";

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-11-17.clover",
});

const customerId = process.argv[2] || "cus_Th8Z44KlAAJ8Ji";

async function checkSepaMandate() {
  console.log("🔍 Checking SEPA mandate for customer:", customerId);
  console.log("");

  try {
    // 1) Récupérer tous les payment methods SEPA
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      type: "sepa_debit",
      limit: 100,
    });

    console.log(`📦 Found ${paymentMethods.data.length} SEPA payment method(s)`);
    console.log("");

    if (paymentMethods.data.length === 0) {
      console.log("❌ No SEPA payment methods found");
      return;
    }

    // 2) Parcourir chaque payment method
    for (const pm of paymentMethods.data) {
      console.log(`📋 Payment Method: ${pm.id}`);
      console.log(`   Type: ${pm.type}`);
      console.log(`   Created: ${new Date(pm.created * 1000).toISOString()}`);
      console.log(`   Mandate ID: ${pm.sepa_debit?.mandate || "❌ NO MANDATE"}`);
      console.log(`   Last4: ${pm.sepa_debit?.last4 || "N/A"}`);
      console.log(`   Bank Code: ${pm.sepa_debit?.bank_code || "N/A"}`);
      console.log("");

      // 3) Si un mandate existe, le récupérer
      if (pm.sepa_debit?.mandate) {
        try {
          const mandate = await stripe.mandates.retrieve(pm.sepa_debit.mandate);
          console.log(`   ✅ Mandate found: ${mandate.id}`);
          console.log(`   Status: ${mandate.status}`);
          console.log(`   Type: ${mandate.type}`);
          console.log(`   Created: ${new Date(mandate.created * 1000).toISOString()}`);
          if (mandate.customer_acceptance) {
            console.log(`   Customer Acceptance:`);
            console.log(`     Type: ${mandate.customer_acceptance.type}`);
            console.log(`     Online: ${mandate.customer_acceptance.online?.ip_address || "N/A"}`);
            console.log(`     Date: ${mandate.customer_acceptance.online?.date || "N/A"}`);
          }
          console.log("");
        } catch (err) {
          console.error(`   ❌ Error retrieving mandate: ${err.message}`);
          console.log("");
        }
      }
    }

    // 4) Récupérer tous les Setup Intents pour ce customer
    console.log("🔍 Checking Setup Intents...");
    const setupIntents = await stripe.setupIntents.list({
      customer: customerId,
      limit: 10,
    });

    console.log(`📦 Found ${setupIntents.data.length} Setup Intent(s)`);
    console.log("");

    for (const si of setupIntents.data) {
      console.log(`📋 Setup Intent: ${si.id}`);
      console.log(`   Status: ${si.status}`);
      console.log(`   Payment Method: ${si.payment_method || "❌ NO PAYMENT METHOD"}`);
      console.log(`   Mandate: ${si.mandate || "❌ NO MANDATE"}`); // ✅ IMPORTANT : Afficher le mandate
      console.log(`   Created: ${new Date(si.created * 1000).toISOString()}`);
      console.log(`   Payment Method Types: ${si.payment_method_types.join(", ")}`);
      
      // Si un mandate existe, le récupérer et afficher son statut
      if (si.mandate) {
        try {
          const mandate = await stripe.mandates.retrieve(si.mandate);
          console.log(`   ✅ Mandate found: ${mandate.id}`);
          console.log(`   Mandate Status: ${mandate.status}`);
          console.log(`   Mandate Type: ${mandate.type}`);
          if (mandate.customer_acceptance) {
            console.log(`   Customer Acceptance Type: ${mandate.customer_acceptance.type}`);
          }
        } catch (err) {
          console.error(`   ❌ Error retrieving mandate: ${err.message}`);
        }
      }
      console.log("");
    }

  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error(error);
  }
}

checkSepaMandate();
