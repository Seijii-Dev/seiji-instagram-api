import app from "../api/index.js";

const port = Number(process.env.PORT || 3000);
app.listen(port, "0.0.0.0", () => console.log(`API listening on http://localhost:${port}`));
