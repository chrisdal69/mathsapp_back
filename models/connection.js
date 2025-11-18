const mongoose = require("mongoose");

const { CONNECTION_STRING } = process.env;

if (mongoose.connection.readyState === 0) {
  mongoose
    .connect(CONNECTION_STRING, { connectTimeoutMS: 10000 })
    .then(() => console.log("Database connected"))
    .catch((err) => console.error("Database connection error:", err));
}

module.exports = mongoose;
