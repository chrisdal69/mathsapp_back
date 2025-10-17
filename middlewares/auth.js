const jwt = require("jsonwebtoken");

const authenticate = (req, res, next) => {
  const token = req.cookies.jwt;
  if (!token) {
    return res.status(401).json({ message: "Non autorisé - token manquant" });
  }

  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    req.user = decoded; // contient userId, email, nom, prenom, role
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Session expirée" });
    }
    return res.status(403).json({ message: "Token invalide" });
  }
};

function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Accès interdit" });
    }
    next();
  };
}

function verifyToken(req, res, next) {
  try {
    // Récupérer le token depuis le cookie
    const token = req.cookies.jwt;

    if (!token) {
      return res.status(401).json({ message: "Accès non autorisé : pas de token" });
    }

    // Vérifier et décoder le token
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

    // Ajouter les infos de l'utilisateur à la requête
    req.user = decoded;

    // Passer à la suite
    next();
  } catch (error) {
    console.error("Erreur de vérification du token :", error);
    return res.status(403).json({ message: "Token invalide ou expiré" });
  }
}
module.exports = { authenticate, authorize , verifyToken};
