const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../middlewares/auth");
const User = require("../models/users");
const yup = require("yup");
const bcrypt = require("bcrypt");


/* DEBUT info utilisateur */
router.get("/me", authenticate, (req, res) => {
  const { email, nom, prenom, role } = req.user;
  console.log("email, nom, prenom, role : ",email, nom, prenom, role)
  res.json({ email, nom, prenom, role });
});
/* FIN info utilisateur */


/************************************************************************* */


/* DEBUT Changepassword */
const schema = yup.object().shape({
  newPassword: yup
    .string()
    .min(8, "8 caractères minimum")
    .matches(/[A-Z]/, "Une majuscule est requise")
    .matches(/[a-z]/, "Une minuscule est requise")
    .matches(/[0-9]/, "Un chiffre est requis")
    .matches(/[^A-Za-z0-9]/, "Un caractère spécial est requis")
    .required("Mot de passe obligatoire"),
});
router.post("/change-password", authenticate, async (req, res) => {
  const { newPassword } = req.body;
  console.log("etape 1 : ",newPassword);
  try {
    // Vérifie la présence du nouveau mot de passe
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: "Mot de passe invalide." });
    }
    // Validation des données avec Yup
    await schema.validate(
      { newPassword },
      { abortEarly: false } // pour obtenir toutes les erreurs à la fois
    );
    console.log("etape 2 : ",newPassword);

    // Récupère l’utilisateur connecté via req.user.userId
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: "Utilisateur introuvable." });
    }
    console.log("etape 3 : ",user);

    // Hash le nouveau mot de passe
    const hashed = await bcrypt.hash(newPassword, 10);

    //  Met à jour l’utilisateur
    user.password = hashed;
    await user.save();

    // Réponse au client
    return res.json({
      success: true,
      message: "Mot de passe changé avec succès ✅",
    });
  } catch (err) {
    if (err.name === "ValidationError") {
      const validationErrors = err.inner.map((err) => ({
        field: err.path,
        message: err.message,
      }));
      return res.status(400).json({ errors: validationErrors });
    }
    console.error("Erreur changement mot de passe :", err);
    return res.status(500).json({ error: "Erreur serveur." });
  }
});
/* FIN Changepassword */

module.exports = router;
