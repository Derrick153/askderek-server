import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

// ── PROPERTY APPROVED EMAIL ───────────────────────────────
export const sendPropertyApprovedEmail = async (
  email: string,
  name: string,
  propertyName: string
): Promise<boolean> => {
  try {
    await resend.emails.send({
      from: "AskDerek <noreply@askderek.com>",
      to: email,
      subject: "🎉 Your Property Has Been Approved!",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #ea580c; padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0;">AskDerek 🇬🇭</h1>
          </div>
          <div style="padding: 30px;">
            <h2>Hello ${name}!</h2>
            <p>Great news! Your property <strong>${propertyName}</strong> has been approved and is now live on AskDerek.</p>
            <p>Tenants in Tarkwa can now find and apply for your property.</p>
            <a href="https://askderek.com" style="background: #ea580c; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none;">View Your Listing</a>
          </div>
          <div style="background: #f5f5f5; padding: 20px; text-align: center;">
            <p style="color: #666; font-size: 12px;">AskDerek — Real Homes. Real Owners. Real Ghana.</p>
          </div>
        </div>
      `,
    });
    console.log(`✅ Property approved email sent to ${email}`);
    return true;
  } catch (error: any) {
    console.error(`❌ Email error:`, error.message);
    return false;
  }
};

// ── PROPERTY REJECTED EMAIL ───────────────────────────────
export const sendPropertyRejectedEmail = async (
  email: string,
  name: string,
  propertyName: string,
  reason: string
): Promise<boolean> => {
  try {
    await resend.emails.send({
      from: "AskDerek <noreply@askderek.com>",
      to: email,
      subject: "Property Listing Update",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #ea580c; padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0;">AskDerek 🇬🇭</h1>
          </div>
          <div style="padding: 30px;">
            <h2>Hello ${name}!</h2>
            <p>Your property <strong>${propertyName}</strong> could not be approved at this time.</p>
            <p><strong>Reason:</strong> ${reason}</p>
            <p>Please update your listing and resubmit for review.</p>
            <a href="https://askderek.com" style="background: #ea580c; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Update Listing</a>
          </div>
          <div style="background: #f5f5f5; padding: 20px; text-align: center;">
            <p style="color: #666; font-size: 12px;">AskDerek — Real Homes. Real Owners. Real Ghana.</p>
          </div>
        </div>
      `,
    });
    console.log(`✅ Property rejected email sent to ${email}`);
    return true;
  } catch (error: any) {
    console.error(`❌ Email error:`, error.message);
    return false;
  }
};

// ── APPLICATION APPROVED EMAIL ────────────────────────────
export const sendApplicationApprovedEmail = async (
  email: string,
  name: string,
  propertyName: string
): Promise<boolean> => {
  try {
    await resend.emails.send({
      from: "AskDerek <noreply@askderek.com>",
      to: email,
      subject: "🎉 Your Application Has Been Approved!",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #ea580c; padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0;">AskDerek 🇬🇭</h1>
          </div>
          <div style="padding: 30px;">
            <h2>Congratulations ${name}!</h2>
            <p>Your application for <strong>${propertyName}</strong> has been approved!</p>
            <p>The landlord will contact you soon with next steps.</p>
            <a href="https://askderek.com" style="background: #ea580c; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none;">View Application</a>
          </div>
          <div style="background: #f5f5f5; padding: 20px; text-align: center;">
            <p style="color: #666; font-size: 12px;">AskDerek — Real Homes. Real Owners. Real Ghana.</p>
          </div>
        </div>
      `,
    });
    console.log(`✅ Application approved email sent to ${email}`);
    return true;
  } catch (error: any) {
    console.error(`❌ Email error:`, error.message);
    return false;
  }
};

// ── VERIFICATION APPROVED EMAIL ───────────────────────────
export const sendVerificationApprovedEmail = async (
  email: string,
  name: string
): Promise<boolean> => {
  try {
    await resend.emails.send({
      from: "AskDerek <noreply@askderek.com>",
      to: email,
      subject: "✅ You Are Now a Verified Landlord!",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #ea580c; padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0;">AskDerek 🇬🇭</h1>
          </div>
          <div style="padding: 30px;">
            <h2>Congratulations ${name}!</h2>
            <p>Your identity has been verified. You are now a <strong>Verified Landlord</strong> on AskDerek.</p>
            <p>A verified badge will now appear on all your listings giving tenants more confidence.</p>
            <a href="https://askderek.com" style="background: #ea580c; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none;">View Your Profile</a>
          </div>
          <div style="background: #f5f5f5; padding: 20px; text-align: center;">
            <p style="color: #666; font-size: 12px;">AskDerek — Real Homes. Real Owners. Real Ghana.</p>
          </div>
        </div>
      `,
    });
    console.log(`✅ Verification approved email sent to ${email}`);
    return true;
  } catch (error: any) {
    console.error(`❌ Email error:`, error.message);
    return false;
  }
};