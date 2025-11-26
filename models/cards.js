const mongoose = require("mongoose");

const hrefSchema = new mongoose.Schema({
    txt: String,
    href: String,
});

const quizzSchema = new mongoose.Schema({
    id: String,
    question: String,
    image: String,
    options: [String],
    correct: Number,
});


const cardSchema = new mongoose.Schema({
  num: Number,
  repertoire: String,
  cloud: Boolean,
  bg: String,
  titre: String,
  presentation: [String],
  plan:[String],
  fichiers: [hrefSchema],
  quizz:[quizzSchema],
  video:[hrefSchema],
  evalQuizz:String,
  resultatQuizz:Boolean,
  visible:Boolean,
  order:Number,
});

module.exports = mongoose.model("Card", cardSchema);
