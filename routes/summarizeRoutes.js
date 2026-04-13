const express = require("express");
const { summarizeVideo } = require("../controllers/summarizeController");

const router = express.Router();

router.post("/", summarizeVideo);

module.exports = router;
