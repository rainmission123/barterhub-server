const express = require("express");
const cors = require("cors");
const paymongo = require("./api/paymongo");

const app = express();
app.use(express.json());
app.use(cors());

app.get("/", (req, res) => {
  res.status(200).json({ message: "✅ BarterHub backend is running!" });
});

// mount PayMongo routes
app.use("/paymongo", paymongo);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
