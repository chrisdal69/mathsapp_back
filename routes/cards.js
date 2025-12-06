var express = require("express");
var router = express.Router();
const path = require("path");
const sharp = require("sharp");
const { Storage } = require("@google-cloud/storage");
const {
  authenticate,
  authorize,
  verifyToken,
  requireAdmin,
} = require("../middlewares/auth");
const Card = require("../models/cards");
const Quizz = require("../models/quizzs");

const NODE_ENV = process.env.NODE_ENV;
let storage;
if (NODE_ENV === "production") {
  const serviceAccount = JSON.parse(process.env.GCP_KEY);
  storage = new Storage({
    projectId: serviceAccount.project_id,
    credentials: serviceAccount,
  });
} else {
  storage = new Storage({ keyFilename: "config/gcs-key.json" });
}
const bucketName = "mathsapp";
const bucket = storage.bucket(bucketName);
const allowedBgExtensions = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
]);
const allowedFileExtensions = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".csv",
  ".txt",
  ".md",
  ".py",
  ".zip",
  ".rar",
  ".7z",
  ".ppt",
  ".pptx",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".svg",
  ".webp",
  ".mp4",
]);
const toBlurFileName = (filename) => {
  if (!filename || typeof filename !== "string") {
    return null;
  }
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) {
    return `${filename}Blur`;
  }
  return `${filename.slice(0, lastDot)}Blur${filename.slice(lastDot)}`;
};

