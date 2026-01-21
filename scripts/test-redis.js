// scripts/test-redis.js
// Script de test pour vérifier que Redis fonctionne correctement

import { getRedisClient, closeRedisConnection } from "../src/config/redis.js";
import dotenv from "dotenv";

dotenv.config();

async function testRedis() {
  console.log("🧪 [TEST] Testing Redis connection...\n");

  try {
    const redis = getRedisClient();

    // Test 1: Ping
    console.log("1️⃣ Testing PING...");
    const pong = await redis.ping();
    console.log(`   ✅ PING: ${pong}\n`);

    // Test 2: Set/Get
    console.log("2️⃣ Testing SET/GET...");
    await redis.set("test:key", "test:value", "EX", 10);
    const value = await redis.get("test:key");
    console.log(`   ✅ SET/GET: ${value}\n`);

    // Test 3: Cache pattern
    console.log("3️⃣ Testing cache pattern...");
    const testData = { providers: [{ id: "1", name: "Test" }] };
    const cacheKey = "cache:GET:/api/v1/providers:default";
    await redis.setex(cacheKey, 60, JSON.stringify(testData));
    const cached = await redis.get(cacheKey);
    const parsed = JSON.parse(cached);
    console.log(`   ✅ Cache pattern: ${parsed.providers.length} providers cached\n`);

    // Test 4: TTL
    console.log("4️⃣ Testing TTL...");
    const ttl = await redis.ttl("test:key");
    console.log(`   ✅ TTL: ${ttl} seconds remaining\n`);

    // Test 5: Keys pattern
    console.log("5️⃣ Testing KEYS pattern...");
    const keys = await redis.keys("cache:*");
    console.log(`   ✅ Found ${keys.length} cache keys\n`);

    // Cleanup
    console.log("🧹 Cleaning up test keys...");
    await redis.del("test:key", cacheKey);
    console.log("   ✅ Cleanup complete\n");

    console.log("✅ [TEST] All Redis tests passed!\n");
    console.log("📊 Redis is ready for production use.\n");

    await closeRedisConnection();
    process.exit(0);
  } catch (err) {
    console.error("❌ [TEST] Redis test failed:", err.message);
    console.error("\n💡 Make sure Redis is running:");
    console.error("   - Docker: docker run -d -p 6379:6379 redis:7-alpine");
    console.error("   - Homebrew: brew services start redis");
    console.error("   - Linux: sudo systemctl start redis-server\n");
    process.exit(1);
  }
}

testRedis();
