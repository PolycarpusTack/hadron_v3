# Phase 5: Team Features & Web App - Production Backlog

**Updated**: 2025-11-12 (Added reference implementations)

## Reference Implementations

**Key Repositories**:
- [dexie/Dexie.js](https://github.com/dexie/Dexie.js) - IndexedDB wrapper for offline-first web app (10k stars)
- [GoogleChrome/workbox](https://github.com/GoogleChrome/workbox) - PWA service workers for offline support (12k stars)
- [helmet](https://github.com/helmetjs/helmet) - Express security headers middleware (9.8k stars)
- [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit) - Rate limiting for APIs
- [express-validator](https://github.com/express-validator/express-validator) - Input validation middleware

## Executive Summary
**Objective**: Enable team collaboration through a lightweight **PWA (Progressive Web App)** with offline-first capabilities using Dexie.js and desktop sync.

**Scope**: Web-based crash analyzer with PostgreSQL backend, JWT authentication, offline support via Workbox service workers, and bidirectional sync with desktop Tauri app.

**Enhanced with**:
- ✅ **Offline-First**: Dexie.js (IndexedDB) + Workbox (service workers)
- ✅ **Security**: helmet middleware for security headers
- ✅ **Rate Limiting**: Prevent API abuse with express-rate-limit
- ✅ **Input Validation**: express-validator for all API endpoints

**Health Score**: 8/9
- **Clarity**: 3/3 - Requirements are well-defined with explicit UI mockups
- **Feasibility**: 2/3 - Sync complexity may require iteration
- **Completeness**: 3/3 - All quality gates and observability included

**Recommendation**: **PROCEED** - Design is mature with clear boundaries and pragmatic trade-offs.

## Risk Ledger

| Risk | Severity | Mitigation | Owner |
|------|----------|------------|-------|
| Data loss during sync conflicts | HIGH | Last-write-wins with audit log + backup before sync | Backend Lead |
| JWT secret exposure | HIGH | Secrets in env vars, rotate quarterly, HSM for prod | Security Lead |
| SQL injection vulnerabilities | HIGH | Parameterized queries, ORMs, security scanning | Backend Lead |
| Sync race conditions | MEDIUM | Optimistic locking with version fields | Backend Lead |
| Bundle size exceeding 500KB | MEDIUM | Code splitting, lazy loading, tree shaking | Frontend Lead |
| PostgreSQL connection exhaustion | MEDIUM | Connection pooling, max 20 per worker | DevOps Lead |

## Assumptions Ledger

| Assumption | Impact | Validation |
|------------|--------|------------|
| Teams have 2-5 users max | HIGH | Monitor user count, scale if >5 |
| Users accept last-write-wins sync | HIGH | Beta test with 2 teams |
| Single VPS can handle 20 users | MEDIUM | Load test with 50 concurrent |
| React components from desktop are reusable | MEDIUM | Spike to verify compatibility |
| JWT 7-day expiry acceptable | LOW | Survey users on session length |

## Architecture Decision Records (ADRs)

### ADR-001: PostgreSQL over SQLite for Multi-User
**Decision**: Use PostgreSQL for web backend
**Rationale**: Proper ACID compliance, connection pooling, row-level locking
**Consequences**: Hosting costs, backup complexity

### ADR-002: JWT Authentication over OAuth
**Decision**: JWT with bcrypt, no OAuth providers
**Rationale**: Simpler implementation, no external dependencies
**Consequences**: Must implement password reset, no SSO

### ADR-003: Last-Write-Wins Sync Strategy
**Decision**: Simple timestamp-based conflict resolution
**Rationale**: Complexity of CRDTs not justified for MVP
**Consequences**: Potential data loss on simultaneous edits

### ADR-004: Monolithic Deployment
**Decision**: Single Node.js process for API + static serving
**Rationale**: Simplicity for <20 users
**Consequences**: Limited horizontal scaling

---

## EPIC A: Backend API Foundation

**Definition of Done**:
- ✓ All endpoints return <200ms (p95)
- ✓ 100% of endpoints have input validation
- ✓ Security scan shows zero HIGH vulnerabilities

### Story A-1: PostgreSQL Database Setup
**Status**: READY
**Persona**: DevOps Engineer
**Acceptance Criteria**:
```gherkin
GIVEN a fresh PostgreSQL 15+ installation
WHEN I run the migration scripts
THEN the database schema matches SQLite schema plus user tables
AND proper indexes exist for multi-user queries
AND connection pooling is configured (max 100 connections)
```
**Unblocks**: A-2, A-3

#### Task A-1-T1: Database Schema Migration
**Token Budget**: 8,000
**Scope**: Create SQL migration scripts
```sql
-- migrations/001_initial_schema.sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    role VARCHAR(50) DEFAULT 'member',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE crashes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(500) NOT NULL,
    exception_type VARCHAR(255),
    message TEXT,
    full_trace TEXT,
    file_path VARCHAR(500),
    line_number INTEGER,
    method_name VARCHAR(255),
    class_name VARCHAR(255),
    ai_analysis JSONB,
    root_cause TEXT,
    suggested_fix TEXT,
    confidence_score DECIMAL(3,2),
    status VARCHAR(50) DEFAULT 'new',
    severity VARCHAR(50),
    tags TEXT[],
    created_by UUID REFERENCES users(id),
    assigned_to UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    version INTEGER DEFAULT 1 -- For optimistic locking
);

CREATE TABLE activity_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    crash_id UUID REFERENCES crashes(id),
    action VARCHAR(50) NOT NULL,
    changes JSONB,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    crash_id UUID REFERENCES crashes(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    content TEXT NOT NULL,
    parent_id UUID REFERENCES comments(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_crashes_created_by ON crashes(created_by);
CREATE INDEX idx_crashes_assigned_to ON crashes(assigned_to);
CREATE INDEX idx_crashes_status ON crashes(status);
CREATE INDEX idx_crashes_created_at ON crashes(created_at DESC);
CREATE INDEX idx_activity_crash_id ON activity_log(crash_id);
CREATE INDEX idx_comments_crash_id ON comments(crash_id);

-- Full-text search
CREATE INDEX idx_crashes_search ON crashes USING gin(to_tsvector('english',
    coalesce(title, '') || ' ' ||
    coalesce(message, '') || ' ' ||
    coalesce(root_cause, '')
));
```

#### Task A-1-T2: Connection Pool Configuration
**Token Budget**: 3,000
**Scope**: Configure pg pool with circuit breaker
```typescript
// src/database/pool.ts
import { Pool } from 'pg';
import CircuitBreaker from 'opossum';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum connections per worker
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000,
});

// Circuit breaker for resilience
const dbCircuitBreaker = new CircuitBreaker(
  async (query: string, params?: any[]) => {
    return pool.query(query, params);
  },
  {
    timeout: 3000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
  }
);

export { pool, dbCircuitBreaker };
```

#### Task A-1-T3: Migration Runner
**Token Budget**: 5,000
**Scope**: Database migration tool with rollback
```typescript
// src/database/migrator.ts
interface Migration {
  id: string;
  up: string;
  down: string;
}

class Migrator {
  async migrate() {
    await this.createMigrationTable();
    const applied = await this.getAppliedMigrations();
    const pending = await this.getPendingMigrations(applied);

    for (const migration of pending) {
      await this.runMigration(migration);
    }
  }

  async rollback(steps = 1) {
    const applied = await this.getAppliedMigrations();
    const toRollback = applied.slice(-steps);

    for (const migration of toRollback.reverse()) {
      await this.runRollback(migration);
    }
  }
}
```

### Story A-2: JWT Authentication Service
**Status**: READY
**Persona**: Security Engineer
**Acceptance Criteria**:
```gherkin
GIVEN a user with valid credentials
WHEN they login via POST /api/v1/auth/login
THEN they receive a JWT token valid for 7 days
AND the token contains user id, email, and role
AND refresh token is stored securely
```
**Depends On**: A-1
**Unblocks**: A-3, B-2

#### Task A-2-T1: Auth Service Implementation
**Token Budget**: 10,000
**Scope**: JWT generation, validation, refresh
```typescript
// src/services/auth.service.ts
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

class AuthService {
  private readonly JWT_SECRET = process.env.JWT_SECRET!;
  private readonly REFRESH_SECRET = process.env.REFRESH_SECRET!;
  private readonly BCRYPT_ROUNDS = 12;

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.BCRYPT_ROUNDS);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  generateAccessToken(user: User): string {
    return jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role
      },
      this.JWT_SECRET,
      {
        expiresIn: '7d',
        issuer: 'crash-analyzer',
        audience: 'web-app'
      }
    );
  }

  generateRefreshToken(userId: string): string {
    return jwt.sign(
      { userId },
      this.REFRESH_SECRET,
      { expiresIn: '30d' }
    );
  }

  async validateToken(token: string): Promise<TokenPayload> {
    try {
      return jwt.verify(token, this.JWT_SECRET) as TokenPayload;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new AuthError('Token expired', 'TOKEN_EXPIRED');
      }
      throw new AuthError('Invalid token', 'INVALID_TOKEN');
    }
  }
}
```

#### Task A-2-T2: Auth Middleware
**Token Budget**: 5,000
**Scope**: Express middleware for protected routes
```typescript
// src/middleware/auth.middleware.ts
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const payload = await authService.validateToken(token);
    req.user = payload;

    // Log authentication for audit
    await activityLogger.log({
      userId: payload.id,
      action: 'authenticated',
      ip: req.ip,
    });

    next();
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
};

export const authorize = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};
```

#### Task A-2-T3: Password Reset Flow
**Token Budget**: 6,000
**Scope**: Email-based password reset
```typescript
// src/services/password-reset.service.ts
class PasswordResetService {
  async initiateReset(email: string): Promise<void> {
    const user = await userRepository.findByEmail(email);
    if (!user) {
      // Don't reveal if user exists
      return;
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + 3600000; // 1 hour

    await this.saveResetToken(user.id, token, expires);
    await emailService.sendPasswordReset(email, token);
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const reset = await this.findValidToken(token);
    if (!reset) {
      throw new Error('Invalid or expired token');
    }

    const hashedPassword = await authService.hashPassword(newPassword);
    await userRepository.updatePassword(reset.userId, hashedPassword);
    await this.invalidateToken(token);
  }
}
```

### Story A-3: Core API Endpoints
**Status**: READY
**Persona**: Backend Developer
**Acceptance Criteria**:
```gherkin
GIVEN authenticated API requests
WHEN CRUD operations are performed on crashes
THEN responses return in <200ms (p95)
AND all inputs are validated against schemas
AND changes are logged to activity_log
```
**Depends On**: A-1, A-2
**Unblocks**: B-3, D-1

#### Task A-3-T1: Express API Setup
**Token Budget**: 8,000
**Scope**: Express server with middleware stack
```typescript
// src/server.ts
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
}));

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true,
}));

// Rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: 'Too many login attempts',
});

app.use('/api/v1/auth', authLimiter);

// Request parsing
app.use(express.json({ limit: '10mb' }));
app.use(compression());

// Request logging
app.use(requestLogger);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// API routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/crashes', authenticate, crashRoutes);
app.use('/api/v1/sync', authenticate, syncRoutes);

// Error handling
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
```

#### Task A-3-T2: Crash CRUD Endpoints
**Token Budget**: 12,000
**Scope**: REST API for crash operations
```typescript
// src/routes/crashes.routes.ts
import { Router } from 'express';
import { body, query, param, validationResult } from 'express-validator';

const router = Router();

// GET /api/v1/crashes - List crashes with pagination
router.get('/',
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('status').optional().isIn(['new', 'in_progress', 'resolved']),
  query('assignedTo').optional().isUUID(),
  validateRequest,
  async (req, res) => {
    const { page = 1, limit = 20, ...filters } = req.query;

    const crashes = await crashRepository.findAll({
      filters,
      pagination: { page, limit },
      userId: req.user.id,
    });

    res.json({
      data: crashes,
      pagination: {
        page,
        limit,
        total: crashes.total,
      },
    });
  }
);

// GET /api/v1/crashes/:id - Get single crash
router.get('/:id',
  param('id').isUUID(),
  validateRequest,
  async (req, res) => {
    const crash = await crashRepository.findById(req.params.id);

    if (!crash) {
      return res.status(404).json({ error: 'Crash not found' });
    }

    // Log view activity
    await activityLogger.log({
      userId: req.user.id,
      crashId: crash.id,
      action: 'viewed',
    });

    res.json(crash);
  }
);

// POST /api/v1/crashes - Create crash
router.post('/',
  body('title').isString().isLength({ min: 1, max: 500 }),
  body('exceptionType').isString(),
  body('message').isString(),
  body('fullTrace').isString(),
  body('aiAnalysis').optional().isObject(),
  validateRequest,
  async (req, res) => {
    const crash = await crashRepository.create({
      ...req.body,
      createdBy: req.user.id,
    });

    // Log creation
    await activityLogger.log({
      userId: req.user.id,
      crashId: crash.id,
      action: 'created',
    });

    // Emit WebSocket event
    io.emit('crash:created', crash);

    res.status(201).json(crash);
  }
);

// PATCH /api/v1/crashes/:id - Update crash
router.patch('/:id',
  param('id').isUUID(),
  body('status').optional().isIn(['new', 'in_progress', 'resolved']),
  body('assignedTo').optional().isUUID(),
  body('tags').optional().isArray(),
  body('version').isInt(), // For optimistic locking
  validateRequest,
  async (req, res) => {
    const { version, ...updates } = req.body;

    try {
      const crash = await crashRepository.update(
        req.params.id,
        updates,
        version
      );

      // Log changes
      await activityLogger.log({
        userId: req.user.id,
        crashId: crash.id,
        action: 'updated',
        changes: updates,
      });

      // Emit WebSocket event
      io.emit('crash:updated', crash);

      res.json(crash);
    } catch (error) {
      if (error.code === 'VERSION_CONFLICT') {
        return res.status(409).json({
          error: 'Version conflict - someone else updated this crash'
        });
      }
      throw error;
    }
  }
);
```

#### Task A-3-T3: Input Validation & Sanitization
**Token Budget**: 5,000
**Scope**: Request validation middleware
```typescript
// src/middleware/validation.middleware.ts
import { validationResult } from 'express-validator';
import DOMPurify from 'isomorphic-dompurify';

export const validateRequest = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array()
    });
  }

  // Sanitize string inputs to prevent XSS
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }

  next();
};

function sanitizeObject(obj: any): any {
  if (typeof obj === 'string') {
    return DOMPurify.sanitize(obj, { ALLOWED_TAGS: [] });
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }

  if (obj && typeof obj === 'object') {
    const sanitized: any = {};
    for (const key in obj) {
      sanitized[key] = sanitizeObject(obj[key]);
    }
    return sanitized;
  }

  return obj;
}
```

### Story A-4: Observability & Monitoring
**Status**: READY
**Persona**: SRE
**Acceptance Criteria**:
```gherkin
GIVEN the API is running in production
WHEN requests are processed
THEN structured logs are emitted with correlation IDs
AND metrics are exported (latency, errors, throughput)
AND traces span database queries and external calls
```
**Depends On**: A-3
**Unblocks**: F-1

#### Task A-4-T1: Structured Logging
**Token Budget**: 6,000
**Scope**: Winston logger with correlation IDs
```typescript
// src/utils/logger.ts
import winston from 'winston';
import { v4 as uuidv4 } from 'uuid';

const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'crash-analyzer-api' },
  transports: [
    new winston.transports.File({
      filename: 'error.log',
      level: 'error'
    }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

// Request correlation middleware
export const correlationMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const correlationId = req.headers['x-correlation-id'] || uuidv4();
  req.correlationId = correlationId;
  res.setHeader('x-correlation-id', correlationId);

  // Attach to async context
  asyncLocalStorage.run({ correlationId }, next);
};

// Contextual logger
export const getLogger = () => {
  const context = asyncLocalStorage.getStore();
  return logger.child({ correlationId: context?.correlationId });
};
```

#### Task A-4-T2: Metrics Collection
**Token Budget**: 5,000
**Scope**: Prometheus metrics for SLOs
```typescript
// src/utils/metrics.ts
import { register, Counter, Histogram, Gauge } from 'prom-client';

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_ms',
  help: 'Duration of HTTP requests in ms',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.1, 5, 15, 50, 100, 200, 300, 400, 500, 1000],
});

export const httpRequestTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'],
});

export const dbConnectionPool = new Gauge({
  name: 'db_connection_pool_size',
  help: 'Number of database connections in pool',
  labelNames: ['status'], // 'active', 'idle', 'waiting'
});

// Metrics middleware
export const metricsMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const route = req.route?.path || 'unknown';

    httpRequestDuration
      .labels(req.method, route, res.statusCode.toString())
      .observe(duration);

    httpRequestTotal
      .labels(req.method, route, res.statusCode.toString())
      .inc();
  });

  next();
};

// Expose metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

#### Task A-4-T3: Distributed Tracing
**Token Budget**: 6,000
**Scope**: OpenTelemetry integration
```typescript
// src/utils/tracing.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'crash-analyzer-api',
    [SemanticResourceAttributes.SERVICE_VERSION]: process.env.VERSION,
  }),
  traceExporter: new JaegerExporter({
    endpoint: process.env.JAEGER_ENDPOINT,
  }),
});

