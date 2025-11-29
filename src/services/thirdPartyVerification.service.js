// src/services/thirdPartyVerification.service.js
const APPLE_BUNDLE_ID = process.env.APPLE_BUNDLE_ID;

export async function verifyAppleToken({ identityToken }) {
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
