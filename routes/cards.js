var express = require("express");
var router = express.Router();
const path = require("path");
const sharp = require("sharp");
const { Storage } = require("@google-cloud/storage");
const { authenticate, authorize, verifyToken, requireAdmin } = require("../middlewares/auth");
const Card = require("../models/cards");

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
const allowedBgExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"]);
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
    const result = await Card.find().lean().exec();

    if (!result.length) {
      return res.status(404).json({ error: "Aucune carte trouvée." });
    }

    res.json({ result });
  } catch (err) {
    console.error("GET /cards", err);
    res.status(500).json({ error: "Erreur serveur." });
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

const sanitizeStringArray = (value) => {
  if (!Array.isArray(value)) return null;
  const next = value
    .map((item) =>
      typeof item === "string" ? item.trim() : typeof item === "number" ? `${item}`.trim() : ""
    )
    .map((item) => item || "")
    .filter((item) => item.length);
  return next;
};

const patchListField = async (req, res, fieldName) => {
  const { id } = req.params;
  const payload = sanitizeStringArray((req.body || {})[fieldName]);

  if (!payload) {
    return res.status(400).json({ error: `Le champ ${fieldName} doit être un tableau de chaînes.` });
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
    return res.status(400).json({ error: `Le champ ${label} est obligatoire.` });
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
  const ext = typeof extension === "string" ? extension : path.extname(rawName || "").toLowerCase();
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
  if (position === "end" || typeof position === "undefined" || position === null) {
    return length;
  }
  const numeric = Number(position);
  if (!Number.isNaN(numeric)) {
    return Math.max(0, Math.min(length, numeric + 1));
  }
  return length;
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
    let instance = sharp(buffer).resize({ width: 32, height: 32, fit: "inside" }).blur(8);
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
      return res.status(400).json({ error: "Extension d'image non autorisée." });
    }

    const targetRepertoire =
      (req.body && req.body.repertoire) || card.repertoire;
    let sanitizedRepertoire;
    try {
      sanitizedRepertoire = sanitizeStorageSegment(targetRepertoire, "Répertoire");
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
        .catch((err) => console.warn("Suppression de l'ancien background échouée", err));

      const prevBlurName = toBlurFileName(card.bg);
      if (prevBlurName) {
        const prevBlurFile = bucket.file(
          `${sanitizedRepertoire}/tag${normalizedTagNumber}/${prevBlurName}`
        );
        prevBlurFile
          .delete({ ignoreNotFound: true })
          .catch((err) =>
            console.warn("Suppression de l'ancien background flouté échouée", err)
          );
      }
    }

    await uploadBufferToBucket(fileRef, uploadedFile.data, uploadedFile.mimetype);
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
      return res.status(400).json({ error: "Extension de fichier non autoris\u00e9e." });
    }

    if (uploadedFile.size && uploadedFile.size > 10 * 1024 * 1024) {
      return res.status(400).json({ error: "Fichier trop volumineux (10 Mo max)." });
    }

    const targetRepertoire =
      (req.body && req.body.repertoire) || card.repertoire;
    let sanitizedRepertoire;
    try {
      sanitizedRepertoire = sanitizeStorageSegment(targetRepertoire, "R\u00e9pertoire");
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

    await uploadBufferToBucket(fileRef, uploadedFile.data, uploadedFile.mimetype);
    try {
      await fileRef.makePublic();
    } catch (err) {
      console.warn("Impossible de rendre le fichier public imm\u00e9diatement", err);
    }

    const listPosition = resolveArrayInsertIndex(card.fichiers, req.body?.position);
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
          $each: [{ txt: description, href: uniqueName }],
          ...(Number.isFinite(normalizedPosition) ? { $position: normalizedPosition } : {}),
        },
      },
    };
    const updatedCard = await Card.findOneAndUpdate(updateQuery, update, {
      new: true,
    }).lean();

    if (!updatedCard) {
      return res.status(404).json({ error: "Carte introuvable apr\u00e8s upload." });
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

module.exports = router;
