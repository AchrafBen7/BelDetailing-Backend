import app from "./app.js";
import "dotenv/config";

const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
  console.log(`BelDetailing API running on http://localhost:${PORT}`);
});
