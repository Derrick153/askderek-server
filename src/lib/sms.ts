import axios from "axios";

const ARKESEL_API_KEY = process.env.ARKESEL_API_KEY;
const ARKESEL_SENDER_ID = process.env.ARKESEL_SENDER_ID || "AskDerek";

export const sendSMS = async (phoneNumber: string, message: string): Promise<boolean> => {
  try {
    const response = await axios.get("https://sms.arkesel.com/sms/api", {
      params: {
        action: "send-sms",
        api_key: ARKESEL_API_KEY,
        to: phoneNumber,
        from: ARKESEL_SENDER_ID,
        sms: message,
      },
    });

    if (response.data.code === "ok") {
      console.log(`✅ SMS sent to ${phoneNumber}`);
      return true;
    } else {
      console.error(`❌ SMS failed:`, response.data);
      return false;
    }
  } catch (error: any) {
    console.error(`❌ SMS error:`, error.message);
    return false;
  }
};

export const sendOTP = async (phoneNumber: string, otp: string): Promise<boolean> => {
  const message = `Your AskDerek verification code is: ${otp}. Valid for 10 minutes. Do not share this code.`;
  return sendSMS(phoneNumber, message);
};