const express = require("express");
const multer = require("multer");
const path = require("path");
const { authenticate } = require("../middlewares/auth");

const router = express.Router();

// ⚙️ Config multer (stockage local, tu peux remplacer par S3 ou autre)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // dossier "uploads" à créer
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

// 📌 Route protégée par authenticate
router.post("/", authenticate, upload.array("fichiers", 10), (req, res) => {
  if (!req.files) {
    return res.status(400).json({ result: false, message: "Aucun fichier reçu" });
  }

  // Exemple de réponse
  const fileNames = req.files.map((f) => f.filename);

  res.json({ result: true, files: fileNames });
});

module.exports = router;