sdk.start();

// Wrap database queries
export const traceQuery = async (
  queryName: string,
  queryFn: () => Promise<any>
) => {
  const span = tracer.startSpan(`db.query.${queryName}`);

  try {
    const result = await queryFn();
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  } finally {
    span.end();
  }
};
```

### Story A-5: Security Hardening
**Status**: READY
**Persona**: Security Engineer
**Acceptance Criteria**:
```gherkin
GIVEN the API is exposed to the internet
WHEN security scanning is performed
THEN zero HIGH vulnerabilities are found
AND all OWASP Top 10 are mitigated
AND rate limiting prevents brute force
```
**Depends On**: A-2, A-3

#### Task A-5-T1: CSRF Protection
**Token Budget**: 4,000
**Scope**: Double-submit cookie pattern
```typescript
// src/middleware/csrf.middleware.ts
import crypto from 'crypto';

export const csrfProtection = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const token = req.headers['x-csrf-token'];
  const cookie = req.cookies['csrf-token'];

  if (!token || token !== cookie) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }

  next();
};

// Generate CSRF token on session start
export const generateCsrfToken = (req: Request, res: Response) => {
  const token = crypto.randomBytes(32).toString('hex');
  res.cookie('csrf-token', token, {
    httpOnly: false, // Needs to be readable by JS
    secure: true,
    sameSite: 'strict',
  });
  return token;
};
```

#### Task A-5-T2: SQL Injection Prevention
**Token Budget**: 3,000
**Scope**: Parameterized query wrapper
```typescript
// src/database/query-builder.ts
class QueryBuilder {
  private query: string = '';
  private params: any[] = [];

