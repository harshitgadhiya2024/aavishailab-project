// What a company can connect for data residency, and what each one asks for.
// The API validates everything again; this only drives the form.

export type FieldDef = {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "password" | "number" | "select" | "checkbox";
  options?: { value: string; label: string }[];
  help?: string;
  optional?: boolean;
  /** Secret fields are never sent back by the API; blank keeps the saved value. */
  secret?: boolean;
  half?: boolean;
};

export type Provider = {
  id: string;
  name: string;
  tagline: string;
  /** Short monogram shown in the tile (no third-party logos bundled). */
  mark: string;
  fields: FieldDef[];
  defaults?: Record<string, any>;
  /** Plain-language permission requirement. */
  permissions: string;
  /** Copyable setup snippet (SQL grant, IAM policy …). */
  snippet?: { title: string; code: string };
  docs?: string;
};

const TLS_FIELD: FieldDef = {
  key: "tls",
  label: "Encryption in transit",
  type: "select",
  options: [
    { value: "verify-full", label: "Encrypted, certificate verified (recommended)" },
    { value: "require", label: "Encrypted, self-signed certificate allowed" },
    { value: "disable", label: "Not encrypted (only on a private link)" },
  ],
  help: "Use a verified certificate whenever your server has one from a public authority.",
};

const sqlFields = (port: number, userHint: string): FieldDef[] => [
  { key: "host", label: "Host", placeholder: "db.yourcompany.com", help: "A public hostname or IP address Aavishield can reach." },
  { key: "port", label: "Port", type: "number", placeholder: String(port), half: true },
  { key: "database", label: "Database", placeholder: "aavishield", half: true },
  { key: "username", label: "Username", placeholder: userHint, half: true },
  { key: "password", label: "Password", type: "password", secret: true, half: true },
];

export const DATABASES: Provider[] = [
  {
    id: "postgres",
    name: "PostgreSQL",
    tagline: "Also Amazon RDS / Aurora, Azure, Cloud SQL, Supabase, Neon",
    mark: "Pg",
    fields: [
      ...sqlFields(5432, "aavishield"),
      { key: "schema", label: "Schema", placeholder: "public", optional: true, help: "Aavishield's tables go in this schema." },
      TLS_FIELD,
    ],
    defaults: { port: 5432, schema: "public", tls: "verify-full" },
    permissions:
      "The user needs to read, write, update and delete rows, and to create tables in the schema the first time it connects.",
    snippet: {
      title: "Create a dedicated user",
      code: `CREATE USER aavishield WITH PASSWORD 'choose-a-strong-password';
GRANT CONNECT ON DATABASE your_database TO aavishield;
GRANT USAGE, CREATE ON SCHEMA public TO aavishield;`,
    },
  },
  {
    id: "mysql",
    name: "MySQL",
    tagline: "Also Amazon RDS / Aurora MySQL, Azure, Cloud SQL, PlanetScale",
    mark: "My",
    fields: [...sqlFields(3306, "aavishield"), TLS_FIELD],
    defaults: { port: 3306, tls: "verify-full" },
    permissions: "The user needs SELECT, INSERT, UPDATE, DELETE, CREATE and INDEX on this database.",
    snippet: {
      title: "Create a dedicated user",
      code: `CREATE USER 'aavishield'@'%' IDENTIFIED BY 'choose-a-strong-password';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX ON your_database.* TO 'aavishield'@'%';`,
    },
  },
  {
    id: "mariadb",
    name: "MariaDB",
    tagline: "Version 10.5 or later",
    mark: "Ma",
    fields: [...sqlFields(3306, "aavishield"), TLS_FIELD],
    defaults: { port: 3306, tls: "verify-full" },
    permissions: "The user needs SELECT, INSERT, UPDATE, DELETE, CREATE and INDEX on this database.",
    snippet: {
      title: "Create a dedicated user",
      code: `CREATE USER 'aavishield'@'%' IDENTIFIED BY 'choose-a-strong-password';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX ON your_database.* TO 'aavishield'@'%';`,
    },
  },
  {
    id: "sqlserver",
    name: "Microsoft SQL Server",
    tagline: "SQL Server 2016+ and Azure SQL Database",
    mark: "MS",
    fields: [...sqlFields(1433, "aavishield"), TLS_FIELD],
    defaults: { port: 1433, tls: "verify-full" },
    permissions:
      "The login needs to read and write data (db_datareader, db_datawriter) and to create tables in its default schema.",
    snippet: {
      title: "Create a dedicated login",
      code: `CREATE LOGIN aavishield WITH PASSWORD = 'Choose-a-strong-password1';
USE your_database;
CREATE USER aavishield FOR LOGIN aavishield;
ALTER ROLE db_datareader ADD MEMBER aavishield;
ALTER ROLE db_datawriter ADD MEMBER aavishield;
GRANT CREATE TABLE TO aavishield;
GRANT ALTER ON SCHEMA::dbo TO aavishield;`,
    },
  },
  {
    id: "mongodb",
    name: "MongoDB",
    tagline: "Also MongoDB Atlas, Amazon DocumentDB, Azure Cosmos DB (MongoDB API)",
    mark: "Mg",
    fields: [
      { key: "uri", label: "Connection string", placeholder: "mongodb+srv://aavishield:<password>@cluster0.example.mongodb.net/", secret: true,
        help: "From Atlas: Connect → Drivers. Leave blank to enter host and credentials instead." },
      { key: "database", label: "Database", placeholder: "aavishield" },
      { key: "host", label: "Host", placeholder: "mongo.yourcompany.com", optional: true, half: true },
      { key: "port", label: "Port", type: "number", placeholder: "27017", optional: true, half: true },
      { key: "username", label: "Username", optional: true, half: true },
      { key: "password", label: "Password", type: "password", secret: true, optional: true, half: true },
      TLS_FIELD,
    ],
    defaults: { port: 27017, tls: "verify-full" },
    permissions: "The user needs the readWrite role on this database (it includes creating collections and indexes).",
    snippet: {
      title: "Create a dedicated user",
      code: `use admin
db.createUser({
  user: "aavishield",
  pwd: "choose-a-strong-password",
  roles: [{ role: "readWrite", db: "aavishield" }]
})`,
    },
  },
];

