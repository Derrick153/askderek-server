import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

// ── SHARED STYLES ─────────────────────────────────────────
const emailWrapper = (content: string): string => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background: #ea580c; padding: 20px; text-align: center;">
      <h1 style="color: white; margin: 0;">AskDerek 🇬🇭</h1>
    </div>
    <div style="padding: 30px;">
      ${content}
    </div>
    <div style="background: #f5f5f5; padding: 20px; text-align: center;">
      <p style="color: #666; font-size: 12px;">AskDerek — Real Homes. Real Owners. Real Ghana.</p>
    </div>
  </div>
`;

const ctaButton = (href: string, label: string): string =>
  `<a href="${href}" style="display:inline-block; background: #ea580c; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin-top: 16px;">${label}</a>`;

const formatAmount = (amount: number): string =>
  `GH₵ ${amount.toLocaleString("en-GH", { minimumFractionDigits: 2 })}`;

// ── PROPERTY APPROVED EMAIL ───────────────────────────────
export const sendPropertyApprovedEmail = async (
  email: string,
  name: string,
  propertyName: string
): Promise<boolean> => {
  try {
    await resend.emails.send({
      from:    "AskDerek <noreply@askderek.com>",
      to:      email,
      subject: "🎉 Your Property Has Been Approved!",
      html:    emailWrapper(`
        <h2>Hello ${name}!</h2>
        <p>Great news! Your property <strong>${propertyName}</strong> has been approved and is now live on AskDerek.</p>
        <p>Tenants in Tarkwa can now find and apply for your property.</p>
        ${ctaButton("https://askderek.com", "View Your Listing")}
      `),
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
      from:    "AskDerek <noreply@askderek.com>",
      to:      email,
      subject: "Property Listing Update",
      html:    emailWrapper(`
        <h2>Hello ${name}!</h2>
        <p>Your property <strong>${propertyName}</strong> could not be approved at this time.</p>
        <p><strong>Reason:</strong> ${reason}</p>
        <p>Please update your listing and resubmit for review.</p>
        ${ctaButton("https://askderek.com", "Update Listing")}
      `),
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
      from:    "AskDerek <noreply@askderek.com>",
      to:      email,
      subject: "🎉 Your Application Has Been Approved!",
      html:    emailWrapper(`
        <h2>Congratulations ${name}!</h2>
        <p>Your application for <strong>${propertyName}</strong> has been approved!</p>
        <p>The landlord will contact you soon with next steps.</p>
        ${ctaButton("https://askderek.com", "View Application")}
      `),
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
      from:    "AskDerek <noreply@askderek.com>",
      to:      email,
      subject: "✅ You Are Now a Verified Landlord!",
      html:    emailWrapper(`
        <h2>Congratulations ${name}!</h2>
        <p>Your identity has been verified. You are now a <strong>Verified Landlord</strong> on AskDerek.</p>
        <p>A verified badge will now appear on all your listings giving tenants more confidence.</p>
        ${ctaButton("https://askderek.com", "View Your Profile")}
      `),
    });
    console.log(`✅ Verification approved email sent to ${email}`);
    return true;
  } catch (error: any) {
    console.error(`❌ Email error:`, error.message);
    return false;
  }
};

// ── PAYMENT CONFIRMATION EMAIL (TENANT) ───────────────────
export const sendPaymentConfirmationEmail = async (
  email:        string,
  name:         string,
  propertyName: string,
  amountPaid:   number,
  reference:    string,
  paidAt:       Date
): Promise<boolean> => {
  try {
    const amount      = formatAmount(amountPaid);
    const dateStr     = new Date(paidAt).toLocaleDateString("en-GH", {
      weekday: "long",
      year:    "numeric",
      month:   "long",
      day:     "numeric",
    });

    await resend.emails.send({
      from:    "AskDerek <noreply@askderek.com>",
      to:      email,
      subject: `✅ Payment Confirmed — ${amount} for ${propertyName}`,
      html:    emailWrapper(`
        <h2>Payment Confirmed! 🎉</h2>
        <p>Hi ${name}, your rent payment has been received successfully.</p>
        <table style="width:100%; border-collapse: collapse; margin: 20px 0;">
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px 0; color: #666;">Property</td>
            <td style="padding: 10px 0; font-weight: bold;">${propertyName}</td>
          </tr>
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px 0; color: #666;">Amount Paid</td>
            <td style="padding: 10px 0; font-weight: bold; color: #16a34a;">${amount}</td>
          </tr>
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px 0; color: #666;">Date</td>
            <td style="padding: 10px 0;">${dateStr}</td>
          </tr>
          <tr>
            <td style="padding: 10px 0; color: #666;">Reference</td>
            <td style="padding: 10px 0; font-family: monospace; font-size: 13px;">${reference}</td>
          </tr>
        </table>
        <p>Keep this email as your payment receipt.</p>
        ${ctaButton("https://askderek.com/tenants/payments", "View Payment History")}
      `),
    });
    console.log(`✅ Payment confirmation email sent to ${email}`);
    return true;
  } catch (error: any) {
    console.error(`❌ Payment confirmation email error:`, error.message);
    return false;
  }
};

// ── PAYMENT FAILED EMAIL (TENANT) ─────────────────────────
export const sendPaymentFailedEmail = async (
  email:        string,
  name:         string,
  propertyName: string,
  amountDue:    number,
  reference:    string
): Promise<boolean> => {
  try {
    const amount = formatAmount(amountDue);

    await resend.emails.send({
      from:    "AskDerek <noreply@askderek.com>",
      to:      email,
      subject: `❌ Payment Failed — ${amount} for ${propertyName}`,
      html:    emailWrapper(`
        <h2>Payment Failed</h2>
        <p>Hi ${name}, unfortunately your payment could not be processed.</p>
        <table style="width:100%; border-collapse: collapse; margin: 20px 0;">
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px 0; color: #666;">Property</td>
            <td style="padding: 10px 0; font-weight: bold;">${propertyName}</td>
          </tr>
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px 0; color: #666;">Amount Due</td>
            <td style="padding: 10px 0; font-weight: bold; color: #dc2626;">${amount}</td>
          </tr>
          <tr>
            <td style="padding: 10px 0; color: #666;">Reference</td>
            <td style="padding: 10px 0; font-family: monospace; font-size: 13px;">${reference}</td>
          </tr>
        </table>
        <p>Please try again. If the problem persists, contact your bank or try a different payment method.</p>
        ${ctaButton("https://askderek.com/tenants/payments/pay", "Try Again")}
      `),
    });
    console.log(`✅ Payment failed email sent to ${email}`);
    return true;
  } catch (error: any) {
    console.error(`❌ Payment failed email error:`, error.message);
    return false;
  }
};

// ── MANAGER PAYMENT RECEIVED EMAIL ────────────────────────
export const sendManagerPaymentReceivedEmail = async (
  email:        string,
  managerName:  string,
  tenantName:   string,
  propertyName: string,
  amountPaid:   number,
  reference:    string,
  paidAt:       Date
): Promise<boolean> => {
  try {
    const commissionRate   = parseFloat(process.env.COMMISSION_PERCENTAGE || "5") / 100;
    const commissionAmount = amountPaid * commissionRate;
    const netAmount        = amountPaid - commissionAmount;

    const gross      = formatAmount(amountPaid);
    const commission = formatAmount(commissionAmount);
    const net        = formatAmount(netAmount);
    const dateStr    = new Date(paidAt).toLocaleDateString("en-GH", {
      weekday: "long",
      year:    "numeric",
      month:   "long",
      day:     "numeric",
    });

    await resend.emails.send({
      from:    "AskDerek <noreply@askderek.com>",
      to:      email,
      subject: `💰 Rent Received — ${gross} from ${tenantName}`,
      html:    emailWrapper(`
        <h2>Rent Payment Received! 💰</h2>
        <p>Hi ${managerName}, a rent payment has been made for your property.</p>
        <table style="width:100%; border-collapse: collapse; margin: 20px 0;">
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px 0; color: #666;">Tenant</td>
            <td style="padding: 10px 0; font-weight: bold;">${tenantName}</td>
          </tr>
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px 0; color: #666;">Property</td>
            <td style="padding: 10px 0; font-weight: bold;">${propertyName}</td>
          </tr>
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px 0; color: #666;">Date</td>
            <td style="padding: 10px 0;">${dateStr}</td>
          </tr>
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px 0; color: #666;">Gross Amount</td>
            <td style="padding: 10px 0;">${gross}</td>
          </tr>
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px 0; color: #666;">AskDerek Commission (${Math.round(commissionRate * 100)}%)</td>
            <td style="padding: 10px 0; color: #dc2626;">- ${commission}</td>
          </tr>
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px 0; color: #666; font-weight: bold;">Your Earnings</td>
            <td style="padding: 10px 0; font-weight: bold; color: #16a34a;">${net}</td>
          </tr>
          <tr>
            <td style="padding: 10px 0; color: #666;">Reference</td>
            <td style="padding: 10px 0; font-family: monospace; font-size: 13px;">${reference}</td>
          </tr>
        </table>
        ${ctaButton("https://askderek.com/managers/payments", "View Earnings Dashboard")}
      `),
    });
    console.log(`✅ Manager payment received email sent to ${email}`);
    return true;
  } catch (error: any) {
    console.error(`❌ Manager payment email error:`, error.message);
    return false;
  }
};