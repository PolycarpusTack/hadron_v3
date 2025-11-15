# VisualWorks Smalltalk Crash Analysis System
## Phase 2: Enterprise & Security Enhancements

---

## Document Overview

**Purpose:** This document outlines the enterprise-grade features and security enhancements to be added AFTER the core lightweight system is deployed and validated.

**Target Users:** Organizations requiring:
- Multi-user access with permissions
- Enhanced security and compliance
- Cost management and quotas
- Advanced analytics and reporting
- Enterprise integrations

**Prerequisites:**
- Phase 1-7 of core system completed and deployed
- Core system is stable and being used in production
- Feedback gathered from initial users
- Business case validated

---

## PHASE 2.1: Authentication & Authorization

### Objective

Transform the single-user/open-access system into a secure multi-user platform with role-based access control.

### Definition of Ready (DoR)

Before starting Phase 2.1, ensure:

- [ ] Core system is stable and in production use
- [ ] User management requirements are documented
- [ ] Authentication method decided (JWT, OAuth2, SAML)
- [ ] User roles and permissions defined
- [ ] Session management strategy agreed upon
- [ ] Password policy documented
- [ ] Decision made on self-registration vs admin-only user creation

### Tasks

#### Task 2.1.1: User Management Database Schema

**Action:** Add user and authentication tables

**Database Schema:**

```sql
-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    role VARCHAR(50) DEFAULT 'analyst' CHECK (role IN ('admin', 'analyst', 'viewer')),

    -- Account status
    is_active BOOLEAN DEFAULT true,
    email_verified BOOLEAN DEFAULT false,
    last_login_at TIMESTAMP WITH TIME ZONE,
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP WITH TIME ZONE,

    -- Preferences
    preferences JSONB DEFAULT '{}',

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Sessions table (for JWT token tracking)
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL, -- Hash of JWT for revocation
    device_info JSONB,
    ip_address INET,
    user_agent TEXT,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Password reset tokens
CREATE TABLE password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Email verification tokens
CREATE TABLE email_verification_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    verified_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add user tracking to crashes
ALTER TABLE crashes ADD COLUMN created_by UUID REFERENCES users(id);
ALTER TABLE crashes ADD COLUMN updated_by UUID REFERENCES users(id);

-- Add indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_sessions_expires ON user_sessions(expires_at);
CREATE INDEX idx_crashes_created_by ON crashes(created_by);
```

**Deliverable:** User management schema implemented

#### Task 2.1.2: Authentication API

**Action:** Build authentication endpoints

**API Endpoints:**

```javascript
// POST /api/v1/auth/register
// Register new user (if self-registration enabled)
{
    "email": "user@example.com",
    "password": "SecurePassword123!",
    "full_name": "John Doe"
}

// POST /api/v1/auth/login
// Login and receive JWT token
{
    "email": "user@example.com",
    "password": "password"
}
// Response: { "token": "jwt-token", "user": {...} }

// POST /api/v1/auth/logout
// Revoke current session token

// POST /api/v1/auth/refresh
// Refresh JWT token before expiry

// POST /api/v1/auth/forgot-password
// Request password reset email
{
    "email": "user@example.com"
}

// POST /api/v1/auth/reset-password
// Reset password with token
{
    "token": "reset-token",
    "new_password": "NewSecurePassword123!"
}

// POST /api/v1/auth/verify-email
// Verify email address
{
    "token": "verification-token"
}

// GET /api/v1/auth/me
// Get current user info (requires authentication)
```

**Authentication Implementation:**

```javascript
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

class AuthService {
    async register(email, password, fullName) {
        // Validate password strength
        this.validatePasswordStrength(password);

        // Hash password
        const passwordHash = await bcrypt.hash(password, 12);

        // Create user
        const user = await db.users.create({
            email,
            password_hash: passwordHash,
            full_name: fullName,
            role: 'analyst' // Default role
        });

        // Send verification email
        await this.sendVerificationEmail(user);

        return { id: user.id, email: user.email };
    }

    async login(email, password) {
        const user = await db.users.findByEmail(email);

        if (!user) {
            throw new Error('Invalid credentials');
        }

        // Check account locked
        if (user.locked_until && user.locked_until > new Date()) {
            throw new Error('Account temporarily locked');
        }

        // Verify password
        const valid = await bcrypt.compare(password, user.password_hash);

        if (!valid) {
            await this.handleFailedLogin(user);
            throw new Error('Invalid credentials');
        }

        // Reset failed attempts
        await db.users.update(user.id, {
            failed_login_attempts: 0,
            last_login_at: new Date()
        });

        // Generate JWT
        const token = this.generateToken(user);

        // Store session
        await this.createSession(user.id, token);

        return {
            token,
            user: {
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                role: user.role
            }
        };
    }

    generateToken(user) {
        return jwt.sign(
            {
                userId: user.id,
                email: user.email,
                role: user.role
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );
    }

    async handleFailedLogin(user) {
        const attempts = user.failed_login_attempts + 1;

        // Lock account after 5 failed attempts
        if (attempts >= 5) {
            await db.users.update(user.id, {
                failed_login_attempts: attempts,
                locked_until: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
            });
        } else {
            await db.users.update(user.id, {
                failed_login_attempts: attempts
            });
        }
    }

    validatePasswordStrength(password) {
        const minLength = 8;
        const hasUpperCase = /[A-Z]/.test(password);
        const hasLowerCase = /[a-z]/.test(password);
        const hasNumbers = /\d/.test(password);
        const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

        if (password.length < minLength) {
            throw new Error('Password must be at least 8 characters');
        }

        if (!hasUpperCase || !hasLowerCase || !hasNumbers || !hasSpecialChar) {
            throw new Error('Password must contain uppercase, lowercase, number, and special character');
        }
    }
}
```

