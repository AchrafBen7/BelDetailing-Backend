#!/usr/bin/env node

/**
 * Script de test pour les notifications OneSignal
 * 
 * Usage:
 *   node scripts/test-notification.js [userId]
 * 
 * Exemples:
 *   node scripts/test-notification.js user-123
 *   node scripts/test-notification.js
 */

import { sendNotificationToUser, sendNotificationWithDeepLink } from "../src/services/onesignal.service.js";
import "dotenv/config";

// Récupérer userId depuis les arguments ou utiliser une valeur par défaut
const testUserId = process.argv[2] || process.env.TEST_USER_ID || "user-123";

async function testNotification() {
  console.log("🧪 === Test des Notifications OneSignal ===\n");
  console.log(`📱 User ID testé: ${testUserId}\n`);

  try {
    // Test 1 : Notification simple
    console.log("🧪 Test 1 : Notification simple");
    console.log("─────────────────────────────────────");
    const result1 = await sendNotificationToUser({
      userId: testUserId,
      title: "Test Notification",
      message: "Ceci est un test de notification OneSignal depuis le script de test.",
      data: {
        type: "test",
        test_id: "test-001",
        timestamp: new Date().toISOString(),
      },
    });
    console.log("✅ Notification envoyée avec succès !");
    console.log(`   ID OneSignal: ${result1.id}`);
    console.log(`   Destinataires: ${result1.recipients || "N/A"}\n`);

    // Attendre 2 secondes avant le test suivant
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test 2 : Notification avec deep link
    console.log("🧪 Test 2 : Notification avec deep link");
    console.log("─────────────────────────────────────");
    const result2 = await sendNotificationWithDeepLink({
      userId: testUserId,
      title: "Réservation confirmée",
      message: "Votre rendez-vous est confirmé. Cliquez pour voir les détails.",
      type: "booking_confirmed",
      id: "booking-456",
      // deepLink optionnel, sinon généré: "beldetailing://booking_confirmed/booking-456"
    });
    console.log("✅ Notification avec deep link envoyée avec succès !");
    console.log(`   ID OneSignal: ${result2.id}`);
    console.log(`   Destinataires: ${result2.recipients || "N/A"}`);
    console.log(`   Deep link: beldetailing://booking_confirmed/booking-456\n`);

    // Attendre 2 secondes avant le test suivant
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test 3 : Notification de paiement
    console.log("🧪 Test 3 : Notification de paiement");
    console.log("─────────────────────────────────────");
    const result3 = await sendNotificationWithDeepLink({
      userId: testUserId,
      title: "Paiement réussi",
      message: "Votre paiement de 75.00 € a été traité avec succès.",
      type: "payment_success",
      id: "payment-789",
      deepLink: "beldetailing://payment/payment-789",
    });
    console.log("✅ Notification de paiement envoyée avec succès !");
    console.log(`   ID OneSignal: ${result3.id}`);
    console.log(`   Destinataires: ${result3.recipients || "N/A"}\n`);

    console.log("✅ Tous les tests réussis !");
    console.log("\n📱 Vérifications à faire sur iOS :");
    console.log("   1. Vérifier que les notifications apparaissent dans le centre de notifications");
    console.log("   2. Cliquer sur chaque notification");
    console.log("   3. Vérifier que l'app s'ouvre sur le bon écran (deep link)");
    console.log("   4. Vérifier les logs iOS pour voir les données reçues");
    console.log("\n🌐 Vérifications à faire dans OneSignal Dashboard :");
    console.log("   1. Aller dans Delivery → All Notifications");
    console.log("   2. Vérifier que les notifications apparaissent avec le statut 'Delivered'");
    console.log("   3. Vérifier que le external_user_id correspond au userId utilisé");
    console.log("   4. Aller dans Players → Chercher le player avec external_user_id = " + testUserId);
    
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Erreur lors des tests :");
    console.error(`   Message: ${error.message}`);
    if (error.stack) {
      console.error(`   Stack: ${error.stack}`);
    }
    console.error("\n💡 Vérifications à faire :");
    console.error("   1. Variables d'environnement configurées (ONESIGNAL_APP_ID, ONESIGNAL_REST_API_KEY)");
    console.error("   2. OneSignal App ID et REST API Key valides");
    console.error("   3. L'utilisateur a appelé OneSignal.login(userId) côté iOS");
    console.error("   4. L'utilisateur a accepté les permissions de notifications");
    
    process.exit(1);
  }
}

// Exécuter les tests
testNotification();
