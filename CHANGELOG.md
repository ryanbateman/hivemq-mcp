# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Zod dependency for enhanced schema validation (`e038177`).

### Changed
- **Project Alignment**: Updated core components to align with the **MCP Specification (2025-03-26)** and **TypeScript SDK (v1.10.2+)**. Key areas refactored include:
    - **Server**: Implemented Streamable HTTP transport (`b2b8665`).
    - **Client**: Enhanced capabilities handling, configuration loading (using Zod), and transport management (Stdio/HTTP) (`38f68b8`).
    - **Logging**: Aligned log levels with RFC 5424 standards and added notification support (`cad6f29`).
    - **Configuration**: Improved validation and aligned log level settings (`6c1e958`).
    - **Echo Example**: Updated Echo tool and resource implementations, including Base64 handling (`a7f385f`).
- **Documentation**: Updated project documentation and internal cheatsheets (`de12abf`, `53c7c0d`).
