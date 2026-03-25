# Expedition MCP — Contexto del Proyecto

> Este documento resume todo el contexto, decisiones y arquitectura de este proyecto
> para retomar el trabajo en cualquier conversación futura.

---

## ¿Qué es esto?

Un **MCP Server** (Model Context Protocol) que expone los endpoints de la **ExpeditionAPI**
como herramientas ("tools") para que el agente de **n8n** pueda consultarlos en lenguaje natural.

También genera **PDF brochures** de tours que se devuelven al frontend como base64,
sin necesidad de almacenamiento en servidor.

---

## Ecosistema completo

```
E:\USERS\KEVIN\Proyectos Web\LatinTrails\
│
├── apis/apps/expedition/       ← Backend NestJS (ExpeditionAPI) — YA EXISTENTE
│                                  Contiene los endpoints reales de cruceros, hoteles, tours
│
├── expeditionapi/              ← Frontend Next.js (dashboard de ExpeditionAPI) — YA EXISTENTE
│                                  Portal para que devs gestionen su API key y widget
│
├── voyagers/                   ← Frontend Nuxt 4 / Vue 3 (voyagers.travel) — YA EXISTENTE
│   └── components/
│       └── ChatbotVoyagers.vue ← NUEVO: componente de chat con soporte de PDF
│
└── expedition-mcp/             ← ESTE PROYECTO (nuevo)
    MCP Server que conecta n8n con la ExpeditionAPI
```

---

## Stack

| Parte | Tecnología |
|---|---|
| MCP Server | TypeScript + Express + `@modelcontextprotocol/sdk` |
| PDF generation | `pdfkit` (sin dependencias de browser, ligero) |
| Transport | Streamable HTTP (`POST /mcp`) |
| Deploy | PM2 en el mismo servidor donde corre n8n |
| Frontend chat | Nuxt 4 / Vue 3 (`ChatbotVoyagers.vue`) |
| Chatbot backend | n8n (con RAG en Qdrant ya configurado) |
| LLM | OpenAI (GPT-4) |

---

## Por qué se decidió hacer MCP (y no endpoints directos en n8n)

- n8n tiene el agente con RAG ya funcionando; agregar llamadas HTTP manuales
  a múltiples endpoints con lógica condicional se volvería muy complejo de mantener.
- MCP le da al agente "tools" tipadas con descripciones: el LLM decide cuándo
  y cómo usarlas sin que el workflow de n8n lo tenga que orquestar manualmente.
- El MCP corre en el mismo servidor que n8n → latencia mínima, sin costos extra.

---

## Por qué no Cloudflare Workers

Se consideró Cloudflare Workers (gratis, zero servidor) pero se descartó porque:
- n8n necesita conectarse al MCP; si está en el mismo servidor, la conexión
  es local (`http://localhost:3001/mcp`) → más rápido y sin CORS.
- El servidor de n8n ya existe y tiene recursos disponibles para un proceso ligero.

---

## Por qué pdfkit y no puppeteer

- `puppeteer` requiere instalar Chromium (~300MB) → pesado para el servidor.
- `pdfkit` es puro Node, sin dependencias de sistema, funciona en cualquier Linux.
- El brochure tiene layout programático (no HTML complejo) → pdfkit es suficiente.

---

## Estructura del proyecto

```
expedition-mcp/
├── src/
│   ├── index.ts              ← Express server + registro de los 7 MCP tools
│   ├── api/
│   │   └── expedition.ts     ← Cliente HTTP para la ExpeditionAPI (tipos + fetch)
│   └── pdf/
│       └── brochure.ts       ← Generador de PDF con pdfkit (branded Voyagers Travel)
├── public/
│   └── brochures/            ← Carpeta reservada (no se usa actualmente, PDF va por base64)
├── .env.example              ← Variables de entorno necesarias
├── package.json
├── tsconfig.json
├── README.md                 ← Instrucciones de setup y deploy
└── CONTEXT.md                ← Este archivo
```

---

## Variables de entorno (.env)

```env
EXPEDITION_API_URL=https://api.expeditionapi.com/v1
EXPEDITION_API_TOKEN=<el JWT token de la ExpeditionAPI>
PORT=3001
```