const s3Fields = (extra: FieldDef[] = []): FieldDef[] => [
  { key: "bucket", label: "Bucket", placeholder: "yourcompany-aavishield" },
  ...extra,
  { key: "access_key_id", label: "Access key ID", half: true },
  { key: "secret_access_key", label: "Secret access key", type: "password", secret: true, half: true },
  { key: "prefix", label: "Folder (optional)", placeholder: "aavishield", optional: true,
    help: "Keeps Aavishield's files in their own folder of a bucket you also use for other things." },
];

const OBJECT_PERMS =
  "The key needs to upload (write), read and delete objects in this bucket. Keep the bucket private: screenshots are shown through links that expire after 15 minutes, so public access is not needed — and should stay off.";

export const FILE_STORES: Provider[] = [
  {
    id: "s3",
    name: "Amazon S3",
    tagline: "Any AWS region",
    mark: "S3",
    fields: s3Fields([{ key: "region", label: "Region", placeholder: "ap-south-1", half: true }]),
    permissions: OBJECT_PERMS,
    snippet: {
      title: "IAM policy for the key",
      code: `{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
    "Resource": "arn:aws:s3:::yourcompany-aavishield/*"
  }]
}`,
    },
  },
  {
    id: "r2",
    name: "Cloudflare R2",
    tagline: "No egress fees",
    mark: "R2",
    fields: s3Fields([{ key: "account_id", label: "Account ID", placeholder: "32-character ID from the R2 overview page" }]),
    permissions: `${OBJECT_PERMS} In R2, create an API token with "Object Read & Write" for this bucket.`,
  },
  {
    id: "gcs",
    name: "Google Cloud Storage",
    tagline: "Through HMAC interoperability keys",
    mark: "GC",
    fields: s3Fields(),
    permissions: `${OBJECT_PERMS} Create HMAC keys (Cloud Storage → Settings → Interoperability) for a service account with the Storage Object User role on this bucket.`,
  },
  {
    id: "azure_blob",
    name: "Azure Blob Storage",
    tagline: "Storage account + container",
    mark: "Az",
    fields: [
      { key: "account_name", label: "Storage account", placeholder: "yourcompanystorage", half: true },
      { key: "container", label: "Container", placeholder: "aavishield", half: true },
      { key: "account_key", label: "Access key", type: "password", secret: true, help: "Storage account → Security + networking → Access keys." },
      { key: "endpoint", label: "Blob endpoint (optional)", placeholder: "https://yourcompanystorage.blob.core.windows.net", optional: true,
        help: "Only for sovereign clouds or private endpoints." },
      { key: "prefix", label: "Folder (optional)", placeholder: "aavishield", optional: true },
    ],
    permissions:
      "The access key must be able to write, read and delete blobs in the container. Keep the container private (no anonymous access): screenshots are shown through links that expire after 15 minutes.",
  },
  {
    id: "s3_compatible",
    name: "S3-compatible",
    tagline: "MinIO, Wasabi, Backblaze B2, DigitalOcean Spaces, on-premises",
    mark: "S3+",
    fields: s3Fields([
      { key: "endpoint", label: "Endpoint URL", placeholder: "https://s3.yourcompany.com" },
      { key: "region", label: "Region", placeholder: "us-east-1", half: true, optional: true },
      { key: "path_style", label: "Path-style addressing (needed by MinIO and most on-premises servers)", type: "checkbox" },
    ]),
    defaults: { path_style: true, region: "us-east-1" },
    permissions: OBJECT_PERMS,
  },
];

export function providerName(list: Provider[], id?: string) {
  return list.find((p) => p.id === id)?.name ?? id ?? "";
}

/** The pre-filled support request for a provider that isn't listed. */
export function customRequestLink(kind: "database" | "file storage") {
  const subject = `Data residency: connect our own ${kind}`;
  const body = [
    `We'd like to keep our employee data in our own ${kind}, which isn't in the list in Settings → Data residency.`,
    "",
    `Which ${kind} (product and version): `,
    "Where it runs (cloud provider / on-premises): ",
    "How Aavishield would reach it (public endpoint, VPN, private link): ",
    "Approximate number of employees / devices: ",
    "Anything else we should know (compliance requirements, deadlines): ",
  ].join("\n");
  const q = new URLSearchParams({ topic: "data_residency", subject, body });
  return `/dashboard/support/new?${q.toString()}`;
}
