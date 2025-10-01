// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const speakeasy = require("speakeasy");
const ExcelJS = require("exceljs");

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
    const { distance, fromPlaces, toPlaces, date, token } = req.body;
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
    // normalize provided date to day-range
    const providedDate = new Date(date);
    if (Number.isNaN(providedDate.getTime())) {
      return res.status(400).json({ message: "Invalid date" });
    }
    const startOfDay = new Date(providedDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(providedDate);
    endOfDay.setHours(23, 59, 59, 999);

    // do not allow duplicate entries for same date (same calendar day)
    const existingForDay = await FormData.findOne({
      user: user._id,
      date: { $gte: startOfDay, $lte: endOfDay }
    }).lean();

    if (existingForDay) {
      return res
        .status(409)
        .json({ message: "Entry for this date already exists" });
    }

    // save the form data
    const doc = new FormData({
      user: user._id,
      distance: Number(distance),
      fromPlaces,
      toPlaces,
      date: startOfDay // store normalized to start of day
    });
    await doc.save();

    return res.json({ success: true, message: "Form data saved." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

app.post("/export-log", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ message: "Missing token" });
    }

    const user = await User.findOne({ email: HARDCODED_EMAIL });
    if (!user || !user.twoFASecret) {
      return res
        .status(500)
        .json({ message: "User not configured with 2FA secret" });
    }

    const valid = speakeasy.totp.verify({
      secret: user.twoFASecret,
      encoding: "base32",
      token,
      window: 1
    });

    if (!valid) {
      return res
        .status(401)
        .json({ message: "Invalid Google Authenticator code" });
    }

    // Build date range for current month (1..min(today,lastDayOfMonth))
    const today = new Date();
    const targetYear = today.getFullYear();
    const targetMonth = today.getMonth(); // 0-indexed
    const lastDayOfMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
    const endDay = Math.min(today.getDate(), lastDayOfMonth); // 1 .. endDay inclusive
    const startDate = new Date(targetYear, targetMonth, 1, 0, 0, 0, 0);
    const endDate = new Date(targetYear, targetMonth, endDay, 23, 59, 59, 999);

    // fetch only current-month entries, sorted by date (ascending)
    const currentMonthEntries = await FormData.find({
      user: user._id,
      date: { $gte: startDate, $lte: endDate }
    })
      .sort({ date: 1 })
      .lean();

    // find the latest entry strictly before the month start to seed previousEnding
    const prevEntryBeforeStart = await FormData.findOne({
      user: user._id,
      date: { $lt: startDate }
    })
      .sort({ date: -1 })
      .lean();

    let previousEnding = prevEntryBeforeStart
      ? Number(prevEntryBeforeStart.distance ?? "")
      : null;

    // map entries by date key YYYY-MM-DD for the target month
    const entryMap = new Map();
    for (const e of currentMonthEntries) {
      if (!e.date) continue;
      const dt = new Date(e.date);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(
        2,
        "0"
      )}-${String(dt.getDate()).padStart(2, "0")}`;
      entryMap.set(key, e);
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("FormData", {
      views: [{ state: "frozen", ySplit: 1 }]
    });

    sheet.columns = [
      { header: "DATE OF JOURNEY", key: "date", width: 35 },
      { header: "FROM", key: "from", width: 40 },
      { header: "DESTINATION", key: "to", width: 60 },
      { header: "STARTING METER\nREADING", key: "startMeter", width: 18 },
      { header: "ENDING METER\nREADING", key: "endMeter", width: 18 }
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.alignment = {
      vertical: "middle",
      horizontal: "center",
      wrapText: true
    };
    sheet.properties.defaultRowHeight = 20;

    const formatShortDate = (d) => {
      if (!d) return "";
      const dt = new Date(d);
      if (Number.isNaN(dt.getTime())) return "";
      const day = dt.getDate();
      const month = dt.toLocaleString("en-US", { month: "short" });
      const yy = String(dt.getFullYear()).slice(-2);
      return `${day}-${month}-${yy}`;
    };

    // iterate each day of current month (1..endDay)
    for (let day = 1; day <= endDay; day++) {
      const currentDate = new Date(targetYear, targetMonth, day);
      const key = `${currentDate.getFullYear()}-${String(
        currentDate.getMonth() + 1
      ).padStart(2, "0")}-${String(currentDate.getDate()).padStart(2, "0")}`;

      const entry = entryMap.get(key);
      const startingMeter = previousEnding !== null ? previousEnding : "";
      let endingMeter = null;
      let docId = "";

      if (entry) {
        endingMeter = entry.distance ?? "";
        docId = entry._id?.toString?.() ?? "";
      } else {
        // fill missing day with previous day's ending (no change)
        endingMeter = previousEnding !== null ? previousEnding : "";
      }

      // push row
      sheet.addRow({
        date: formatShortDate(currentDate),
        from: entry
          ? Array.isArray(entry.fromPlaces)
            ? entry.fromPlaces.join(", ")
            : entry.fromPlaces ?? ""
          : "",
        to: entry
          ? Array.isArray(entry.toPlaces)
            ? entry.toPlaces.join(", ")
            : entry.toPlaces ?? ""
          : "",
        startMeter: startingMeter,
        endMeter: endingMeter,
        _id: docId
      });

      // update previousEnding for next iteration
      previousEnding =
        endingMeter === ""
          ? previousEnding
          : endingMeter !== null
          ? Number(endingMeter)
          : previousEnding;
    }

    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" }
        };
        if (["from", "to", "_id"].includes(cell._column?.key)) {
          cell.alignment = {
            horizontal: "left",
            vertical: "middle",
            wrapText: true
          };
        } else {
          cell.alignment = { horizontal: "center", vertical: "middle" };
        }
      });
    });

    // set response headers for download
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="form-data.xlsx"`
    );

    // write workbook to response stream
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
