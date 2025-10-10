const jwt = require("jsonwebtoken");

const authenticate = (req, res, next) => {
  const token = req.cookies.jwt;
  if (!token) {
    return res.status(403).json({ message: "Non autorisé" });
  }

  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    req.user = decoded; // on ajoute userId, email, role
    next();
  } catch (err) { 
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

module.exports = { authenticate, authorize };
