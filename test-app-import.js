// Test minimal pour identifier le problème
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, ".env");
dotenv.config({ path: envPath });

console.log("✅ dotenv loaded");

try {
  console.log("🔄 Testing app import...");
  const app = await import("./src/app.js");
  console.log("✅ app loaded successfully!");
  process.exit(0);
} catch (err) {
  console.error("❌ app import failed:", err.message);
  console.error("Stack:", err.stack);
  process.exit(1);
}