  select(columns: string[]): this {
    // Validate column names against whitelist
    const safe = columns.filter(col => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col));
    this.query = `SELECT ${safe.join(', ')}`;
    return this;
  }

  where(column: string, operator: string, value: any): this {
    // Only allow safe operators
    const safeOps = ['=', '!=', '<', '>', '<=', '>=', 'LIKE', 'IN'];
    if (!safeOps.includes(operator)) {
      throw new Error('Invalid operator');
    }

    this.params.push(value);
    this.query += ` WHERE ${column} ${operator} $${this.params.length}`;
    return this;
  }

  async execute(): Promise<any> {
    return dbCircuitBreaker.fire(this.query, this.params);
  }
}
```

---

## EPIC B: Web Application Frontend

**Definition of Done**:
- ✓ Lighthouse score >90 for performance
- ✓ Bundle size <500KB gzipped
- ✓ Works offline with service worker

### Story B-1: React Application Shell
**Status**: READY
**Persona**: Frontend Developer
**Acceptance Criteria**:
```gherkin
GIVEN a user visits the web app
WHEN the page loads
THEN React app renders in <2s on 3G
AND routing works without page refresh
AND layout is responsive (mobile, tablet, desktop)
```
**Unblocks**: B-2, B-3

#### Task B-1-T1: Vite Project Setup
**Token Budget**: 5,000
**Scope**: React + TypeScript + Vite configuration
```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  plugins: [
    react(),
    visualizer({ open: true, gzipSize: true }),
  ],
  build: {
    target: 'es2015',
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'ui-vendor': ['@headlessui/react', '@heroicons/react'],
        },
      },
    },
    chunkSizeWarningLimit: 500,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
```

#### Task B-1-T2: Router & Layout Components
**Token Budget**: 8,000
**Scope**: React Router setup with layouts
```typescript
// src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './contexts/AuthContext';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: 2,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<ProtectedLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="crashes" element={<CrashList />} />
              <Route path="crashes/:id" element={<CrashDetail />} />
              <Route path="settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

// src/layouts/ProtectedLayout.tsx
function ProtectedLayout() {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" />;
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Header />
        <div className="container mx-auto px-4 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
```

#### Task B-1-T3: Responsive Design System
**Token Budget**: 7,000
**Scope**: Tailwind setup with component library
```typescript
// tailwind.config.js
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          500: '#3b82f6',
          900: '#1e3a8a',
        },
      },
      screens: {
        'xs': '475px',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
  ],
};

// src/components/ui/Button.tsx
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  children,
  ...props
}: ButtonProps) {
  const baseClasses = 'font-medium rounded-lg transition-colors';

  const variantClasses = {
    primary: 'bg-primary-500 text-white hover:bg-primary-600',
    secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300',
    danger: 'bg-red-500 text-white hover:bg-red-600',
  };

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2',
    lg: 'px-6 py-3 text-lg',
  };

  return (
    <button
      className={cn(
        baseClasses,
        variantClasses[variant],
        sizeClasses[size],
        loading && 'opacity-50 cursor-not-allowed'
      )}
      disabled={loading}
      {...props}
    >
      {loading ? <Spinner /> : children}
    </button>
  );
}
```

### Story B-2: Authentication UI
**Status**: READY
**Persona**: Frontend Developer
**Acceptance Criteria**:
```gherkin
GIVEN a user visits the login page
WHEN they enter valid credentials
THEN they are redirected to dashboard
AND JWT token is stored securely
AND session persists across page refresh
```
**Depends On**: A-2
**Unblocks**: B-3

#### Task B-2-T1: Login Page Component
**Token Budget**: 6,000
**Scope**: Login form with validation
```typescript
// src/pages/LoginPage.tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  rememberMe: z.boolean().optional(),
});

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [error, setError] = useState('');

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    try {
      await login(data.email, data.password, data.rememberMe);
      navigate('/');
    } catch (error) {
      setError('Invalid email or password');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="text-3xl font-bold text-center">
            Sign in to Crash Analyzer
          </h2>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {error && (
            <Alert variant="error">{error}</Alert>
          )}

          <Input
            label="Email"
            type="email"
            {...register('email')}
            error={errors.email?.message}
          />

          <Input
            label="Password"
            type="password"
            {...register('password')}
            error={errors.password?.message}
          />

          <Checkbox {...register('rememberMe')}>
            Remember me for 30 days
          </Checkbox>

          <Button
            type="submit"
            className="w-full"
            loading={isSubmitting}
          >
            Sign In
          </Button>

          <Link to="/forgot-password" className="text-sm text-primary-500">
            Forgot your password?
          </Link>
        </form>
      </div>
    </div>
  );
}
```

#### Task B-2-T2: Auth Context & Hooks
**Token Budget**: 7,000
**Scope**: JWT management and auth state
```typescript
// src/contexts/AuthContext.tsx
interface AuthContextValue {
  user: User | null;
  login: (email: string, password: string, remember?: boolean) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check for existing session
    const token = localStorage.getItem('access_token');
    if (token) {
      validateAndSetUser(token);
    }
    setIsLoading(false);
  }, []);

  const login = async (email: string, password: string, remember?: boolean) => {
    const response = await api.post('/auth/login', { email, password });
    const { accessToken, refreshToken, user } = response.data;

    // Store tokens
    const storage = remember ? localStorage : sessionStorage;
    storage.setItem('access_token', accessToken);
    storage.setItem('refresh_token', refreshToken);

    // Set axios default header
    api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;

    setUser(user);
  };

  const logout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    sessionStorage.removeItem('access_token');
    sessionStorage.removeItem('refresh_token');
    delete api.defaults.headers.common['Authorization'];
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
```

#### Task B-2-T3: Token Refresh Interceptor
**Token Budget**: 5,000
**Scope**: Axios interceptor for token refresh
```typescript
// src/utils/api.ts
import axios from 'axios';

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 10000,
});

// Request interceptor - add token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token')
      || sessionStorage.getItem('access_token');

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Add CSRF token
    const csrfToken = getCookie('csrf-token');
    if (csrfToken) {
      config.headers['X-CSRF-Token'] = csrfToken;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor - handle token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = localStorage.getItem('refresh_token')
          || sessionStorage.getItem('refresh_token');

        const response = await api.post('/auth/refresh', { refreshToken });
        const { accessToken } = response.data;

        // Update stored token
        if (localStorage.getItem('access_token')) {
          localStorage.setItem('access_token', accessToken);
        } else {
          sessionStorage.setItem('access_token', accessToken);
        }

        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        // Refresh failed - logout
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
```

### Story B-3: Crash Management UI
**Status**: READY
**Persona**: Frontend Developer
**Acceptance Criteria**:
```gherkin
GIVEN an authenticated user
WHEN they view the crashes page
THEN they see a paginated list of crashes
AND can filter by status, assignee, tags
AND can click to view crash details
AND can edit crash properties
```
**Depends On**: A-3, B-2
**Unblocks**: D-2

#### Task B-3-T1: Crash List Component
**Token Budget**: 10,000
**Scope**: Paginated list with filters
```typescript
// src/pages/CrashList.tsx
export function CrashList() {
  const [filters, setFilters] = useState<CrashFilters>({
    status: 'all',
    assignedTo: 'all',
    search: '',
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['crashes', filters],
    queryFn: () => api.getCrashes(filters),
    keepPreviousData: true,
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Crashes</h1>
        <Button onClick={() => navigate('/crashes/new')}>
          New Crash
        </Button>
      </div>

      <CrashFilters
        filters={filters}
        onChange={setFilters}
      />

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} />
      ) : (
        <div className="bg-white shadow rounded-lg">
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr>
                <th>ID</th>
                <th>Title</th>
                <th>Type</th>
                <th>Status</th>
                <th>Assigned</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {data.items.map(crash => (
                <CrashRow key={crash.id} crash={crash} />
              ))}
            </tbody>
          </table>

          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            onPageChange={(page) => setFilters({ ...filters, page })}
          />
        </div>
      )}
    </div>
  );
}

