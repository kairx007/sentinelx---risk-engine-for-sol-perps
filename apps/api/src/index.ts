import { createApiApp } from "./app.js";

const port = Number(process.env.PORT ?? 3000);

createApiApp().listen(port, () => {
  console.log(`Risk API listening on port ${port}`);
});
