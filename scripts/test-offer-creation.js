/**
 * Script de test pour vérifier la création d'offre avec catégories multiples
 * Usage: node scripts/test-offer-creation.js
 */

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Charger .env
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, "..", ".env");
dotenv.config({ path: envPath });

import { supabaseAdmin as supabase } from "../src/config/supabase.js";

async function testOfferCreation() {
  console.log("🧪 Test de création d'offre avec catégories multiples\n");

  // 1. Vérifier si la colonne categories existe
  console.log("1️⃣ Vérification de la colonne 'categories'...");
  try {
    const { data: columns, error } = await supabase.rpc("get_table_columns", {
      table_name: "offers",
    });

    // Alternative: essayer de sélectionner categories
    const { data: testData, error: testError } = await supabase
      .from("offers")
      .select("categories")
      .limit(1);

    if (testError && testError.code === "42703") {
      console.log("❌ La colonne 'categories' n'existe pas encore.");
      console.log("📝 Veuillez exécuter la migration: migrations/add_offer_categories_array.sql\n");
    } else {
      console.log("✅ La colonne 'categories' existe.\n");
    }
  } catch (err) {
    console.log("⚠️ Impossible de vérifier la colonne (continuer quand même)...\n");
  }

  // 2. Tester la création d'une offre avec catégories multiples
  console.log("2️⃣ Test de création d'offre...");
  
  // Trouver un utilisateur company pour le test
  const { data: companies, error: companyError } = await supabase
    .from("users")
    .select("id, email")
    .eq("role", "company")
    .limit(1);

  if (companyError || !companies || companies.length === 0) {
    console.log("❌ Aucun utilisateur company trouvé pour le test.");
    console.log("💡 Créez d'abord un compte company dans l'app.\n");
    return;
  }

  const testCompany = companies[0];
  console.log(`   Utilisateur test: ${testCompany.email} (${testCompany.id})\n`);

  const testPayload = {
    title: "Test Offre Multi-Catégories",
    description: "Offre de test avec intérieur et extérieur",
    categories: ["interior", "exterior"], // Array de catégories
    vehicleCount: 5,
    priceMin: 200,
    priceMax: 500,
    city: "Bruxelles",
    postalCode: "1000",
    type: "oneTime",
  };

  console.log("   Payload:", JSON.stringify(testPayload, null, 2));
  console.log("");

  try {
    // Simuler l'appel du service
    const insertPayload = {
      title: testPayload.title,
      category: testPayload.categories[0], // Première catégorie
      categories: testPayload.categories, // Array complet
      description: testPayload.description,
      vehicle_count: testPayload.vehicleCount,
      price_min: testPayload.priceMin,
      price_max: testPayload.priceMax,
      city: testPayload.city,
      postal_code: testPayload.postalCode,
      type: testPayload.type,
      status: "open",
      contract_id: null,
      created_by: testCompany.id,
      company_name: "Test Company",
      company_logo_url: null,
    };

    console.log("3️⃣ Insertion dans la base de données...");
    const { data, error } = await supabase
      .from("offers")
      .insert(insertPayload)
      .select("*")
      .single();

    if (error) {
      console.log("❌ Erreur lors de l'insertion:");
      console.log("   Code:", error.code);
      console.log("   Message:", error.message);
      console.log("   Details:", error.details);

      // Si l'erreur est due à la colonne categories qui n'existe pas
      if (error.code === "42703" && error.message?.includes("categories")) {
        console.log("\n💡 Solution: Exécutez la migration SQL:");
        console.log("   migrations/add_offer_categories_array.sql\n");
      }
      return;
    }

    console.log("✅ Offre créée avec succès!");
    console.log("\n   Résultat:");
    console.log("   - ID:", data.id);
    console.log("   - Titre:", data.title);
    console.log("   - Category (première):", data.category);
    console.log("   - Categories (array):", data.categories);
    console.log("   - Vehicle Count:", data.vehicle_count);
    console.log("   - Price Min:", data.price_min);
    console.log("   - Price Max:", data.price_max);
    console.log("   - City:", data.city);
    console.log("   - Type:", data.type);
    console.log("   - Status:", data.status);
    console.log("");

    // Vérifier que les catégories sont bien stockées
    if (Array.isArray(data.categories) && data.categories.length > 0) {
      console.log("✅ Les catégories multiples sont bien stockées!");
      console.log(`   Catégories: ${data.categories.join(", ")}\n`);
    } else if (data.category) {
      console.log("⚠️ Seule la première catégorie est stockée (colonne 'category').");
      console.log("   La colonne 'categories' n'existe peut-être pas encore.\n");
    }

    // Nettoyer: supprimer l'offre de test
    console.log("4️⃣ Nettoyage: suppression de l'offre de test...");
    await supabase.from("offers").delete().eq("id", data.id);
    console.log("✅ Offre de test supprimée.\n");

  } catch (err) {
    console.log("❌ Erreur inattendue:", err.message);
    console.log(err);
  }
}

// Exécuter le test
testOfferCreation()
  .then(() => {
    console.log("✅ Test terminé.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Erreur fatale:", err);
    process.exit(1);
  });
