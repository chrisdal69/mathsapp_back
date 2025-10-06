var express = require("express");
var router = express.Router();
const jwt = require("jsonwebtoken");

const user = {
  id: 42,
  name: "John Doe",
  email: "john@gmail.com",
  admin: true,
};

function generateAccessToken(user) {
  return jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: "1800s",
  });
}
function generateRefreshToken(user) {
  return jwt.sign(user, process.env.REFRESH_TOKEN_SECRET, {
    expiresIn: "1y",
  });
}

router.post("/login", (req, res) => {
  if (req.body.email != user.email) {
    res.status(401).send("invalid credentials");
    return;
  }
  if (req.body.password != "pass") {
    res.status(401).send("invalid credentials");
    return;
  }
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  res.json({
    accessToken,
    refreshToken,
  });
});

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) {
    return res.sendStatus(401);
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
    if (err) {
      return res.sendStatus(401);
    }
    req.user = user;
    next();
  });
}

router.get("/me", authenticateToken, (req, res) => {
  res.send(req.user);
});

router.post("/refreshToken", (req, res) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) {
    return res.sendStatus(401);
  }
  jwt.verify(token, process.env.REFRESH_TOKEN_SECRET, (err, user) => {
    if (err) {
      return res.sendStatus(401);
    }
    // todo : check en bdd que le user a tjs les droits
    delete user.iat;
    delete user.exp;
    const refreshToken = generateAccessToken(user);
    res.send({
      accessToken: refreshToken,
    });
  });
});


module.exports = router;
