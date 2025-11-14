var express = require("express");
var router = express.Router();
const path = require("path");
const { Storage } = require("@google-cloud/storage");
const { authenticate, authorize, verifyToken } = require("../middlewares/auth");
const Card = require("../models/cards");



router.get("/:param", async (req, res) => {
  try {
    const allowedParents = ["ciel1", "python"];
    const repertoire = String(req.params.param || "").trim().toLowerCase();

    if (!allowedParents.includes(repertoire)) {
      return res.status(403).json({ error: "Repertoire non autorisé." });
    }

    const result = await Card.find({ repertoire }).lean().exec();
    if (!result.length) {
      return res.status(404).json({ error: "Aucune carte trouvée." });
    }

    res.json({ result });
  } catch (err) {
    console.error("GET /cards/:param", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
});




module.exports = router;