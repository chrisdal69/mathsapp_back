const express = require("express");
const router = express.Router();
const yup = require("yup");
const { authenticate } = require("../middlewares/auth");
const Quizz = require("../models/quizzs");
const Card = require("../models/cards");

const quizzSaveSchema = yup.object().shape({
  cardId: yup.string().trim().required("cardId requis"),
  reponses: yup
    .array()
    .of(yup.number().integer().min(0))
    .min(1, "Aucune reponse fournie")
    .required("Reponses requises"),
});

router.get("/historique", authenticate, async (req, res) => {
  try {
    const cardId = (req.query && req.query.cardId) || "";
    if (!cardId) {
      return res.status(400).json({ message: "cardId requis." });
    }

    const card = await Card.findById(cardId)
      .select("evalQuizz resultatQuizz")
      .lean();
    if (!card || card.evalQuizz !== "oui") {
      return res.status(404).json({ message: "Quizz non disponible." });
    }

    const existing = await Quizz.findOne({
      id_user: req.user.userId,
      id_card: cardId,
    }).lean();

    if (!existing) {
      return res.status(200).json({ alreadyDone: false });
    }

    const correctCount =
      Array.isArray(existing.reponses) && existing.reponses.length
        ? existing.reponses.reduce(
            (sum, val) => sum + (Number(val) === 1 ? 1 : 0),
            0
          )
        : 0;

    return res.status(200).json({
      alreadyDone: true,
      date: existing.date,
      correctCount: card.resultatQuizz ? correctCount : undefined,
      totalQuestions: card.resultatQuizz
        ? existing.reponses?.length || 0
        : undefined,
    });
  } catch (error) {
    console.error("GET /quizzs/historique :", error);
    return res.status(500).json({ message: "Erreur serveur." });
  }
});

router.post("/", authenticate, async (req, res) => {
  try {
    const { cardId, reponses } = await quizzSaveSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    const existing = await Quizz.findOne({
      id_user: req.user.userId,
      id_card: cardId,
    });

    const card = await Card.findById(cardId)
      .select("evalQuizz quizz resultatQuizz")
      .lean();
    if (!card) {
      return res.status(404).json({ message: "Carte inconnue." });
    }
    if (card.evalQuizz === "attente") {
      return res.status(403).json({ message: "Quizz non accessible." });
    }
    if (card.evalQuizz !== "oui") {
      return res
        .status(403)
        .json({ message: "Ce quizz n'est pas reserve aux comptes." });
    }

    const questions = Array.isArray(card.quizz) ? card.quizz : [];
    if (questions.length !== reponses.length) {
      return res
        .status(400)
        .json({ message: "Nombre de reponses incoherent avec le quizz." });
    }

    const scoredReponses = questions.map((q, idx) => {
      const userChoice = reponses[idx];
      const correctIndex =
        q && Object.prototype.hasOwnProperty.call(q, "correct")
          ? q.correct
          : null;
      if (typeof userChoice !== "number" || !Number.isInteger(correctIndex)) {
        return 0;
      }
      return userChoice === correctIndex ? 1 : 0;
    });

    if (existing) {
      if (card.resultatQuizz) {
        const correctCount =
          Array.isArray(existing.reponses) && existing.reponses.length
            ? existing.reponses.reduce((sum, val) => sum + (Number(val) === 1 ? 1 : 0), 0)
            : 0;
        return res.status(200).json({
          alreadyDone: true,
          date: existing.date,
          correctCount,
          totalQuestions: existing.reponses?.length || questions.length,
          message: "Ce quizz a deja ete enregistre pour cet utilisateur.",
        });
      }

      return res.status(200).json({
        alreadyDone: true,
        date: existing.date,
        message: "Ce quizz a deja ete enregistre pour cet utilisateur.",
      });
    }

    const doc = new Quizz({
      id_user: req.user.userId,
      id_card: cardId,
      reponses: scoredReponses,
    });
    const saved = await doc.save();

    if (card.resultatQuizz) {
      const correctCount = scoredReponses.reduce(
        (sum, val) => sum + (Number(val) === 1 ? 1 : 0),
        0
      );

      return res.status(201).json({
        message: "Reponses enregistrees.",
        quizz: saved,
        date: saved.date,
        correctCount,
        totalQuestions: scoredReponses.length,
      });
    }

    return res.status(201).json({
      message: "Reponses enregistrees.",
      quizz: saved,
      date: saved.date,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      if (Array.isArray(error.inner) && error.inner.length) {
        const errors = error.inner.map((err) => ({
          field: err.path,
          message: err.message,
        }));
        return res.status(400).json({ errors });
      }
      return res.status(400).json({ message: error.message });
    }
    console.error("Erreur route /quizzs :", error);
    return res.status(500).json({ message: "Erreur serveur." });
  }
});

module.exports = router;