**Middleware:**

```javascript
// Authentication middleware
async function authenticate(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Check if session exists and not expired
        const session = await db.sessions.findByTokenHash(
            crypto.createHash('sha256').update(token).digest('hex')
        );

        if (!session || session.expires_at < new Date()) {
            return res.status(401).json({ error: 'Session expired' });
        }

        // Attach user to request
        req.user = {
            id: decoded.userId,
            email: decoded.email,
            role: decoded.role
        };

        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid token' });
    }
}

// Authorization middleware
function authorize(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }

        next();
    };
}

// Apply to routes
app.get('/api/v1/crashes', authenticate, getCrashes);
app.delete('/api/v1/crashes/:id', authenticate, authorize('admin'), deleteCrash);
```

**Deliverable:** Complete authentication system

#### Task 2.1.3: Role-Based Access Control (RBAC)

**Action:** Implement permission system

**Role Definitions:**

```javascript
const ROLES = {
    admin: {
        name: 'Administrator',
        permissions: [
            'crash:create',
            'crash:read',
            'crash:update',
            'crash:delete',
            'crash:validate',
            'user:create',
            'user:read',
            'user:update',
            'user:delete',
            'settings:manage',
            'ai:configure'
        ]
    },
    analyst: {
        name: 'Crash Analyst',
        permissions: [
            'crash:create',
            'crash:read',
            'crash:update',
            'crash:validate',
            'crash:export'
        ]
    },
    viewer: {
        name: 'Viewer',
        permissions: [
            'crash:read',
            'crash:export'
        ]
    }
};

// Permission checker
class PermissionChecker {
    hasPermission(user, permission) {
        const role = ROLES[user.role];
        return role && role.permissions.includes(permission);
    }

    requirePermission(permission) {
        return (req, res, next) => {
            if (!this.hasPermission(req.user, permission)) {
                return res.status(403).json({
                    error: 'Insufficient permissions',
                    required: permission
                });
            }
            next();
        };
    }
}

// Usage
app.post('/api/v1/crashes',
    authenticate,
    permissionChecker.requirePermission('crash:create'),
    createCrash
);

app.post('/api/v1/crashes/:id/validate',
    authenticate,
    permissionChecker.requirePermission('crash:validate'),
    validateCrash
);
```

**Deliverable:** RBAC system implemented

#### Task 2.1.4: User Management UI

**Action:** Build user administration interface

**UI Components:**

```jsx
// User management page (Admin only)
<UserManagementPage>
  <Header>
    <Title>User Management</Title>
    <CreateUserButton />
  </Header>

  <UserTable>
    <TableHeader>
      <Column>Email</Column>
      <Column>Name</Column>
      <Column>Role</Column>
      <Column>Status</Column>
      <Column>Last Login</Column>
      <Column>Actions</Column>
    </TableHeader>
    <TableBody>
      {users.map(user => (
        <UserRow>
          <Email>{user.email}</Email>
          <Name>{user.full_name}</Name>
          <RoleBadge>{user.role}</RoleBadge>
          <StatusBadge active={user.is_active} />
          <LastLogin>{formatDate(user.last_login_at)}</LastLogin>
          <Actions>
            <EditButton />
            <DeactivateButton />
            <DeleteButton />
          </Actions>
        </UserRow>
      ))}
    </TableBody>
  </UserTable>

  <Pagination />
</UserManagementPage>

// Login page
<LoginPage>
  <LoginForm>
    <Logo />
    <Title>Crash Analyzer Login</Title>
    <EmailInput />
    <PasswordInput />
    <RememberMeCheckbox />
    <LoginButton />
    <ForgotPasswordLink />
  </LoginForm>
</LoginPage>

// User profile page
<UserProfilePage>
  <ProfileSection>
    <Avatar />
    <UserInfo>
      <Name>{user.full_name}</Name>
      <Email>{user.email}</Email>
      <Role>{user.role}</Role>
    </UserInfo>
    <EditProfileButton />
  </ProfileSection>

  <PasswordChangeSection>
    <CurrentPasswordInput />
    <NewPasswordInput />
    <ConfirmPasswordInput />
    <ChangePasswordButton />
  </PasswordChangeSection>

  <SessionsSection>
    <Title>Active Sessions</Title>
    <SessionsList>
      {sessions.map(session => (
        <SessionCard>
          <DeviceInfo>{session.device_info}</DeviceInfo>
          <IPAddress>{session.ip_address}</IPAddress>
          <LastActive>{session.created_at}</LastActive>
          <RevokeButton />
        </SessionCard>
      ))}
    </SessionsList>
  </SessionsSection>
</UserProfilePage>
```

**Deliverable:** User management UI

### Definition of Done (DoD) - Phase 2.1

