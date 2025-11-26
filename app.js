var express = require("express");
var path = require("path");
var cookieParser = require("cookie-parser");
var logger = require("morgan");
require("dotenv").config();
require("./models/connection");

var indexRouter = require("./routes/index");
var authRoutes = require("./routes/auth");
var usersRouter = require("./routes/users");
var uploadRouter = require("./routes/upload");
var cardsRouter = require("./routes/cards");
var quizzsRouter = require("./routes/quizzs");



var app = express();
const fileUpload = require("express-fileupload");
app.use(fileUpload());
const cors = require("cors");
const allowedOrigins = [
  "http://localhost:3001", // front en local
  "https://mathsapp-front.vercel.app", // front en production
  "https://mathsapp-testfront.vercel.app", // front en test
];
app.use(
  cors({
    origin: function (origin, callback) {
      // Autorise les requêtes sans origin (Postman, server-side) ou celles dans la liste
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.error("❌ Requête refusée par CORS : ", origin);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    optionsSuccessStatus: 200,
  })
);
app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true })); //false ds la Capsule
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

app.use("/", indexRouter);
app.use("/users", usersRouter); // pour profile, admin actions...
app.use("/auth", authRoutes); // pour login/logout/signup/refresh
app.use("/upload", uploadRouter);
app.use("/cards", cardsRouter); // pour profile, admin actions...
app.use("/quizzs", quizzsRouter); // pour enregistrements des résultats de quizz...


module.exports = app;
