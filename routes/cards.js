var express = require("express");
var router = express.Router();
const path = require("path");
const { Storage } = require("@google-cloud/storage");
const { authenticate, authorize, verifyToken } = require("../middlewares/auth");
const Card = require("../models/cards");

router.get("/", async (req, res) => {
  try {
    const result = await Card.find().lean().exec();

    if (!result.length) {
      return res.status(404).json({ error: "Aucune carte trouvée." });
    }

    res.json({ result });
  } catch (err) {
    console.error("GET /cards", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

module.exports = router;
