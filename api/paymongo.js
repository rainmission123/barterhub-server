const express = require("express");
const axios = require("axios");
const cors = require("cors");
const admin = require("firebase-admin");

const router = express.Router();
router.use(cors());

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: "https://barterhub-3c947-default-rtdb.firebaseio.com"
  });
}

router.post("/", async (req, res) => {
  const { amount, paymentMethod, userId, coins, currency } = req.body;

  try {
    const response = await axios.post(
      "https://api.paymongo.com/v1/checkout_sessions",
      {
        data: {
          attributes: {
            amount,
            payment_method_types: ["gcash", "grab_pay"],
            description: `Buy ${coins} Coins - BarterHub PH`,
            line_items: [
              {
                amount,
                currency,
                name: "Coins Purchase",
                quantity: 1
              }
            ],
            metadata: { userId, coins }
          }
        }
      },
      {
        auth: { username: process.env.PAYMONGO_SECRET, password: "" }
      }
    );

    return res.json({
      checkout_url: response.data.data.attributes.checkout_url
    });

  } catch (err) {
    console.error(err.response?.data ?? err);
    res.status(500).json({ error: err.toString() });
  }
});

router.post("/webhook", async (req, res) => {
  console.log("🔄 Webhook received - Full body:", JSON.stringify(req.body, null, 2));
  
  const signature = req.headers["paymongo-signature"];
  console.log("Signature:", signature);
  
  if (signature !== process.env.WEBHOOK_SECRET) {
    console.log("❌ Webhook secret mismatch");
    return res.status(401).send("Unauthorized");
  }

  try {
    // DEBUG: Check the actual structure
    console.log("📦 Body keys:", Object.keys(req.body));
    
    let payload, payment;
    
    // Handle different payload structures
    if (req.body.data) {
      payload = req.body.data;
      payment = payload.attributes;
      console.log("✅ Using data.attributes structure");
    } else if (req.body.attributes) {
      payment = req.body.attributes;
      console.log("✅ Using direct attributes structure");
    } else {
      console.log("❓ Unknown payload structure:", req.body);
      return res.status(400).send("Invalid payload structure");
    }

    console.log("🎯 Payment object:", payment);

    const userId = payment.metadata?.userId;
    const coins = parseInt(payment.metadata?.coins || 0);
    const amount = payment.amount ? payment.amount / 100 : 0;

    console.log(`👤 User: ${userId}, Coins: ${coins}, Amount: ${amount}`);

    // Only process if payment is PAID and has valid data
    if (payment.status === "paid" && userId && coins > 0) {
      
      // 1️⃣ Update user coins
      await admin.database().ref(`users/${userId}/coins`)
        .transaction(current => (current || 0) + coins);

      // 2️⃣ Record coin transaction
      await admin.database().ref(`coin_transactions/${userId}`).push({
        coins: coins,
        amount: amount,
        type: "purchase",
        status: "completed",
        paymentMethod: "paymongo",
        timestamp: Date.now()
      });

      // 3️⃣ Record for finance dashboard
      await admin.database().ref("transactions").push({
        userId: userId,
        type: "cash-in",
        amount: amount,
        coins: coins,
        paymentMethod: "paymongo",
        status: "completed",
        timestamp: Date.now(),
        description: `Coin purchase - ${coins} coins`
      });

      console.log(`✅ Payment completed: ${coins} coins for user ${userId}`);
      return res.status(200).json({ success: true, message: "Coins added" });
    } else {
      console.log("⏩ Payment not processed - Status:", payment.status, "User:", userId);
      return res.status(200).json({ success: true, message: "Payment ignored" });
    }

  } catch (error) {
    console.error("❌ Webhook error:", error);
    return res.status(500).send("Error processing payment");
  }
});

module.exports = router;