Phase 2.1 is complete when:

- [ ] User registration and login work correctly
- [ ] JWT tokens are generated and validated
- [ ] Password hashing uses bcrypt with salt rounds ≥12
- [ ] Failed login attempts trigger account lockout
- [ ] Password reset flow works (email → token → reset)
- [ ] Email verification works
- [ ] All API endpoints require authentication
- [ ] RBAC correctly restricts access based on role
- [ ] Admin can create/edit/delete users
- [ ] Users can update their own profile
- [ ] Users can change their password
- [ ] Active sessions are tracked and can be revoked
- [ ] Desktop app stores JWT token securely
- [ ] Web app stores JWT token securely (httpOnly cookie or localStorage)
- [ ] Token refresh works before expiry
- [ ] Logout properly revokes tokens
- [ ] All auth flows are tested
- [ ] Security audit passed

---

## PHASE 2.2: Data Encryption & Security

### Objective

Add encryption for sensitive data at rest and in transit, implement security best practices.

### Definition of Ready (DoR)

Before starting Phase 2.2, ensure:

- [ ] Phase 2.1 (Authentication) is complete
- [ ] Encryption key management strategy decided
- [ ] Compliance requirements documented (GDPR, HIPAA, etc.)
- [ ] Sensitive data fields identified
- [ ] Decision made on encryption library (Node crypto, libsodium, etc.)

### Tasks

#### Task 2.2.1: Database Encryption

**Action:** Encrypt sensitive fields in database

**Implementation:**

```javascript
import crypto from 'crypto';

class EncryptionService {
    constructor() {
        // Master key from environment variable
        this.masterKey = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
        this.algorithm = 'aes-256-gcm';
    }

    encrypt(plaintext) {
        // Generate random IV (initialization vector)
        const iv = crypto.randomBytes(16);

        // Create cipher
        const cipher = crypto.createCipheriv(this.algorithm, this.masterKey, iv);

        // Encrypt
        let encrypted = cipher.update(plaintext, 'utf8', 'hex');
        encrypted += cipher.final('hex');

        // Get auth tag
        const authTag = cipher.getAuthTag();

        // Return IV + authTag + encrypted data (all hex encoded)
        return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
    }

    decrypt(encryptedData) {
        // Parse IV, authTag, and encrypted parts
        const [ivHex, authTagHex, encrypted] = encryptedData.split(':');

        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');

        // Create decipher
        const decipher = crypto.createDecipheriv(this.algorithm, this.masterKey, iv);
        decipher.setAuthTag(authTag);

        // Decrypt
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    }
}

// Usage in database models
class CrashModel {
    async create(crashData) {
        const encryptionService = new EncryptionService();

        // Encrypt sensitive fields
        const encrypted = {
            ...crashData,
            raw_log_content: encryptionService.encrypt(crashData.raw_log_content),
            // Optionally encrypt other fields
            stack_trace: encryptionService.encrypt(crashData.stack_trace || ''),
            user_steps: encryptionService.encrypt(crashData.user_steps || '')
        };

        return await db.crashes.insert(encrypted);
    }

    async get(id) {
        const crash = await db.crashes.findById(id);
        const encryptionService = new EncryptionService();

        // Decrypt sensitive fields
        return {
            ...crash,
            raw_log_content: encryptionService.decrypt(crash.raw_log_content),
            stack_trace: crash.stack_trace ? encryptionService.decrypt(crash.stack_trace) : '',
            user_steps: crash.user_steps ? encryptionService.decrypt(crash.user_steps) : ''
        };
    }
}
```

**Desktop/Web Encryption:**

```javascript
// Desktop (Electron) - Use electron-store with encryption
import Store from 'electron-store';

const store = new Store({
    encryptionKey: 'user-specific-key', // Derived from user password
    name: 'crash-analyzer-data'
});

// Web (IndexedDB) - Encrypt before storing
import { encrypt, decrypt } from './crypto';

class EncryptedIndexedDB {
    async saveCrash(crash) {
        const encryptedCrash = {
            ...crash,
            raw_log_content: await encrypt(crash.raw_log_content, userKey),
            stack_trace: await encrypt(crash.stack_trace, userKey)
        };

        await db.crashes.add(encryptedCrash);
    }

    async getCrash(id) {
        const crash = await db.crashes.get(id);

        return {
            ...crash,
            raw_log_content: await decrypt(crash.raw_log_content, userKey),
            stack_trace: await decrypt(crash.stack_trace, userKey)
        };
    }
}
```

**Deliverable:** Encrypted storage implementation

#### Task 2.2.2: API Key Management

**Action:** Secure storage and rotation of API keys

**Implementation:**

```sql
-- API keys table
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    key_name VARCHAR(255) NOT NULL,
    key_hash VARCHAR(255) NOT NULL, -- Hash of the key
    key_prefix VARCHAR(10) NOT NULL, -- First chars for identification

    -- Permissions
    scopes TEXT[] DEFAULT ARRAY['read'], -- 'read', 'write', 'admin'

    -- Status
    is_active BOOLEAN DEFAULT true,
    last_used_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_api_keys_user ON api_keys(user_id);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
```