// src/components/CrashRow.tsx
function CrashRow({ crash }: { crash: Crash }) {
  return (
    <tr
      className="hover:bg-gray-50 cursor-pointer"
      onClick={() => navigate(`/crashes/${crash.id}`)}
    >
      <td className="px-6 py-4 text-sm">
        #{crash.id.slice(0, 8)}
      </td>
      <td className="px-6 py-4">
        <div className="text-sm font-medium text-gray-900">
          {crash.title}
        </div>
        <div className="text-sm text-gray-500">
          {crash.message?.substring(0, 100)}
        </div>
      </td>
      <td className="px-6 py-4">
        <Badge variant={getSeverityColor(crash.severity)}>
          {crash.exceptionType}
        </Badge>
      </td>
      <td className="px-6 py-4">
        <StatusBadge status={crash.status} />
      </td>
      <td className="px-6 py-4">
        {crash.assignedTo ? (
          <UserAvatar userId={crash.assignedTo} />
        ) : (
          <span className="text-gray-400">Unassigned</span>
        )}
      </td>
      <td className="px-6 py-4 text-sm text-gray-500">
        {formatRelativeTime(crash.createdAt)}
      </td>
      <td className="px-6 py-4">
        <ChevronRightIcon className="h-5 w-5 text-gray-400" />
      </td>
    </tr>
  );
}
```

#### Task B-3-T2: Crash Detail View
**Token Budget**: 12,000
**Scope**: Full crash details with editing
```typescript
// src/pages/CrashDetail.tsx
export function CrashDetail() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);

  const { data: crash, isLoading } = useQuery({
    queryKey: ['crash', id],
    queryFn: () => api.getCrash(id),
  });

  const updateMutation = useMutation({
    mutationFn: (updates: Partial<Crash>) =>
      api.updateCrash(id, updates),
    onSuccess: (updatedCrash) => {
      queryClient.setQueryData(['crash', id], updatedCrash);
      toast.success('Crash updated successfully');
      setIsEditing(false);
    },
    onError: (error) => {
      if (error.response?.status === 409) {
        toast.error('Someone else updated this crash. Please refresh.');
      }
    },
  });

  if (isLoading) return <LoadingState />;
  if (!crash) return <NotFound />;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {crash.title}
              </h1>
              <div className="mt-1 flex items-center space-x-4">
                <StatusBadge status={crash.status} />
                <span className="text-sm text-gray-500">
                  Created {formatRelativeTime(crash.createdAt)}
                </span>
              </div>
            </div>

            <div className="flex space-x-2">
              <Button
                variant="secondary"
                onClick={() => setIsEditing(!isEditing)}
              >
                {isEditing ? 'Cancel' : 'Edit'}
              </Button>
              <Button variant="secondary">
                Export
              </Button>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Exception Details */}
            <section>
              <h2 className="text-lg font-medium mb-3">Exception Details</h2>
              <div className="bg-gray-50 rounded-lg p-4">
                <dl className="space-y-2">
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Type</dt>
                    <dd className="text-sm text-gray-900">{crash.exceptionType}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Message</dt>
                    <dd className="text-sm text-gray-900">{crash.message}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Location</dt>
                    <dd className="text-sm text-gray-900">
                      {crash.fileName}:{crash.lineNumber} in {crash.methodName}
                    </dd>
                  </div>
                </dl>
              </div>
            </section>

            {/* Stack Trace */}
            <section>
              <h2 className="text-lg font-medium mb-3">Stack Trace</h2>
              <CodeBlock
                code={crash.fullTrace}
                language="smalltalk"
                className="max-h-96 overflow-auto"
              />
            </section>

            {/* AI Analysis */}
            {crash.aiAnalysis && (
              <section>
                <h2 className="text-lg font-medium mb-3">AI Analysis</h2>
                <div className="bg-blue-50 rounded-lg p-4">
                  <div className="space-y-3">
                    <div>
                      <h3 className="text-sm font-medium text-gray-700">
                        Root Cause
                      </h3>
                      <p className="mt-1 text-sm text-gray-900">
                        {crash.rootCause}
                      </p>
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-gray-700">
                        Suggested Fix
                      </h3>
                      <p className="mt-1 text-sm text-gray-900">
                        {crash.suggestedFix}
                      </p>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">
                        Confidence: {Math.round(crash.confidenceScore * 100)}%
                      </span>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* Comments */}
            <CommentsSection crashId={id} />
          </div>

          <div className="space-y-6">
            {/* Metadata */}
            <section>
              <h2 className="text-lg font-medium mb-3">Details</h2>
              {isEditing ? (
                <CrashEditForm
                  crash={crash}
                  onSave={(updates) => updateMutation.mutate(updates)}
                  onCancel={() => setIsEditing(false)}
                />
              ) : (
                <CrashMetadata crash={crash} />
              )}
            </section>

            {/* Activity Log */}
            <section>
              <h2 className="text-lg font-medium mb-3">Activity</h2>
              <ActivityLog crashId={id} />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
```

#### Task B-3-T3: Real-time Updates
**Token Budget**: 6,000
**Scope**: WebSocket integration for live updates
```typescript
// src/hooks/useWebSocket.ts
export function useWebSocket() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;

    const socket = io(process.env.REACT_APP_WS_URL, {
      auth: {
        token: localStorage.getItem('access_token'),
      },
    });

    socket.on('crash:created', (crash: Crash) => {
      // Update list cache
      queryClient.setQueryData(
        ['crashes'],
        (old: PaginatedResponse<Crash>) => ({
          ...old,
          items: [crash, ...old.items].slice(0, 20),
        })
      );

      // Show notification
      toast.info(`New crash: ${crash.title}`);
    });

    socket.on('crash:updated', (crash: Crash) => {
      // Update specific crash cache
      queryClient.setQueryData(['crash', crash.id], crash);

      // Update list cache
      queryClient.setQueryData(
        ['crashes'],
        (old: PaginatedResponse<Crash>) => ({
          ...old,
          items: old.items.map(c => c.id === crash.id ? crash : c),
        })
      );
    });

    socket.on('comment:added', (comment: Comment) => {
      queryClient.setQueryData(
        ['comments', comment.crashId],
        (old: Comment[]) => [...old, comment]
      );
    });

    return () => {
      socket.disconnect();
    };
  }, [user, queryClient]);
}
```

### Story B-4: Progressive Web App
**Status**: READY
**Persona**: Frontend Developer
**Acceptance Criteria**:
```gherkin
GIVEN a user on mobile device
WHEN they visit the web app
THEN they can install it to home screen
AND app works offline with cached data
AND syncs when connection restored
```
**Depends On**: B-1, B-3

#### Task B-4-T1: Service Worker
**Token Budget**: 8,000
**Scope**: Offline caching strategy
```typescript
// src/service-worker.ts
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate, NetworkFirst } from 'workbox-strategies';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

// Precache static assets
precacheAndRoute(self.__WB_MANIFEST);

// Cache API responses
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/v1/crashes'),
  new NetworkFirst({
    cacheName: 'api-cache',
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
    ],
    networkTimeoutSeconds: 3,
  })
);

// Cache images and avatars
registerRoute(
  ({ request }) => request.destination === 'image',
  new StaleWhileRevalidate({
    cacheName: 'image-cache',
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
    ],
  })
);

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-crashes') {
    event.waitUntil(syncOfflineData());
  }
});

