# Changelog

All notable changes to this project will be documented in this file.

## [1.1.3] - 2025-05-02

### Added

- **HTTP Authentication**: Implemented mandatory JWT-based authentication for the HTTP transport (`src/mcp-server/transports/authentication/authMiddleware.ts`) as required by MCP security guidelines. Added `jsonwebtoken` dependency.
- **Configuration**: Added `MCP_AUTH_SECRET_KEY` environment variable for JWT signing/verification.

### Changed

- **Dependencies**: Updated `@modelcontextprotocol/sdk` to `^1.11.0`.
- **HTTP Transport**: Integrated authentication middleware, enhanced security headers (CSP, Referrer-Policy), and improved logging context/clarity.
- **Server Core**: Refined server initialization logging and error handling. Improved comments referencing MCP specifications.
- **Stdio Transport**: Improved logging context and added comments referencing MCP specifications and authentication guidelines.
- **Documentation**: Updated `README.md` with new version badges, authentication details, and configuration variable (`MCP_AUTH_SECRET_KEY`). Regenerated `docs/tree.md`.


## [1.1.2] - 2025-05-01

### Added

- **Utility Script**: Added `scripts/fetch-openapi-spec.ts`, a generic script to fetch OpenAPI specifications (YAML/JSON) from a URL with fallback logic, parse them, and save both YAML and JSON versions locally.
- **NPM Script**: Added `fetch-spec` script to `package.json` for running the new OpenAPI fetch script (`ts-node --esm scripts/fetch-openapi-spec.ts <url> <output-base-path>`).
- **Dependencies**: Added `axios`, `js-yaml`, and `@types/js-yaml` as dev dependencies required by the new fetch script.

### Changed

- **Documentation**: Updated `README.md` (Detailed Features Table) and `.clinerules` (Utility Scripts section) to include details about the new `fetch-openapi-spec.ts` script and its usage.


The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.1] - 2025-05-01

### Changed

- **Configuration Refactoring**: Centralized the handling of environment variables (`MCP_TRANSPORT_TYPE`, `MCP_HTTP_PORT`, `MCP_HTTP_HOST`, `MCP_ALLOWED_ORIGINS`, `MCP_SERVER_NAME`, `MCP_SERVER_VERSION`, `MCP_LOG_LEVEL`, `NODE_ENV`) within `src/config/index.ts` using Zod for validation and defaulting.
- Updated `src/mcp-server/server.ts`, `src/mcp-server/transports/httpTransport.ts`, `src/index.ts`, and `src/utils/security/rateLimiter.ts` to consistently use the validated configuration object from `src/config/index.ts` instead of accessing `process.env` directly.
- Changed the default HTTP port (`MCP_HTTP_PORT`) from 3000 to 3010 in the configuration.

## [1.1.0] - 2025-05-01

This release focuses on integrating API documentation generation, enhancing the HTTP transport layer, and refining server initialization and logging.

- **API Documentation & Build**: Integrated TypeDoc for automated API documentation generation. Added `typedoc.json` configuration and a `docs:generate` script to `package.json`. Updated `.gitignore` to exclude the generated `docs/api/` directory and refreshed `README.md` and `docs/tree.md`. (Commit: `b1e5f4d` - approx, based on sequence)
- **MCP Types & Server Initialization**: Removed redundant local MCP type definitions (`src/types-global/mcp.ts`, `src/types-global/tool.ts`), relying on the SDK types. Refactored the main server entry point (`src/index.ts`) to initialize the logger _after_ configuration loading and used an async IIFE for startup. Improved JSDoc clarity in server, resource, and tool registration files. (Commit: `0459112`)
- **HTTP Transport & Logging Enhancements**:
  - Added stricter security headers (CSP, HSTS, Permissions-Policy) to HTTP responses.
  - Improved logging detail within the HTTP transport for origin checks, session handling, port checks, and request flow.
  - Made logger initialization asynchronous and added conditional console logging (active only when `MCP_LOG_LEVEL=debug` and stdout is a TTY).
  - Implemented a workaround for an SDK `isInitializeRequest` check issue in the HTTP transport.
  - Changed the default HTTP port from 3000 to 3010.
  - Enhanced port conflict detection with proactive checks before binding.
  - Cleaned up minor logging inconsistencies. (Commit: `76bf1b8`)

## [1.0.6] - 2025-04-29

### Added

- Zod dependency for enhanced schema validation (`e038177`).

### Changed

- **Project Alignment**: Updated core components to align with the **MCP Specification (2025-03-26)** and **TypeScript SDK (v1.10.2+)**. Key areas refactored include:
  - **Server**: Implemented Streamable HTTP transport (`b2b8665`).
  - **Client**: Enhanced capabilities handling, configuration loading (using Zod), and transport management (Stdio/HTTP) (`38f68b8`).
  - **Logging**: Aligned log levels with RFC 5424 standards and added notification support (`cad6f29`).
  - **Configuration**: Improved validation and aligned log level settings (`6c1e958`).
  - **Echo Example**: Updated Echo tool and resource implementations, including Base64 handling (`a7f385f`).
- **Server Refinement**: Enhanced `src/mcp-server/server.ts` with comprehensive JSDoc comments, improved logging messages, and refined HTTP transport logic including error handling and session management (`6c54d1e`).
- **Documentation**: Updated project documentation and internal cheatsheets (`de12abf`, `53c7c0d`).
