# Watt Data MCP Integration Suite

Complete suite for working with the Watt Data MCP server using Claude AI - includes both a CLI proof-of-concept and a full web application.

## 📦 What's Included

This repository contains two projects:

### 1. **CLI Proof of Concept** (`/` root directory)
A Node.js CLI tool that demonstrates programmatic connection to the Watt Data MCP server.

### 2. **Web Application** (`/watt-data-web/`)
A full-featured Next.js web app with AI chat interface, CSV upload, data enrichment, and export capabilities.

## 🚀 Quick Start

### Option 1: Web Application (Recommended)

```bash
cd watt-data-web
npm install
npm run dev
```

Open http://localhost:3000 and start enriching data!

### Option 2: CLI Tool

```bash
npm install
npm start
# Or with custom prompt:
node agent-poc.js "What tools are available?"
```

## 🔧 Setup

### 1. Prerequisites

- Node.js 18+
- Anthropic API key
- Watt Data MCP server access (Machine-to-Machine token from Clerk)

### 2. Environment Configuration

Copy the Watt Data config template:

```bash
cp .env.wattdata.example .env
```

Edit `.env` and add your credentials:

```env
# Anthropic API key
ANTHROPIC_API_KEY=sk-ant-your_key_here

# Claude model
CLAUDE_MODEL=claude-sonnet-4-5

# MCP Configuration
MCP_TRANSPORT_TYPE=streamable
MCP_AUTH_TYPE=basic
MCP_SERVER_URL=https://api.wattdata.ai/mcp

# Watt Data API key (base64 encoded)
MCP_SERVER_API_KEY=your_base64_token_here
```

### 3. Get Your Watt Data API Key

1. Log into Clerk web UI
2. Create a Machine for your customer
3. Create a new token within that Machine
4. Record the **Token ID** and **Token Secret**
5. Encode credentials:
   ```bash
   echo -n "tokenId:tokenSecret" | base64
   ```
6. Use the result as `MCP_SERVER_API_KEY`

## 📚 Project Structure

```
watt-data/
├── agent-poc.js              # CLI proof of concept
├── check-models.js           # Check available Claude models
├── package.json              # CLI dependencies
├── .env                      # Your config (not in git)
├── .env.wattdata.example     # Config template
├── POC-README.md             # CLI documentation
├── QUICKSTART.md             # Quick start guide
└── watt-data-web/            # Web application
    ├── app/
    │   ├── page.tsx          # Main UI
    │   └── api/              # API routes
    ├── components/           # React components
    ├── lib/                  # Utilities
    └── README.md             # Web app docs
```

## 🎯 Features

### CLI Tool
- ✅ Connect to Watt Data MCP server via API
- ✅ Supports Streamable HTTP transport
- ✅ Basic authentication with M2M tokens
- ✅ Agentic tool execution
- ✅ 6 available Watt Data tools

### Web Application
- ✅ AI chat interface
- ✅ CSV upload with drag-and-drop
- ✅ Auto-detect email/phone/address columns
- ✅ Data enrichment with demographics
- ✅ Export enriched CSV
- ✅ Persistent chat history
- ✅ Real-time data preview

## 🛠️ Available Tools (via Watt Data MCP)

1. **resolve_identities** - Match emails/phones/addresses to person IDs
2. **get_person** - Get detailed person profiles
3. **list_clusters** - Discover audience clusters
4. **get_cluster** - Get cluster analytics
5. **find_persons** - Build audiences based on clusters
6. **submit_feedback** - Report data issues

## 📖 Documentation

- **[QUICKSTART.md](QUICKSTART.md)** - 5-minute setup for CLI
- **[POC-README.md](POC-README.md)** - Detailed CLI documentation
- **[watt-data-web/README.md](watt-data-web/README.md)** - Web app documentation
- **[API Spec](api-spec.md)** - Watt Data API specification

## 🔍 Usage Examples

### CLI

```bash
# List available tools
npm start

# Custom query
node agent-poc.js "Resolve email: test@example.com"

# Check available models
npm run check-models
```

### Web App

1. Upload CSV with email/phone/address columns
2. Ask: "Enrich all rows with demographics"
3. Export enriched CSV with person_id, demographics, interests

## 🏗️ Architecture

```
┌─────────────┐
│   User      │
│  (CLI/Web)  │
└──────┬──────┘
       │
       ↓
┌──────────────┐
│  MCP Agent   │
│  Library     │
└──────┬───────┘
       │
       ↓
┌────────────────────┐
│  Streamable HTTP   │
│  Transport         │
└──────┬─────────────┘
       │
       ↓
┌───────────────┐
│  Watt Data    │
│  MCP Server   │
└───────────────┘
```

## 🔑 Key Learnings

1. **Transport Type**: Use `StreamableHTTPClientTransport` for remote MCP servers (not SSE)
2. **Authentication**: Pass headers via `requestInit: { headers }` object
3. **Model Availability**: Check available models with `npm run check-models`
4. **Basic Auth Format**: `Authorization: Basic <base64>`

## 🐛 Troubleshooting

### "401 Unauthorized"
- Verify base64 encoding: `echo -n "id:secret" | base64`
- Check token is active in Clerk
- Ensure `MCP_AUTH_TYPE=basic`

### "Model not found"
- Run `npm run check-models`
- Update `CLAUDE_MODEL` in `.env`

### "MCP connection failed"
- Verify `MCP_SERVER_URL` is correct
- Check network connection
- Ensure `MCP_TRANSPORT_TYPE=streamable`

## 🚀 Development

### CLI Tool

```bash
# Install dependencies
npm install

# Run CLI
npm start

# Check models
npm run check-models
```

### Web App

```bash
cd watt-data-web

# Install dependencies
npm install

# Run dev server
npm run dev

# Build for production
npm run build
npm start
```

## 📝 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key |
| `CLAUDE_MODEL` | Yes | Claude model (e.g., claude-sonnet-4-5) |
| `MCP_TRANSPORT_TYPE` | Yes | Transport type (streamable) |
| `MCP_AUTH_TYPE` | Yes | Auth type (basic) |
| `MCP_SERVER_URL` | Yes | Watt Data MCP server URL |
| `MCP_SERVER_API_KEY` | Yes | Base64-encoded M2M token |

## 🎓 Technologies

- **Node.js** - Runtime
- **TypeScript** - Type safety (web app)
- **Next.js 16** - React framework (web app)
- **Anthropic SDK** - Claude AI integration
- **MCP SDK** - Model Context Protocol client
- **Tailwind CSS** - Styling (web app)
- **PapaParse** - CSV parsing (web app)

## 📄 License

ISC

---

**Built with Claude Code**

Powered by Anthropic Claude & Watt Data MCP Server