El `EXPEDITION_API_TOKEN` es el mismo que usa el frontend de `expeditionapi/`
como `NEXT_PUBLIC_API_TOKEN` — es un token fijo de nivel aplicación (Bearer JWT).

---

## Los 7 MCP Tools

| Tool | Endpoint que consume | Para qué |
|---|---|---|
| `list_cruises` | `GET /availability/cruises?origin=` | Listar cruceros por origen |
| `get_cruise_availability` | `GET /availability/cruise/{id}?start=` | Disponibilidad y precios |
| `list_hotels` | `GET /availability/hotels` | Listar hoteles |
| `get_hotel_availability` | `GET /availability/hotel/{id}?arriveDate=&nights=` | Disponibilidad hotel |
| `list_tours` | `GET /itineraries/?origin=&cruise=` | Listar tours |
| `get_itinerary` | `GET /itineraries/itinerary?origin=&id=` | Detalle completo del tour |
| `generate_brochure` | `get_itinerary` + pdfkit | Genera PDF y devuelve base64 |

### Autenticación de la ExpeditionAPI
Todas las llamadas usan `Authorization: Bearer <EXPEDITION_API_TOKEN>`.
La lógica está centralizada en `src/api/expedition.ts` → función `apiFetch()`.

### Origins disponibles
- `galapagos` — cruceros Galápagos (~40 barcos)
- `antarctica` — expediciones antárticas (Quark, G Adventures)
- `all` — ambos (solo disponible en `list_cruises`)

---

## Cómo funciona el PDF brochure

```
Usuario: "dame el brochure del Seaman Journey 8 días"
  ↓
n8n AI Agent → llama tool generate_brochure(origin="galapagos", tour_id="seaman-8d")
  ↓
MCP server:
  1. Llama GET /itineraries/itinerary?origin=galapagos&id=seaman-8d
  2. Genera PDF con pdfkit (layout Voyagers Travel)
  3. Convierte PDF a base64
  4. Devuelve JSON: { type: "EXPEDITION_PDF_ATTACHMENT", filename, base64, title }
  ↓
n8n Code node (post-Agent) → extrae el base64 de intermediateSteps
  ↓
Webhook response:
  {
    "message": "Aquí está tu brochure del Seaman Journey 8 días",
    "attachment": { "type": "pdf", "filename": "...", "base64": "...", "title": "..." }
  }
  ↓
ChatbotVoyagers.vue:
  - Detecta response.attachment.type === "pdf"
  - Renderiza botón "Download PDF" en el bubble del chat
  - Click → atob(base64) → Blob → URL.createObjectURL() → descarga
  - setTimeout(URL.revokeObjectURL, 120_000) → temporal, sin servidor
```

### Por qué base64 y no URL del servidor
- No requiere dominio público en el servidor de n8n.
- No hay archivos temporales que limpiar.
- El PDF vive solo en memoria del browser mientras el tab está abierto.
- Suficiente para el caso de uso: descarga puntual durante el chat.

---

## Frontend — ChatbotVoyagers.vue

**Ubicación:** `E:\USERS\KEVIN\Proyectos Web\LatinTrails\voyagers\components\ChatbotVoyagers.vue`

### Diferencias con el Chatbot.vue existente
El `Chatbot.vue` original conecta a `https://app.world-trails.com/ai/assistant`
con un formato de respuesta distinto (`result[0].text.value`).
`ChatbotVoyagers.vue` es un componente nuevo independiente que:
- Conecta al webhook de n8n (`N8N_WEBHOOK_URL` desde `runtimeConfig.public`)
- Espera respuesta con formato `{ message: string, attachment?: PdfAttachment }`
- Maneja el botón de descarga de PDF
- Guarda historial en localStorage (solo texto, no base64)

### Configuración en nuxt.config.ts
```ts
runtimeConfig: {
  public: {
    n8nChatWebhook: 'https://tu-n8n.com/webhook/voyagers-chat'
  }
}
```

---

## n8n — Configuración del workflow

