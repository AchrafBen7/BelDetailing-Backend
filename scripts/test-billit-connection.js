// test-billit-connection.js
// Script de test pour vérifier la connexion à l'API Billit

import axios from "axios";
import dotenv from "dotenv";

// Charger les variables d'environnement
dotenv.config();

const BILLIT_API_BASE_URL = process.env.BILLIT_API_BASE_URL || "https://api.billit.be/v1";
const BILLIT_API_KEY = process.env.BILLIT_API_KEY;

if (!BILLIT_API_KEY) {
  console.error("❌ BILLIT_API_KEY not set in environment variables");
  console.error("   Please add BILLIT_API_KEY to your .env file");
  process.exit(1);
}

async function testConnection() {
  try {
    console.log("🔵 Testing Billit API connection...");
    console.log("   URL:", BILLIT_API_BASE_URL);
    console.log("   API Key:", BILLIT_API_KEY.substring(0, 10) + "..." + BILLIT_API_KEY.substring(BILLIT_API_KEY.length - 4));
    console.log("");
    
    // Test 1: Vérifier le statut de l'API (endpoint de santé)
    console.log("📡 Test 1: Checking API health...");
    try {
      const healthResponse = await axios.get(
        `${BILLIT_API_BASE_URL}/health`,
        {
          headers: {
            "Authorization": `Bearer ${BILLIT_API_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );
      
      console.log("   ✅ Health check successful");
      console.log("   Status:", healthResponse.status);
      if (healthResponse.data) {
        console.log("   Response:", JSON.stringify(healthResponse.data, null, 2));
      }
    } catch (healthError) {
      // L'endpoint /health peut ne pas exister, ce n'est pas grave
      if (healthError.response?.status === 404) {
        console.log("   ⚠️  /health endpoint not found (this is OK)");
      } else {
        throw healthError;
      }
    }
    
    console.log("");
    
    // Test 2: Vérifier les informations du compte (si endpoint disponible)
    console.log("📡 Test 2: Checking account information...");
    try {
      const accountResponse = await axios.get(
        `${BILLIT_API_BASE_URL}/account`,
        {
          headers: {
            "Authorization": `Bearer ${BILLIT_API_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );
      
      console.log("   ✅ Account info retrieved");
      console.log("   Status:", accountResponse.status);
      if (accountResponse.data) {
        console.log("   Account:", JSON.stringify(accountResponse.data, null, 2));
      }
    } catch (accountError) {
      if (accountError.response?.status === 404) {
        console.log("   ⚠️  /account endpoint not found (this is OK)");
      } else if (accountError.response?.status === 401) {
        console.log("   ❌ Unauthorized - Check your API key");
        throw accountError;
      } else {
        throw accountError;
      }
    }
    
    console.log("");
    console.log("✅ All tests passed! Billit API is configured correctly.");
    console.log("");
    console.log("📝 Next steps:");
    console.log("   1. Test creating a booking with Peppol enabled");
    console.log("   2. Complete the service to trigger invoice sending");
    console.log("   3. Check Billit dashboard for the invoice");
    
  } catch (error) {
    console.error("");
    console.error("❌ Connection test failed!");
    console.error("");
    
    if (error.response) {
      // Erreur API
      console.error("   Status:", error.response.status);
      console.error("   Error:", JSON.stringify(error.response.data, null, 2));
      
      if (error.response.status === 401) {
        console.error("");
        console.error("   💡 Solution: Check your BILLIT_API_KEY in .env");
        console.error("      Make sure the API key is correct and has not expired");
      } else if (error.response.status === 403) {
        console.error("");
        console.error("   💡 Solution: Check API key permissions");
        console.error("      Make sure the key has 'Create invoices' and 'Send via Peppol' permissions");
      }
    } else if (error.request) {
      // Pas de réponse
      console.error("   No response from server");
      console.error("   Request:", error.request);
      console.error("");
      console.error("   💡 Solution: Check your internet connection and BILLIT_API_BASE_URL");
    } else {
      // Erreur de configuration
      console.error("   Error:", error.message);
      console.error("");
      console.error("   💡 Solution: Check your .env file configuration");
    }
    
    console.error("");
    process.exit(1);
  }
}

// Exécuter le test
testConnection();
