const express = require("express");
var router = express.Router();
const jwt = require("jsonwebtoken");



// Route de login
router.post("/login", (req, res) => {
  // 1. Vérifie les identifiants (email/mot de passe)
  const { email, password } = req.body;
  console.log(req.body);
  if (email !== "john@gmail.com" || password !== "0!6inDia5!0") {
    return res.status(401).json({ message: "Identifiants invalides" });
  }

  // 2. Génère le JWT access et l'envoie dans un cookie httpOnly
  const accessToken = jwt.sign(
    { userId: 123, email },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: "1m" }
  );
  res.cookie("jwt", accessToken, {
    httpOnly: true, // Le cookie n'est pas accessible via JavaScript
    secure: true, // Active en HTTPS uniquement (désactive en développement si nécessaire)
    sameSite: "strict", // Protège contre les attaques CSRF
    //maxAge: 1 * 60 * 1000, // 15 minutes
  });

  // 2. Génère le JWT refresh et l'envoie dans un cookie httpOnly
  const refreshToken = jwt.sign(
    { userId: 123, email },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: "4h" } // Durée longue
  );
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: true, // false en developpement avec HTTPS
    sameSite: "strict",
    maxAge: 4 * 60 * 60 * 1000, // 4 heures
  });
  return res.json({ message: "Connexion réussie" });
});

// Route de logout
router.post("/logout", (req, res) => {
  // Supprime le cookie
  res.clearCookie("jwt");
  return res.json({ message: "Déconnexion réussie" });
});

// Middleware pour vérifier le JWT
const authenticate = (req, res, next) => {
  const token = req.cookies.jwt;
  if (!token) {
    return res.status(403).json({ message: "Non autorisé" });
  }
  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ message: "Token invalide" });
  }
};

// Route protégée
router.get("/protected", authenticate, (req, res) => {
  res.json({ message: "Accès autorisé", user: req.user });
});

// Backend : route de refresh
router.post('/refresh', (req, res) => {
  const { refreshToken } = req.cookies;

  // 1. Vérifie le refresh token
  if (!refreshToken) {
    return res.status(401).json({ message: 'Refresh token manquant' });
  }
  try {
    // 2. Décode le refresh token
    const decoded = jwt.verify(refreshToken,  process.env.REFRESH_TOKEN_SECRET);

    // 3. Génère un nouveau JWT
    const newAccessToken = jwt.sign(
      { userId: decoded.userId, email: decoded.email },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: '1m' }
    );

    // 4. Met à jour le cookie du JWT
    res.cookie('jwt', newAccessToken, {
      httpOnly: true,
      secure: true, // false en developpement
      sameSite: 'strict',
      //maxAge: 1 * 60 * 1000,
    });

    res.json({ result:true , message: 'Token rafraîchi' });
  } catch (err) {
    // 5. Si le refresh token est invalide, déconnecte l'utilisateur
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
    return res.status(401).json({ message: 'Session expirée' });
  }
});


//******************** */nodemailer
const nodemailer = require('nodemailer');

// Configuration du transporteur SMTP
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'christiandalferro@gmail.com',
    pass: 'ywow lflk muan tuwr ', 
  },
});

// Fonction pour envoyer un e-mail
async function sendEmail(to, subject, text) {
  const mailOptions = {
    from: 'christiandalferro@gmail.com',
    to,
    subject,
    text,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('E-mail envoyé :', info.messageId);
  } catch (error) {
    console.error("Erreur lors de l'envoi de l'e-mail :", error);
  }
}

// Utilisation
//sendEmail('christian.dal-ferro@ac-lyon.fr', "Sujet de l'e-mail", "Contenu de l'e-mail");
// METTRE EN .ENV le mot de pass google  ***********************







module.exports = router;
