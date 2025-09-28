const mongoose = require('mongoose');

const formSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  distance: Number,
  fromPlaces: String,
  toPlaces: String,
  date: Date,
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('FormData', formSchema);