```javascript
class APIKeyService {
    generate(userId, keyName, scopes, expiresInDays = 90) {
        // Generate cryptographically secure random key
        const key = 'sk_' + crypto.randomBytes(32).toString('hex');
        const keyHash = crypto.createHash('sha256').update(key).digest('hex');
        const keyPrefix = key.substring(0, 10);

        // Store hash only
        await db.api_keys.create({
            user_id: userId,
            key_name: keyName,
            key_hash: keyHash,
            key_prefix: keyPrefix,
            scopes: scopes,
            expires_at: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
        });

        // Return actual key ONCE (never stored in plaintext)
        return key;
    }

    async verify(apiKey) {
        const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

        const key = await db.api_keys.findByHash(keyHash);

        if (!key || !key.is_active) {
            return null;
        }

        if (key.expires_at && key.expires_at < new Date()) {
            return null;
        }

        // Update last used
        await db.api_keys.update(key.id, { last_used_at: new Date() });

        return {
            userId: key.user_id,
            scopes: key.scopes
        };
    }
}

// Middleware for API key auth
async function authenticateAPIKey(req, res, next) {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
        return res.status(401).json({ error: 'API key required' });
    }

    const keyData = await apiKeyService.verify(apiKey);

    if (!keyData) {
        return res.status(401).json({ error: 'Invalid or expired API key' });
    }

    req.user = { id: keyData.userId, scopes: keyData.scopes };
    next();
}
```

**Deliverable:** Secure API key system

#### Task 2.2.3: Security Headers & HTTPS

**Action:** Implement security best practices

**Implementation:**

```javascript
import helmet from 'helmet';
import cors from 'cors';

// Apply security headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"]
        }
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }
}));

// CORS configuration
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
}));

// Rate limiting
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests, please try again later',
    standardHeaders: true,
    legacyHeaders: false
});

app.use('/api/', limiter);

// Stricter limits for auth endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5, // 5 login attempts per 15 minutes
    skipSuccessfulRequests: true
});

app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/register', authLimiter);

// HTTPS redirect in production
if (process.env.NODE_ENV === 'production') {
    app.use((req, res, next) => {
        if (req.headers['x-forwarded-proto'] !== 'https') {
            return res.redirect('https://' + req.headers.host + req.url);
        }
        next();
    });
}
```

**Deliverable:** Security hardening complete

### Definition of Done (DoD) - Phase 2.2

Phase 2.2 is complete when:

- [ ] Raw log content encrypted at rest in all databases
- [ ] Encryption key management documented
- [ ] API keys are hashed before storage
- [ ] API key authentication works
- [ ] API key rotation capability exists
- [ ] Security headers (Helmet) applied
- [ ] CORS properly configured
- [ ] Rate limiting prevents abuse
- [ ] HTTPS enforced in production
- [ ] SQL injection tests pass (parameterized queries)
- [ ] XSS prevention verified
- [ ] CSRF protection implemented (for web)
- [ ] Security audit passed
- [ ] Penetration testing completed

---

## PHASE 2.3: Multi-Tenancy & Organizations

### Objective

Support multiple organizations/teams with data isolation and resource quotas.

### Definition of Ready (DoR)

Before starting Phase 2.3, ensure:

- [ ] Phase 2.1 and 2.2 complete
- [ ] Multi-tenancy requirements documented
- [ ] Pricing/quota model defined
- [ ] Decision on organization hierarchy (flat vs nested)

### Tasks

#### Task 2.3.1: Organization Schema

**Action:** Add organization support

**Schema:**

```sql
-- Organizations table
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL, -- URL-friendly identifier

    -- Plan and limits
    plan_type VARCHAR(50) DEFAULT 'free' CHECK (plan_type IN ('free', 'pro', 'enterprise')),
    max_users INTEGER DEFAULT 5,
    max_crashes INTEGER DEFAULT 1000,
    storage_quota_gb INTEGER DEFAULT 10,
    ai_analysis_quota INTEGER DEFAULT 100, -- per month

    -- Current usage
    current_user_count INTEGER DEFAULT 0,
    current_crash_count INTEGER DEFAULT 0,
    current_storage_gb DECIMAL(10, 2) DEFAULT 0,
    ai_analyses_this_month INTEGER DEFAULT 0,

    -- Billing
    billing_email VARCHAR(255),
    subscription_status VARCHAR(50) DEFAULT 'active',
    subscription_expires_at TIMESTAMP WITH TIME ZONE,

    -- Settings
    settings JSONB DEFAULT '{}',

    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Organization members (users belong to organizations)
CREATE TABLE organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(organization_id, user_id)
);

-- Add organization_id to crashes
ALTER TABLE crashes ADD COLUMN organization_id UUID REFERENCES organizations(id);
CREATE INDEX idx_crashes_organization ON crashes(organization_id);

-- Row-level security (PostgreSQL)
ALTER TABLE crashes ENABLE ROW LEVEL SECURITY;

CREATE POLICY crashes_org_isolation ON crashes
    FOR ALL
    USING (organization_id = current_setting('app.current_organization_id')::UUID);

-- Indexes
CREATE INDEX idx_organizations_slug ON organizations(slug);
CREATE INDEX idx_org_members_org ON organization_members(organization_id);
CREATE INDEX idx_org_members_user ON organization_members(user_id);
```

**Deliverable:** Multi-tenancy schema

