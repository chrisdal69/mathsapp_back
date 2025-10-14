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
const verifmailcodeSchema = yup.object().shape({
  email: yup
    .string()
    .trim()
    .email("Adresse email invalide")
    .required("L'email est obligatoire"),
  code: yup.string().required("Le code est obligatoire"),
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
    console.log("signup : ", newDoc);

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
    await verifmailcodeSchema.validate(
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
    const isMatch = bcrypt.compareSync(code, user.confirm);
    console.log("verifmail isMatch: ", isMatch);
    if (!isMatch) {
      return res.status(400).json({ error: "Code incorrect." });
    }

    // ✅ Active le compte
    await User.updateOne(
      { email },
      {
        $set: { isVerified: true, confirm: "", confirmExpires: "" },
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
    const newHashedCode = await bcrypt.hash(newCode, 10);

    const newExpire = new Date(Date.now() + 10 * 60 * 1000); // expire dans 10 min

    // 5️⃣ Met à jour le code dans la base
    await User.updateOne(
      { email },
      { $set: { confirm: newHashedCode, confirmExpires: newExpire } }
    );
    console.log("code dans /resend-code : ", newCode);
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
  console.log("etape 1 ", email, password);
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
      return res
        .status(401)
        .json({ message: "Compte inexistant ou non vérifié" });
    }
    // 3. Génère le JWT access et l'envoie dans un cookie httpOnly

    console.log("etape 2 ", data);

    const accessToken = jwt.sign(
      {
        userId: data._id,
        email: data.email,
        nom: data.nom,
        prenom: data.prenom,
        role: data.role,
      }, // 👈 ajout du rôle
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: "1h" }
    );
    console.log("etape 3 ");

    res.cookie("jwt", accessToken, {
      httpOnly: true, // Le cookie n'est pas accessible via JavaScript
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      // pas de maxAge => cookie supprimé à la fermeture de l'onglet
    });

    return res.json({
      message: "Connexion réussie",
      email: data.email,
      nom: data.nom,
      prenom: data.prenom,
    });
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
  res.clearCookie("jwt");
  return res.json({ message: "Déconnexion réussie" });
});

/* FIN LOGOUT */
/************************************************************************* */

/* DEBUT FORGOT */
const verifmailSchema = yup.object().shape({
  email: yup
    .string()
    .trim()
    .email("Adresse email invalide")
    .required("L'email est obligatoire"),
});
const verifmailcodepassSchema = yup.object().shape({
  email: yup
    .string()
    .trim()
    .email("Adresse email invalide")
    .required("L'email est obligatoire"),
  newPassword: yup
    .string()
    .min(8, "8 caractères minimum")
    .matches(/[A-Z]/, "Une majuscule est requise")
    .matches(/[a-z]/, "Une minuscule est requise")
    .matches(/[0-9]/, "Un chiffre est requis")
    .matches(/[^A-Za-z0-9]/, "Un caractère spécial est requis")
    .required("Mot de passe obligatoire"),
  code: yup.string().required("Le code est obligatoire"),
});
router.post("/forgot", async (req, res) => {
  const { email } = req.body;
  try {
    // 1️⃣ Validation des données avec Yup
    await verifmailSchema.validate(
      { email },
      { abortEarly: false } // pour obtenir toutes les erreurs à la fois
    );

    // 2️⃣ Vérification si cet email existe bien
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: "Cet email n'est pas connu" });
    }
    if (!user.isVerified) {
      return res
        .status(400)
        .json({ error: "Ce compte n’a pas encore été vérifié." });
    }
    // 3️⃣ Envoi d'un code de validation
    const codeAlea = generateCode();
    const hashedCode = await bcrypt.hash(codeAlea, 10); // hash du code avant stockage
    const prenom = user.prenom;
    await User.updateOne(
      { email },
      {
        $set: {
          confirm: hashedCode,
          confirmExpires: new Date(Date.now() + 10 * 60 * 1000), // expire dans 10 min
        },
      }
    );
    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: email,
      subject: "MathsApp - Réinitialisation du mot de passe",
      text: `Bonjour ${prenom},\n\nVotre code de réinitialisation est : ${codeAlea}\n\nCe code expire dans 10 minutes.`,
    };
    const info = await transporter.sendMail(mailOptions);

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

router.post("/resend-forgot", async (req, res) => {
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
    if (!user.isVerified) {
      return res
        .status(400)
        .json({ error: "Ce compte n'a pas été vérifié à l'inscription." });
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

router.post("/reset-password", async (req, res) => {
  const { email, code, newPassword } = req.body;
  try {
    // 1️⃣ Validation des données avec Yup
    await verifmailcodepassSchema.validate(
      { email, code, newPassword },
      { abortEarly: false } // pour obtenir toutes les erreurs à la fois
    );

    // 2️⃣ Lecture du code dans la bdd Mongoose
    const user = await User.findOne({ email });
    if (!user) {
      return res
        .status(400)
        .json({ error: "Aucun compte trouvé pour cet email." });
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
      return res
        .status(400)
        .json({ error: "Code incorrect : Retour et réessayer !" });
    }
    // ✅ Active le compte
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await User.updateOne(
      { email },
      {
        $set: {
          password: hashedPassword,
          confirm: "",
          confirmExpires: "",
        },
      }
    );
    return res.status(200).json({
      success: true,
      message: "Mot de passe mis à jour avec succès.",
    });
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

/* FIN FORGOT */
/************************************************************************* */
/* Route pour verif cookies (non utilisé) */
router.get("/me", async (req, res) => {
  try {
    const token = req.cookies.jwt;
    if (!token) return res.status(401).json({ error: "Non authentifié" });

    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const { email, nom, prenom, role } = decoded;
    res.json({ user: { email, nom, prenom, role } });
  } catch (err) {
    res.status(403).json({ error: "Token invalide ou expiré" });
  }
});

module.exports = router;
