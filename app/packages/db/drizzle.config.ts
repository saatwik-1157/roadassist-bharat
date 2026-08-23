import type { Config } from "drizzle-kit";

export default {
  // Point at the build output, not the TypeScript sources: drizzle-kit loads
  // schema files through a CJS shim that cannot resolve NodeNext's mandatory
  // ".js" import specifiers. `npm run build` first, then generate.
  schema: "./dist/src/schema/*.js",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://roadassist:devpassword@localhost:5434/roadassist",
  },
  verbose: true,
  strict: false,
} satisfies Config;