#### Task 2.3.2: Quota Management

**Action:** Implement resource quotas and limits

```javascript
class QuotaService {
    async checkCrashQuota(organizationId) {
        const org = await db.organizations.findById(organizationId);

        if (org.current_crash_count >= org.max_crashes) {
            throw new Error(`Crash limit reached (${org.max_crashes}). Please upgrade your plan.`);
        }
    }

    async checkStorageQuota(organizationId, fileSize) {
        const org = await db.organizations.findById(organizationId);
        const newStorage = org.current_storage_gb + (fileSize / (1024 * 1024 * 1024));

        if (newStorage >= org.storage_quota_gb) {
            throw new Error(`Storage limit reached (${org.storage_quota_gb}GB). Please upgrade.`);
        }
    }

    async checkAIAnalysisQuota(organizationId) {
        const org = await db.organizations.findById(organizationId);

        if (org.ai_analyses_this_month >= org.ai_analysis_quota) {
            throw new Error(`AI analysis limit reached (${org.ai_analysis_quota}/month). Resets next month.`);
        }
    }

    async incrementUsage(organizationId, type, amount = 1) {
        const updates = {};

        switch(type) {
            case 'crash':
                updates.current_crash_count = db.raw('current_crash_count + 1');
                break;
            case 'storage':
                updates.current_storage_gb = db.raw(`current_storage_gb + ${amount}`);
                break;
            case 'ai_analysis':
                updates.ai_analyses_this_month = db.raw('ai_analyses_this_month + 1');
                break;
        }

        await db.organizations.update(organizationId, updates);
    }

    async resetMonthlyQuotas() {
        // Run as cron job on 1st of each month
        await db.organizations.updateAll({
            ai_analyses_this_month: 0
        });
    }
}

// Apply in crash creation
app.post('/api/v1/crashes', authenticate, async (req, res) => {
    const org = req.user.organization;

    // Check quotas
    await quotaService.checkCrashQuota(org.id);
    await quotaService.checkStorageQuota(org.id, req.body.file_size_bytes);

    // Create crash
    const crash = await crashService.create({
        ...req.body,
        organization_id: org.id,
        created_by: req.user.id
    });

    // Increment usage
    await quotaService.incrementUsage(org.id, 'crash');
    await quotaService.incrementUsage(org.id, 'storage', req.body.file_size_bytes / (1024 ** 3));

    res.json(crash);
});
```

**Deliverable:** Quota enforcement system

#### Task 2.3.3: Organization UI

**Action:** Build organization management interface

```jsx
<OrganizationSettingsPage>
  <Tabs>
    <Tab label="General">
      <OrganizationInfo>
        <Field label="Name" value={org.name} editable />
        <Field label="Slug" value={org.slug} />
        <Field label="Plan" value={org.plan_type} />
      </OrganizationInfo>

      <QuotaUsage>
        <QuotaBar
          label="Users"
          current={org.current_user_count}
          max={org.max_users}
        />
        <QuotaBar
          label="Crashes"
          current={org.current_crash_count}
          max={org.max_crashes}
        />
        <QuotaBar
          label="Storage"
          current={org.current_storage_gb}
          max={org.storage_quota_gb}
          unit="GB"
        />
        <QuotaBar
          label="AI Analyses (this month)"
          current={org.ai_analyses_this_month}
          max={org.ai_analysis_quota}
        />
      </QuotaUsage>

      <UpgradePlanButton />
    </Tab>

    <Tab label="Members">
      <MembersList>
        {members.map(member => (
          <MemberCard>
            <UserInfo>
              <Name>{member.full_name}</Name>
              <Email>{member.email}</Email>
            </UserInfo>
            <RoleSelector value={member.role} />
            <RemoveButton />
          </MemberCard>
        ))}
      </MembersList>
      <InviteMemberButton />
    </Tab>

    <Tab label="Billing">
      <BillingInfo>
        <CurrentPlan>{org.plan_type}</CurrentPlan>
        <SubscriptionStatus>{org.subscription_status}</SubscriptionStatus>
        <NextBillingDate>{org.subscription_expires_at}</NextBillingDate>
      </BillingInfo>
      <PaymentMethodSection />
      <InvoiceHistory />
    </Tab>
  </Tabs>
</OrganizationSettingsPage>
```

**Deliverable:** Organization management UI

### Definition of Done (DoD) - Phase 2.3

Phase 2.3 is complete when:

