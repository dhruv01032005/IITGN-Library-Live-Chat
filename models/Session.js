const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  sessionId: String,
  user: {
    id: String,
    name: String,
    email: String
  },
  librarian: {
    id: String,
    name: String,
    email: String
  },
  startTime: {
    type: Date,
    default: Date.now
  },
  endTime: Date,
  status: {
    type: String,
    enum: ['active', 'ended'],
    default: 'active'
  }
});

module.exports = mongoose.model('Session', sessionSchema);