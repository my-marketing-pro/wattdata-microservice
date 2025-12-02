# Watt Data MCP Web Assistant

A Next.js web application for interacting with the Watt Data MCP server through an AI chatbot interface with CSV upload and enrichment capabilities.

## Features

- **AI Chat Interface**: Natural language interaction with Watt Data tools
- **CSV Upload**: Drag-and-drop or file picker for CSV files
- **Auto-Detection**: Automatically detects email, phone, address, and person_id columns
- **Data Enrichment**: Enrich uploaded data with demographics, interests, and profile data
- **CSV Export**: Remote MCP exports are re-ordered to match the input rows and merged with the original columns before download
- **Secure Proxy Download**: Server-side `/api/proxy-download` route hides signed MCP URLs from the browser while streaming large exports
- **Chat History**: Persistent chat history in browser localStorage
- **Real-time Preview**: View uploaded data and enrichment status

## Quick Start

### 1. Installation

```bash
npm install
```

### 2. Environment Setup

The `.env.local` file should already be configured with your Watt Data credentials from the parent project. If not, copy it:

```bash
cp ../.env .env.local
```

Required environment variables:
- `AI_PROVIDER` - `claude` (default) or `gemini`
- `ANTHROPIC_API_KEY` - Your Anthropic API key (required when `AI_PROVIDER=claude`)
- `CLAUDE_MODEL` - Claude model to use (e.g., claude-sonnet-4-5)
- `GEMINI_API_KEY` - Your Gemini API key (required when `AI_PROVIDER=gemini`)
- `GEMINI_MODEL` - Gemini model to use (defaults to gemini-2.0-flash)
- `MCP_TRANSPORT_TYPE` - Transport type (streamable)
- `MCP_AUTH_TYPE` - Authentication type (basic)
- `MCP_SERVER_URL` - Watt Data MCP server URL
- `MCP_SERVER_API_KEY` - Base64-encoded Watt Data token

You can switch between Claude and Gemini by changing the `AI_PROVIDER` variable without touching the rest of the stack. This is useful if one provider temporarily runs out of quota—you can continue testing with Gemini and switch back to Claude later.

### 3. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

### Basic Workflow

1. **Upload CSV**: Drag and drop or click to upload a CSV file with:
   - Email addresses
   - Phone numbers
   - Physical addresses
   - Person IDs

2. **Ask Questions**: Chat with the AI assistant about your data:
   - "Enrich all rows with demographics"
   - "Find people in California"
   - "Get profiles for the first 10 rows"

3. **Export Results**: Click "Export CSV" to download enriched data. The app fetches the MCP export through the proxy API, flattens malformed JSON structures, merges in the original columns, and preserves row order.

### Example Queries

```
"Resolve the emails in my CSV and get their demographics"

"Enrich the first 5 rows with full profile data"

"What clusters are available for my data?"

"Find similar people to the profiles in my CSV"
```

## Project Structure

```
watt-data-web/
├── app/
│   ├── page.tsx              # Main UI + layout
│   └── api/
│       ├── chat/route.ts     # Chat endpoint (tool orchestration + summaries)
│       ├── process-csv/      # Legacy CSV processing endpoint
│       └── proxy-download/   # Server-side proxy for MCP export files
├── components/
│   ├── ChatInterface.tsx     # Chat UI component
│   ├── FileUpload.tsx        # File upload with drag-drop
│   └── ExportButton.tsx      # CSV export button
├── lib/
│   ├── mcp-agent.ts          # MCP agent logic
│   ├── csv-processor.ts      # CSV parsing/enrichment
│   └── chat-storage.ts       # LocalStorage for chat history
└── .env.local                # Environment variables
```

## Architecture

```
┌─────────────┐
│  Browser    │
│  (React UI) │
└──────┬──────┘
       │
       ↓
┌──────────────┐
│  Next.js API │
│  Routes      │
└──────┬───────┘
       │
       ↓
┌──────────────┐
│  MCP Agent   │
│  Library     │
└──────┬───────┘
       │
       ↓
┌───────────────┐
│  Watt Data    │
│  MCP Server   │
└───────────────┘
```

## Features Breakdown

### Chat Interface
- Real-time streaming responses
- Tool execution tracking
- Message timestamps
- Clear conversation history
- Auto-scroll to latest message

### File Upload
- Drag-and-drop support
- CSV validation
- Automatic field detection
- Data preview with first 3 rows
- File removal

### Data Processing
- Identity resolution (email/phone/address)
- Full profile enrichment
- Demographics extraction
- Interests/clusters extraction
- Flattened JSON to CSV conversion

### Export & Proxy Download
- One-click CSV export that always matches the input order
- Remote JSON/CSV exports are flattened (with malformed JSON repair heuristics)
- Original CSV columns stay at the front of each row
- `/api/proxy-download` fetches signed URLs server-side so tokens never reach the browser

## Troubleshooting

### "Module not found" errors
Make sure you've installed dependencies:
```bash
npm install
```

### Environment variable errors
Check that `.env.local` exists and has all required variables:
```bash
cat .env.local
```

### MCP connection fails
Verify your Watt Data credentials and that the server URL is correct.

### CSV upload not working
Ensure your CSV has headers and at least one detectable field (email, phone, address, or person_id).

## Development

### Running in Development Mode

```bash
npm run dev
```

### Building for Production

```bash
npm run build
npm start
```

### Type Checking

```bash
npx tsc --noEmit
```

## Deployment Notes

- Deploying to **Vercel** works out of the box; the API routes (chat, proxy-download, etc.) ship with the app. Make sure outbound HTTPS traffic is allowed so `/api/proxy-download` can fetch Watt Data exports.
- The build currently enforces TypeScript checks (`npx tsc --noEmit`). If Vercel reports a TS error, run the same command locally to reproduce.
- No extra infrastructure is required for the proxy—just use `/api/proxy-download?url=...` in the client, even in production.

## Technologies

- **Next.js 16** - React framework with App Router
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Anthropic SDK** - Claude AI integration
- **MCP SDK** - Model Context Protocol client
- **PapaParse** - CSV parsing

## License

ISC

---

Built with Claude Code & Watt Data MCP Server
