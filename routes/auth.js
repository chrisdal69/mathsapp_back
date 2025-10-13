const express = require("express");
var router = express.Router();
const jwt = require("jsonwebtoken");
const yup = require("yup");
const User = require("../models/users");
const bcrypt = require("bcrypt");
const nodemailer = require("nodemailer");

/* DEBUT SIGNUP */
// VERIFICATION DONNEE RECUES
const signupSchema = yup.object().shape({
  nom: yup
    .string()
    .trim()
    .min(2, "Le nom doit contenir au moins 2 caractères")
    .required("Le nom est obligatoire"),
  prenom: yup
    .string()
    .trim()
    .min(2, "Le prénom doit contenir au moins 2 caractères")
    .required("Le prénom est obligatoire"),
  email: yup
    .string()
    .trim()
    .email("Adresse email invalide")
    .required("L'email est obligatoire"),
  password: yup
    .string()
    .min(8, "8 caractères minimum")
    .matches(/[A-Z]/, "Une majuscule est requise")
    .matches(/[a-z]/, "Une minuscule est requise")
    .matches(/[0-9]/, "Un chiffre est requis")
    .matches(/[^A-Za-z0-9]/, "Un caractère spécial est requis")
    .required("Mot de passe obligatoire"),
  confirmPassword: yup
    .string()
    .oneOf(
      [yup.ref("password"), null],
      "Les mots de passe ne correspondent pas"
    )
    .required("Confirmez votre mot de passe"),
});
const verifmailSchema = yup.object().shape({
  email: yup
    .string()
    .trim()
    .email("Adresse email invalide")
    .required("L'email est obligatoire"),
  code: yup
    .string()
    .required("Le code est obligatoire")
    .length(4, "Le code doit contenir exactement 4 caractères")
    .matches(
      /^[A-Z0-9]{4}$/,
      "Le code doit contenir uniquement des lettres majuscules et/ou des chiffres"
    ),
});
// DONNEE POUR ENVOI EMAIL
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_SEND_PASS,
  },
});
function generateCode(length = 4) {
  const chars = "ABCDEFGHIJKLMNPQRSTUVWXYZ123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

router.post("/signup", async (req, res) => {
  let { nom, prenom, email, password, confirmPassword } = req.body;
  nom = nom.toUpperCase().trim();
  prenom = prenom.toLowerCase().trim();
  try {
    // 1️⃣ Validation des données avec Yup
    await signupSchema.validate(
      { nom, prenom, email, password, confirmPassword },
      { abortEarly: false } // pour obtenir toutes les erreurs à la fois
    );

    // 2️⃣ Vérification si l'utilisateur existe déjà par l'email et par le nom, prenom
    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      return res.status(400).json({ error: "Cet email est déjà utilisé" });
    }
    const existingUser = await User.findOne({ nom, prenom });
    if (existingUser) {
      return res
        .status(400)
        .json({ error: `L'utilisateur ${nom} ${prenom} est déjà inscrit` });
    }

    // 3️⃣ Validation de l'adresse email récupérée
    const codeAlea = generateCode();
    const hashedCode = await bcrypt.hash(codeAlea, 10); // hash du code avant stockage

    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: email,
      subject: "Inscription MathsApp - Vérification de l’email",
      text: `Bonjour ${prenom},\n\nVotre code de vérification est : ${codeAlea}\n\nCe code expire dans 10 minutes.`,
    };
    const info = await transporter.sendMail(mailOptions);

    // 3️⃣ Hash du mot de passe
    const hashedPassword = await bcrypt.hash(password, 10);

    // 4️⃣ Création de l’utilisateur dans la BDD Mongoose
    const newUser = new User({
      nom,
      prenom,
      email,
      password: hashedPassword,
      confirm: hashedCode,
      confirmExpires: new Date(Date.now() + 10 * 60 * 1000), // 10 min
    });
    const newDoc = await newUser.save();
    console.log(newDoc);

    // 5️⃣ Réponse OK
    return res
      .status(201)
      .json({ sendMail: true, email, infoMail: info.messageId });
  } catch (error) {
    // Gestion des erreurs de validation Yup
    if (error.name === "ValidationError") {
      const validationErrors = error.inner.map((err) => ({
        field: err.path,
        message: err.message,
      }));
      return res.status(400).json({ errors: validationErrors });
    }
    console.error("Erreur lors de l'inscription :", error);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

router.post("/verifmail", async (req, res) => {
  const { email, code } = req.body;
  try {
    // 1️⃣ Validation des données avec Yup
    await verifmailSchema.validate(
      { email, code },
      { abortEarly: false } // pour obtenir toutes les erreurs à la fois
    );

    // 2️⃣ Lecture du code dans la bdd Mongoose
    const user = await User.findOne({ email });
    if (!user) {
      return res
        .status(400)
        .json({ error: "Aucun compte trouvé pour cet email." });
    }

    // ⚠️ Vérifie si déjà vérifié
    if (user.isVerified) {
      return res.status(400).json({ error: "Ce compte est déjà vérifié." });
    }

    // ⏳ Vérifie expiration du code
    if (!user.confirmExpires || user.confirmExpires < new Date()) {
      return res
        .status(400)
        .json({ error: "Le code a expiré. Veuillez en demander un nouveau." });
    }

    // 🔑 Vérifie le code
    const isMatch = await bcrypt.compare(code, user.confirm);
    if (!isMatch) {
      return res.status(400).json({ error: "Code incorrect." });
    }

    // ✅ Active le compte
    await User.updateOne(
      { email },
      {
        $set: { isVerified: true },
        $unset: { confirm: "", confirmExpires: "" },
      }
    );
    return res
      .status(200)
      .json({ success: true, message: "Email vérifié avec succès." });
  } catch (error) {
    // Gestion des erreurs de validation Yup
    if (error.name === "ValidationError") {
      const validationErrors = error.inner.map((err) => ({
        field: err.path,
        message: err.message,
      }));
      return res.status(400).json({ errors: validationErrors });
    }
    console.error("Erreur lors de l'inscription :", error);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

router.post("/resend-code", async (req, res) => {
  const { email } = req.body;

  try {
    // 1️⃣ Vérifie que l’email est fourni
    if (!email) {
      return res.status(400).json({ error: "L'adresse email est requise." });
    }

    // 2️⃣ Recherche de l’utilisateur
    const user = await User.findOne({ email });
    if (!user) {
      return res
        .status(400)
        .json({ error: "Aucun compte trouvé avec cet email." });
    }

    // 3️⃣ Vérifie si déjà vérifié
    if (user.isVerified) {
      return res.status(400).json({ error: "Ce compte est déjà vérifié." });
    }

    // 4️⃣ Génère un nouveau code
    const newCode = generateCode();
    const hashedCode = await bcrypt.hash(newCode, 10);
    const newExpire = new Date(Date.now() + 10 * 60 * 1000); // expire dans 10 min

    // 5️⃣ Met à jour le code dans la base
    await User.updateOne(
      { email },
      { $set: { confirm: hashedCode, confirmExpires: newExpire } }
    );

    // 6️⃣ Envoie du nouveau mail
    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: email,
      subject: "Nouveau code de vérification - MathsApp",
      text: `Bonjour,\n\nVoici votre nouveau code de vérification : ${newCode}\nCe code expire dans 10 minutes.`,
    };
    await transporter.sendMail(mailOptions);

    return res.status(200).json({
      resend: true,
      message: "Un nouveau code a été envoyé par email.",
    });
  } catch (error) {
    console.error("Erreur lors du renvoi du code :", error);
    return res.status(500).json({ error: "Erreur interne du serveur." });
  }
});

/* FIN SIGNUP */
/************************************************************************* */
/* DEBUT LOGIN */
const loginSchema = yup.object().shape({
  email: yup
    .string()
    .trim()
    .email("Adresse email invalide")
    .required("L'email est obligatoire"),
  password: yup
    .string()
    .min(8, "8 caractères minimum")
    .matches(/[A-Z]/, "Une majuscule est requise")
    .matches(/[a-z]/, "Une minuscule est requise")
    .matches(/[0-9]/, "Un chiffre est requis")
    .matches(/[^A-Za-z0-9]/, "Un caractère spécial est requis")
    .required("Mot de passe obligatoire"),
});
router.post("/login", async (req, res) => {
  let { email, password } = req.body;
  try {
    // 1- Validation des données avec Yup
    await loginSchema.validate(
      { email, password },
      { abortEarly: false } // pour obtenir toutes les erreurs à la fois
    );
    // 2- Recherche dans la base de données de l'utilisateur et validation pass
    const data = await User.findOne({ email });
    if (
      !data ||
      !bcrypt.compareSync(password, data.password) ||
      !data.isVerified
    ) {
      return res.status(401).json({ message: "Compte non vérifié" });
    }
    // 3. Génère le JWT access et l'envoie dans un cookie httpOnly
    const accessToken = jwt.sign(
      { userId: data._id, email: data.email, role: data.role }, // 👈 ajout du rôle
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: "15m" }
    );

    res.cookie("jwt", accessToken, {
      httpOnly: true, // Le cookie n'est pas accessible via JavaScript
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      // pas de maxAge => cookie supprimé à la fermeture de l'onglet
    });

    // 3. Génère le JWT refresh et l'envoie dans un cookie httpOnly
    const refreshToken = jwt.sign(
      { userId: data._id, email: data.email },
      process.env.REFRESH_TOKEN_SECRET,
      { expiresIn: "4h" }
    );
    // 🔑 Enregistrement du refreshToken en base
    data.refreshToken = refreshToken;
    await data.save();

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 4 * 60 * 60 * 1000, // 4 heures
    });

    return res.json({ message: "Connexion réussie" });
  } catch (error) {
    // Gestion des erreurs de validation Yup
    if (error.name === "ValidationError") {
      const validationErrors = error.inner.map((err) => ({
        field: err.path,
        message: err.message,
      }));
      return res.status(400).json({ errors: validationErrors });
    }
    console.error("Erreur lors de la connexion :", error);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

/* FIN LOGIN */
/************************************************************************* */
/* DEBUT LOGOUT */
router.post("/logout", async (req, res) => {
  const { refreshToken } = req.cookies;
  if (refreshToken) {
    // Supprimer le refreshToken de la base
    await User.updateOne({ refreshToken }, { $unset: { refreshToken: "" } });
  }
  // Supprimer les cookies
  res.clearCookie("jwt");
  res.clearCookie("refreshToken");
  return res.json({ message: "Déconnexion réussie" });
});

/* FIN LOGOUT */
/************************************************************************* */

/* DEBUT REFRESH */
router.post("/refresh", async (req, res) => {
  const { refreshToken } = req.cookies;
  if (!refreshToken) {
    return res.status(401).json({ message: "Refresh token manquant" });
  }

  try {
    // 1- Vérifie si ce refreshToken existe en base
    const data = await User.findOne({ refreshToken });
    if (!data) {
      return res.status(403).json({ message: "Refresh token invalide" });
    }

    // 2- Vérifie le refresh token JWT
    const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);

    // 3- Génère un nouveau accessToken


 const newAccessToken = jwt.sign(
    { userId: decoded.userId, email: decoded.email, role: data.role },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: "15m" }
  );


    // 4- Met à jour le cookie
    res.cookie("jwt", newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    });

    res.json({ result: true, message: "Token rafraîchi" });
  } catch (err) {
    // Token invalide → déconnexion
    res.clearCookie("jwt");
    res.clearCookie("refreshToken");

    // Supprime en base si jamais il était stocké
    await User.updateOne({ refreshToken }, { $unset: { refreshToken: "" } });

    return res.status(401).json({ message: "Session expirée" });
  }
});

/* FIN REFRESH */
/************************************************************************* */

module.exports = router;