router.get("/", async (req, res) => {
  try {
    const result = await Card.find({ visible: true })
      .sort({ order: -1 })
      .lean()
      .exec();

    if (!result.length) {
      return res.status(404).json({ error: "Aucune carte trouvée." });
    }

    const sanitized = result.map((card) => {
      const filteredFiles = Array.isArray(card.fichiers)
        ? card.fichiers.filter((f) => f && f.visible === true)
        : card.fichiers;

      if (!Array.isArray(card.quizz)) {
        return { ...card, fichiers: filteredFiles };
      }

      return {
        ...card,
        fichiers: filteredFiles,
        quizz: card.quizz.map((q) => {
          const base = {
            id: q.id,
            question: q.question,
            image: q.image,
            options: Array.isArray(q.options) ? q.options : [],
          };
          if (card.evalQuizz === "non") {
            return { ...base, correct: q.correct };
          }
          return base;
        }),
      };
    });

    res.json({ result: sanitized });
  } catch (err) {
    console.error("GET /cards", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

router.get("/admin", requireAdmin, async (req, res) => {
  try {
    const result = await Card.find().sort({ order: -1 }).lean().exec();

    if (!result.length) {
      return res.status(404).json({ error: "Aucune carte trouvée." });
    }

    res.json({ result });
  } catch (err) {
    console.error("GET /cards/admin", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

router.post("/admin", requireAdmin, async (req, res) => {
  const repertoire = (req.body?.repertoire || "").trim();

  if (!repertoire) {
    return res.status(400).json({ error: "Repertoire manquant." });
  }

  try {
    const computeNextValues = async () => {
      const [agg] = await Card.aggregate([
        { $match: { repertoire } },
        {
          $group: {
            _id: null,
            maxNum: { $max: "$num" },
            maxOrder: { $max: "$order" },
          },
        },
      ]);

      const nextNum = Number.isFinite(agg?.maxNum)
        ? Math.trunc(agg.maxNum) + 1
        : 1;
      const nextOrder = Number.isFinite(agg?.maxOrder)
        ? Math.trunc(agg.maxOrder) + 1
        : 1;
      return { nextNum, nextOrder };
    };

    let values = await computeNextValues();
    let created = null;

    for (let attempt = 0; attempt < 2 && !created; attempt += 1) {
      const payload = {
        num: values.nextNum,
        repertoire,
        cloud: false,
        bg: "",
        titre: "",
        presentation: [],
        plan: [],
        fichiers: [],
        quizz: [],
        video: [],
        evalQuizz: "non",
        resultatQuizz: false,
        visible: false,
        order: values.nextOrder,
      };

      try {
        created = await Card.create(payload);
      } catch (error) {
        const isDupKey = error?.code === 11000;
        if (isDupKey && attempt === 0) {
          values = await computeNextValues();
          continue;
        }
        if (isDupKey) {
          return res
            .status(409)
            .json({ error: "Une carte avec ce num ou cet ordre existe deja." });
        }
        throw error;
      }
    }

    const result = created?.toObject ? created.toObject() : created;

    res.status(201).json({ result });
  } catch (err) {
    console.error("POST /cards/admin", err);
    res.status(500).json({ error: "Erreur lors de la creation de la carte." });
  }
});

router.patch("/:id/title", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { titre } = req.body || {};

  if (!titre || !titre.trim()) {
    return res.status(400).json({ error: "Le titre est obligatoire." });
  }

  try {
    const updatedCard = await Card.findByIdAndUpdate(
      id,
      { titre: titre.trim() },
      { new: true }
    ).lean();

    if (!updatedCard) {
      return res.status(404).json({ error: "Carte introuvable." });
    }

    res.json({ result: updatedCard });
  } catch (err) {
    console.error("PATCH /cards/:id/title", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

router.patch("/:id/visible", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const rawValue = (req.body || {}).visible;
  let normalizedVisible = null;

  if (typeof rawValue === "boolean") {
    normalizedVisible = rawValue;
  } else if (typeof rawValue === "string") {
    if (rawValue.toLowerCase() === "true") {
      normalizedVisible = true;
    } else if (rawValue.toLowerCase() === "false") {
      normalizedVisible = false;
    }
  }

  if (normalizedVisible === null) {
    return res.status(400).json({ error: "Valeur de visibilitǸ invalide." });
  }

  try {
    const updatedCard = await Card.findByIdAndUpdate(
      id,
      { visible: normalizedVisible },
      { new: true }
    ).lean();

    if (!updatedCard) {
      return res.status(404).json({ error: "Carte introuvable." });
    }

    res.json({ result: updatedCard });
  } catch (err) {
    console.error("PATCH /cards/:id/visible", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

router.patch("/:id/cloud", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const rawValue = (req.body || {}).cloud;
  let normalizedCloud = null;

  if (typeof rawValue === "boolean") {
    normalizedCloud = rawValue;
  } else if (typeof rawValue === "string") {
    if (rawValue.toLowerCase() === "true") {
      normalizedCloud = true;
    } else if (rawValue.toLowerCase() === "false") {
      normalizedCloud = false;
    }
  }

  if (normalizedCloud === null) {
    return res.status(400).json({ error: "Valeur cloud invalide." });
  }

  try {
    const updatedCard = await Card.findByIdAndUpdate(
      id,
      { cloud: normalizedCloud },
      { new: true }
    ).lean();

    if (!updatedCard) {
      return res.status(404).json({ error: "Carte introuvable." });
    }

    res.json({ result: updatedCard });
  } catch (err) {
    console.error("PATCH /cards/:id/cloud", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

router.delete("/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const card = await Card.findById(id).lean();
    if (!card) {
      return res.status(404).json({ error: "Carte introuvable." });
    }

    const sanitizedRepertoire = sanitizeStorageSegment(card.repertoire, "Repertoire");
    const tagNumber = normalizeTagNumber(card.num);

    await Promise.all([
      Card.deleteOne({ _id: card._id }),
      Quizz.deleteMany({ id_card: card._id }),
      (async () => {
        if (sanitizedRepertoire && tagNumber !== null) {
          const prefix = `${sanitizedRepertoire}/tag${Math.trunc(tagNumber)}/`;
          try {
            await bucket.deleteFiles({ prefix });
          } catch (err) {
            console.warn("Suppression des fichiers du bucket échouée", err);
          }
        }
      })(),
    ]);

    return res.json({
      result: {
        id: card._id,
        num: card.num,
        repertoire: card.repertoire,
      },
    });
  } catch (err) {
    console.error("DELETE /cards/:id", err);
    res.status(500).json({ error: "Erreur lors de la suppression de la carte." });
  }
});

router.patch("/:id/move", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const direction = (req.body?.direction || "").toLowerCase();

  if (direction !== "up" && direction !== "down") {
    return res.status(400).json({ error: "Direction invalide (attendue: up ou down)." });
  }

  try {
    const current = await Card.findById(id).lean();
    if (!current) {
      return res.status(404).json({ error: "Carte introuvable." });
    }

    const filter = { repertoire: current.repertoire };
    const sorted = await Card.find(filter).sort({ order: -1, num: -1 }).lean();

    const index = sorted.findIndex((c) => String(c._id) === String(id));
    if (index === -1) {
      return res.status(404).json({ error: "Carte introuvable." });
    }

    const neighborIndex = direction === "up" ? index - 1 : index + 1;
    if (neighborIndex < 0 || neighborIndex >= sorted.length) {
      return res
        .status(400)
        .json({ error: direction === "up" ? "Carte déjà en tête." : "Carte déjà en queue." });
    }

    const neighbor = sorted[neighborIndex];
    const currentOrder = Number.isFinite(current.order) ? current.order : 0;
    const neighborOrder = Number.isFinite(neighbor.order) ? neighbor.order : 0;

    await Promise.all([
      Card.updateOne({ _id: current._id }, { $set: { order: neighborOrder } }),
      Card.updateOne({ _id: neighbor._id }, { $set: { order: currentOrder } }),
    ]);

    const updatedList = await Card.find(filter).sort({ order: -1, num: -1 }).lean();
    return res.json({ result: updatedList });
  } catch (err) {
    console.error("PATCH /cards/:id/move", err);
    res.status(500).json({ error: "Erreur lors du déplacement de la carte." });
  }
});

const sanitizeStringArray = (value) => {
  if (!Array.isArray(value)) return null;
  const next = value
    .map((item) =>
      typeof item === "string"
        ? item.trim()
        : typeof item === "number"
        ? `${item}`.trim()
        : ""
    )
    .map((item) => item || "")
    .filter((item) => item.length);
  return next;
};

const patchListField = async (req, res, fieldName) => {
  const { id } = req.params;
  const payload = sanitizeStringArray((req.body || {})[fieldName]);

  if (!payload) {
    return res.status(400).json({
      error: `Le champ ${fieldName} doit être un tableau de chaînes.`,
    });
  }

  try {
    const updatedCard = await Card.findByIdAndUpdate(
      id,
      { [fieldName]: payload },
      { new: true }
    ).lean();

    if (!updatedCard) {
      return res.status(404).json({ error: "Carte introuvable." });
    }

    res.json({ result: updatedCard });
  } catch (err) {
    console.error(`PATCH /cards/:id/${fieldName}`, err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};

router.patch("/:id/presentation", requireAdmin, async (req, res) => {
  await patchListField(req, res, "presentation");
});

router.patch("/:id/plan", requireAdmin, async (req, res) => {
  await patchListField(req, res, "plan");
});

const patchStringField = async (req, res, fieldName, label = fieldName) => {
  const { id } = req.params;
  const rawValue = (req.body || {})[fieldName];
  const trimmed = typeof rawValue === "string" ? rawValue.trim() : "";

  if (!trimmed) {
    return res
      .status(400)
      .json({ error: `Le champ ${label} est obligatoire.` });
  }

  try {
    const updatedCard = await Card.findByIdAndUpdate(
      id,
      { [fieldName]: trimmed },
      { new: true }
    ).lean();

    if (!updatedCard) {
      return res.status(404).json({ error: "Carte introuvable." });
    }

    res.json({ result: updatedCard });
  } catch (err) {
    console.error(`PATCH /cards/:id/${fieldName}`, err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};

router.patch("/:id/bg", requireAdmin, async (req, res) => {
  await patchStringField(req, res, "bg", "bg");
});

const sanitizeStorageSegment = (value, label) => {
  if (!value || typeof value !== "string") {
    return null;
  }
  const cleaned = value.trim();
  if (!cleaned) {
    return null;
  }
  if (cleaned.length > 60) {
    throw new Error(`${label} trop long.`);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(cleaned)) {
    throw new Error(`${label} invalide.`);
  }
  return cleaned;
};

const normalizeTagNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
};

const sanitizeFileBaseName = (rawName, extension) => {
  const ext =
    typeof extension === "string"
      ? extension
      : path.extname(rawName || "").toLowerCase();
  const base = path
    .basename(rawName || "fichier", ext)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return { ext, base: base || "fichier" };
};

const resolveArrayInsertIndex = (list, position) => {
  const length = Array.isArray(list) ? list.length : 0;
  if (position === "start") return 0;
  if (
    position === "end" ||
    typeof position === "undefined" ||
    position === null
  ) {
    return length;
  }
  const numeric = Number(position);
  if (!Number.isNaN(numeric)) {
    return Math.max(0, Math.min(length, numeric + 1));
  }
  return length;
};

const sanitizeVideoArray = (list) =>
  Array.isArray(list)
    ? list.map((v) => ({
        txt: typeof v?.txt === "string" ? v.txt.trim() : "",
        href: typeof v?.href === "string" ? v.href.trim() : "",
      }))
    : [];

const isSafeFileName = (value) => {
  if (!value || typeof value !== "string") return false;
  if (value.length > 200) return false;
  if (value.includes("/") || value.includes("\\") || value.includes(".."))
    return false;
  return true;
};

const extractSingleFile = (files) => {
  if (!files || typeof files !== "object") {
    return null;
  }
  const candidates = ["file", "bg", "background", "image"];
  for (const key of candidates) {
    if (files[key]) {
      return Array.isArray(files[key]) ? files[key][0] : files[key];
    }
  }
  const values = Object.values(files);
  if (!values.length) {
    return null;
  }
  const first = values[0];
  return Array.isArray(first) ? first[0] : first;
};

const uploadBufferToBucket = (fileRef, buffer, mimetype) =>
  new Promise((resolve, reject) => {
    const stream = fileRef.createWriteStream({
      metadata: { contentType: mimetype || "application/octet-stream" },
      resumable: false,
    });
    stream.on("error", (err) => reject(err));
    stream.on("finish", resolve);
    stream.end(buffer);
  });

const buildBlurBuffer = async (buffer, format) => {
  try {
    let instance = sharp(buffer)
      .resize({ width: 32, height: 32, fit: "inside" })
      .blur(8);
    if (format === ".jpg") {
      instance = instance.jpeg({ quality: 60 });
    } else if (format === ".jpeg") {
      instance = instance.jpeg({ quality: 60 });
    } else if (format === ".png") {
      instance = instance.png({ quality: 60 });
    } else if (format === ".webp") {
      instance = instance.webp({ quality: 50 });
    }
    return await instance.toBuffer();
  } catch (err) {
    console.warn("Impossible de générer l'aperçu flouté :", err);
    return null;
  }
};

router.post("/:id/bg/upload", requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const card = await Card.findById(id).lean();
    if (!card) {
      return res.status(404).json({ error: "Carte introuvable." });
    }

    if (!req.files || Object.keys(req.files).length === 0) {
      return res.status(400).json({ error: "Aucun fichier fourni." });
    }

    const uploadedFile = extractSingleFile(req.files);
    if (!uploadedFile || !uploadedFile.data) {
      return res.status(400).json({ error: "Fichier d'upload invalide." });
    }

    const extension = path.extname(uploadedFile.name || "").toLowerCase();
    if (!allowedBgExtensions.has(extension)) {
      return res
        .status(400)
        .json({ error: "Extension d'image non autorisée." });
    }

    const targetRepertoire =
      (req.body && req.body.repertoire) || card.repertoire;
    let sanitizedRepertoire;
    try {
      sanitizedRepertoire = sanitizeStorageSegment(
        targetRepertoire,
        "Répertoire"
      );
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }
    if (!sanitizedRepertoire) {
      return res.status(400).json({ error: "Répertoire manquant." });
    }

    const rawNum =
      req.body && Object.prototype.hasOwnProperty.call(req.body, "num")
        ? req.body.num
        : card.num;
    const tagNumber = normalizeTagNumber(rawNum);
    if (tagNumber === null) {
      return res.status(400).json({ error: "Numéro de tag invalide." });
    }
    const normalizedTagNumber = Math.trunc(tagNumber);

    const safeBaseName = path
      .basename(uploadedFile.name || "background", extension)
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
    const finalBase = safeBaseName ? safeBaseName.slice(0, 60) : "background";
    const uniqueBase = `${finalBase}_${Date.now()}`;
    const uniqueName = `${uniqueBase}${extension}`;
    const blurName = `${uniqueBase}Blur${extension}`;
    const objectPath = `${sanitizedRepertoire}/tag${normalizedTagNumber}/${uniqueName}`;
    const blurPath = `${sanitizedRepertoire}/tag${normalizedTagNumber}/${blurName}`;
    const fileRef = bucket.file(objectPath);
    const blurRef = bucket.file(blurPath);

    if (card.bg) {
      const previousFile = bucket.file(
        `${sanitizedRepertoire}/tag${normalizedTagNumber}/${card.bg}`
      );
      previousFile
        .delete({ ignoreNotFound: true })
        .catch((err) =>
          console.warn("Suppression de l'ancien background échouée", err)
        );

      const prevBlurName = toBlurFileName(card.bg);
      if (prevBlurName) {
        const prevBlurFile = bucket.file(
          `${sanitizedRepertoire}/tag${normalizedTagNumber}/${prevBlurName}`
        );
        prevBlurFile
          .delete({ ignoreNotFound: true })
          .catch((err) =>
            console.warn(
              "Suppression de l'ancien background flouté échouée",
              err
            )
          );
      }
    }

    await uploadBufferToBucket(
      fileRef,
      uploadedFile.data,
      uploadedFile.mimetype
    );
    const blurBuffer = await buildBlurBuffer(uploadedFile.data, extension);
    if (blurBuffer) {
      await uploadBufferToBucket(blurRef, blurBuffer, uploadedFile.mimetype);
    }
    try {
      await fileRef.makePublic();
      if (blurBuffer) {
        await blurRef.makePublic();
      }
    } catch (err) {
      console.warn("Impossible de rendre le fichier public immédiatement", err);
    }

    const updatedCard = await Card.findByIdAndUpdate(
      id,
      { bg: uniqueName },
      { new: true }
    ).lean();

    if (!updatedCard) {
      return res.status(404).json({ error: "Carte introuvable après upload." });
    }

    res.json({
      result: updatedCard,
      fileName: uniqueName,
      publicUrl: `https://storage.googleapis.com/${bucketName}/${objectPath}`,
    });
  } catch (err) {
    console.error("POST /cards/:id/bg/upload", err);
    res.status(500).json({ error: "Erreur lors de l'upload de l'image." });
  }
});

router.post("/:id/files", requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const card = await Card.findById(id).lean();
    if (!card) {
      return res.status(404).json({ error: "Carte introuvable." });
    }

    const descriptionRaw =
      (req.body && (req.body.description || req.body.txt)) || "";
    const description =
      typeof descriptionRaw === "string" ? descriptionRaw.trim() : "";
    if (!description) {
      return res.status(400).json({ error: "Le descriptif est obligatoire." });
    }

    if (!req.files || Object.keys(req.files).length === 0) {
      return res.status(400).json({ error: "Aucun fichier fourni." });
    }

    const uploadedFile = extractSingleFile(req.files);
    if (!uploadedFile || !uploadedFile.data) {
      return res.status(400).json({ error: "Fichier d'upload invalide." });
    }

    const rawExtension = path.extname(uploadedFile.name || "").toLowerCase();
    const { ext, base } = sanitizeFileBaseName(uploadedFile.name, rawExtension);
    if (!ext || !allowedFileExtensions.has(ext)) {
      return res
        .status(400)
        .json({ error: "Extension de fichier non autorisée." });
    }

    if (uploadedFile.size && uploadedFile.size > 100 * 1024 * 1024) {
      return res
        .status(400)
        .json({ error: "Fichier trop volumineux (100 Mo max)." });
    }

    const targetRepertoire =
      (req.body && req.body.repertoire) || card.repertoire;
    let sanitizedRepertoire;
    try {
      sanitizedRepertoire = sanitizeStorageSegment(
        targetRepertoire,
        "R\u00e9pertoire"
      );
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }
    if (!sanitizedRepertoire) {
      return res.status(400).json({ error: "R\u00e9pertoire manquant." });
    }

    const rawNum =
      req.body && Object.prototype.hasOwnProperty.call(req.body, "num")
        ? req.body.num
        : card.num;
    const tagNumber = normalizeTagNumber(rawNum);
    if (tagNumber === null) {
      return res.status(400).json({ error: "Num\u00e9ro de tag invalide." });
    }
    const normalizedTagNumber = Math.trunc(tagNumber);

    const uniqueName = `${base}_${Date.now()}${ext}`;
    const objectPath = `${sanitizedRepertoire}/tag${normalizedTagNumber}/${uniqueName}`;
    const fileRef = bucket.file(objectPath);

    await uploadBufferToBucket(
      fileRef,
      uploadedFile.data,
      uploadedFile.mimetype
    );
    try {
      await fileRef.makePublic();
    } catch (err) {
      console.warn(
        "Impossible de rendre le fichier public imm\u00e9diatement",
        err
      );
    }

    const listPosition = resolveArrayInsertIndex(
      card.fichiers,
      req.body?.position
    );
    const normalizedPosition = Number.isFinite(listPosition)
      ? Math.trunc(listPosition)
      : null;
    const updateQuery = {
      _id: card._id,
      repertoire: card.repertoire,
      num: card.num,
    };
    const update = {
      $push: {
        fichiers: {
          $each: [{ txt: description, href: uniqueName, visible: true }],
          ...(Number.isFinite(normalizedPosition)
            ? { $position: normalizedPosition }
            : {}),
        },
      },
    };
    const updatedCard = await Card.findOneAndUpdate(updateQuery, update, {
      new: true,
    }).lean();

    if (!updatedCard) {
      return res
        .status(404)
        .json({ error: "Carte introuvable apr\u00e8s upload." });
    }

    res.json({
      result: updatedCard,
      fileName: uniqueName,
      publicUrl: `https://storage.googleapis.com/${bucketName}/${objectPath}`,
    });
  } catch (err) {
    console.error("POST /cards/:id/files", err);
    res.status(500).json({ error: "Erreur lors de l'upload du fichier." });
  }
});

router.delete("/:id/files", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const targetHref = (
    req.body && req.body.href ? `${req.body.href}` : ""
  ).trim();

  if (!targetHref) {
    return res.status(400).json({ error: "Nom de fichier manquant." });
  }
  if (!isSafeFileName(targetHref)) {
    return res.status(400).json({ error: "Nom de fichier invalide." });
  }

  try {
    const card = await Card.findById(id).lean();
    if (!card) {
      return res.status(404).json({ error: "Carte introuvable." });
    }

    const sanitizedRepertoire = sanitizeStorageSegment(
      card.repertoire,
      "R\u00e9pertoire"
    );
    if (!sanitizedRepertoire) {
      return res.status(400).json({ error: "R\u00e9pertoire manquant." });
    }
    const tagNumber = normalizeTagNumber(card.num);
    if (tagNumber === null) {
      return res.status(400).json({ error: "Num\u00e9ro de tag invalide." });
    }
    const normalizedTagNumber = Math.trunc(tagNumber);

    const existsInCard = Array.isArray(card.fichiers)
      ? card.fichiers.some((f) => f && f.href === targetHref)
      : false;
    if (!existsInCard) {
      return res
        .status(404)
        .json({ error: "Fichier non trouv\u00e9 dans la carte." });
    }

    const objectPath = `${sanitizedRepertoire}/tag${normalizedTagNumber}/${targetHref}`;
    try {
      const fileRef = bucket.file(objectPath);
      await fileRef.delete({ ignoreNotFound: true });
    } catch (err) {
      console.warn("Suppression fichier bucket \u00e9chou\u00e9e", err);
    }

    const updatedCard = await Card.findOneAndUpdate(
      { _id: card._id, repertoire: card.repertoire, num: card.num },
      { $pull: { fichiers: { href: targetHref } } },
      { new: true }
    ).lean();

    if (!updatedCard) {
      return res
        .status(404)
        .json({ error: "Carte introuvable apr\u00e8s suppression." });
    }

    res.json({ result: updatedCard });
  } catch (err) {
    console.error("DELETE /cards/:id/files", err);
    res
      .status(500)
      .json({ error: "Erreur lors de la suppression du fichier." });
  }
});

router.patch("/:id/files", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const targetHref = (
    req.body && req.body.href ? `${req.body.href}` : ""
  ).trim();
  const hasTxt = Object.prototype.hasOwnProperty.call(req.body || {}, "txt");
  const hasVisible = Object.prototype.hasOwnProperty.call(
    req.body || {},
    "visible"
  );
  const rawTxt = hasTxt ? (`${req.body?.txt || ""}`).trim() : "";
  const rawVisible = hasVisible ? req.body?.visible : undefined;

  if (!targetHref) {
    return res.status(400).json({ error: "Nom de fichier manquant." });
  }
  if (!isSafeFileName(targetHref)) {
    return res.status(400).json({ error: "Nom de fichier invalide." });
  }
  if (!hasTxt && !hasVisible) {
    return res.status(400).json({ error: "Aucune modification fournie." });
  }
  if (hasTxt && !rawTxt) {
    return res.status(400).json({ error: "Le descriptif est obligatoire." });
  }

  let normalizedVisible = null;
  if (hasVisible) {
    if (typeof rawVisible === "boolean") {
      normalizedVisible = rawVisible;
    } else if (typeof rawVisible === "string") {
      const lowered = rawVisible.toLowerCase();
      if (lowered === "true") normalizedVisible = true;
      else if (lowered === "false") normalizedVisible = false;
    }
    if (normalizedVisible === null) {
      return res.status(400).json({ error: "Valeur visible invalide." });
    }
  }

  try {
    const card = await Card.findById(id).lean();
    if (!card) {
      return res.status(404).json({ error: "Carte introuvable." });
    }

    const existsInCard = Array.isArray(card.fichiers)
      ? card.fichiers.some((f) => f && f.href === targetHref)
      : false;
    if (!existsInCard) {
      return res
        .status(404)
        .json({ error: "Fichier non trouv\u00e9 dans la carte." });
    }

    const updateFields = {};
    if (hasTxt) {
      updateFields["fichiers.$.txt"] = rawTxt;
    }
    if (hasVisible) {
      updateFields["fichiers.$.visible"] = normalizedVisible;
    }

    const updatedCard = await Card.findOneAndUpdate(
      {
        _id: card._id,
        repertoire: card.repertoire,
        num: card.num,
        "fichiers.href": targetHref,
      },
      { $set: updateFields },
      { new: true }
    ).lean();

    if (!updatedCard) {
      return res
        .status(404)
        .json({ error: "Carte introuvable apr\u00e8s mise \u00e0 jour." });
    }

    res.json({ result: updatedCard });
  } catch (err) {
    console.error("PATCH /cards/:id/files", err);
    res
      .status(500)
      .json({ error: "Erreur lors de la mise \u00e0 jour du fichier." });
  }
});

router.patch("/:id/files/reorder", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const rawOrder = Array.isArray(req.body?.hrefs)
    ? req.body.hrefs
    : Array.isArray(req.body?.order)
    ? req.body.order
    : null;

  if (!rawOrder) {
    return res
      .status(400)
      .json({ error: "Liste d'ordre manquante (hrefs ou order)." });
  }

  const cleanedOrder = [];
  for (const item of rawOrder) {
    const href = typeof item === "string" ? item.trim() : "";
    if (!href) {
      return res
        .status(400)
        .json({ error: "Nom de fichier invalide dans l'ordre fourni." });
    }
    if (!isSafeFileName(href)) {
      return res.status(400).json({ error: `Nom de fichier invalide: ${href}.` });
    }
    cleanedOrder.push(href);
  }

  const unique = new Set(cleanedOrder);
  if (unique.size !== cleanedOrder.length) {
    return res.status(400).json({ error: "Duplicata dans l'ordre fourni." });
  }

  try {
    const card = await Card.findById(id).lean();
    if (!card) {
      return res.status(404).json({ error: "Carte introuvable." });
    }

    const currentList = Array.isArray(card.fichiers)
      ? card.fichiers.filter((f) => f && typeof f.href === "string")
      : [];

    if (!currentList.length) {
      return res.status(400).json({ error: "Aucun fichier a reordonner." });
    }

    if (cleanedOrder.length !== currentList.length) {
      return res.status(400).json({ error: "Ordre incomplet ou invalide." });
    }

    const fileMap = new Map();
    for (const file of currentList) {
      fileMap.set(file.href, file);
    }

    const missing = currentList
      .map((f) => f.href)
      .filter((href) => !unique.has(href));
    if (missing.length) {
      return res.status(400).json({
        error: "Tous les fichiers doivent etre inclus dans l'ordre fourni.",
      });
    }

    const unknown = cleanedOrder.filter((href) => !fileMap.has(href));
    if (unknown.length) {
      return res
        .status(400)
        .json({ error: "Fichier inconnu dans l'ordre fourni." });
    }

    const reordered = cleanedOrder
      .map((href) => fileMap.get(href))
      .filter(Boolean);

    const updatedCard = await Card.findOneAndUpdate(
      { _id: card._id, repertoire: card.repertoire, num: card.num },
      { fichiers: reordered },
      { new: true }
    ).lean();

    if (!updatedCard) {
      return res.status(404).json({
        error: "Carte introuvable apres reordonnancement.",
      });
    }

    res.json({ result: updatedCard });
  } catch (err) {
    console.error("PATCH /cards/:id/files/reorder", err);
    res.status(500).json({
      error: "Erreur lors du reordonnancement des fichiers.",
    });
  }
});

router.post("/:id/video", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const position = req.body?.position;

  try {
    const card = await Card.findById(id).lean();
    if (!card) {
      return res.status(404).json({ error: "Carte introuvable." });
    }

    const currentList = sanitizeVideoArray(card.video);
    const insertIndex = resolveArrayInsertIndex(currentList, position);
    const normalizedIndex = Math.max(
      0,
      Math.min(currentList.length, insertIndex)
    );
    const next = [...currentList];
    next.splice(normalizedIndex, 0, { txt: "", href: "" });

    const updatedCard = await Card.findOneAndUpdate(
      { _id: card._id, repertoire: card.repertoire, num: card.num },
      { video: next },
      { new: true }
    ).lean();

    if (!updatedCard) {
      return res
        .status(404)
        .json({ error: "Carte introuvable apr\u00e8s ajout." });
    }

    res.json({ result: updatedCard });
  } catch (err) {
    console.error("POST /cards/:id/video", err);
    res.status(500).json({ error: "Erreur lors de l'ajout de la video." });
  }
});

router.delete("/:id/video", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const index = Number.isInteger(req.body?.index)
    ? req.body.index
    : Number(req.body?.index);

  if (!Number.isInteger(index) || index < 0) {
    return res.status(400).json({ error: "Indice de video invalide." });
  }

  try {
    const card = await Card.findById(id).lean();
    if (!card) {
      return res.status(404).json({ error: "Carte introuvable." });
    }
    const list = Array.isArray(card.video) ? card.video : [];
    if (index >= list.length) {
      return res.status(404).json({ error: "Video introuvable." });
    }

    const next = list.filter((_, idx) => idx !== index);
    const updatedCard = await Card.findOneAndUpdate(
      { _id: card._id, repertoire: card.repertoire, num: card.num },
      { video: next },
      { new: true }
    ).lean();

    if (!updatedCard) {
      return res
        .status(404)
        .json({ error: "Carte introuvable apr\u00e8s suppression." });
    }

    res.json({ result: updatedCard });
  } catch (err) {
    console.error("DELETE /cards/:id/video", err);
    res
      .status(500)
      .json({ error: "Erreur lors de la suppression de la video." });
  }
});

router.patch("/:id/video", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const index = Number.isInteger(req.body?.index)
    ? req.body.index
    : Number(req.body?.index);
  const hasTxt = Object.prototype.hasOwnProperty.call(req.body || {}, "txt");
  const hasHref = Object.prototype.hasOwnProperty.call(req.body || {}, "href");

  if (!Number.isInteger(index) || index < 0) {
    return res.status(400).json({ error: "Indice de video invalide." });
  }
  if (!hasTxt && !hasHref) {
    return res.status(400).json({ error: "Aucune modification fournie." });
  }

  try {
    const card = await Card.findById(id).lean();
    if (!card) {
      return res.status(404).json({ error: "Carte introuvable." });
    }

    const list = sanitizeVideoArray(card.video);
    if (index >= list.length) {
      return res.status(404).json({ error: "Video introuvable." });
    }

    const current = list[index] || { txt: "", href: "" };
    list[index] = {
      txt: hasTxt ? (req.body.txt || "").trim() : current.txt || "",
      href: hasHref ? (req.body.href || "").trim() : current.href || "",
    };

    const updatedCard = await Card.findOneAndUpdate(
      { _id: card._id, repertoire: card.repertoire, num: card.num },
      { video: list },
      { new: true }
    ).lean();

    if (!updatedCard) {
      return res
        .status(404)
        .json({ error: "Carte introuvable apr\u00e8s mise \u00e0 jour." });
    }

    res.json({ result: updatedCard });
  } catch (err) {
    console.error("PATCH /cards/:id/video", err);
    res
      .status(500)
      .json({ error: "Erreur lors de la mise \u00e0 jour de la video." });
  }
});

module.exports = router;