async function syncOfflineData() {
  const db = await openDB('offline-queue', 1);
  const tx = db.transaction('requests', 'readonly');
  const requests = await tx.objectStore('requests').getAll();

  for (const request of requests) {
    try {
      await fetch(request.url, request.options);
      await db.delete('requests', request.id);
    } catch (error) {
      console.error('Sync failed for request:', request.id);
    }
  }
}
```

#### Task B-4-T2: PWA Manifest
**Token Budget**: 3,000
**Scope**: App manifest and icons
```json
// public/manifest.json
{
  "name": "Crash Analyzer",
  "short_name": "CrashAnalyzer",
  "description": "Smalltalk crash analysis tool",
  "start_url": "/",
  "display": "standalone",
  "theme_color": "#3b82f6",
  "background_color": "#ffffff",
  "orientation": "portrait-primary",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ],
  "shortcuts": [
    {
      "name": "New Crash",
      "url": "/crashes/new",
      "icons": [{ "src": "/icons/new-crash.png", "sizes": "96x96" }]
    }
  ],
  "categories": ["developer", "productivity"],
  "screenshots": [
    {
      "src": "/screenshots/desktop.png",
      "sizes": "1280x720",
      "type": "image/png"
    }
  ]
}
```

#### Task B-4-T3: IndexedDB Offline Storage
**Token Budget**: 7,000
**Scope**: Local data persistence
```typescript
// src/utils/offline-storage.ts
import { openDB, DBSchema } from 'idb';

interface CrashDB extends DBSchema {
  crashes: {
    key: string;
    value: Crash;
    indexes: { 'by-date': Date; 'by-status': string };
  };
  queue: {
    key: string;
    value: {
      id: string;
      url: string;
      method: string;
      body?: any;
      timestamp: number;
    };
  };
}

class OfflineStorage {
  private db: Promise<IDBDatabase>;

  constructor() {
    this.db = openDB<CrashDB>('crash-analyzer', 1, {
      upgrade(db) {
        // Crashes store
        const crashStore = db.createObjectStore('crashes', {
          keyPath: 'id',
        });
        crashStore.createIndex('by-date', 'createdAt');
        crashStore.createIndex('by-status', 'status');

        // Offline queue
        db.createObjectStore('queue', {
          keyPath: 'id',
        });
      },
    });
  }

  async saveCrashes(crashes: Crash[]) {
    const db = await this.db;
    const tx = db.transaction('crashes', 'readwrite');

    await Promise.all([
      ...crashes.map(crash => tx.store.put(crash)),
      tx.done,
    ]);
  }

  async getCrashes(filters?: CrashFilters): Promise<Crash[]> {
    const db = await this.db;

    if (filters?.status) {
      return db.getAllFromIndex('crashes', 'by-status', filters.status);
    }

    return db.getAll('crashes');
  }

  async queueRequest(request: QueuedRequest) {
    const db = await this.db;
    await db.put('queue', {
      ...request,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    });

    // Register for background sync
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      const registration = await navigator.serviceWorker.ready;
      await registration.sync.register('sync-crashes');
    }
  }
}

export const offlineStorage = new OfflineStorage();
```

---

## EPIC C: Desktop-Web Synchronization

**Definition of Done**:
- ✓ Sync completes in <5 seconds for 100 crashes
- ✓ Zero data loss on conflicts
- ✓ Audit log shows all sync operations

### Story C-1: Desktop Sync Service
**Status**: READY
**Persona**: Desktop Developer
**Acceptance Criteria**:
```gherkin
GIVEN the desktop app has local changes
WHEN auto-sync triggers (5 min interval)
THEN changes are pushed to server
AND remote changes are pulled
AND conflicts show warning to user
```
**Depends On**: A-3
**Unblocks**: C-2

#### Task C-1-T1: Sync Engine Implementation
**Token Budget**: 12,000
**Scope**: Bidirectional sync with conflict detection
```typescript
// desktop/src/services/sync.service.ts
class SyncService {
  private syncInterval: NodeJS.Timer | null = null;
  private isSyncing = false;

  constructor(
    private db: Database,
    private api: ApiClient,
    private eventBus: EventEmitter
  ) {}

  async startAutoSync(intervalMs = 300000) { // 5 minutes
    this.syncInterval = setInterval(() => {
      this.sync().catch(error => {
        console.error('Auto-sync failed:', error);
        this.eventBus.emit('sync:error', error);
      });
    }, intervalMs);
  }

  async sync(): Promise<SyncResult> {
    if (this.isSyncing) {
      throw new Error('Sync already in progress');
    }

    this.isSyncing = true;
    this.eventBus.emit('sync:start');

    try {
      const lastSync = await this.getLastSyncTime();

      // Step 1: Pull remote changes
      const pullResult = await this.pull(lastSync);

      // Step 2: Push local changes
      const pushResult = await this.push(lastSync);

      // Step 3: Handle conflicts
      const conflicts = await this.detectConflicts(pullResult, pushResult);

      if (conflicts.length > 0) {
        this.eventBus.emit('sync:conflicts', conflicts);
      }

      await this.setLastSyncTime(Date.now());

      const result = {
        pulled: pullResult.count,
        pushed: pushResult.count,
        conflicts: conflicts.length,
        timestamp: Date.now(),
      };

      this.eventBus.emit('sync:complete', result);
      return result;

    } finally {
      this.isSyncing = false;
    }
  }

  private async pull(since: number): Promise<PullResult> {
    const response = await this.api.get('/sync/pull', {
      params: { since },
    });

    const { crashes, deleted } = response.data;

    // Apply remote changes to local database
    await this.db.transaction(async (tx) => {
      // Update or insert crashes
      for (const crash of crashes) {
        const local = await tx.get('crashes', crash.id);

        if (!local || local.updatedAt < crash.updatedAt) {
          await tx.put('crashes', crash);
        }
      }

      // Handle deletions
      for (const id of deleted) {
        await tx.delete('crashes', id);
      }
    });

    return { count: crashes.length + deleted.length };
  }

  private async push(since: number): Promise<PushResult> {
    // Get local changes
    const changes = await this.db.all(`
      SELECT * FROM crashes
      WHERE updatedAt > ?
      AND syncStatus IN ('pending', 'failed')
      ORDER BY updatedAt ASC
    `, [since]);

    if (changes.length === 0) {
      return { count: 0 };
    }

    // Batch push to server
    const batchSize = 20;
    let pushed = 0;

    for (let i = 0; i < changes.length; i += batchSize) {
      const batch = changes.slice(i, i + batchSize);

      try {
        await this.api.post('/sync/push', {
          changes: batch,
        });

        // Mark as synced
        await this.db.run(`
          UPDATE crashes
          SET syncStatus = 'synced', syncedAt = ?
          WHERE id IN (${batch.map(() => '?').join(',')})
        `, [Date.now(), ...batch.map(c => c.id)]);

        pushed += batch.length;
      } catch (error) {
        console.error('Failed to push batch:', error);

        // Mark as failed
        await this.db.run(`
          UPDATE crashes
          SET syncStatus = 'failed'
          WHERE id IN (${batch.map(() => '?').join(',')})
        `, [...batch.map(c => c.id)]);
      }
    }

    return { count: pushed };
  }

