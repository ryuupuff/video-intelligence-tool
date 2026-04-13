const path = require("path");
const express = require("express");
require("dotenv").config();

const summarizeRoutes = require("../routes/summarizeRoutes");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

app.use("/summarize", summarizeRoutes);

app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
    message: "That route does not exist."
  });
});

app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({
    error: err.code || "SERVER_ERROR",
    message: err.publicMessage || "Something went wrong while processing the video."
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Video Intelligence Tool running at http://localhost:${PORT}`);
  });
}

module.exports = app;
