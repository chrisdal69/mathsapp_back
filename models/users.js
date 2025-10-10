const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  nom: String,
  prenom: String,
  email: { type: String, unique: true },
  password: String,
  date: { type: Date, default: Date.now },
  isVerified: { type: Boolean, default: false },
  confirm: String, // code hashé
  confirmExpires: Date,
  refreshToken: { type: String, default: null },
  role: { type: String, enum: ["user", "admin", "superadmin"], default: "user" }
});

module.exports = mongoose.model("User", userSchema);
