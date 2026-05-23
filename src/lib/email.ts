import { Resend } from 'resend';
import { createLogger } from '../logger';
import { config } from '../config';
import { hUrl } from './email-escape';

const log = createLogger('email');

const resend = new Resend(config.RESEND_API_KEY);

const FROM_EMAIL = config.RESEND_FROM_EMAIL;

export async function sendPasswordResetEmail(to: string, resetToken: string) {
  const resetLink = `${config.FRONTEND_URL}/reset-password?token=${resetToken}`;

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: 'Reset Your Password - Smart Attendance',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
          <div style="text-align: center; margin-bottom: 32px;">
            <div style="display: inline-block; width: 40px; height: 40px; background: #0f172a; border-radius: 8px; line-height: 40px; color: white; font-weight: bold; font-size: 18px;">S</div>
            <p style="margin: 8px 0 0; font-size: 14px; font-weight: 600; color: #0f172a;">Smart Attendance</p>
          </div>
          <h2 style="font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 8px;">Reset your password</h2>
          <p style="font-size: 14px; color: #64748b; line-height: 1.6; margin-bottom: 24px;">
            We received a request to reset your password. Click the button below to choose a new password. This link expires in 1 hour.
          </p>
          <a href="${hUrl(resetLink)}" style="display: inline-block; padding: 12px 32px; background: #0f172a; color: white; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 500;">
            Reset Password
          </a>
          <p style="font-size: 12px; color: #94a3b8; margin-top: 32px; line-height: 1.5;">
            If you didn't request this, you can safely ignore this email. Your password will remain unchanged.
          </p>
        </div>
      `,
    });
    log.info({ to }, 'Password reset email sent');
  } catch (err) {
    log.error({ to, err }, 'Failed to send password reset email');
    throw new Error('Failed to send email');
  }
}
