import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendVerificationEmail(email, verificationCode) {
  console.log("📧 [EMAIL] Sending verification code to:", email);
  console.log("📧 [EMAIL] Code:", verificationCode);

  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY environment variable is not set");
  }

  if (!process.env.RESEND_FROM_EMAIL) {
    throw new Error("RESEND_FROM_EMAIL environment variable is not set");
  }

  try {
    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to: email,
      subject: "Votre code de verification - NIOS",
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #FF6B35 0%, #F7931E 100%); padding: 30px; text-align: center; border-radius: 12px 12px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 28px;">NIOS</h1>
              <p style="color: white; opacity: 0.9; margin: 5px 0 0 0;">beldetailing</p>
            </div>

            <div style="background: white; padding: 40px; border-radius: 0 0 12px 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
              <h2 style="color: #333; margin-top: 0;">Verifiez votre email</h2>

              <p>Bonjour,</p>

              <p>Merci de vous etre inscrit sur NIOS. Utilisez le code ci-dessous pour verifier votre email :</p>

              <div style="text-align: center; margin: 30px 0;">
                <div style="display: inline-block; background: #f5f5f5; border: 2px dashed #FF6B35; padding: 20px 40px; border-radius: 12px;">
                  <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #FF6B35; font-family: 'Courier New', monospace;">
                    ${verificationCode}
                  </div>
                </div>
              </div>

              <p style="color: #666; font-size: 14px; margin-top: 20px;">
                Entrez ce code dans l'application NIOS pour activer votre compte.
              </p>

              <p style="color: #666; font-size: 14px; margin-top: 20px;">
                ⏱️ Ce code expire dans <strong>10 minutes</strong>.
              </p>

              <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

              <p style="color: #999; font-size: 12px; margin: 0;">
                Si vous n'avez pas cree de compte, ignorez cet email.
              </p>
            </div>
          </body>
        </html>
      `,
    });

    if (error) {
      console.error("❌ [EMAIL] Resend error:", error);
      throw new Error(`Resend error: ${error.message}`);
    }

    console.log("✅ [EMAIL] Email sent successfully:", data?.id);
    return data;
  } catch (err) {
    console.error("❌ [EMAIL] Exception:", err);
    throw err;
  }
}

export async function resendVerificationEmail(email, verificationCode) {
  return sendVerificationEmail(email, verificationCode);
}
