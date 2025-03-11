const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const twilio = require("twilio");

// Initialize Firebase Admin
admin.initializeApp();

// Twilio Credentials from Firebase Config
const accountSid = functions.config().twilio.sid;
const authToken = functions.config().twilio.token;
const twilioWhatsAppNumber = functions.config().twilio.whatsapp;

const recipientPhone = "+917018897425";

const client = twilio(accountSid, authToken);

exports.newOrderNotification = functions.firestore
  .document("orders/{orderId}")
  .onCreate(async (snapshot, context) => {
    const orderId = context.params.orderId;
    const orderData = snapshot.data();

    // fetching contact number
    let contactNumber = "Unknown";
    try {
      const userDoc = await admin
        .firestore()
        .collection("users")
        .doc(orderData.orderedBy)
        .get();

      if (userDoc.exists) {
        const userData = userDoc.data();
        contactNumber = userData.phoneNumber || "Not provided";
      } else {
        console.warn(
          `User document for ${orderData.orderedBy} does not exist.`
        );
      }
    } catch (err) {
      console.error("Error fetching user data:", err);
    }

    //Message Data
    const message = `🛒 *New Order Placed!*\n\n📦 *Order ID:* ${orderId}\n\n💰 *Contact Number:* ${contactNumber}`;

    try {
      await client.messages.create({
        body: message,
        from: `whatsapp:${twilioWhatsAppNumber}`, // Twilio WhatsApp number
        to: `whatsapp:${recipientPhone}`, // recipient's WhatsApp number
      });

      console.log("WhatsApp Message Sent Successfully!");
    } catch (error) {
      console.error("Error sending WhatsApp message:", error);
    }
  });
