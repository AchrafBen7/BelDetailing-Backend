import express from "express";

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "BelDetailing Backend is running 🔥" });
});

app.listen(8000, () => {
  console.log("Server running on http://localhost:8000");
});
