/**
 * @fileoverview Handles the registration of the `health API` resource with an MCP server instance.
 * This module defines the resource's template (URI structure), metadata (name, description, examples),
 * and the asynchronous handler function that processes `resources/read` requests matching the template.
 * It utilizes the MCP SDK's `server.resource()` method for registration and integrates
 * robust error handling using the project's `ErrorHandler` utility.
 * @module src/mcp-server/resources/healthAPIResource/registration
 */

import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  ListResourcesResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import { BaseErrorCode, McpError } from "../../../types-global/errors.js";
import {
  ErrorHandler,
  logger,
  RequestContext,
  requestContextService,
} from "../../../utils/index.js";
import {
  HealthAPIResourceParams,
  processHealthAPIResource,
} from "./healthAPIResourceLogic.js";

/**
 * Registers the 'Health API' resource and its handlers with the provided MCP server instance.
 *
 * This function defines:
 * 1.  The resource template (e.g., `health://{component}`), which determines the URI structure.
 *     The `{component}` part is a path variable.
 * 2.  A `list` operation for the template to provide example/discoverable URIs.
 * 3.  Metadata for the resource, including its user-friendly name, description, MIME type,
 *     and example URIs.
 * 4.  The core asynchronous handler logic for `resources/read` requests that match the template.
 *     This handler processes the request and returns the resource content.
 *
 * Error handling is integrated throughout using `ErrorHandler.tryCatch` for robustness.
 *
 * @param server - The MCP server instance to register the resource with.
 * @returns A promise that resolves when the resource registration is complete. It does not return a value upon successful completion.
 * @throws {McpError} If the registration process fails critically, which might halt server startup.
 * @see {@link HealthAPIResourceParams} for the type of parameters passed to the handler.
 * @see {@link HealthAPIResource} for the core resource logic.
 */
export const registerHealthAPIResource = async (
  server: McpServer,
): Promise<void> => {
  const resourceName = "healthapi-resource"; // Internal identifier for this resource registration.

  const registrationContext: RequestContext =
    requestContextService.createRequestContext({
      operation: "RegisterResource",
      resourceName: resourceName,
      moduleName: "HealthAPIResourceRegistration",
    });

  logger.info(
    `Attempting to register resource: '${resourceName}'`,
    registrationContext,
  );

  await ErrorHandler.tryCatch(
    async () => {
      // Define the resource template. This specifies the URI structure and supported operations.
      // The URI `health://{component}` uses RFC 6570 syntax, where `{component}` is a path variable.
      const template = new ResourceTemplate("health://", {
        /**
         * Asynchronous handler for the `resources/list` operation associated with this template.
         * It provides a list of example or discoverable resource URIs that match this template.
         * This allows clients to discover how to interact with the Health API resource.
         *
         * @returns A promise resolving to an object containing an array of resource descriptors.
         */
        list: async (): Promise<ListResourcesResult> => {
          const listContext: RequestContext =
            requestContextService.createRequestContext({
              parentContext: registrationContext,
              operation: "ListHealthAPIResourceExamples",
            });
          logger.debug(
            "Executing list operation for health API resource template.",
            listContext,
          );
          // Return a static list of example URIs.
          return {
            resources: [
              {
                uri: "health://",
                name: "Default Health resource",
                description:
                  "A simple health resource example without specifying a specific components.",
              }
            ],
            // nextCursor could be used here if the list were paginated.
          };
        },
        // The `complete` operation (for URI completion suggestions) is optional and not implemented here.
      });
      logger.debug(
        `Resource template created for '${resourceName}': ${template.uriTemplate}`,
        registrationContext,
      );

      // Register the resource with the server.
      // This involves providing the registration name, the template, metadata, and the handler for read operations.
      server.resource(
        resourceName,
        template,
        {
          name: "Health API Resource",
          description:
            "A resource that returns the health of the HiveMQ Broker.",
          mimeType: "application/json",
          examples: [
            {
              name: "Basic health API request",
              uri: "health://",
              description:
                "Accesses the health API to inform the state of the Broker.",
            }
          ],
        },

        /**
         * Asynchronous handler for `resources/read` requests matching the `health://{component}` template.
         * This function is invoked by the MCP SDK when a client requests to read a resource
         * whose URI matches the registered template.
         *
         * The SDK extracts path variables (like `{component}` from `health://{component}`) from the URI.
         * These path variables, along with any validated query parameters, are passed in the `params` object.
         *
         * @param uri - The full URL object of the resource being requested.
         * @param params - An object containing parameters derived from the request.
         *   For this resource, it's expected to include `component` extracted from the URI
         *   path by the SDK. It conforms to {@link HealthAPIResourceParams}.
         * @returns A promise that resolves with the resource content, formatted as a `ReadResourceResult`.
         *   This includes the URI, Base64 encoded content blob, and MIME type.
         *   If an error is thrown from this handler, the SDK is responsible for catching it and
         *   formatting an error response.
         */
        async (
          uri: URL
        ): Promise<ReadResourceResult> => {
          const handlerContext: RequestContext =
            requestContextService.createRequestContext({
              parentContext: registrationContext,
              operation: "HandleResourceRead",
              resourceName: resourceName,
              resourceUri: uri.href
            });


          return await ErrorHandler.tryCatch(
            async () => {
              const responseData = processHealthAPIResource(
                uri,
                handlerContext,
              );

              logger.debug(
                `'${resourceName}' (URI: ${uri.href}) processed successfully. Preparing content.`,
                handlerContext,
              );

              // Construct the `ReadResourceResult` as expected by the MCP SDK.
              // The content (blob) must be Base64 encoded.
              return {
                contents: [
                  {
                    uri: uri.href,
                    blob: Buffer.from(JSON.stringify(responseData)).toString(
                      "base64",
                    ),
                    mimeType: "application/json",
                  },
                ],
              };
            },
            {
              operation: `ExecutingCoreLogicFor_${resourceName}_Read`,
              context: handlerContext,
              input: { uri: uri.href },
              errorMapper: (error: unknown): McpError => {
                const baseErrorCode =
                  error instanceof McpError
                    ? error.code
                    : BaseErrorCode.INTERNAL_ERROR;
                const errorMessage = `Error processing read request for resource '${uri.href}': ${error instanceof Error ? error.message : "An unknown error occurred"}`;
                return new McpError(baseErrorCode, errorMessage, {
                  ...handlerContext,
                  originalErrorName:
                    error instanceof Error ? error.name : typeof error,
                });
              },
            },
          );
        },
      );

      logger.info(
        `Resource '${resourceName}' (template: '${template.uriTemplate}') registered successfully.`,
        registrationContext,
      );
    },
    {
      operation: `RegisteringResource_${resourceName}`,
      context: registrationContext,
      errorCode: BaseErrorCode.INITIALIZATION_FAILED,
      errorMapper: (error: unknown): McpError => {
        const errorMessage = `Failed to register resource '${resourceName}': ${error instanceof Error ? error.message : "An unknown error occurred during registration."}`;
        const code =
          error instanceof McpError
            ? error.code
            : BaseErrorCode.INITIALIZATION_FAILED;
        return new McpError(code, errorMessage, {
          ...registrationContext,
          originalErrorName: error instanceof Error ? error.name : typeof error,
        });
      },
      critical: true,
    },
  );
};
