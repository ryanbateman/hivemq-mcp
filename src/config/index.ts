import dotenv from "dotenv";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

dotenv.config(); // Load environment variables from .env file

// Determine the directory name of the current module
const __dirname = dirname(fileURLToPath(import.meta.url));
// Construct the path to package.json relative to the current file
const pkgPath = join(__dirname, "../../package.json");
// Default package information in case package.json is unreadable
let pkg = { name: "mcp-ts-template", version: "0.0.0" };

try {
  // Read and parse package.json to get default server name and version
  pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
} catch (error) {
  // Silently use default pkg info if reading fails.
  // Consider adding logging here if robust error handling is needed.
  if (process.stdout.isTTY) {
    // Guarded console.error
    console.error(
      "Warning: Could not read package.json for default config values.",
      error,
    );
  }
}

// Define a schema for environment variables for validation and type safety
const EnvSchema = z.object({
  MCP_SERVER_NAME: z.string().optional(),
  MCP_SERVER_VERSION: z.string().optional(),
  MCP_LOG_LEVEL: z.string().default("info"),
  NODE_ENV: z.string().default("development"),
  MCP_TRANSPORT_TYPE: z.enum(["stdio", "http"]).default("stdio"),
  MCP_HTTP_PORT: z.coerce.number().int().positive().default(3010), // Updated default port
  MCP_HTTP_HOST: z.string().default("127.0.0.1"),
  MCP_ALLOWED_ORIGINS: z.string().optional(), // Comma-separated string
  MCP_AUTH_SECRET_KEY: z
    .string()
    .min(
      32,
      "MCP_AUTH_SECRET_KEY must be at least 32 characters long for security",
    )
    .optional(), // Secret for signing/verifying tokens

  // OpenRouter and LLM specific configurations
  OPENROUTER_APP_URL: z
    .string()
    .url("OPENROUTER_APP_URL must be a valid URL")
    .optional(),
  OPENROUTER_APP_NAME: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  LLM_DEFAULT_MODEL: z
    .string()
    .default("google/gemini-2.5-flash-preview:thinking"),
  LLM_DEFAULT_TEMPERATURE: z.coerce.number().min(0).max(2).optional(),
  LLM_DEFAULT_TOP_P: z.coerce.number().min(0).max(1).optional(),
  LLM_DEFAULT_MAX_TOKENS: z.coerce.number().int().positive().optional(),
  LLM_DEFAULT_TOP_K: z.coerce.number().int().nonnegative().optional(), // top_k can be 0
  LLM_DEFAULT_MIN_P: z.coerce.number().min(0).max(1).optional(),
});

// Parse and validate environment variables
const parsedEnv = EnvSchema.safeParse(process.env);

if (!parsedEnv.success) {
  if (process.stdout.isTTY) {
    console.error(
      "❌ Invalid environment variables:",
      parsedEnv.error.flatten().fieldErrors,
    );
  }
  // Decide if the application should exit or continue with defaults
  // For critical configs, you might want to throw an error:
  // throw new Error("Invalid environment configuration.");
  // For now, we'll log the error and proceed with defaults where possible.
}

const env = parsedEnv.success ? parsedEnv.data : EnvSchema.parse({}); // Use defaults on failure

/**
 * Main application configuration object.
 * Aggregates settings from environment variables and package.json.
 */
export const config = {
  /**
   * The name of the MCP server.
   * Prioritizes MCP_SERVER_NAME env var, falls back to package.json name.
   * Default: 'mcp-ts-template' (from package.json)
   */
  mcpServerName: env.MCP_SERVER_NAME || pkg.name,

  /**
   * The version of the MCP server.
   * Prioritizes MCP_SERVER_VERSION env var, falls back to package.json version.
   * Default: (from package.json)
   */
  mcpServerVersion: env.MCP_SERVER_VERSION || pkg.version,

  /**
   * Logging level for the application (e.g., "debug", "info", "warning", "error").
   * Controlled by MCP_LOG_LEVEL env var.
   * Default: "info"
   */
  logLevel: env.MCP_LOG_LEVEL,

  /**
   * The runtime environment (e.g., "development", "production").
   * Controlled by NODE_ENV env var.
   * Default: "development"
   */
  environment: env.NODE_ENV,

  /**
   * Specifies the transport mechanism for the server.
   * Controlled by MCP_TRANSPORT_TYPE env var. Options: 'stdio', 'http'.
   * Default: "stdio"
   */
  mcpTransportType: env.MCP_TRANSPORT_TYPE,

  /**
   * The port number for the HTTP server to listen on (if MCP_TRANSPORT_TYPE is 'http').
   * Controlled by MCP_HTTP_PORT env var.
   * Default: 3010
   */
  mcpHttpPort: env.MCP_HTTP_PORT,

  /**
   * The host address for the HTTP server to bind to (if MCP_TRANSPORT_TYPE is 'http').
   * Controlled by MCP_HTTP_HOST env var.
   * Default: "127.0.0.1"
   */
  mcpHttpHost: env.MCP_HTTP_HOST,

  /**
   * Comma-separated list of allowed origins for CORS requests when using the 'http' transport.
   * Controlled by MCP_ALLOWED_ORIGINS env var.
   * Default: undefined (meaning CORS might be restrictive by default in the transport layer)
   */
  mcpAllowedOrigins: env.MCP_ALLOWED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),

  /**
   * A secret key used for signing and verifying authentication tokens (e.g., JWT).
   * MUST be set in production for HTTP transport security.
   * Controlled by MCP_AUTH_SECRET_KEY env var.
   * Default: undefined (Auth middleware should throw error if not set in production)
   */
  mcpAuthSecretKey: env.MCP_AUTH_SECRET_KEY,

  // OpenRouter and LLM specific properties
  openrouterAppUrl: env.OPENROUTER_APP_URL || "http://localhost:3000", // Default if not set
  openrouterAppName: env.OPENROUTER_APP_NAME || pkg.name || "MCP TS App", // Default if not set
  openrouterApiKey: env.OPENROUTER_API_KEY, // No default, service handles if missing
  llmDefaultModel: env.LLM_DEFAULT_MODEL,
  llmDefaultTemperature: env.LLM_DEFAULT_TEMPERATURE,
  llmDefaultTopP: env.LLM_DEFAULT_TOP_P,
  llmDefaultMaxTokens: env.LLM_DEFAULT_MAX_TOKENS,
  llmDefaultTopK: env.LLM_DEFAULT_TOP_K,
  llmDefaultMinP: env.LLM_DEFAULT_MIN_P,

  // Note: mcpClient configuration is loaded separately via src/mcp-client/configLoader.ts
  // Note: Logger-specific configurations (LOG_FILE_PATH, LOG_MAX_FILES, etc.)
  //       are typically handled directly within the logger utility (src/utils/internal/logger.ts)
};

/**
 * The configured logging level for the application.
 * Exported separately for convenience (e.g., logger initialization).
 * @type {string}
 */
export const logLevel = config.logLevel;

/**
 * The configured runtime environment for the application.
 * Exported separately for convenience.
 * @type {string}
 */
export const environment = config.environment;

// Logger initialization and validation logic should occur at the application entry point (e.g., src/index.ts)
// after configuration is loaded.
