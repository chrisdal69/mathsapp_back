const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../middlewares/auth");
const User = require("../models/users");

router.get("/profile", authenticate, (req, res) => {
  res.json({ message: "Profil utilisateur", user: req.user });
});

// Exemple réservé aux admins
router.delete("/:id", authenticate, authorize("admin"), async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  res.json({ message: "Utilisateur supprimé" });
});

module.exports = router;
