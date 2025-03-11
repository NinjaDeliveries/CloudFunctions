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

    // Fetch the user document from "users" collection using orderData.orderedBy
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

    // Construct the WhatsApp message with the fetched contact number
    const message = `🛒 *New Order Placed!*\n\n📦 *Order ID:* ${orderId}\n\n💰 *Contact Number:* ${contactNumber}`;

    try {
      await client.messages.create({
        body: message,
        from: `whatsapp:${twilioWhatsAppNumber}`, // Your Twilio WhatsApp number
        to: `whatsapp:${recipientPhone}`, // The recipient's WhatsApp number
      });

      console.log("WhatsApp Message Sent Successfully!");
    } catch (error) {
      console.error("Error sending WhatsApp message:", error);
    }
  });

const { jsPDF } = require("jspdf");
require("jspdf-autotable"); // extend jsPDF with autoTable
const nodemailer = require("nodemailer");

const fetch = require("node-fetch");

exports.generateWeeklyReport = functions.pubsub
  .schedule("5 0 * * 1") //Monday 00:05
  .timeZone("Asia/Kolkata") // Set to your desired time zone
  .onRun(async (context) => {
    try {
      const firestore = admin.firestore();

      // Calculate last week's date range (previous 7 days)
      const today = new Date();
      const endOfLastWeek = new Date(today);
      endOfLastWeek.setDate(today.getDate() - 1); // Yesterday
      const startOfLastWeek = new Date(endOfLastWeek);
      startOfLastWeek.setDate(endOfLastWeek.getDate() - 6); // 7-day range

      // Fetch orders with status "tripEnded" from last week
      const ordersSnapshot = await firestore
        .collection("orders")
        .where("status", "==", "tripEnded")
        .where(
          "createdAt",
          ">=",
          admin.firestore.Timestamp.fromDate(startOfLastWeek)
        )
        .where(
          "createdAt",
          "<=",
          admin.firestore.Timestamp.fromDate(endOfLastWeek)
        )
        .get();

      // Aggregate items and collect unique product IDs
      const itemsMap = new Map();
      const productIds = new Set();
      ordersSnapshot.forEach((doc) => {
        const order = doc.data();
        if (order.items && Array.isArray(order.items)) {
          order.items.forEach((item) => {
            productIds.add(item.productId);
            const key = item.productId;
            if (itemsMap.has(key)) {
              const existing = itemsMap.get(key);
              itemsMap.set(key, {
                ...existing,
                quantity: existing.quantity + item.quantity,
              });
            } else {
              itemsMap.set(key, {
                productId: item.productId,
                quantity: item.quantity,
              });
            }
          });
        }
      });

      // Fetch product details (assumes productIds.length <= 10 for an "in" query)
      let productsSnapshot;
      if (productIds.size > 0) {
        productsSnapshot = await firestore
          .collection("products")
          .where(
            admin.firestore.FieldPath.documentId(),
            "in",
            Array.from(productIds)
          )
          .get();
      } else {
        productsSnapshot = { docs: [] };
      }

      const productsMap = new Map();
      productsSnapshot.docs.forEach((doc) => {
        productsMap.set(doc.id, doc.data());
      });

      // Combine item data with product details
      const itemsArray = Array.from(itemsMap.values()).map((item) => ({
        ...item,
        name: productsMap.get(item.productId)?.name || "Unknown",
        image: productsMap.get(item.productId)?.image || "",
      }));

      // Sort items by quantity sold in descending order and take top 3
      itemsArray.sort((a, b) => b.quantity - a.quantity);
      const topSoldItems = itemsArray.slice(0, 3);

      // Preload images as base64 strings using node-fetch
      const imagesBase64 = await Promise.all(
        topSoldItems.map(async (item) => {
          if (item.image) {
            try {
              const response = await fetch(item.image);
              const buffer = await response.buffer();
              return buffer.toString("base64");
            } catch (err) {
              console.error(
                "Error fetching image for product",
                item.productId,
                err
              );
              return null;
            }
          }
          return null;
        })
      );

      // Generate the PDF using jsPDF and autoTable
      const pdfDoc = new jsPDF();
      pdfDoc.setFontSize(22);
      pdfDoc.text("Ninja Deliveries", 10, 20);
      pdfDoc.setFontSize(16);
      pdfDoc.text("Top 3 Most Sold Items (Last Week):", 10, 40);

      // Prepare table data with an extra column for image
      const tableData = topSoldItems.map((item, index) => [
        index + 1,
        item.name,
        "", // Placeholder for the image
        item.quantity,
      ]);

      pdfDoc.autoTable({
        startY: 50,
        head: [["Rank", "Item Name", "Image", "Quantity Sold"]],
        body: tableData,
        styles: { cellPadding: 10, minCellHeight: 30 },
        didDrawCell: (data) => {
          // For cells in the "Image" column (index 2) in the table body:
          if (data.column.index === 2 && data.cell.section === "body") {
            const imageBase64 = imagesBase64[data.row.index];
            if (imageBase64) {
              // Add the image; adjust x, y, width, and height as needed
              pdfDoc.addImage(
                `data:image/jpeg;base64,${imageBase64}`,
                "JPEG",
                data.cell.x + 2,
                data.cell.y + 2,
                20,
                20
              );
            }
          }
        },
      });

      // (Total Units Sold text has been removed)

      // Create a buffer from the PDF
      const pdfBuffer = Buffer.from(pdfDoc.output("arraybuffer"));

      // Upload the PDF to Firebase Storage
      const bucket = admin.storage().bucket();
      const fileName = `reports/last_week_report_${Date.now()}.pdf`;
      const file = bucket.file(fileName);
      await file.save(pdfBuffer, { contentType: "application/pdf" });
      console.log("PDF uploaded to:", fileName);

      // Optionally, record the report in Firestore
      await firestore.collection("reports").add({
        filePath: fileName,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Set up Nodemailer with Gmail credentials
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: functions.config().email.user,
          pass: functions.config().email.pass,
        },
      });

      // Download the PDF back from storage for attaching in the email
      const [downloadedBuffer] = await file.download();

      const mailOptions = {
        from: "deliveriesninja@gmail.com",
        to: "suryanshchoudhary44@gmail.com",
        subject: "Weekly Sales Report",
        text: "Last Week Sales Report",
        attachments: [
          {
            filename: "weekly_report.pdf",
            content: downloadedBuffer,
          },
        ],
      };

      await transporter.sendMail(mailOptions);
      console.log("Email sent successfully.");

      return null;
    } catch (error) {
      console.error("Error generating weekly report:", error);
      throw error;
    }
  });
