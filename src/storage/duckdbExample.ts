/**
 * @fileoverview Example script to demonstrate usage of the DuckDBService.
 * Creates a sample database, table, inserts data, queries it, and logs results.
 * Database files will be stored in the './duckdata/' directory.
 * @module storage/duckdbExample
 */

import * as fs from "fs";
import * as path from "path";
import { config } from "../config/index.js"; // Added config import
import { DuckDBService } from "../services/duck-db/duckDBService.js";
import { DuckDBServiceConfig } from "../services/duck-db/types.js";
import { BaseErrorCode } from "../types-global/errors.js";
import {
  ErrorHandler,
  idGenerator, // Added idGenerator import
  logger,
  McpLogLevel,
  RequestContext,
  requestContextService,
} from "../utils/index.js";

const DUCKDB_DATA_DIR = path.resolve(process.cwd(), "duckdata");
const DUCKDB_FILE_PATH = path.join(DUCKDB_DATA_DIR, "example.db");

/**
 * Ensures that the directory for storing DuckDB files exists.
 * @param {RequestContext} context - The request context for logging.
 */
function ensureDataDirectoryExists(context: RequestContext): void {
  if (!fs.existsSync(DUCKDB_DATA_DIR)) {
    logger.info(
      `Data directory ${DUCKDB_DATA_DIR} does not exist. Creating...`,
      context,
    );
    try {
      fs.mkdirSync(DUCKDB_DATA_DIR, { recursive: true });
      logger.info(`Data directory ${DUCKDB_DATA_DIR} created.`, context);
    } catch (error) {
      logger.error(
        `Failed to create data directory ${DUCKDB_DATA_DIR}`,
        error as Error,
        context,
      );
      // Re-throw as a critical error if directory creation fails
      throw new Error(
        `Could not create DuckDB data directory: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    logger.debug(`Data directory ${DUCKDB_DATA_DIR} already exists.`, context);
  }

  // Ensure a fresh database file for the example by deleting it if it exists.
  // This allows launchConfig settings like custom_user_agent to be applied on each run.
  if (fs.existsSync(DUCKDB_FILE_PATH)) {
    logger.info(
      `Existing DuckDB file ${DUCKDB_FILE_PATH} found. Deleting for a fresh example run...`,
      context,
    );
    try {
      fs.unlinkSync(DUCKDB_FILE_PATH);
      logger.info(`Successfully deleted ${DUCKDB_FILE_PATH}.`, context);
    } catch (error) {
      logger.error(
        `Failed to delete existing DuckDB file ${DUCKDB_FILE_PATH}`,
        error as Error,
        context,
      );
      // Re-throw as a critical error if deletion fails, as it will likely cause subsequent errors
      throw new Error(
        `Could not delete existing DuckDB file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function runDuckDBExample(): Promise<void> {
  const operation = "runDuckDBExample";
  const context = requestContextService.createRequestContext({ operation });

  logger.notice("Starting DuckDB example script...", context);

  ensureDataDirectoryExists(context);

  const service = new DuckDBService();
  const config: DuckDBServiceConfig = {
    dbPath: DUCKDB_FILE_PATH,
    extensions: ["json"], // Example: include an extension
    launchConfig: { custom_user_agent: "DuckDBExampleScript/1.0" },
  };

  try {
    logger.info(
      `Initializing DuckDBService with path: ${config.dbPath}`,
      context,
    );
    await service.initialize(config);
    logger.info("DuckDBService initialized.", context);

    // Create a table
    const createTableSql = `
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(6) PRIMARY KEY,
        name VARCHAR NOT NULL,
        email VARCHAR,
        createdAt TIMESTAMP DEFAULT current_timestamp
      );
    `;
    logger.info("Creating 'users' table...", {
      ...context,
      sql: createTableSql,
    });
    await service.run(createTableSql);
    logger.info("'users' table created or already exists.", context);

    // Insert data
    const usersToInsert = [
      { name: "Alice Wonderland", email: "alice@example.com" },
      { name: "Bob The Builder", email: "bob@example.com" },
      { name: "Charlie Chaplin", email: "charlie@example.com" },
    ].map((user) => ({
      id: idGenerator.generateRandomString(6), // Generate 6-digit alphanumeric ID directly
      ...user,
    }));

    logger.info("Inserting data into 'users' table...", {
      ...context,
      users: usersToInsert.length,
    });
    for (const user of usersToInsert) {
      // Check if user already exists to prevent primary key constraint errors on re-runs
      const existingUser = await service.query(
        "SELECT id FROM users WHERE id = ?",
        [user.id],
      );
      if (existingUser.rowCount === 0) {
        await service.run(
          "INSERT INTO users (id, name, email) VALUES (?, ?, ?)",
          [user.id, user.name, user.email],
        );
        logger.debug(`Inserted user with ID: ${user.id}`, context);
      } else {
        logger.debug(
          `User with ID: ${user.id} already exists. Skipping insertion.`,
          context,
        );
      }
    }
    logger.info("Data insertion complete.", context);

    // Query data
    const querySql =
      "SELECT id, name, email, createdAt FROM users ORDER BY id;";
    logger.info("Querying 'users' table...", { ...context, sql: querySql });
    const result = await service.query(querySql);

    logger.notice("Query Results:", {
      ...context,
      rowCount: result.rowCount,
      columnNames: result.columnNames,
    });
    result.rows.forEach((row: Record<string, unknown>, index: number) => {
      logger.info(`Row ${index + 1}:`, { ...context, rowData: row });
    });

    // Example of using an extension function (json)
    // Use the ID of the first inserted user for the query
    if (usersToInsert.length > 0) {
      const firstUserId = usersToInsert[0].id;
      const jsonQuerySql =
        "SELECT json_object('id', id, 'name', name, 'email', email) AS user_json FROM users WHERE id = ?;"; // Added email to json_object
      logger.info(
        "Querying with JSON extension function for a specific user...",
        {
          ...context,
          sql: jsonQuerySql,
          userId: firstUserId,
        },
      );
      const jsonResult = await service.query(jsonQuerySql, [firstUserId]);
      if (jsonResult.rowCount > 0) {
        logger.info("JSON Query Result:", {
          ...context,
          jsonData: jsonResult.rows[0],
        });
      } else {
        logger.warning(
          `Could not find user with ID ${firstUserId} for JSON query example.`,
          context,
        ); // Changed warn to warning
      }
    } else {
      logger.info(
        "Skipping JSON query example as no users were inserted.",
        context,
      );
    }
  } catch (error) {
    // ErrorHandler.tryCatch is used within the service, so errors should be McpError
    // If an error occurs outside service calls (e.g. directory creation), it might be a standard Error
    logger.error(
      "An error occurred in the DuckDB example script",
      error as Error,
      {
        ...context,
        isMcpError: error instanceof Object && "errorCode" in error, // Basic check
      },
    );
  } finally {
    logger.info("Closing DuckDBService...", context);
    // Wrap close in its own tryCatch as it might also throw
    try {
      await service.close();
      logger.info("DuckDBService closed.", context);
    } catch (closeError) {
      logger.error(
        "Failed to close DuckDBService",
        closeError as Error,
        context,
      );
    }
  }
  logger.notice("DuckDB example script finished.", context);
}

// Self-executing async function
(async () => {
  // Initialize the logger before any other operations
  // Ensure config.logLevel is correctly typed as McpLogLevel for the initialize method.
  await logger.initialize(config.logLevel as McpLogLevel);

  // Setup a global error handler for unhandled rejections or exceptions
  // specific to this script's execution context.
  const scriptContext = requestContextService.createRequestContext({
    operation: "DuckDBExampleScript.main",
  });
  try {
    await ErrorHandler.tryCatch(runDuckDBExample, {
      operation: "runDuckDBExample.mainExecution",
      context: scriptContext,
      errorCode: BaseErrorCode.INTERNAL_ERROR, // Changed from SCRIPT_EXECUTION_ERROR
      critical: true, // If the main example fails, it's critical for the script
    });
  } catch (e) {
    // This catch is for errors that ErrorHandler.tryCatch itself might rethrow
    // or if ErrorHandler is bypassed.
    logger.crit(
      "Unhandled critical error in DuckDB example script execution.",
      e as Error,
      scriptContext,
    );
    process.exit(1); // Exit with error code
  }
})();
