// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const speakeasy = require("speakeasy");

const User = require("./models/User");
const FormData = require("./models/FormData");

const app = express();
app.use(express.json());
app.use(cors({ origin: "http://localhost:3000" })); // allow Next dev server

const MONGO_URI = process.env.MONGO_URI;
const PORT = process.env.PORT || 4000;
const HARDCODED_EMAIL = process.env.HARDCODED_EMAIL;

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });

app.post("/log-entry", async (req, res) => {
  try {
    const { distance, fromPlaces, toPlaces, date, token } = req.body ; 
    if (!distance || !fromPlaces || !toPlaces || !date || !token) { 
      return res.status(400).json({ message: "Few Missing fields" });
    }

    // get the hardcoded user
    const user = await User.findOne({ email: HARDCODED_EMAIL });
    if (!user || !user.twoFASecret) {
      return res
        .status(500)
        .json({ message: "User not configured with 2FA secret" });
    }

    // verify the 6-digit token with speakeasy
    const valid = speakeasy.totp.verify({
      secret: user.twoFASecret,
      encoding: "base32",
      token,
      window: 1 // allow +/-1 timestep
    });

    if (!valid) {
      return res
        .status(401)
        .json({ message: "Invalid Google Authenticator code" });
    }

    // save the form data
    const doc = new FormData({
      user: user._id,
      distance: Number(distance),
      fromPlaces,
      toPlaces,
      date: new Date(date)
    });
    await doc.save();

    return res.json({ success: true, message: "Form data saved." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
