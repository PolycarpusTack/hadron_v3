# Keeper Secrets Manager UI/UX Design

## Design Goals

1. **Discoverability**: Users should easily find and understand the Keeper option
2. **Simplicity**: Minimal steps to connect and configure
3. **Security Messaging**: Clearly communicate the security benefits
4. **Fallback Clarity**: Show whether API key comes from Keeper or direct entry
5. **Enterprise-Ready**: Support organizational deployment scenarios

---

## User Flow

### Flow 1: First-Time Setup (New User)

```
┌────────────────────────────────────────────────────────────────┐
│ Settings Panel                                                  │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐│
│ │ 🛡️ API Key Source                                           ││
│ │                                                              ││
│ │   ○ Direct Entry                                             ││
│ │     Enter API keys manually (stored encrypted locally)       ││
│ │                                                              ││
│ │   ● Keeper Secrets Manager (Recommended for Enterprise)      ││
│ │     Securely retrieve keys from your organization's vault    ││
│ │                                                              ││
│ └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│ When "Keeper" is selected:                                      │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐│
│ │ Connect to Keeper                                            ││
│ │                                                              ││
│ │ One-Time Access Token                                        ││
│ │ ┌─────────────────────────────────────┐ ┌──────────────┐    ││
│ │ │ ••••••••••••••••••••••••           │ │ 👁 │ Connect │    ││
│ │ └─────────────────────────────────────┘ └──────────────┘    ││
│ │                                                              ││
│ │ 💡 Get token from: Settings → Secrets Manager → Applications ││
│ │    in your Keeper Web Vault                                  ││
│ │                                                              ││
│ └─────────────────────────────────────────────────────────────┘│
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

### Flow 2: After Keeper Connection

```
┌────────────────────────────────────────────────────────────────┐
│ Settings Panel                                                  │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐│
│ │ 🛡️ Keeper Secrets Manager                     [Disconnect]  ││
│ │                                                              ││
│ │ ✅ Connected • 5 secrets available                           ││
│ │                                                              ││
│ │ ─────────────────────────────────────────────────────────── ││
│ │                                                              ││
│ │ Map Secrets to AI Providers                                  ││
│ │                                                              ││
│ │ OpenAI      [▼ Select a secret...              ] 🔗          ││
│ │             └─ Production API Key                            ││
│ │             └─ Development API Key                           ││
│ │             └─ Team Shared Key                               ││
│ │                                                              ││
│ │ Anthropic   [▼ Anthropic Production Key        ] ✓           ││
│ │                                                              ││
│ │ Z.ai        [▼ Select a secret...              ] ○           ││
│ │                                                              ││
│ │ ─────────────────────────────────────────────────────────── ││
│ │                                                              ││
│ │ 🔒 API keys are retrieved securely from Keeper at runtime.   ││
│ │    Keys are never stored locally or displayed in this app.   ││
│ │                                                              ││
│ └─────────────────────────────────────────────────────────────┘│
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

### Flow 3: Mixed Mode (Some from Keeper, Some Direct)

