var express = require("express");
var path = require("path");
var cookieParser = require("cookie-parser");
var logger = require("morgan");
require("dotenv").config();
require("./models/connection");

var indexRouter = require("./routes/index");
var usersRouter = require("./routes/users");
var uploadRouter = require("./routes/upload");

var app = express();
const fileUpload = require("express-fileupload");
app.use(fileUpload());
const cors = require("cors");
app.use(
  cors({
    origin: "*", // ou mettre le domaine de ton front
  })
);
//app.use(cors());
app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true })); //false ds la Capsule
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

app.use("/", indexRouter);
app.use("/users", usersRouter);
app.use("/upload", uploadRouter);


module.exports = app;
