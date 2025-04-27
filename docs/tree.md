# mcp-ts-template - Directory Structure

Generated on: 2025-04-27 18:01:31


```
mcp-ts-template
├── backups
├── docs
    └── tree.md
├── scripts
    ├── clean.ts
    ├── make-executable.ts
    └── tree.ts
├── src
    ├── config
    │   └── index.ts
    ├── mcp-client
    │   ├── client.ts
    │   ├── configLoader.ts
    │   ├── index.ts
    │   ├── mcp-config.json
    │   ├── mcp-config.json.example
    │   └── transport.ts
    ├── mcp-server
    │   ├── resources
    │   │   └── echoResource
    │   │   │   ├── echoResourceLogic.ts
    │   │   │   ├── index.ts
    │   │   │   └── registration.ts
    │   ├── tools
    │   │   └── echoTool
    │   │   │   ├── echoToolLogic.ts
    │   │   │   ├── index.ts
    │   │   │   └── registration.ts
    │   ├── .DS_Store
    │   └── server.ts
    ├── types-global
    │   ├── errors.ts
    │   ├── mcp.ts
    │   └── tool.ts
    ├── utils
    │   ├── errorHandler.ts
    │   ├── idGenerator.ts
    │   ├── index.ts
    │   ├── jsonParser.ts
    │   ├── logger.ts
    │   ├── rateLimiter.ts
    │   ├── requestContext.ts
    │   ├── sanitization.ts
    │   └── tokenCounter.ts
    ├── .DS_Store
    └── index.ts
├── .clinerules
├── .dockerignore
├── CHANGELOG.md
├── Dockerfile
├── LICENSE
├── package-lock.json
├── package.json
├── README.md
├── repomix.config.json
└── tsconfig.json

```

_Note: This tree excludes files and directories matched by .gitignore and common patterns like node_modules._
