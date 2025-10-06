var express = require("express");
var router = express.Router();
const path = require("path");
const { Storage } = require("@google-cloud/storage");

const VERCEL = false; //false en localhost:3000
let storage;
if (VERCEL) {
  const serviceAccount = JSON.parse(process.env.GCP_KEY);
  storage = new Storage({
    projectId: serviceAccount.project_id,
    credentials: serviceAccount,
  });
} else {
  storage = new Storage({ keyFilename: "config/gcs-key.json" });
}
//Info du google Storage
const bucketName = "mathsapp";
const fs = require("fs");
const bucket = storage.bucket(bucketName);

// Extension autorisés
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


// Dossier de stockage dans le bucket
const repertoireBucket = "tp1"
const folderName = "tp1/";
async function createFolder() {

  // On crée un "fichier" vide qui sert de dossier
  const file = bucket.file(folderName);

  await file.save(""); // écrit un contenu vide
  console.log(`Dossier ${folderName} créé dans ${bucketName}`);
}

//createFolder().catch(console.error);
//







// Lister tous les fichiers qui sont dans le bucket
router.get("/", async (req, res) => {
  try {
    const [files] = await bucket.getFiles();
    // files est un tableau d'objets File
    const fileNames = files.map((file) => file.name);
    res.json(fileNames);
  } catch (err) {
    console.error(err);
    res.status(500).send("Erreur lors de la récupération des fichiers");
  }
});

// Récupérer l'upload du front et envoyer les fichiers dans le bucket google
router.post("/", async (req, res) => {
  // Si pas de nom reçu
  if (!req.body.name || req.body.name === "") {
    return res.status(400).send("Champs name vide.");
  }
  // Si pas de fichiers reçu
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).send("No files were uploaded.");
  }

  const fichiersCopies = [];
  // Cas d'1 seul fichier
  if (!Array.isArray(req.files.fichiers)) {
    req.files.fichiers = [req.files.fichiers];
  }
  // Boucle sur les fichiers reçus
  for (let file of req.files.fichiers) {

    const filePath = VERCEL ? `/tmp/${req.body.name}_${file.name}` : `./tmp/${req.body.name}_${file.name}` ; 
    try {
      // test des extensions et de la taille (5Mo)
      const ext = path.extname(file.name).toLowerCase();
      if (allowedExtensions.includes(ext) && file.size < 5000000) {
        //Copie fichier dans dossier /tmp
        const resultMove = await file.mv(filePath);
        if (resultMove) {
          return res.json({ result: false, error: "erreur move" });
        }
        //copie fichier dans cloud strorage
        const destFileName = `${repertoireBucket}/${req.body.name}_${file.name}`;
        await storage.bucket(bucketName).upload(filePath, {
          destination: destFileName,
        });
        //suppression du fichier du dossier /tmp
        fs.unlinkSync(filePath);
        fichiersCopies.push(file.name);
      }
      //await storage.bucket('mathsapp').file(fileDelete).delete()
      // console.log(
      //   `${filePath} uploadé dans gs://${bucketName}/${destFileName}`
      // );
      // console.log(
      //   `URL publique : https://storage.googleapis.com/${bucketName}/${destFileName}`
      // );
    } catch (err) {
      console.error("Erreur réception sur le back :", err);
    }
  }
  res.json({
    result: true,
    files: fichiersCopies,
  });
});

router.delete("/", async (req, res) => {
  const name = "nsiNotes.xlsx";
  const repertoireBucket = "repertoire2";
  const fileDelete = `${repertoireBucket}/${name}`;
  await storage.bucket(bucketName).file(fileDelete).delete();
  res.json({
    result: true,
    fichierSupprime: name,
  });
});

module.exports = router;
