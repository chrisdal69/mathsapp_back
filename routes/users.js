var express = require("express");
var router = express.Router();
const { Storage } = require("@google-cloud/storage");
const storage = new Storage({ keyFilename: "config/gcs-key.json" });
// *** pour gitHub pour Vercel ****
// const serviceAccount = JSON.parse(process.env.GCP_KEY);
// const storage = new Storage({
//   projectId: serviceAccount.project_id,
//   credentials: serviceAccount,
// });



const bucketName = "mathsapp";
const fs = require("fs");

const bucket = storage.bucket(bucketName);

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
  console.log("req.files",req.files);
  const fichiersCopies = [];
  if (!Array.isArray(req.files.fichiers)){
    req.files.fichiers = [req.files.fichiers];
  }
  for (let file of req.files.fichiers) {
    const filePath = `/tmp/${file.name}`;// './tmp/${file.name}' en local
    try {
      //Copie fichier dans dossier /tmp
      const resultMove = await file.mv(filePath);
      if (resultMove) {
        return res.json({ result: false, error: "erreur move" });
      }
      //copie fichier dans cloud strorage
      const repertoireBucket = "repertoire2";
      const destFileName = `${repertoireBucket}/${file.name}`;
      await storage.bucket(bucketName).upload(filePath, {
        destination: destFileName,
      });
      //suppression du fichier du dossier /tmp
      fs.unlinkSync(filePath);
      fichiersCopies.push(file.name);

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
  const name = 'nsiNotes.xlsx'
  const repertoireBucket = "repertoire2";
  const fileDelete = `${repertoireBucket}/${name}`;
  await storage.bucket(bucketName).file(fileDelete).delete()
    res.json({
    result: true,
    fichierSupprime: name,
  });
});

module.exports = router;
