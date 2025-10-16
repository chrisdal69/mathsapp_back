var express = require("express");
var router = express.Router();
const path = require("path");
const { Storage } = require("@google-cloud/storage");
const { authenticate, authorize, verifyToken } = require("../middlewares/auth");

//GESTION du google Storage
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
const fs = require("fs");
const bucket = storage.bucket(bucketName);

// Extensions autorisés
const allowedExtensions = [
  ".jpg",
  ".jpeg",
  ".png",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".txt",
  ".py",
];

/************************************************************************* */

//DEBUT CREATION FOLDER DANS Google Storage
// Crée un "dossier" dans le bucket mathsapp et rend public son contenu uniquement
//@param : exemple : createPublicFolder('ciel1', 'tp1')

async function createPublicFolder(dossierParent, folderName) {
  const folderPath = folderName.endsWith("/")
    ? `${dossierParent}/${folderName}`
    : `${dossierParent}/${folderName}/`;
  try {
    // 1️⃣ Vérifier si le dossier existe déjà
    const [files] = await bucket.getFiles({
      prefix: folderPath,
      maxResults: 1,
    });
    if (files.length > 0) {
      console.log(
        `ℹ️ Le dossier ${folderPath} existe déjà, aucune action nécessaire.`
      );
      return {
        result: true,
        message: `Le dossier ${folderPath} existe déjà.`,
        publicUrl: `https://storage.googleapis.com/${bucketName}/${folderPath}`,
      };
    }

    // 2️⃣ Crée un "fichier" vide pour matérialiser le dossier
    const file = bucket.file(folderPath);
    await file.save("");
    console.log(`✅ Dossier ${folderPath} créé.`);

    // 3️⃣ Récupère la policy IAM du bucket
    const [policy] = await bucket.iam.getPolicy();

    // 4️⃣ Vérifie qu'une règle pour ce dossier n'existe pas déjà
    const exists = policy.bindings.some(
      (b) =>
        b.role === "roles/storage.objectViewer" &&
        b.members.includes("allUsers") &&
        b.condition?.expression?.includes(`/objects/${folderPath}`)
    );

    if (exists) {
      console.log(`🔒 Les accès publics pour ${folderPath} existent déjà.`);
      return {
        result: true,
        message: `Le dossier ${folderPath} existe déjà et est public.`,
        publicUrl: `https://storage.googleapis.com/${bucketName}/${folderPath}`,
      };
    }

    // 5️⃣ Ajoute la règle IAM publique pour ce préfixe
    policy.bindings.push({
      role: "roles/storage.objectViewer",
      members: ["allUsers"],
      condition: {
        title: `Public access to ${folderPath}`,
        description: `Allow public read access to files in ${folderPath}`,
        expression: `resource.name.startsWith("projects/_/buckets/${bucketName}/objects/${folderPath}")`,
      },
    });

    // 6️⃣ Applique la policy mise à jour
    await bucket.iam.setPolicy(policy);
    console.log(`🌍 Le dossier ${folderPath} est désormais public.`);

    return {
      result: true,
      message: `Le dossier ${folderPath} a été créé et rendu public.`,
      publicUrl: `https://storage.googleapis.com/${bucketName}/${folderPath}`,
    };
  } catch (err) {
    console.error("❌ Erreur lors de la création du dossier public :", err);
    return { result: false, error: err.message };
  }
}

//FIN CREATION FOLDER DANS Google Storage

/************************************************************************* */

/* DEBUT Lister des fichiers qui sont dans le répertoire */

router.post("/recup", authenticate, async (req, res) => {
  try {
    // Validation des champs name , parent et repertoire
    const { nom, prenom, email, role } = req.user;
    const safeName = `${removeSpaces(nom)}${removeSpaces(prenom)}`;
    const parent = validatePathComponent(req.body.parent, "Dossier parent");
    const repertoire = validatePathComponent(
      req.body.repertoire,
      "Nom de répertoire"
    );
    const repertoireBucket = `${parent}/${repertoire}`;

    // On cible le n répertoire
    const [files] = await bucket.getFiles({
      prefix: `${repertoireBucket}/`, // dossier cible
      delimiter: "/", // permet d'éviter de descendre dans des sous-dossiers
    });

    // Extraire uniquement les noms de fichiers
    const fileNames = files.map((file) => {
      return {
        name: file.name,
        url: `https://storage.googleapis.com/${bucketName}/${file.name}`,
      };
    });
    const fileNamesFilter = fileNames.filter((obj) =>
      obj.name
        .split("/")
        .pop()
        .startsWith(safeName + "_")
    );

    res.json(fileNamesFilter);
  } catch (err) {
    console.error(
      "Erreur lors de la récupération des fichiers du dossier tp1:",
      err
    );
    res
      .status(500)
      .send("Erreur lors de la récupération des fichiers du dossier tp1");
  }
});

/* FIN  des fichiers qui sont dans le répertoire */

/************************************************************************* */

/* DEBUT Récupérer l'upload du front et envoyer les fichiers dans le bucket google */
// Dossier de stockage dans le bucket
function validatePathComponent(value, label) {
  if (!value || typeof value !== "string") {
    throw new Error(`${label} manquant`);
  }

  // Nettoyage de base
  const cleaned = value.trim();

  // Longueur raisonnable
  if (cleaned.length > 50) {
    throw new Error(`${label} trop long`);
  }

  // Regex whitelist : uniquement lettres, chiffres, tirets et underscores
  if (!/^[a-zA-Z0-9_-]+$/.test(cleaned)) {
    throw new Error(
      `${label} invalide : seuls lettres, chiffres, "-", "_" sont autorisés`
    );
  }

  // Empêche chemins relatifs ou séparateurs
  if (
    cleaned.includes("/") ||
    cleaned.includes("\\") ||
    cleaned.includes("..")
  ) {
    throw new Error(`${label} invalide : caractères de chemin interdits`);
  }

  return cleaned;
}

