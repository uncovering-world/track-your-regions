const Joi = require('joi');

// Capture initial environment variables
const initialEnvVars = new Set(Object.keys(process.env));

// Load .env files
require('dotenv-flow').config();

// Capture environment variables after loading .env files
const postLoadEnvVars = new Set(Object.keys(process.env));

// Identify variables added by .env files
const dotenvAddedVars = new Set([...postLoadEnvVars].filter((x) => !initialEnvVars.has(x)));

const postgresIdentifierPattern = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/; // Common pattern for DB_USER and DB_NAME

const envVarsSchema = Joi.object({
  DB_USER: Joi.string().pattern(postgresIdentifierPattern).required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().pattern(postgresIdentifierPattern).required().invalid('postgres', 'template0', 'template1'), // Invalidating certain reserved DB names
  DB_HOST: Joi.string().hostname().default('localhost'),
}).unknown(); // Allow other environment variables

const { error, value: envVars } = envVarsSchema.validate(process.env);

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

// Check for unknown keys in dotenv-added variables
const knownKeys = Object.keys(envVarsSchema.describe().keys);
const unknownKeys = [...dotenvAddedVars].filter((key) => !knownKeys.includes(key));
if (unknownKeys.length > 0) {
  console.warn(`Warning: Unknown .env variables detected: ${unknownKeys.join(', ')}`);
}

module.exports = {
  db_user: envVars.DB_USER,
  db_password: envVars.DB_PASSWORD,
  db_name: envVars.DB_NAME,
  db_host: envVars.DB_HOST,
  db_dialect: 'postgres',
};
