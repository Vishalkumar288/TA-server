require('dotenv').config();
const mongoose = require('mongoose');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const User = require('../models/User');

const MONGO_URI = process.env.MONGO_URI;
const HARDCODED_EMAIL = process.env.HARDCODED_EMAIL ;

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  let user = await User.findOne({ email: HARDCODED_EMAIL });
  if (!user) {
    user = new User({ email: HARDCODED_EMAIL, name: 'Admin' });
  }

  if (!user.twoFASecret) {
    const secret = speakeasy.generateSecret({
      name: `MyApp (${HARDCODED_EMAIL})`,
      length: 20,
    });
    user.twoFASecret = secret.base32;
    await user.save();
    await qrcode.toFile('./qr.png', secret.otpauth_url);
  } else {
    console.log('Contact Admin of the App');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