### Nodos necesarios
1. **Webhook** — recibe `{ message, history }` del frontend
2. **Window Buffer Memory** — últimos 10 mensajes, TTL 24h (sesiones por usuario)
3. **MCP Client** → URL: `http://localhost:3001/mcp`
4. **Qdrant retrieval** — RAG del PDF de preguntas genéricas (ya configurado)
5. **AI Agent (OpenAI GPT-4)** — con las tools del MCP + memoria + RAG
6. **Code node** — extrae PDF del tool response (ver código abajo)
7. **Respond to Webhook** — devuelve `{ message, attachment }`

### Code node (extraer PDF de intermediateSteps)
```javascript
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
    // no es JSON, ignorar
  }
}

return {
  message: $('AI Agent').item.json.output,
  attachment,
};
```

---

## Deploy en producción — ESTADO ACTUAL ✅

### Arquitectura real del servidor (VPS IP: 72.60.166.131)

```
Internet (80/443)
    ↓
root-traefik-1   ← Traefik principal (docker-compose en /root)
    ↓ labels Docker
root-expedition-mcp-1   ← contenedor MCP (imagen de Dokploy)
    puerto interno: 3002
```

**El MCP NO usa Dokploy para el routing** — está en `/root/docker-compose.yml`
junto con n8n y Traefik. Dokploy buildeó la imagen pero el contenedor
de producción lo corre el compose de `/root`.

### Por qué no se usó Dokploy para el routing
- Dokploy instala su propio Traefik en puertos 8080/8443
- El Traefik real (que recibe tráfico de internet) está en 80/443 en `/root/docker-compose.yml`
- El tráfico nunca llegaba al Traefik de Dokploy
- Solución: agregar el MCP directamente al `docker-compose.yml` de `/root`

### Bloque en /root/docker-compose.yml
```yaml
  expedition-mcp:
    image: mcp-server-expedition-jgateo:latest   # imagen buildeada por Dokploy
    restart: always
    environment:
      - EXPEDITION_API_URL=https://api.expeditionapi.com/v1
      - EXPEDITION_API_TOKEN=${EXPEDITION_API_TOKEN}
      - SERVER_DOMAIN=https://mcp.voyagers.travel
      - PORT=3002
    labels:
      - traefik.enable=true
      - traefik.http.routers.expedition-mcp.rule=Host(`mcp.voyagers.travel`)
      - traefik.http.routers.expedition-mcp.tls=true
      - traefik.http.routers.expedition-mcp.entrypoints=websecure
      - traefik.http.routers.expedition-mcp.tls.certresolver=mytlschallenge
      - traefik.http.services.expedition-mcp.loadbalancer.server.port=3002
```

### SSL
- Let's Encrypt TLS challenge falla porque el dominio pasa por Cloudflare
- **No es problema**: Cloudflare maneja el SSL de cara al usuario (cert válido)
- La conexión Cloudflare → VPS va sin cert de LE pero funciona correctamente

### Verificado y funcionando
```bash
curl https://mcp.voyagers.travel/health
# → {"status":"ok","server":"expedition-mcp"}

curl -s https://mcp.voyagers.travel/mcp \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}'
# → 7 tools listados ✅
```

### Para actualizar cuando haya cambios en el código
```bash
# 1. Push a GitHub → Dokploy hace rebuild automático de la imagen
# 2. En el servidor:
cd /root && docker compose up -d expedition-mcp
# Esto recarga el contenedor con la nueva imagen
```

---

## Comandos útiles

```bash
npm run dev      # desarrollo con hot reload
npm run build    # compilar TypeScript → dist/
npm start        # correr la versión compilada

# Testear MCP interactivamente
npx @modelcontextprotocol/inspector
# → Streamable HTTP → http://localhost:3001/mcp → Connect
```

---

## Pendientes / Próximos pasos

- [ ] Configurar `.env` con el `EXPEDITION_API_TOKEN` real
- [ ] Deploy en el servidor de n8n con PM2
- [ ] Configurar el nodo MCP Client en n8n apuntando a `http://localhost:3001/mcp`
- [ ] Agregar el Code node en n8n para extraer el PDF
- [ ] Agregar `n8nChatWebhook` a `nuxt.config.ts` en voyagers
- [ ] Usar `ChatbotVoyagers.vue` en la página de chatbot de voyagers.travel
- [ ] Ajustar diseño/colores del PDF brochure si es necesario
- [ ] Considerar agregar tours de Costa Rica si la API los soporta en el futuro
