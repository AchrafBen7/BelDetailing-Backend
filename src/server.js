import app from "./app.js";
import "dotenv/config";
import dotenv from "dotenv";
dotenv.config();

console.log("SERVER ENV SUPABASE_URL =", process.env.SUPABASE_URL);

const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
  console.log(`BelDetailing API running on http://localhost:${PORT}`);
});