  private async detectConflicts(
    pulled: PullResult,
    pushed: PushResult
  ): Promise<Conflict[]> {
    // Query for crashes that were modified both locally and remotely
    const conflicts = await this.db.all(`
      SELECT id, title, localUpdatedAt, remoteUpdatedAt
      FROM crashes
      WHERE syncStatus = 'conflict'
    `);

    return conflicts.map(c => ({
      id: c.id,
      title: c.title,
      localTime: c.localUpdatedAt,
      remoteTime: c.remoteUpdatedAt,
      resolution: 'pending',
    }));
  }
}
```

#### Task C-1-T2: Sync UI Components
**Token Budget**: 6,000
**Scope**: Electron UI for sync status
```typescript
// desktop/src/components/SyncStatus.tsx
export function SyncStatus() {
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);

  useEffect(() => {
    const handlers = {
      'sync:start': () => setSyncState('syncing'),
      'sync:complete': (result: SyncResult) => {
        setSyncState('idle');
        setLastSync(new Date(result.timestamp));
      },
      'sync:error': () => setSyncState('error'),
      'sync:conflicts': (c: Conflict[]) => setConflicts(c),
    };

    Object.entries(handlers).forEach(([event, handler]) => {
      ipcRenderer.on(event, handler);
    });

    return () => {
      Object.keys(handlers).forEach(event => {
        ipcRenderer.removeAllListeners(event);
      });
    };
  }, []);

  const handleManualSync = () => {
    ipcRenderer.send('sync:manual');
  };

  return (
    <div className="sync-status">
      <div className="flex items-center space-x-2">
        {syncState === 'syncing' ? (
          <Spinner className="w-4 h-4" />
        ) : syncState === 'error' ? (
          <ExclamationIcon className="w-4 h-4 text-red-500" />
        ) : (
          <CheckIcon className="w-4 h-4 text-green-500" />
        )}

        <span className="text-sm">
          {syncState === 'syncing' ? 'Syncing...' :
           lastSync ? `Last sync: ${formatRelativeTime(lastSync)}` :
           'Never synced'}
        </span>

        <button
          onClick={handleManualSync}
          disabled={syncState === 'syncing'}
          className="text-sm text-blue-500 hover:text-blue-600"
        >
          Sync Now
        </button>
      </div>

      {conflicts.length > 0 && (
        <ConflictBanner
          conflicts={conflicts}
          onResolve={(id, resolution) => {
            ipcRenderer.send('sync:resolve-conflict', { id, resolution });
          }}
        />
      )}
    </div>
  );
}
```

#### Task C-1-T3: Conflict Resolution UI
**Token Budget**: 5,000
**Scope**: Dialog for resolving sync conflicts
```typescript
// desktop/src/components/ConflictDialog.tsx
export function ConflictDialog({
  conflict,
  onResolve
}: {
  conflict: Conflict;
  onResolve: (resolution: 'local' | 'remote') => void;
}) {
  const [localVersion, setLocalVersion] = useState<Crash | null>(null);
  const [remoteVersion, setRemoteVersion] = useState<Crash | null>(null);

  useEffect(() => {
    Promise.all([
      ipcRenderer.invoke('get-local-crash', conflict.id),
      ipcRenderer.invoke('get-remote-crash', conflict.id),
    ]).then(([local, remote]) => {
      setLocalVersion(local);
      setRemoteVersion(remote);
    });
  }, [conflict.id]);

  return (
    <Dialog open onClose={() => onResolve('remote')}>
      <Dialog.Title>Sync Conflict Detected</Dialog.Title>

      <div className="mt-4">
        <p className="text-sm text-gray-600">
          This crash was modified in both the desktop app and web app.
          Choose which version to keep:
        </p>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <div className="border rounded-lg p-4">
            <h3 className="font-medium">Local Version</h3>
            <p className="text-sm text-gray-500">
              Modified: {formatDate(conflict.localTime)}
            </p>
            {localVersion && (
              <div className="mt-2 text-sm">
                <p>Status: {localVersion.status}</p>
                <p>Assigned: {localVersion.assignedTo || 'Unassigned'}</p>
              </div>
            )}
            <button
              onClick={() => onResolve('local')}
              className="mt-4 w-full btn btn-primary"
            >
              Keep Local
            </button>
          </div>

          <div className="border rounded-lg p-4">
            <h3 className="font-medium">Remote Version</h3>
            <p className="text-sm text-gray-500">
              Modified: {formatDate(conflict.remoteTime)}
            </p>
            {remoteVersion && (
              <div className="mt-2 text-sm">
                <p>Status: {remoteVersion.status}</p>
                <p>Assigned: {remoteVersion.assignedTo || 'Unassigned'}</p>
              </div>
            )}
            <button
              onClick={() => onResolve('remote')}
              className="mt-4 w-full btn btn-secondary"
            >
              Keep Remote
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
```

### Story C-2: Sync API Endpoints
**Status**: READY
**Persona**: Backend Developer
**Acceptance Criteria**:
```gherkin
GIVEN a desktop client syncing data
WHEN it calls /api/v1/sync/pull
THEN it receives changes since last sync
AND deleted items are included
AND response is paginated if >100 items
```
**Depends On**: A-3, C-1

#### Task C-2-T1: Sync Pull Endpoint
**Token Budget**: 6,000
**Scope**: Efficient change detection
```typescript
// src/routes/sync.routes.ts
router.get('/pull',
  authenticate,
  query('since').isInt({ min: 0 }),
  query('limit').optional().isInt({ min: 1, max: 1000 }),
  validateRequest,
  async (req, res) => {
    const { since, limit = 100 } = req.query;
    const userId = req.user.id;

    // Get changes visible to user
    const changes = await db.query(`
      WITH user_crashes AS (
        SELECT * FROM crashes
        WHERE created_by = $1 OR assigned_to = $1
          OR $2 = 'admin'
      )
      SELECT
        id,
        title,
        exception_type,
        status,
        assigned_to,
        updated_at,
        version,
        'modified' as change_type
      FROM user_crashes
      WHERE updated_at > $3

      UNION ALL

      SELECT
        crash_id as id,
        NULL as title,
        NULL as exception_type,
        NULL as status,
        NULL as assigned_to,
        deleted_at as updated_at,
        NULL as version,
        'deleted' as change_type
      FROM deleted_crashes
      WHERE deleted_at > $3
        AND (deleted_by = $1 OR $2 = 'admin')

      ORDER BY updated_at ASC
      LIMIT $4
    `, [userId, req.user.role, since, limit]);

    const modified = changes
      .filter(c => c.change_type === 'modified')
      .map(({ change_type, ...crash }) => crash);

    const deleted = changes
      .filter(c => c.change_type === 'deleted')
      .map(c => c.id);

    res.json({
      crashes: modified,
      deleted,
      hasMore: changes.length === limit,
      timestamp: Date.now(),
    });
  }
);
```

#### Task C-2-T2: Sync Push Endpoint
**Token Budget**: 7,000
**Scope**: Batch updates with validation
```typescript
// src/routes/sync.routes.ts
router.post('/push',
  authenticate,
  body('changes').isArray().isLength({ min: 1, max: 100 }),
  body('changes.*.id').isUUID(),
  body('changes.*.version').isInt(),
  validateRequest,
  async (req, res) => {
    const { changes } = req.body;
    const results = [];

    await db.transaction(async (trx) => {
      for (const change of changes) {
        try {
          // Check version for optimistic locking
          const current = await trx.query(
            'SELECT version, updated_at FROM crashes WHERE id = $1',
            [change.id]
          );

          if (current && current.version !== change.version) {
            results.push({
              id: change.id,
              status: 'conflict',
              serverVersion: current.version,
            });
            continue;
          }

          // Apply change
          const { id, version, ...updates } = change;
          await trx.query(`
            UPDATE crashes
            SET
              ${Object.keys(updates).map((k, i) => `${k} = $${i + 3}`).join(', ')},
              version = version + 1,
              updated_at = NOW()
            WHERE id = $1 AND version = $2
          `, [id, version, ...Object.values(updates)]);

          // Log activity
          await activityLogger.logWithTrx(trx, {
            userId: req.user.id,
            crashId: id,
            action: 'synced',
            changes: updates,
          });

          results.push({
            id: change.id,
            status: 'success',
          });

        } catch (error) {
          results.push({
            id: change.id,
            status: 'error',
            error: error.message,
          });
        }
      }
    });

    res.json({ results });
  }
);
```

---

## EPIC D: Testing & Quality Assurance

**Definition of Done**:
- ✓ Unit test coverage >80%
- ✓ All E2E critical paths pass
- ✓ Load test supports 50 concurrent users

### Story D-1: API Testing Suite
**Status**: READY
**Persona**: QA Engineer
**Acceptance Criteria**:
```gherkin
GIVEN the API test suite
WHEN npm test is run
THEN unit tests achieve >80% coverage
AND integration tests verify all endpoints
AND contract tests validate schemas
```
**Depends On**: A-3

#### Task D-1-T1: Unit Tests
**Token Budget**: 8,000
**Scope**: Service and middleware tests
```typescript
// src/__tests__/services/auth.service.test.ts
describe('AuthService', () => {
  let authService: AuthService;

  beforeEach(() => {
    authService = new AuthService();
  });

  describe('password hashing', () => {
    it('should hash passwords with bcrypt', async () => {
      const password = 'SecurePassword123!';
      const hash = await authService.hashPassword(password);

      expect(hash).not.toBe(password);
      expect(hash).toMatch(/^\$2[aby]\$.{56}$/);
    });

    it('should verify correct passwords', async () => {
      const password = 'SecurePassword123!';
      const hash = await authService.hashPassword(password);

      const isValid = await authService.verifyPassword(password, hash);
      expect(isValid).toBe(true);
    });

    it('should reject incorrect passwords', async () => {
      const password = 'SecurePassword123!';
      const hash = await authService.hashPassword(password);

      const isValid = await authService.verifyPassword('wrong', hash);
      expect(isValid).toBe(false);
    });
  });

  describe('JWT generation', () => {
    it('should generate valid access tokens', () => {
      const user = {
        id: 'user-123',
        email: 'test@example.com',
        role: 'member',
      };

      const token = authService.generateAccessToken(user);
      const decoded = jwt.verify(token, process.env.JWT_SECRET!);

      expect(decoded).toMatchObject({
        id: user.id,
        email: user.email,
        role: user.role,
      });
    });

    it('should expire tokens after 7 days', () => {
      const user = { id: '123', email: 'test@example.com', role: 'member' };
      const token = authService.generateAccessToken(user);
      const decoded = jwt.decode(token) as any;

      const expiryDate = new Date(decoded.exp * 1000);
      const expectedExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      expect(expiryDate.getTime()).toBeCloseTo(expectedExpiry.getTime(), -10000);
    });
  });
});
```

#### Task D-1-T2: API Integration Tests
**Token Budget**: 10,000
**Scope**: End-to-end API testing
```typescript
// src/__tests__/api/crashes.test.ts
describe('Crashes API', () => {
  let app: Application;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getTestToken();
  });

  afterAll(async () => {
    await cleanupTestDb();
  });

  describe('GET /api/v1/crashes', () => {
    it('should return paginated crashes', async () => {
      // Seed test data
      await seedCrashes(25);

      const response = await request(app)
        .get('/api/v1/crashes')
        .set('Authorization', `Bearer ${token}`)
        .query({ page: 1, limit: 10 });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(10);
      expect(response.body.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 25,
      });
    });

    it('should filter by status', async () => {
      await seedCrashes([
        { status: 'new' },
        { status: 'in_progress' },
        { status: 'resolved' },
      ]);

      const response = await request(app)
        .get('/api/v1/crashes')
        .set('Authorization', `Bearer ${token}`)
        .query({ status: 'in_progress' });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].status).toBe('in_progress');
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get('/api/v1/crashes');

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/v1/crashes', () => {
    it('should create a new crash', async () => {
      const crashData = {
        title: 'NullPointerException in OrderService',
        exceptionType: 'NullPointerException',
        message: 'Attempt to send message to nil',
        fullTrace: 'Stack trace here...',
      };

      const response = await request(app)
        .post('/api/v1/crashes')
        .set('Authorization', `Bearer ${token}`)
        .send(crashData);

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        id: expect.any(String),
        ...crashData,
        createdBy: expect.any(String),
        version: 1,
      });
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/v1/crashes')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Only title' });

      expect(response.status).toBe(400);
      expect(response.body.details).toContainEqual(
        expect.objectContaining({
          param: 'exceptionType',
          msg: expect.any(String),
        })
      );
    });

    it('should sanitize XSS attempts', async () => {
      const response = await request(app)
        .post('/api/v1/crashes')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: '<script>alert("XSS")</script>',
          exceptionType: 'Test',
          message: 'Test',
          fullTrace: 'Test',
        });

      expect(response.status).toBe(201);
      expect(response.body.title).toBe('alert("XSS")');
    });
  });
});
```

#### Task D-1-T3: Contract Tests
**Token Budget**: 5,000
**Scope**: API contract validation
```typescript
// src/__tests__/contracts/crash.contract.test.ts
import { Pact } from '@pact-foundation/pact';