- [ ] Organizations can be created
- [ ] Users can belong to multiple organizations
- [ ] Data isolation enforced (users only see their org's crashes)
- [ ] Quota limits enforced (crashes, storage, AI analyses)
- [ ] Quota usage displayed in UI
- [ ] Organization members can be invited
- [ ] Member roles control permissions
- [ ] Organization settings can be updated
- [ ] Plan upgrades/downgrades work
- [ ] Monthly quota resets function correctly
- [ ] All queries filtered by organization_id
- [ ] Row-level security tested
- [ ] Performance acceptable with 100+ organizations

---

## PHASE 2.4: Audit Logging & Compliance

### Objective

Implement comprehensive audit trails for compliance and debugging.

### Tasks

#### Task 2.4.1: Audit Log Schema

```sql
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Actor (who did it)
    user_id UUID REFERENCES users(id),
    organization_id UUID REFERENCES organizations(id),

    -- Action
    action VARCHAR(100) NOT NULL, -- 'crash.created', 'crash.validated', 'user.login', etc.
    resource_type VARCHAR(50), -- 'crash', 'user', 'organization'
    resource_id UUID,

    -- Context
    changes JSONB, -- Before/after values
    ip_address INET,
    user_agent TEXT,

    -- Result
    status VARCHAR(20) CHECK (status IN ('success', 'failed')),
    error_message TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_org ON audit_logs(organization_id);
CREATE INDEX idx_audit_action ON audit_logs(action);
CREATE INDEX idx_audit_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);
```

```javascript
class AuditLogger {
    async log(userId, organizationId, action, resourceType, resourceId, changes, status, req) {
        await db.audit_logs.create({
            user_id: userId,
            organization_id: organizationId,
            action: action,
            resource_type: resourceType,
            resource_id: resourceId,
            changes: changes,
            ip_address: req.ip,
            user_agent: req.headers['user-agent'],
            status: status
        });
    }

    async logCrashCreated(crash, user, req) {
        await this.log(
            user.id,
            user.organization_id,
            'crash.created',
            'crash',
            crash.id,
            { filename: crash.filename, severity: crash.severity },
            'success',
            req
        );
    }

    async logCrashValidated(crash, user, validationData, req) {
        await this.log(
            user.id,
            user.organization_id,
            'crash.validated',
            'crash',
            crash.id,
            {
                before: { validation_status: crash.validation_status },
                after: { validation_status: validationData.status }
            },
            'success',
            req
        );
    }
}
```

**Deliverable:** Audit logging system

#### Task 2.4.2: Compliance Reports

```jsx
<CompliancePage>
  <AuditLogViewer>
    <Filters>
      <DateRangePicker />
      <UserFilter />
      <ActionFilter />
      <ResourceFilter />
    </Filters>

    <AuditTable>
      {logs.map(log => (
        <AuditRow>
          <Timestamp>{log.created_at}</Timestamp>
          <User>{log.user_email}</User>
          <Action>{log.action}</Action>
          <Resource>{log.resource_type}:{log.resource_id}</Resource>
          <IP>{log.ip_address}</IP>
          <Status>{log.status}</Status>
          <ViewDetailsButton />
        </AuditRow>
      ))}
    </AuditTable>

    <ExportButton format="CSV" />
  </AuditLogViewer>

  <ComplianceReports>
    <Report title="GDPR Data Access Report" />
    <Report title="User Activity Report" />
    <Report title="Security Events Report" />
  </ComplianceReports>
</CompliancePage>
```

**Deliverable:** Compliance reporting

### Definition of Done (DoD) - Phase 2.4

- [ ] All significant actions logged
- [ ] Audit logs include before/after values
- [ ] IP addresses and user agents tracked
- [ ] Audit log viewer shows complete history
- [ ] Audit logs can be exported
- [ ] Retention policy implemented (e.g., 7 years)
- [ ] GDPR compliance verified
- [ ] Audit logs cannot be tampered with

---

## PHASE 2.5: Advanced Cost Management

### Objective

Track and control AI analysis costs, implement budgets and alerts.

### Tasks

#### Task 2.5.1: Cost Tracking Schema

```sql
CREATE TABLE ai_cost_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id),
    crash_id UUID REFERENCES crashes(id),

    provider VARCHAR(50) NOT NULL,
    model VARCHAR(100) NOT NULL,

    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    total_tokens INTEGER NOT NULL,

    cost_per_1k_input DECIMAL(10, 6),
    cost_per_1k_output DECIMAL(10, 6),
    estimated_cost DECIMAL(10, 4),

    analysis_duration_ms INTEGER,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE ai_budget_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id),

    budget_type VARCHAR(50) CHECK (budget_type IN ('daily', 'monthly', 'per_analysis')),
    threshold_amount DECIMAL(10, 2),
    current_amount DECIMAL(10, 2) DEFAULT 0,

    alert_threshold_percent INTEGER DEFAULT 80, -- Alert at 80% of budget
    alert_sent BOOLEAN DEFAULT false,

    reset_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

```javascript
class CostTracker {
    // Pricing as of 2024 (example)
    PRICING = {
        'openai': {
            'gpt-4': { input: 0.03, output: 0.06 }, // per 1K tokens
            'gpt-3.5-turbo': { input: 0.0015, output: 0.002 }
        },
        'anthropic': {
            'claude-3-opus': { input: 0.015, output: 0.075 },
            'claude-3-sonnet': { input: 0.003, output: 0.015 }
        },
        'ollama': {
            'llama3': { input: 0, output: 0 } // Local, free
        }
    };

    calculateCost(provider, model, inputTokens, outputTokens) {
        const pricing = this.PRICING[provider]?.[model];

        if (!pricing) return 0;

        const inputCost = (inputTokens / 1000) * pricing.input;
        const outputCost = (outputTokens / 1000) * pricing.output;

        return inputCost + outputCost;
    }

    async trackAnalysis(organizationId, crashId, provider, model, tokens, duration) {
        const cost = this.calculateCost(provider, model, tokens.input, tokens.output);

        await db.ai_cost_tracking.create({
            organization_id: organizationId,
            crash_id: crashId,
            provider: provider,
            model: model,
            input_tokens: tokens.input,
            output_tokens: tokens.output,
            total_tokens: tokens.input + tokens.output,
            cost_per_1k_input: this.PRICING[provider][model].input,
            cost_per_1k_output: this.PRICING[provider][model].output,
            estimated_cost: cost,
            analysis_duration_ms: duration
        });

        await this.checkBudgetAlerts(organizationId, cost);

        return cost;
    }

    async checkBudgetAlerts(organizationId, newCost) {
        const alerts = await db.ai_budget_alerts.findByOrganization(organizationId);

        for (const alert of alerts) {
            const newTotal = alert.current_amount + newCost;

            if (newTotal >= alert.threshold_amount * (alert.alert_threshold_percent / 100) && !alert.alert_sent) {
                await this.sendBudgetAlert(alert, newTotal);
                await db.ai_budget_alerts.update(alert.id, { alert_sent: true });
            }

            await db.ai_budget_alerts.update(alert.id, {
                current_amount: newTotal
            });
        }
    }

    async getMonthlySpend(organizationId, provider = null) {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const query = db.ai_cost_tracking
            .where('organization_id', organizationId)
            .where('created_at', '>=', startOfMonth);

        if (provider) {
            query.where('provider', provider);
        }

        const result = await query.sum('estimated_cost');
        return result || 0;
    }
}
```

**Deliverable:** Cost tracking system

#### Task 2.5.2: Cost Dashboard

```jsx
<CostManagementPage>
  <CostOverview>
    <StatCard title="This Month" value={`$${monthlySpend.toFixed(2)}`} />
    <StatCard title="This Week" value={`$${weeklySpend.toFixed(2)}`} />
    <StatCard title="Average per Analysis" value={`$${avgCost.toFixed(4)}`} />
    <StatCard title="Total Analyses" value={totalAnalyses} />
  </CostOverview>

  <CostChart>
    <LineChart
      data={dailyCosts}
      xAxis="date"
      yAxis="cost"
      title="Daily AI Costs"
    />
  </CostChart>

  <ProviderBreakdown>
    <PieChart
      data={costsByProvider}
      title="Cost by Provider"
    />
  </ProviderBreakdown>

  <BudgetAlerts>
    <AlertsList>
      {alerts.map(alert => (
        <AlertCard>
          <Type>{alert.budget_type}</Type>
          <Progress
            current={alert.current_amount}
            max={alert.threshold_amount}
          />
          <EditButton />
        </AlertCard>
      ))}
    </AlertsList>
    <CreateBudgetButton />
  </BudgetAlerts>

  <CostHistory>
    <Table>
      {costs.map(cost => (
        <Row>
          <Date>{cost.created_at}</Date>
          <Provider>{cost.provider}</Provider>
          <Model>{cost.model}</Model>
          <Tokens>{cost.total_tokens.toLocaleString()}</Tokens>
          <Cost>${cost.estimated_cost.toFixed(4)}</Cost>
          <CrashLink crashId={cost.crash_id} />
        </Row>
      ))}
    </Table>
    <ExportButton />
  </CostHistory>
</CostManagementPage>
```

**Deliverable:** Cost management dashboard

### Definition of Done (DoD) - Phase 2.5

- [ ] All AI API calls tracked with token counts
- [ ] Costs calculated accurately for each provider
- [ ] Monthly spend totals correct
- [ ] Budget alerts trigger at configured thresholds
- [ ] Email notifications sent for budget alerts
- [ ] Cost dashboard displays accurate data
- [ ] Cost export functionality works
- [ ] Automatic budget reset monthly

---

## PHASE 2.6: Data Retention & Archival

### Objective

Implement automated data archival and retention policies.

### Tasks

```sql
-- Archived crashes table
CREATE TABLE archived_crashes (
    id UUID PRIMARY KEY,
    organization_id UUID,
    archived_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    archive_reason VARCHAR(100),
    original_data JSONB,

    -- Indexed for quick retrieval
    created_at TIMESTAMP WITH TIME ZONE,
    severity VARCHAR(20),
    validation_status VARCHAR(50)
);

-- Retention policies table
CREATE TABLE retention_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id),

    policy_type VARCHAR(50) CHECK (policy_type IN ('age', 'count', 'size')),
    archive_after_days INTEGER, -- Archive crashes older than X days
    delete_after_days INTEGER, -- Delete archived crashes older than X days

    max_crash_count INTEGER, -- Archive oldest when count exceeds this
    max_storage_gb DECIMAL(10, 2),

    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