function removeSpaces(str) {
  //enlève les espaces
  return str.replace(/\s+/g, "");
}

router.post("/", authenticate, async (req, res) => {
  try {
    // Validation parent et repertoire
    const parent = validatePathComponent(req.body.parent, "Dossier parent");
    const repertoire = validatePathComponent(
      req.body.repertoire,
      "Nom de répertoire"
    );
    // (Optionnel) Restreindre à une liste blanche
    const allowedParents = ["ciel1"];
    if (!allowedParents.includes(parent)) {
      return res.status(403).send("Dossier parent non autorisé.");
    }
    // Création du répertoire public si besoin
    await createPublicFolder(parent, repertoire);
    const repertoireBucket = `${parent}/${repertoire}`;
    // Préfixe du user devant le fichier
    const { nom, prenom, email, role } = req.user;
    const safeName = `${removeSpaces(nom)}${removeSpaces(prenom)}`;
    // Vérifie la présence de fichiers
    if (!req.files || Object.keys(req.files).length === 0) {
      return res.status(400).send("Aucun fichier reçu.");
    }
    // 
    const fichiersCopies = [];
    const fichiers = Array.isArray(req.files.fichiers)
      ? req.files.fichiers
      : [req.files.fichiers];

    for (const file of fichiers) {
      const ext = path.extname(file.name).toLowerCase();
      if (!allowedExtensions.includes(ext)) {
        console.warn(`Extension refusée : ${file.name}`);
        continue;
      }

      if (file.size > 5_000_000) {
        console.warn(`Fichier trop volumineux : ${file.name}`);
        continue;
      }

      const tmpPath =
        NODE_ENV === "production"
          ? `/tmp/${safeName}_${file.name}`
          : `./tmp/${safeName}_${file.name}`;

      await file.mv(tmpPath);

      const destFileName = `${repertoireBucket}/${safeName}_${file.name}`;
      await storage
        .bucket(bucketName)
        .upload(tmpPath, { destination: destFileName });

      fs.unlinkSync(tmpPath);
      fichiersCopies.push({
        name: file.name,
        url: `https://storage.googleapis.com/${bucketName}/${destFileName}`,
      });
    }

    res.json({
      result: true,
      files: fichiersCopies,
    });
  } catch (err) {
    console.error("Erreur réception sur le back :", err);
    const status =
      err.message.includes("invalide") || err.message.includes("manquant")
        ? 400
        : 500;
    res.status(status).json({ result: false, error: err.message });
  }
});

/* FIN Récupérer l'upload du front et envoyer les fichiers dans le bucket google */

/************************************************************************* */

/* DEBUT supprimer un fichier */
router.post("/delete", authenticate, async (req, res) => {
  try {
    const { parent, repertoire, file } = req.body;

    if (!parent || !repertoire || !file) {
      return res.status(400).json({ success: false, message: "Données manquantes" });
    }

    const filePath = `${parent}/${repertoire}/${file}`;
    const fileRef = bucket.file(filePath);

    await fileRef.delete();

    console.log(`✅ Fichier supprimé : ${filePath}`);
    return res.json({ success: true, message: "Fichier supprimé" });
  } catch (err) {
    console.error("Erreur suppression fichier :", err);
    return res.status(500).json({
      success: false,
      message: "Erreur lors de la suppression du fichier",
      error: err.message,
    });
  }
});
/* FIN supprimer un fichier */

/* DEBUT renommer un fichier */
router.post("/rename", authenticate, async (req, res) => {
  try {
    const { parent, repertoire, oldName, newName } = req.body;

    if (!parent || !repertoire || !oldName || !newName) {
      return res.status(400).json({ success: false, message: "Données manquantes" });
    }

    const oldPath = `${parent}/${repertoire}/${oldName}`;
    const newPath = `${parent}/${repertoire}/${newName}`;

    const oldFile = bucket.file(oldPath);
    const newFile = bucket.file(newPath);

    // Vérifie si l’ancien fichier existe
    const [exists] = await oldFile.exists();
    if (!exists) {
      return res.status(404).json({ success: false, message: "Fichier introuvable" });
    }

    // Copie vers le nouveau nom
    await oldFile.copy(newFile);
    // Supprime l’ancien fichier
    await oldFile.delete();

    console.log(`✏️ Fichier renommé : ${oldPath} → ${newPath}`);
    return res.json({ success: true, message: "Fichier renommé" });
  } catch (err) {
    console.error("Erreur renommage fichier :", err);
    return res.status(500).json({
      success: false,
      message: "Erreur lors du renommage du fichier",
      error: err.message,
    });
  }
});
/* FIN renommer un fichier */


/* DEBUT exemple route pour utiliser veriyToken */

router.get("/profil", verifyToken, (req, res) => {
  // Tu as maintenant accès à req.user (décodé depuis le JWT)
  const { nom, prenom, email, role } = req.user;

  res.json({
    message: "Données de l'utilisateur connecté",
    nom,
    prenom,
    email,
    role,
  });
});

//router.use(verifyToken);

// Toutes les routes en dessous sont protégées
router.get("/dashboard", (req, res) => {
  res.json({ message: `Bienvenue ${req.user.prenom} ${req.user.nom}` });
});
/* FIN exemple route pour utiliser veriyToken */

module.exports = router;
