const mongoose = require("mongoose");

const { CONNECTION_STRING } = process.env;

if (!CONNECTION_STRING) {
  throw new Error("Missing CONNECTION_STRING");
}
mongoose.set("bufferCommands", false);

const globalWithMongoose = global;

if (!globalWithMongoose.mongoose) {
  globalWithMongoose.mongoose = { conn: null, promise: null };
}

const cached = globalWithMongoose.mongoose;

if (!cached._listenersAttached) {
  mongoose.connection.on("disconnected", () => {
    cached.conn = null;
    cached.promise = null;
  });
  mongoose.connection.on("error", () => {
    cached.conn = null;
    cached.promise = null;
  });
  cached._listenersAttached = true;
}

const connectionOptions = {
  connectTimeoutMS: 10000,
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  maxPoolSize: 5,
  minPoolSize: 0,
  maxIdleTimeMS: 30000,
};

async function connectToDatabase() {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(CONNECTION_STRING, connectionOptions)
      .then((mongooseInstance) => {
        console.log("Database connected");
        return mongooseInstance.connection;
      })
      .catch((err) => {
        console.error("Database connection error:", err);
        cached.promise = null;
        throw err;
      });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

module.exports = connectToDatabase;
