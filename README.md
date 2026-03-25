# Expedition MCP Server

MCP server that exposes the ExpeditionAPI (cruises, hotels, tours) as tools for the n8n AI agent.

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your API token
```

## Run

```bash
# Development (auto-reload)
npm run dev

# Production
npm run build
npm start
```

Server starts on `http://localhost:3001/mcp`

## Tools available

| Tool | Description |
|---|---|
| `list_cruises` | List cruises by origin (galapagos / antarctica / all) |
| `get_cruise_availability` | Availability + pricing for a cruise |
| `list_hotels` | List hotels |
| `get_hotel_availability` | Hotel availability by date and nights |
| `list_tours` | List tours by origin and optional cruise filter |
| `get_itinerary` | Full day-by-day itinerary for a tour |
| `generate_brochure` | Generate PDF brochure → returns base64 |

## n8n configuration

### 1. Add MCP Client node
- URL: `http://localhost:3001/mcp`
- Transport: Streamable HTTP

### 2. Extract PDF from tool response (Code node after AI Agent)

```javascript
// Add this Code node after your AI Agent node
const steps = $('AI Agent').item.json.intermediateSteps ?? [];

let attachment = null;

for (const step of steps) {
  const obs = step?.observation ?? step?.output ?? '';
  try {
    const parsed = JSON.parse(obs);
    if (parsed.type === 'EXPEDITION_PDF_ATTACHMENT') {
      attachment = {
        type: 'pdf',
        filename: parsed.filename,
        base64: parsed.base64,
        title: parsed.title,
      };
      break;
    }
  } catch {
    // not JSON, skip
  }
}

return {
  message: $('AI Agent').item.json.output,
  attachment,
};
```

### 3. Webhook response
The webhook node should return the output of the Code node above:
```json
{
  "message": "Here is the brochure for the Seaman Journey 8D tour!",
  "attachment": {
    "type": "pdf",
    "filename": "seaman-journey-8d-brochure.pdf",
    "base64": "JVBERi0x...",
    "title": "Seaman Journey 8 Days / 7 Nights"
  }
}
```
When there's no PDF, `attachment` will be `null`.

## Deploy on n8n server (Linux)

```bash
# Clone / copy the project to the server
git clone ... && cd expedition-mcp

npm install --production
npm run build

# Run with PM2 (recommended)
pm2 start dist/index.js --name expedition-mcp
pm2 save
```

## voyagers frontend

Add the `ChatbotVoyagers.vue` component and configure `nuxt.config.ts`:

```ts
runtimeConfig: {
  public: {
    n8nChatWebhook: 'https://your-n8n.com/webhook/voyagers-chat'
  }
}
```
