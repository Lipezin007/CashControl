const { Pool } = require("pg");

// Aiven e a maioria dos bancos cloud exigem SSL.
// rejectUnauthorized: false aceita o certificado auto-assinado do Aiven.
function sslConfig() {
  const url = process.env.DATABASE_URL || "";
  if (url.includes("sslmode=require") || process.env.NODE_ENV === "production") {
    return { rejectUnauthorized: false };
  }
  return false;
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig()
});

module.exports = pool;
