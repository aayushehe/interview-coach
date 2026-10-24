import app from "./app";
import { logger } from "./lib/logger";
import { explainDatabaseError, initDatabase } from "./lib/db-init";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function main() {
  await initDatabase();
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}

main().catch((error) => {
  logger.error({ err: error }, "The server could not start");
  console.error(`\nCould not start: ${explainDatabaseError(error)}\n`);
  process.exit(1);
});
