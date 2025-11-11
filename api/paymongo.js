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
  const signature = req.headers["paymongo-signature"];
  if (signature !== process.env.WEBHOOK_SECRET)
    return res.status(401).send("Unauthorized");

  const event = req.body.data.attributes.data.attributes;
  
  try {
    const userId = event.metadata.userId;
    const coins = parseInt(event.metadata.coins);
    const amount = event.amount / 100; // Convert to pesos

    // 1. Update user coins
    await admin.database().ref(`users/${userId}/coins`)
      .transaction((current) => (current || 0) + coins);

    // 2. Record coin transaction
    await admin.database().ref(`coin_transactions/${userId}`).push({
      coins: coins,
      amount: amount,
      type: "purchase",
      status: "completed",
      paymentMethod: "paymongo",
      timestamp: Date.now()
    });

    // ✅ 3. RECORD SA FINANCE DASHBOARD
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

    console.log(`✅ Coin purchase recorded: ${coins} coins for user ${userId}`);
    return res.status(200).send("Coins credited and transaction recorded");

  } catch (error) {
    console.error("Webhook error:", error);
    return res.status(500).send("Error processing payment");
  }
});
module.exports = router;
