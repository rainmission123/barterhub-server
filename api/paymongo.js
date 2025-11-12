const express = require("express");
const axios = require("axios");
const cors = require("cors");
const admin = require("firebase-admin");

const router = express.Router(); 
router.use(cors());

const fs = require("fs");

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(
    fs.readFileSync("/etc/secrets/firebase-service-account.json", "utf8")
  );

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://barterhub-3c947-default-rtdb.firebaseio.com"
  });
}

// ✅ CHECKOUT ROUTE
router.post("/", express.json(), async (req, res) => {
  const { amount, paymentMethod, userId, coins, currency } = req.body;

  console.log("🛒 Creating checkout session:", { amount, userId, coins });

  // Quick validation
  if (!amount || !userId || !coins) {
    return res.status(400).json({ 
      error: "Missing required fields: amount, userId, coins" 
    });
  }

  try {
    const response = await axios.post(
      "https://api.paymongo.com/v1/checkout_sessions",
      {
        data: {
          attributes: {
            amount: amount,
            payment_method_types: ["gcash", "grab_pay"],
            description: `Buy ${coins} Coins - BarterHub PH`,
            line_items: [
              {
                amount: amount,
                currency: currency || "PHP",
                name: "Coins Purchase",
                quantity: 1
              }
            ],
            metadata: { userId, coins }
          }
        }
      },
      {
        auth: { 
          username: process.env.PAYMONGO_SECRET, 
          password: "" 
        },
        timeout: 30000
      }
    );

    console.log("✅ Checkout session created");
    return res.json({
      checkout_url: response.data.data.attributes.checkout_url
    });

  } catch (err) {
    console.error("❌ PayMongo API error:", err.response?.data ?? err.message);
    res.status(500).json({ 
      error: "Payment gateway error",
      details: err.message 
    });
  }
});

// ✅ MANUAL COIN ADD ROUTE (NEW)
router.post("/manual-add-coins", express.json(), async (req, res) => {
  const { userId, coins } = req.body;
  
  console.log(`🔄 Manual coin add: ${coins} coins for user ${userId}`);
  
  if (!userId || !coins) {
    return res.status(400).json({ error: "Missing userId or coins" });
  }

  try {
    // 1️⃣ Update user coins
    const userRef = admin.database().ref(`users/${userId}/coins`);
    const currentSnapshot = await userRef.once('value');
    const currentCoins = currentSnapshot.val() || 0;
    const newCoins = currentCoins + parseInt(coins);
    
    await userRef.set(newCoins);

    // 2️⃣ Record coin transaction
    await admin.database().ref(`coin_transactions/${userId}`).push({
      coins: parseInt(coins),
      amount: parseInt(coins) * 100, // Assuming 1 coin = ₱1.00
      type: "manual_add",
      status: "completed",
      paymentMethod: "manual",
      timestamp: Date.now()
    });

    console.log(`✅ Manual coins added: ${coins} coins to user ${userId}`);
    console.log(`💰 Coin balance: ${currentCoins} → ${newCoins}`);
    
    res.json({ 
      success: true, 
      message: `${coins} coins added successfully`,
      previous_balance: currentCoins,
      new_balance: newCoins
    });
    
  } catch (error) {
    console.error("❌ Manual coins error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ CHECK COINS ROUTE (NEW)
router.get("/check-coins/:userId", async (req, res) => {
  const userId = req.params.userId;
  
  try {
    const userRef = admin.database().ref(`users/${userId}`);
    const snapshot = await userRef.once('value');
    const userData = snapshot.val();
    
    console.log("💰 Current coins for user:", userId, userData?.coins);
    
    res.json({ 
      userId: userId,
      coins: userData?.coins || 0,
      userData: userData
    });
  } catch (error) {
    console.error("Check coins error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ WEBHOOK ROUTE
router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const crypto = require("crypto");
  const rawBody = req.body.toString();
  const signature = req.headers["paymongo-signature"];

  console.log("🔄 Webhook received - Raw body:", rawBody);
  console.log("Signature:", signature);

  const webhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET;
  
  console.log(`🔍 Webhook verification details:`);
  console.log(`- Webhook Secret: ${webhookSecret ? 'SET' : 'NOT SET'}`);

  if (!signature) {
    console.log('❌ No signature provided');
    return res.status(401).send("Unauthorized");
  }

  if (!webhookSecret) {
    console.log('❌ Webhook secret not configured');
    return res.status(500).send("Webhook secret not configured");
  }

  // Parse the signature (new PayMongo format)
  const signatureParts = signature.split(',');
  const timestamp = signatureParts.find(part => part.startsWith('t='))?.split('=')[1];
  const receivedSignature = signatureParts.find(part => part.startsWith('te='))?.split('=')[1];
  
  if (!timestamp || !receivedSignature) {
    console.log('❌ Invalid signature format');
    return res.status(401).send("Unauthorized");
  }

  // Verify the signature
  const payload = `${timestamp}.${rawBody}`;
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(payload)
    .digest('hex');

  console.log(`🔐 Signature verification:`);
  console.log(`- Received: ${receivedSignature}`);
  console.log(`- Expected: ${expectedSignature}`);

  if (receivedSignature !== expectedSignature) {
    console.log('❌ Webhook signature mismatch');
    return res.status(401).send("Unauthorized");
  }

  console.log('✅ Webhook verified successfully');

  let webhookPayload;
  try {
    webhookPayload = JSON.parse(rawBody);
  } catch (err) {
    console.error("❌ Invalid JSON payload:", err);
    return res.status(400).send("Invalid JSON");
  }

  try {
    const data = webhookPayload.data;
    const payment = data.attributes;

    // Extract from nested structure for payment.paid events
    let userId, coins, amount;
    
    if (data.attributes.type === 'payment.paid') {
      // For payment.paid events, data is nested
      userId = data.attributes.data.attributes.metadata?.userId;
      coins = parseInt(data.attributes.data.attributes.metadata?.coins || 0);
      amount = data.attributes.data.attributes.amount ? data.attributes.data.attributes.amount / 100 : 0;
    } else {
      // For other event types
      userId = payment.metadata?.userId;
      coins = parseInt(payment.metadata?.coins || 0);
      amount = payment.amount ? payment.amount / 100 : 0;
    }

    console.log(`🎯 Event: ${data.attributes.type}`);
    console.log(`🎯 User: ${userId}, Coins: ${coins}, Amount: ${amount}`);

    if (data.attributes.type === "payment.paid" && userId && coins > 0) {
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
      console.log("⏩ Event ignored - Type:", data.attributes.type);
      return res.status(200).json({ success: true, message: "Event ignored" });
    }

  } catch (error) {
    console.error("❌ Webhook error:", error);
    return res.status(500).send("Error processing payment");
  }
});

module.exports = router;
