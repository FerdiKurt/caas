module.exports = {
  databaseUrl:
    process.env.DATABASE_URL ||
    `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`,
  dir: "migrations",
  migrationTable: "pgmigrations",
  logger: console,
};
