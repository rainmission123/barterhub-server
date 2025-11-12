const express = require("express");
const cors = require("cors");
const paymongo = require("./api/paymongo.js");

const app = express();
app.use(cors());

// ✅ IMPORTANT: mount paymongo FIRST (to allow express.raw() on webhook)
app.use("/paymongo", paymongo);

// ✅ After webhook route, parse JSON normally
app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).json({ message: "✅ BarterHub backend is running!" });
});

// ✅ ADD HEALTH ENDPOINT - para di makatulog ang server
app.get("/health", (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    message: 'Server is awake and healthy!'
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