```javascript
class RetentionService {
    async applyRetentionPolicies() {
        const policies = await db.retention_policies.findActive();

        for (const policy of policies) {
            await this.applyPolicy(policy);
        }
    }

    async applyPolicy(policy) {
        if (policy.policy_type === 'age' && policy.archive_after_days) {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - policy.archive_after_days);

            const oldCrashes = await db.crashes
                .where('organization_id', policy.organization_id)
                .where('created_at', '<', cutoffDate)
                .where('deleted_at', null)
                .limit(100); // Process in batches

            for (const crash of oldCrashes) {
                await this.archiveCrash(crash);
            }
        }

        if (policy.delete_after_days) {
            const deleteCutoff = new Date();
            deleteCutoff.setDate(deleteCutoff.getDate() - policy.delete_after_days);

            await db.archived_crashes
                .where('organization_id', policy.organization_id)
                .where('archived_at', '<', deleteCutoff)
                .delete();
        }
    }

    async archiveCrash(crash) {
        // Move to archive table
        await db.archived_crashes.create({
            id: crash.id,
            organization_id: crash.organization_id,
            archive_reason: 'retention_policy',
            original_data: crash,
            created_at: crash.created_at,
            severity: crash.severity,
            validation_status: crash.validation_status
        });

        // Soft delete from main table
        await db.crashes.update(crash.id, {
            deleted_at: new Date()
        });
    }

    async restoreCrash(crashId) {
        const archived = await db.archived_crashes.findById(crashId);

        if (!archived) {
            throw new Error('Archived crash not found');
        }

        // Restore to main table
        await db.crashes.update(crashId, {
            ...archived.original_data,
            deleted_at: null
        });

        // Remove from archive
        await db.archived_crashes.delete(crashId);
    }
}
```

