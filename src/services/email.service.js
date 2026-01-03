// src/services/email.service.js
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

function buildVerificationEmail(verificationUrl) {
  return `
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
          <h2 style="color: #333; margin-top: 0;">Vérifiez votre email</h2>
          <p>Bonjour,</p>
          <p>Merci de vous être inscrit sur NIOS. Pour activer votre compte, veuillez cliquer sur le bouton ci-dessous :</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verificationUrl}" style="display: inline-block; background: #FF6B35; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
              Vérifier mon email
            </a>
          </div>
          <p style="color: #666; font-size: 14px; margin-top: 30px;">
            Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>
            <a href="${verificationUrl}" style="color: #FF6B35; word-break: break-all;">${verificationUrl}</a>
          </p>
          <p style="color: #666; font-size: 14px; margin-top: 20px;">Ce lien expire dans 24 heures.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          <p style="color: #999; font-size: 12px; margin: 0;">
            Si vous n'avez pas créé de compte, ignorez cet email.
          </p>
        </div>
      </body>
    </html>
  `;
}

export async function sendVerificationEmail(email, verificationToken) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    throw new Error("Resend configuration missing");
  }

  const verificationUrl = `${process.env.FRONTEND_BASE_URL}/verify-email?token=${verificationToken}`;

  const { data, error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to: email,
    subject: "Vérifiez votre email - NIOS",
    html: buildVerificationEmail(verificationUrl),
  });

  if (error) {
    console.error("Resend error:", error);
    throw new Error("Could not send verification email");
  }

  return data;
}

export async function resendVerificationEmail(email, verificationToken) {
  return sendVerificationEmail(email, verificationToken);
}