```
┌────────────────────────────────────────────────────────────────┐
│ API Keys Configuration                                          │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Provider   │ Source            │ Status                        │
│ ───────────┼───────────────────┼─────────────────────────────  │
│ OpenAI     │ 🔑 Keeper         │ ✅ "Production API Key"        │
│ Anthropic  │ 📝 Direct Entry   │ ✅ Configured                  │
│ Z.ai       │ ○ Not configured  │ ⚠️ No key                      │
│ Ollama     │ 🏠 Local          │ ✅ No key needed               │
│                                                                 │
│ [Configure Keeper] [Enter Keys Manually]                        │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

---

## Component Design

### KeeperConfigSection Component

```tsx
interface KeeperConfigSectionProps {
  keeperStatus: KeeperStatus;
  keeperSecrets: KeeperSecretInfo[];
  secretMappings: Record<string, string>;
  onInitialize: (token: string) => Promise<void>;
  onDisconnect: () => Promise<void>;
  onMapSecret: (provider: string, secretUid: string | null) => void;
}
```

### Visual States

#### State: Not Connected
- Gray background with purple accent border
- Shield icon (purple)
- One-time token input field (password type)
- "Connect" button (purple, prominent)
- Help text with link to Keeper documentation

#### State: Connecting
- Loading spinner replacing Connect button
- Input field disabled
- Status text: "Connecting to Keeper..."

#### State: Connected
- Green success indicator
- Connected status with secret count
- Dropdown menus for each provider
- Link/Unlink icons showing mapping status
- Disconnect button (subtle, in corner)

#### State: Connection Error
- Red error indicator
- Error message with troubleshooting tips
- "Retry" button
- Option to fall back to direct entry

---

## Color Scheme

| Element | Light Mode | Dark Mode |
|---------|------------|-----------|
| Keeper Section BG | `purple-50` | `purple-500/10` |
| Keeper Section Border | `purple-200` | `purple-500/30` |
| Connected Status | `green-600` | `green-400` |
| Disconnected | `gray-500` | `gray-400` |
| Error | `red-600` | `red-400` |
| Secret Mapped | `green-500` | `green-400` (Link icon) |
| Secret Unmapped | `gray-400` | `gray-500` (Unlink icon) |

---

## Interaction Details

### Token Input
- Paste-friendly (no character restrictions)
- Show/hide toggle for verification
- Auto-clear after successful connection
- Validation: Must be non-empty

### Secret Dropdown
- Shows secret title only (not UID)
- "-- Select a secret --" as default option
- Sorted alphabetically
- Filter for Login/Password record types preferred

### Keyboard Navigation
- Tab through all controls
- Enter to submit token
- Escape to cancel/close

---

## Responsive Behavior

### Desktop (> 768px)
- Full side-by-side layout
- All provider mappings visible at once

### Tablet (768px)
- Stacked layout
- Collapsible provider mapping section

### Mobile (< 640px)
- Single column
- Expandable accordion for each provider

---

## Error Handling UX

### Invalid Token
```
┌─────────────────────────────────────────────────────────────┐
│ ❌ Connection Failed                                         │
│                                                              │
│ The one-time token is invalid or expired.                    │
│                                                              │
│ Possible causes:                                             │
│ • Token has already been used (one-time only)                │
│ • Token has expired                                          │
│ • Copy/paste error (ensure full token)                       │
│                                                              │
│ Generate a new token in Keeper Web Vault:                    │
│ Settings → Secrets Manager → Applications → Add Device       │
│                                                              │
│ [Try Again] [Use Direct Entry Instead]                       │
└─────────────────────────────────────────────────────────────┘
```

### Network Error
```
┌─────────────────────────────────────────────────────────────┐
│ ⚠️ Connection Error                                          │
│                                                              │
│ Could not connect to Keeper servers.                         │
│                                                              │
│ • Check your internet connection                             │
│ • Keeper may be temporarily unavailable                      │
│                                                              │
│ [Retry] [Use Cached Secrets] [Use Direct Entry]              │
└─────────────────────────────────────────────────────────────┘
```

---

## Security Indicators

### Tooltip: Why use Keeper?
```
Benefits of Keeper integration:
• API keys never stored locally
• Centralized key management
• Audit trail of access
• Easy key rotation
• Enterprise policy compliance
```

### Security Badge
Show a small shield icon next to provider name when using Keeper:
```
OpenAI  🛡️  Using: "Production API Key" from Keeper
```

---

## Implementation Priority

1. **P0 - MVP**: Basic connect/disconnect, secret listing, mapping
2. **P1 - Enhanced**: Error handling, retry logic, cached secrets
3. **P2 - Polish**: Help tooltips, keyboard shortcuts, responsive design
4. **P3 - Enterprise**: Multi-tenant support, admin configuration

---

## Accessibility Considerations

- All interactive elements keyboard accessible
- ARIA labels for status indicators
- Color-blind friendly status icons (not color-only)
- Screen reader announcements for connection status changes
- Sufficient color contrast (WCAG AA minimum)
