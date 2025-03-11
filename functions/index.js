const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const twilio = require("twilio");

// Initialize Firebase Admin
admin.initializeApp();

// Twilio Credentials from Firebase Config
const accountSid = functions.config().twilio.sid;
const authToken = functions.config().twilio.token;
const twilioWhatsAppNumber = functions.config().twilio.whatsapp;

// Array of recipient phone numbers
const recipientPhones = ["+917018897425", "+918219105753", "+919882401250"]; // Add multiple numbers here

const client = twilio(accountSid, authToken);

exports.newOrderNotification = functions.firestore
  .document("orders/{orderId}")
  .onCreate(async (snapshot, context) => {
    const orderId = context.params.orderId;
    const orderData = snapshot.data();

    // Fetching contact number
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

    // Message Data
    const message = `🛒 *New Order Placed!*\n\n📦 *Order ID:* ${orderId}\n\n💰 *Contact Number:* ${contactNumber}`;

    // Send message to all recipients
    try {
      const sendMessages = recipientPhones.map((phone) =>
        client.messages.create({
          body: message,
          from: `whatsapp:${twilioWhatsAppNumber}`, // Twilio WhatsApp number
          to: `whatsapp:${phone}`, // recipient's WhatsApp number
        })
      );

      await Promise.all(sendMessages);
      console.log("WhatsApp Messages Sent Successfully!");
    } catch (error) {
      console.error("Error sending WhatsApp messages:", error);
    }
  });