describe('Crash API Contract', () => {
  const provider = new Pact({
    consumer: 'Desktop App',
    provider: 'Crash API',
  });

  beforeAll(() => provider.setup());
  afterAll(() => provider.finalize());

  describe('get crash by id', () => {
    it('should return crash details', async () => {
      const expectedCrash = {
        id: 'crash-123',
        title: 'Test Crash',
        exceptionType: 'TestException',
        status: 'new',
        version: 1,
      };

      await provider.addInteraction({
        state: 'crash crash-123 exists',
        uponReceiving: 'a request for crash details',
        withRequest: {
          method: 'GET',
          path: '/api/v1/crashes/crash-123',
          headers: {
            Authorization: 'Bearer token',
          },
        },
        willRespondWith: {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
          body: expectedCrash,
        },
      });

      const response = await api.getCrash('crash-123');
      expect(response).toEqual(expectedCrash);
    });
  });
});
```

### Story D-2: Frontend Testing
**Status**: READY
**Persona**: Frontend QA Engineer
**Acceptance Criteria**:
```gherkin
GIVEN the frontend test suite
WHEN tests are executed
THEN component tests verify all interactions
AND E2E tests cover critical user journeys
AND visual regression tests catch UI changes
```
**Depends On**: B-3

#### Task D-2-T1: Component Tests
**Token Budget**: 7,000
**Scope**: React Testing Library tests
```typescript
// src/__tests__/components/CrashList.test.tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CrashList } from '../../pages/CrashList';

const renderWithProviders = (component: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      {component}
    </QueryClientProvider>
  );
};

describe('CrashList', () => {
  it('should display loading state initially', () => {
    renderWithProviders(<CrashList />);
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
  });

  it('should display crashes after loading', async () => {
    const mockCrashes = [
      { id: '1', title: 'Crash 1', status: 'new' },
      { id: '2', title: 'Crash 2', status: 'resolved' },
    ];

    jest.spyOn(api, 'getCrashes').mockResolvedValue({
      items: mockCrashes,
      page: 1,
      totalPages: 1,
    });

    renderWithProviders(<CrashList />);

    await waitFor(() => {
      expect(screen.getByText('Crash 1')).toBeInTheDocument();
      expect(screen.getByText('Crash 2')).toBeInTheDocument();
    });
  });

  it('should filter crashes by status', async () => {
    renderWithProviders(<CrashList />);

    await waitFor(() => {
      screen.getByTestId('status-filter');
    });

    const statusFilter = screen.getByTestId('status-filter');
    fireEvent.change(statusFilter, { target: { value: 'resolved' } });

    await waitFor(() => {
      expect(api.getCrashes).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'resolved' })
      );
    });
  });
});
```

#### Task D-2-T2: E2E Tests
**Token Budget**: 10,000
**Scope**: Playwright E2E test suite
```typescript
// e2e/crash-workflow.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Crash Analysis Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('[name="email"]', 'test@example.com');
    await page.fill('[name="password"]', 'TestPassword123!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/');
  });

  test('should create and analyze a crash', async ({ page }) => {
    // Navigate to crashes
    await page.click('a[href="/crashes"]');
    await expect(page).toHaveURL('/crashes');

    // Create new crash
    await page.click('button:has-text("New Crash")');

    // Fill crash details
    await page.fill('[name="title"]', 'E2E Test Crash');
    await page.fill('[name="exceptionType"]', 'TestException');
    await page.fill('[name="message"]', 'This is a test crash');
    await page.fill('[name="fullTrace"]', 'Stack trace for testing');

    // Submit
    await page.click('button:has-text("Create")');

    // Verify creation
    await expect(page.locator('h1')).toContainText('E2E Test Crash');
    await expect(page.locator('.status-badge')).toContainText('new');

    // Edit crash
    await page.click('button:has-text("Edit")');
    await page.selectOption('[name="status"]', 'in_progress');
    await page.click('button:has-text("Save")');

    // Verify update
    await expect(page.locator('.status-badge')).toContainText('in_progress');

    // Add comment
    await page.fill('[name="comment"]', 'Investigating this issue');
    await page.click('button:has-text("Add Comment")');

    // Verify comment appears
    await expect(page.locator('.comment')).toContainText('Investigating this issue');
  });

  test('should handle sync conflicts', async ({ page, context }) => {
    // Open two tabs
    const page2 = await context.newPage();

    // Navigate to same crash in both tabs
    const crashUrl = '/crashes/test-crash-123';
    await page.goto(crashUrl);
    await page2.goto(crashUrl);

    // Edit in first tab
    await page.click('button:has-text("Edit")');
    await page.selectOption('[name="status"]', 'in_progress');
    await page.click('button:has-text("Save")');

    // Edit in second tab (should conflict)
    await page2.click('button:has-text("Edit")');
    await page2.selectOption('[name="status"]', 'resolved');
    await page2.click('button:has-text("Save")');

    // Verify conflict warning
    await expect(page2.locator('.alert-error'))
      .toContainText('Someone else updated this crash');
  });
});
```

### Story D-3: Performance Testing
**Status**: READY
**Persona**: Performance Engineer
**Acceptance Criteria**:
```gherkin
GIVEN the load test suite
WHEN 50 concurrent users access the system
THEN p95 latency remains <200ms
AND no requests fail
AND memory usage stays <500MB
```
**Depends On**: F-1

#### Task D-3-T1: Load Testing
**Token Budget**: 6,000
**Scope**: k6 load test scripts
```typescript
// load-tests/api-load.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');