**Deliverable:** Automated retention system

### Definition of Done (DoD) - Phase 2.6

- [ ] Retention policies can be configured per organization
- [ ] Old crashes automatically archived
- [ ] Archived crashes can be searched/restored
- [ ] Archived crashes automatically deleted after retention period
- [ ] Storage quotas account for archived data
- [ ] Cron job runs retention policies daily
- [ ] Archive/restore operations logged

---

## Implementation Timeline

**Estimated Total: 12-16 weeks**

- Phase 2.1 (Auth & Authorization): 3-4 weeks
- Phase 2.2 (Encryption & Security): 2-3 weeks
- Phase 2.3 (Multi-Tenancy): 3-4 weeks
- Phase 2.4 (Audit Logging): 1-2 weeks
- Phase 2.5 (Cost Management): 1-2 weeks
- Phase 2.6 (Data Retention): 2 weeks

---

## Deployment Strategy

### Migration Path from Phase 1

1. **Database Migration:**
   ```bash
   # Run migration scripts
   npm run migrate:phase2

   # Creates: users, organizations, org_members, api_keys, audit_logs, etc.
   ```

2. **Create Initial Admin User:**
   ```bash
   npm run create-admin -- --email admin@example.com
   ```

3. **Convert Existing Crashes:**
   ```javascript
   // Assign all existing crashes to default organization
   const defaultOrg = await createOrganization('Default Organization');
   await db.crashes.update({ organization_id: null }, { organization_id: defaultOrg.id });
   ```

4. **Enable Authentication:**
   ```bash
   # Update environment variable
   REQUIRE_AUTHENTICATION=true

   # Restart API server
   pm2 restart api
   ```

---

## Security Checklist

Before deploying Phase 2:

- [ ] All passwords hashed with bcrypt (rounds ≥12)
- [ ] JWT secret is cryptographically random (256+ bits)
- [ ] Encryption keys stored securely (not in code)
- [ ] API rate limiting enabled
- [ ] HTTPS enforced
- [ ] Security headers configured
- [ ] SQL injection tests passed
- [ ] XSS prevention verified
- [ ] CSRF protection implemented
- [ ] Audit logging enabled
- [ ] Penetration testing completed
- [ ] GDPR compliance verified
- [ ] Backup encryption enabled

---

## Cost Considerations

### Infrastructure Additions

**New Costs:**
- Email service (SendGrid, AWS SES): $10-50/month
- Additional database storage: $20-100/month
- Monitoring/alerting (optional): $50-200/month

**Potential Savings:**
- AI cost control can save hundreds/month
- Automated archival reduces storage costs

---

## Success Metrics

Phase 2 is successful when:

1. **Security:**
   - Zero authentication bypass vulnerabilities
   - All sensitive data encrypted
   - Penetration test passed

2. **Multi-Tenancy:**
   - 10+ organizations using system
   - Zero cross-organization data leaks
   - Quota enforcement working

3. **Compliance:**
   - Complete audit trail for 6+ months
   - GDPR data export working
   - Retention policies active

4. **Cost Management:**
   - AI costs tracked and within budget
   - Budget alerts preventing overages
   - 20%+ cost reduction through optimization

---

## Rollback Plan

If Phase 2 deployment fails:

1. **Revert database migrations:**
   ```bash
   npm run migrate:rollback:phase2
   ```

2. **Disable authentication:**
   ```bash
   REQUIRE_AUTHENTICATION=false
   pm2 restart api
   ```

3. **Restore from backup:**
   ```bash
   pg_restore -d crash_db backup_pre_phase2.dump
   ```

---

## Summary

Phase 2 transforms the lightweight crash analyzer into an **enterprise-ready platform** with:

✅ **Multi-user authentication & authorization**
✅ **Data encryption at rest and in transit**
✅ **Multi-tenancy with resource quotas**
✅ **Comprehensive audit logging**
✅ **AI cost tracking and budgets**
✅ **Automated data retention & archival**

**When to implement:** After the core system (Phase 1-7) is deployed, validated, and showing value in production.

**Who needs it:** Organizations requiring security, compliance, and multi-user collaboration.

**Who can skip it:** Individual developers or small teams using the system locally or in trusted environments.
