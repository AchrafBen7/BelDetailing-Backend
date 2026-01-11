// src/services/thirdPartyVerification.service.js
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";

const APPLE_BUNDLE_ID = process.env.APPLE_BUNDLE_ID;

if (!APPLE_BUNDLE_ID) {
  console.error("⚠️ APPLE_BUNDLE_ID environment variable is not set");
}

// Client JWKS pour récupérer les clés publiques Apple
const client = jwksClient({
  jwksUri: "https://appleid.apple.com/auth/keys",
  cache: true,
  cacheMaxAge: 86400000, // 24 heures
});

/**
 * Récupère la clé publique Apple pour vérifier le token
 */
function getAppleKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      return callback(err);
    }
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

/**
 * Vérifie le token Apple identityToken
 * @param {string} identityToken - Le token JWT fourni par Apple
 * @returns {Promise<{userId: string, emailFromToken: string, emailVerified: boolean}>}
 */
export async function verifyAppleToken({ identityToken }) {
  if (!APPLE_BUNDLE_ID) {
    throw new Error("APPLE_BUNDLE_ID environment variable is not set");
  }

  if (!identityToken) {
    throw new Error("identityToken is required");
  }

  return new Promise((resolve, reject) => {
    jwt.verify(
      identityToken,
      getAppleKey,
      {
        algorithms: ["RS256"],
        issuer: "https://appleid.apple.com",
        audience: APPLE_BUNDLE_ID,
      },
      (err, payload) => {
        if (err) {
          console.error("Apple token verify error:", err);
          return reject(err);
        }

        const userId = payload.sub;
        const emailFromToken = payload.email;
        const emailVerified = payload.email_verified === "true";

        resolve({
          userId,
          emailFromToken,
          emailVerified,
        });
      }
    );
  });
}