export const options = {
  stages: [
    { duration: '30s', target: 10 },  // Ramp up
    { duration: '1m', target: 50 },   // Stay at 50
    { duration: '30s', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<200'], // 95% of requests under 200ms
    errors: ['rate<0.01'],             // Error rate under 1%
  },
};

export function setup() {
  // Login and get token
  const loginRes = http.post(`${__ENV.API_URL}/api/v1/auth/login`, {
    email: 'loadtest@example.com',
    password: 'LoadTest123!',
  });

  return { token: loginRes.json('accessToken') };
}

export default function(data) {
  const params = {
    headers: {
      'Authorization': `Bearer ${data.token}`,
      'Content-Type': 'application/json',
    },
  };

  // Scenario 1: List crashes
  const listRes = http.get(
    `${__ENV.API_URL}/api/v1/crashes?page=1&limit=20`,
    params
  );

  check(listRes, {
    'list status is 200': (r) => r.status === 200,
    'list response time < 200ms': (r) => r.timings.duration < 200,
  });

  errorRate.add(listRes.status !== 200);

  sleep(1);

  // Scenario 2: Get specific crash
  const crashId = 'test-crash-123';
  const getRes = http.get(
    `${__ENV.API_URL}/api/v1/crashes/${crashId}`,
    params
  );

  check(getRes, {
    'get status is 200': (r) => r.status === 200,
    'get response time < 200ms': (r) => r.timings.duration < 200,
  });

  errorRate.add(getRes.status !== 200);

  sleep(1);
}
```

---

## EPIC E: Security & Compliance

**Definition of Done**:
- ✓ Zero HIGH vulnerabilities in security scan
- ✓ All OWASP Top 10 mitigated
- ✓ Penetration test passed

### Story E-1: Security Scanning
**Status**: READY
**Persona**: Security Engineer
**Acceptance Criteria**:
```gherkin
GIVEN the security scanning pipeline
WHEN code is committed
THEN dependency vulnerabilities are detected
AND SAST finds code vulnerabilities
AND secrets are prevented from commits
```

#### Task E-1-T1: Dependency Scanning
**Token Budget**: 4,000
**Scope**: npm audit and Snyk integration
```yaml
# .github/workflows/security.yml
name: Security Scan

on: [push, pull_request]

jobs:
  dependency-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Run npm audit
        run: |
          npm audit --audit-level=high

      - name: Run Snyk scan
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
        with:
          args: --severity-threshold=high

      - name: Upload results
        uses: github/codeql-action/upload-sarif@v2
        with:
          sarif_file: snyk.sarif
```

#### Task E-1-T2: SAST Implementation
**Token Budget**: 5,000
**Scope**: CodeQL and ESLint security rules
```javascript
// .eslintrc.security.js
module.exports = {
  extends: [
    'plugin:security/recommended',
  ],
  plugins: ['security'],
  rules: {
    'security/detect-object-injection': 'error',
    'security/detect-non-literal-regexp': 'error',
    'security/detect-unsafe-regex': 'error',
    'security/detect-buffer-noassert': 'error',
    'security/detect-child-process': 'error',
    'security/detect-disable-mustache-escape': 'error',
    'security/detect-eval-with-expression': 'error',
    'security/detect-no-csrf-before-method-override': 'error',
    'security/detect-non-literal-fs-filename': 'error',
    'security/detect-non-literal-require': 'error',
    'security/detect-possible-timing-attacks': 'error',
    'security/detect-pseudoRandomBytes': 'error',
  },
};
```

---

## EPIC F: Deployment & Operations

**Definition of Done**:
- ✓ One-command deployment
- ✓ Zero-downtime deployments
- ✓ Monitoring dashboard operational

### Story F-1: Infrastructure as Code
**Status**: READY
**Persona**: DevOps Engineer
**Acceptance Criteria**:
```gherkin
GIVEN the deployment scripts
WHEN ./deploy.sh production is run
THEN application deploys with zero downtime
AND database migrations run automatically
AND health checks pass
```
**Depends On**: A-4

#### Task F-1-T1: Docker Configuration
**Token Budget**: 6,000
**Scope**: Multi-stage Dockerfile
```dockerfile
# Dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:18-alpine AS dev-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM dev-deps AS build
WORKDIR /app
COPY . .
RUN npm run build

FROM node:18-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache dumb-init
USER node
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node package*.json ./

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
```

#### Task F-1-T2: Deployment Scripts
**Token Budget**: 7,000
**Scope**: Zero-downtime deployment
```bash
#!/bin/bash
# deploy.sh

set -euo pipefail

ENVIRONMENT=$1
IMAGE_TAG=${2:-latest}

echo "Deploying to ${ENVIRONMENT} with tag ${IMAGE_TAG}"

# Build and push image
docker build -t crash-analyzer:${IMAGE_TAG} .
docker tag crash-analyzer:${IMAGE_TAG} registry.example.com/crash-analyzer:${IMAGE_TAG}
docker push registry.example.com/crash-analyzer:${IMAGE_TAG}

# Run database migrations
echo "Running database migrations..."
docker run --rm \
  --env-file .env.${ENVIRONMENT} \
  registry.example.com/crash-analyzer:${IMAGE_TAG} \
  npm run migrate

# Deploy with blue-green strategy
echo "Starting new version..."
docker-compose -f docker-compose.${ENVIRONMENT}.yml up -d --scale app=2

# Wait for health checks
echo "Waiting for health checks..."
./scripts/wait-for-healthy.sh

# Switch traffic
echo "Switching traffic to new version..."
./scripts/switch-traffic.sh ${IMAGE_TAG}

# Stop old version
echo "Stopping old version..."
docker-compose -f docker-compose.${ENVIRONMENT}.yml stop app_old

echo "Deployment complete!"
```

#### Task F-1-T3: Monitoring Setup
**Token Budget**: 5,000
**Scope**: Grafana dashboards
```json
// grafana-dashboard.json
{
  "dashboard": {
    "title": "Crash Analyzer Metrics",
    "panels": [
      {
        "title": "Request Rate",
        "targets": [
          {
            "expr": "rate(http_requests_total[5m])"
          }
        ]
      },
      {
        "title": "Response Time (p95)",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(http_request_duration_ms_bucket[5m]))"
          }
        ]
      },
      {
        "title": "Error Rate",
        "targets": [
          {
            "expr": "rate(http_requests_total{status=~\"5..\"}[5m])"
          }
        ]
      },
      {
        "title": "Database Connections",
        "targets": [
          {
            "expr": "db_connection_pool_size"
          }
        ]
      }
    ]
  }
}
```

---

## Test Strategy Summary

### Testing Pyramid
```
         /\
        /E2E\       (5%)  - Critical user journeys
       /------\
      /  API   \    (15%) - Contract & integration tests
     /----------\
    / Component  \  (30%) - UI component tests
   /--------------\
  /   Unit Tests   \ (50%) - Service & utility tests
 /------------------\
```

### Coverage Requirements
- Backend: >80% unit test coverage
- Frontend: >70% component coverage
- API: 100% endpoint coverage
- E2E: Critical paths only

### Performance SLOs
- API Response: p95 < 200ms
- Web Load: < 2s on 3G
- Sync Time: < 5s for 100 items
- Bundle Size: < 500KB gzipped

---

## Rollout Strategy

### Phase 1: Alpha (Week 1-2)
- Deploy to staging
- Internal team testing
- Fix critical bugs

### Phase 2: Beta (Week 3)
- Deploy to 2-3 pilot teams
- Gather feedback
- Performance tuning

### Phase 3: GA (Week 4)
- Full production release
- Monitor metrics
- Iterate based on feedback

---

## Success Metrics

### Technical Metrics
- Uptime: >99.9%
- Error Rate: <1%
- Response Time: p95 <200ms
- Sync Success: >99%

### Business Metrics
- Teams Using: >2
- Daily Active Users: >5
- Crashes Analyzed: >100/week
- Time to Resolution: -30%

---

## Runbook

### Common Issues

#### Issue: Sync Conflicts
**Symptoms**: Users see conflict warnings
**Resolution**:
1. Check activity_log for concurrent edits
2. Identify conflict pattern
3. Advise users on resolution
4. Consider implementing locking if frequent

#### Issue: Slow API Response
**Symptoms**: Response time >500ms
**Resolution**:
1. Check database connection pool
2. Analyze slow query log
3. Check for missing indexes
4. Scale if needed

#### Issue: Authentication Failures
**Symptoms**: 401 errors spike
**Resolution**:
1. Check JWT expiry settings
2. Verify refresh token flow
3. Check for clock skew
4. Rotate secrets if compromised

---

## Completion Checklist

- [ ] All EPICs have clear Definition of Done
- [ ] Every story passes Definition of Ready
- [ ] Dependencies form valid DAG
- [ ] All high-risk items have mitigation
- [ ] Test coverage meets requirements
- [ ] Security scanning configured
- [ ] Monitoring dashboards ready
- [ ] Deployment scripts tested
- [ ] Runbook documented
- [ ] Success metrics defined

**Total Stories**: 24
**Total Tasks**: 72
**Estimated Duration**: 4 weeks
**Team Size Required**: 3-4 developers

This backlog is structured for sequential AI code generation, with each task containing sufficient detail for implementation while staying within token limits.