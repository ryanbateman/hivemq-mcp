# Utils: Your TypeScript Toolkit 🛠️

Welcome to the Utils collection! This folder contains practical utilities to make your TypeScript development easier and more productive.

## What's Inside

This toolkit gives you ready-to-use solutions for common challenges:

- **Error Handling** - Smart error classification and formatting
- **ID Generation** - Create unique IDs with custom formats
- **Logging** - Flexible logging with file rotation
- **Rate Limiting** - Prevent API abuse
- **Request Context** - Track and manage request data
- **Input Sanitization** - Keep your data clean and secure

## Quick Start

Import what you need:

```typescript
// Import individual utilities
import { logger } from './utils/logger.js';
import { idGenerator } from './utils/idGenerator.js';

// Or import everything
import utils from './utils/index.js';
```

## The Toolkit

### 🔍 Error Handler

Makes error handling painless with automatic classification and consistent formatting.

```typescript
import { ErrorHandler } from './utils/errorHandler.js';

try {
  // Your code
} catch (error) {
  // Clean and classify the error
  ErrorHandler.handleError(error, {
    operation: 'createUser',
    context: { userId: '123' },
    input: userInput
  });
}
```

### 🆔 ID Generator

Generate unique IDs with optional prefixes - perfect for database entities.

```typescript
import { idGenerator } from './utils/idGenerator.js';

// Simple random ID
const randomId = idGenerator.generate();

// Create an ID with prefix
const userId = idGenerator.generate('USER');  // "USER_A7B3C9"

// Or use UUID for guaranteed uniqueness
import { generateUUID } from './utils/idGenerator.js';
const uuid = generateUUID();
```

### 📝 Logger

Smart logging with automatic sensitive data redaction.

```typescript
import { logger } from './utils/logger.js';

// Basic logging
logger.info('User registered successfully');

// With context
logger.info('Payment processed', { 
  amount: 50.00, 
  userId: 'user_123', 
  // Sensitive fields like 'creditCard' are automatically redacted
});

// Create a child logger for a specific component
const paymentLogger = logger.createChildLogger({ component: 'PaymentService' });
paymentLogger.info('Payment initiated'); // Includes component info
```

### ⏱️ Rate Limiter

Protect your APIs from overuse.

```typescript
import { rateLimiter } from './utils/rateLimiter.js';

// Check if a request should be allowed
try {
  rateLimiter.check('api:getUsers', { ip: '192.168.1.1' });
  // Continue with request handling
} catch (error) {
  // Handle rate limit exceeded
}
```

### 🔄 Request Context

Track request information throughout the request lifecycle.

```typescript
import { createRequestContext } from './utils/requestContext.js';

// Create context at request start
const context = createRequestContext({ 
  path: '/api/users', 
  method: 'GET',
  ip: '192.168.1.1'
});

// Use requestId in logs
logger.info('Request received', { requestId: context.requestId });
```

### 🧼 Sanitization

Clean user input to prevent security issues.

```typescript
import { sanitizeInput } from './utils/sanitization.js';

// Clean user-provided HTML
const cleanHtml = sanitizeInput.html(userInput);

// Sanitize path to prevent directory traversal
const safePath = sanitizeInput.path(userProvidedPath);

// Safely use user-provided URLs
const safeUrl = sanitizeInput.url(userProvidedUrl);
```

## Tips and Best Practices

- Use the error handler to maintain consistent error formats across your application
- Always sanitize user inputs before processing them
- Create child loggers for different components to make logs easier to filter
- Use request contexts to trace requests through your application

## Contributing

Found a bug or have an idea for improvement? Open an issue or PR!