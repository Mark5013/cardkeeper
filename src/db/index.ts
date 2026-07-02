import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
const maxConnections = Number(process.env.DATABASE_MAX_CONNECTIONS ?? "1");

if (!connectionString) {
  throw new Error("DATABASE_URL is required when accessing the database.");
}

const client = postgres(connectionString, {
  prepare: false,
  max: Number.isInteger(maxConnections) && maxConnections > 0 ? maxConnections : 1,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });
