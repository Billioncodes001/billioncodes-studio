import { DatabaseSync } from "node:sqlite";
import { createApplication } from "../server.mjs";
// Only this isolated browser-test database receives a legacy fixture.
const db = new DatabaseSync(process.env.DATABASE);
db.exec("CREATE TABLE workspace (id INTEGER PRIMARY KEY, data TEXT NOT NULL)");
db.prepare("INSERT INTO workspace VALUES (1, ?)").run(
  JSON.stringify({
    briefs: [
      {
        id: "5d5295c8-043b-47db-9a6f-9c95663978a5",
        name: "Original fictional demo",
        kind: "Website",
        pages: "5",
        care: true,
        estimate: 240000,
      },
    ],
  }),
);
db.close();
const server = createApplication();
server.listen(Number(process.env.PORT), "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => server.close());
