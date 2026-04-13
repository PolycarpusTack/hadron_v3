# Hadron Web — Install Guide

Get Hadron Web running on your machine in under 10 minutes.

## What You Need

- **Docker Desktop** (Windows or Mac) — [download here](https://www.docker.com/products/docker-desktop/)
- **A web browser** (Chrome, Edge, or Firefox)
- **An AI API key** from [OpenAI](https://platform.openai.com/api-keys) or [Anthropic](https://console.anthropic.com/)

That's it. No programming tools required.

## Step 1: Install Docker Desktop

1. Download Docker Desktop from https://www.docker.com/products/docker-desktop/
2. Run the installer and follow the prompts
3. After installation, open Docker Desktop and wait until it says "Docker is running"

**Windows users:** If asked, enable WSL 2 during installation. Click "Yes" to any restart prompts.

## Step 2: Download Hadron

If you received Hadron as a ZIP file, extract it to a folder like `C:\Hadron` or `~/Hadron`.

If using Git:
```
git clone <repository-url> Hadron
```

## Step 3: Start Hadron

Open a terminal (Command Prompt on Windows, Terminal on Mac) and navigate to the Hadron web folder:

```
cd Hadron/hadron-web
```

Start the application:

```
docker compose up -d
```

The first time you run this, Docker will download and build everything. This takes **5-10 minutes**. Subsequent starts take about 10 seconds.

To check that everything is running:

```
docker compose logs -f hadron-web
```

Wait until you see:

```
Hadron Web listening on 0.0.0.0:8080
```

Press `Ctrl+C` to stop watching the logs (the app keeps running).

## Step 4: Open Hadron

Open your browser and go to:

**http://localhost:8080**

You should see the Hadron dashboard. You're logged in automatically as an admin user.

## Step 5: Configure AI

Hadron uses AI to analyze crash logs, code, and tickets. You need to provide an API key:

1. Click **Admin** in the top navigation
2. Click the **AI Config** tab
3. Choose your provider:
   - **OpenAI** — recommended model: `gpt-4o`
   - **Anthropic** — recommended model: `claude-sonnet-4-6`
4. Paste your API key
5. Click **Save**
6. Click **Test** to verify the connection

## Step 6: Start Using Hadron

You're ready! Here's what you can do:

| Feature | Where to Find It | What It Does |
|---|---|---|
| **Crash Analyzer** | Analyze tab | Upload crash logs for AI-powered analysis |
| **Code Analyzer** | Code Analyzer tab | Paste code for quality review and optimization suggestions |
| **JIRA Integration** | JIRA Analyzer tab | Analyze JIRA tickets with AI triage and deep analysis |
| **Sentry Integration** | Sentry tab | Analyze Sentry error events with pattern detection |
| **Release Notes** | Releases tab | Generate release notes from JIRA fix versions |
| **Performance Analyzer** | Performance tab | Analyze VisualWorks performance traces |
| **Chat** | Chat tab | Ask Hadron questions — it can search your analyses and knowledge base |
| **Search** | Search tab | Find past analyses with text or hybrid (AI-powered) search |

## Optional: Set Up Integrations

### JIRA

1. Go to **Admin** → **JIRA Poller** tab
2. Enter your JIRA Cloud URL (e.g., `https://yourcompany.atlassian.net`)
3. Enter your email address
4. Enter a JIRA API token ([create one here](https://id.atlassian.com/manage-profile/security/api-tokens))
5. Click **Save**

### Sentry

1. Go to **Admin** → **Sentry** tab
2. Enter your Sentry URL (e.g., `https://sentry.io`)
3. Enter your organization slug
4. Enter a Sentry auth token ([create one here](https://sentry.io/settings/auth-tokens/))
5. Click **Save**

### Confluence (for publishing release notes)

1. Go to **Admin** → **Confluence** tab
2. Enter your Confluence space key
3. Enter the parent page ID (find it in the Confluence page URL)
4. Click **Save** — uses the same credentials as JIRA

### OpenSearch (for knowledge base search)

1. Go to **Admin** → configure via the OpenSearch panel in Search
2. Enter your cluster URL, index pattern, and credentials

## Stopping and Restarting

**Stop Hadron:**
```
cd Hadron/hadron-web
docker compose down
```

**Restart Hadron:**
```
cd Hadron/hadron-web
docker compose up -d
```

Your data is preserved between restarts — it's stored in a Docker volume.

## Updating Hadron

```
cd Hadron/hadron-web
docker compose down
git pull              # or replace files with the new version
docker compose build
docker compose up -d
```

## Troubleshooting

### "Port 8080 is already in use"

Another application is using port 8080. Either stop that application, or change Hadron's port by editing `docker-compose.yml`:

```yaml
ports:
  - "9090:8080"    # change 8080 to any free port
```

Then open `http://localhost:9090` instead.

### "Cannot connect to the Docker daemon"

Docker Desktop is not running. Open Docker Desktop and wait for it to start.

### "Error: database connection refused"

The database is still starting up. Wait 10 seconds and refresh the page.

### AI features say "No AI configuration available"

You need to set up an AI API key. Go to **Admin** → **AI Config** and enter your key.

### The first build takes very long

This is normal. Rust compilation takes 5-10 minutes on the first build. Subsequent builds are much faster.

## Multi-User Setup (Azure AD)

For production use with multiple users and real authentication:

1. Create an Azure AD App Registration
2. Set the redirect URI to your Hadron URL
3. Create a `.env` file in `hadron-web/`:

```
AUTH_MODE=azure_ad
AZURE_AD_TENANT_ID=your-tenant-id
AZURE_AD_CLIENT_ID=your-client-id
DB_PASSWORD=a-strong-password
SERVER_ENCRYPTION_KEY=a-64-character-hex-string
```

4. Rebuild: `docker compose build && docker compose up -d`

Users will now need to log in with their Azure AD account. The first user to log in gets the admin role.

## Getting Help

- Check the **Admin** panel for configuration options
- Use the **Chat** tab to ask Hadron questions about your analyses
- Contact your team lead or administrator for access issues
