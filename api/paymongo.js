import express from "express";
import axios from "axios";
import cors from "cors";
import admin from "firebase-admin";

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

  await admin
    .database()
    .ref(`users/${event.metadata.userId}/coins`)
    .transaction((cur) => (cur || 0) + parseInt(event.metadata.coins));

  return res.status(200).send("Coins credited");
});

export default router;
