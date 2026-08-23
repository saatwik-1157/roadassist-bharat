import { createClient } from "@roadassist/db";
import { env } from "./env.js";

const { sql, db } = createClient(env.databaseUrl);

export { sql, db };
export type Db = typeof db;
