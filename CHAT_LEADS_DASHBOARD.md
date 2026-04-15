# Chat Leads & Dashboard — Plan de Implementación

> Proyecto: Voyagers Travel Chatbot  
> Objetivo: Captura de leads, límite de mensajes y dashboard interno para el equipo  
> Última actualización: 2026-04-10

---

## Contexto

- El chat usa `avWaxQwJ3Hxcsutgc68vP` (n8n: "RAG - Voyagers Travel")
- Firebase project: `chatbot-voyagers` (distinto del monorepo: `latin-trails-8723e`)
- Ya existe colección `chat_messages` con `{ sessionId, role, message, createdAt }` — guarda solo mensajes del usuario
- El monorepo de apps internas: `apps/apps/` — usa Firebase Auth de `latin-trails-8723e`

---

## Decisiones de arquitectura

| Decisión | Elección | Razón |
|---|---|---|
| Lead form persistencia | Por sesión de 30 min (localStorage) | Evitar re-submit en recarga, capturar en cada nueva sesión |
| Límite de mensajes | 6 por sesión, solo frontend | Suficiente para marketing, mejor UX |
| Auth del dashboard | Firebase Auth de `latin-trails-8723e` (mismo que otras apps) | Reutiliza cuentas del equipo existentes |
| Datos del dashboard | Firebase SDK directo (no via n8n) | Más simple, menos latencia |
| Envío de leads | Frontend → Nuxt `/api/lead` → n8n webhook → Firebase | Mantiene webhook URL en servidor |

---

## Estructura Firebase (proyecto: `chatbot-voyagers`)

```
chat_leads/{sessionId}
  ├── name: string
  ├── email: string
  ├── phone: string
  ├── country: string
  ├── sessionId: string
  └── createdAt: ISO string

chat_messages/{autoId}          ← ya existe
  ├── sessionId: string
  ├── role: 'user' | 'assistant'
  ├── message: string
  └── createdAt: ISO string
```

---

## Paso 1 — Frontend: Lead form + límite mensajes (voyagers)

### Archivos afectados
- `voyagers/components/ChatbotVoyagers.vue`
- `voyagers/server/api/lead.post.ts` *(nuevo)*

### Lógica
- `LEAD_KEY = 'voyagers-lead-submitted'` — se guarda con el sessionId en localStorage
- Cuando la sesión expira (30 min), se limpia `LEAD_KEY` junto con `SESSION_KEY`
- Si `LEAD_KEY` existe → ir directo al chat
- Si no → mostrar formulario de: Nombre, Correo, Teléfono, País
- Envío del form → POST `/api/lead` → n8n → Firebase `chat_leads`
- `MSG_COUNT_KEY = 'voyagers-chat-count'` — contador de mensajes enviados
- Al llegar a 6: deshabilitar input y mostrar mensaje con botón WhatsApp

- [x] `ChatbotVoyagers.vue` — lead form UI + lógica de contador
- [x] `server/api/lead.post.ts` — endpoint Nuxt proxy

---

## Paso 2 — n8n: Webhook para recibir leads → Firebase

### Workflow: `avWaxQwJ3Hxcsutgc68vP` (nodos añadidos, NO workflow nuevo)
- Webhook POST `/voyagers-chat-lead`
- Recibe: `{ name, email, phone, country, sessionId }`
- Guarda en Firebase `chatbot-voyagers/chat_leads/{sessionId}` con upsert (evita duplicados)
- Nodos: Lead Webhook → Prepare Lead → Save Lead to Firebase → Respond Lead OK

- [x] Nodos de leads añadidos al workflow existente

---

## Paso 3 — n8n: Guardar respuestas del asistente en Firebase

### Workflow existente: `avWaxQwJ3Hxcsutgc68vP`
- Nodo `Prepare Assistant Message` después de `Extract PDF` (en paralelo)
- Lee `sessionId` desde `$('Voyagers Chat Webhook').item.json.body.sessionId`
- Lee respuesta desde `item.json.output ?? item.json.message ?? item.json.text`
- Guarda en `chat_messages` con `role: 'assistant'`

- [x] Nodos de respuesta del asistente añadidos al workflow

---

## Paso 4 — Dashboard Vue: `apps/chat-dashboard`

### Stack
- Vue 3 + Vite + TypeScript (mismo patrón que `apps/system`)
- Firebase Auth de `latin-trails-8723e` (mismo auth que otras apps)
- Firebase SDK directo a `chatbot-voyagers` para leer datos (segunda app Firebase)
- Ant Design Vue para UI

### Estructura creada ✓
```
apps/chat-dashboard/
├── index.html              ✓
├── package.json            ✓
├── vite.config.ts          ✓ (puerto 3030)
├── tsconfig.json           ✓
├── tsconfig.app.json       ✓
├── tsconfig.node.json      ✓
└── src/
    ├── main.ts             ✓
    ├── App.vue             ✓
    ├── router.ts           ✓ (auth guard con waitForAuthReady)
    ├── style.css           ✓
    ├── providers/
    │   ├── firebase-auth.ts    ✓ (latin-trails-8723e)
    │   └── firebase-chat.ts    ✓ (chatbot-voyagers — requiere .env)
    ├── components/
    │   └── AppLayout.vue   ✓ (sidebar con nav)
    └── pages/
        ├── LoginPage.vue           ✓
        ├── DashboardPage.vue       ✓ (métricas: leads, sesiones, mensajes)
        ├── ConversationsPage.vue   ✓ (lista agrupada por sessionId)
        ├── ConversationDetail.vue  ✓ (mensajes + info del lead)
        └── LeadsPage.vue           ✓ (tabla con filtro)
```

- [x] App base creada en monorepo
- [x] Firebase providers configurados (auth + chat data)
- [x] Router + auth guard implementado
- [x] LoginPage.vue
- [x] DashboardPage.vue (métricas)
- [x] ConversationsPage.vue (lista)
- [x] ConversationDetail.vue (detalle)
- [x] LeadsPage.vue (tabla de leads)

---

## Paso 5 — Deploy (PENDIENTE)

- [ ] `voyagers` → `git push origin staging`
  - Archivos cambiados: `components/ChatbotVoyagers.vue`, `server/api/lead.post.ts`, `nuxt.config.ts`
  - En VPS agregar: `NUXT_N8N_LEAD_WEBHOOK=<url-webhook-n8n>`
  - URL del webhook: `https://<tu-n8n>/webhook/voyagers-chat-lead`

- [ ] `chat-dashboard` → instalar dependencias + build
  - Crear `.env` en `apps/apps/chat-dashboard/` con config de `chatbot-voyagers`
  - Decidir hosting: Firebase Hosting o VPS

- [ ] Verificar CORS: el webhook de leads en n8n ya responde (responseNode), debería funcionar

- [ ] Re-habilitar Guardrails en n8n (`avWaxQwJ3Hxcsutgc68vP`)

---

## Variables de entorno necesarias

### voyagers (VPS .env o docker-compose environment)
```
NUXT_N8N_LEAD_WEBHOOK=https://<tu-n8n>/webhook/voyagers-chat-lead
```

### chat-dashboard (.env en apps/apps/chat-dashboard/)
```
# Obtener en Firebase Console → proyecto chatbot-voyagers → Project settings → Web apps
VITE_CHAT_FIREBASE_API_KEY=<apiKey-de-chatbot-voyagers>
VITE_CHAT_FIREBASE_AUTH_DOMAIN=chatbot-voyagers.firebaseapp.com
VITE_CHAT_FIREBASE_STORAGE_BUCKET=chatbot-voyagers.appspot.com
VITE_CHAT_FIREBASE_MESSAGING_SENDER_ID=<messagingSenderId>
VITE_CHAT_FIREBASE_APP_ID=<appId>
```
Nota: el auth (latin-trails-8723e) ya tiene sus credenciales hardcodeadas en firebase-auth.ts (igual que system app).

---

## Notas para continuar en otra sesión

1. El workflow n8n `avWaxQwJ3Hxcsutgc68vP` tiene el nodo `Code in JavaScript` que alimenta `Create a document` — guarda `role:'user'` en `chat_messages`. Se necesita agregar uno más para `role:'assistant'` después de `Extract PDF`.
2. El `Block Response` del guardrail está sin conectar a `Respond to Webhook` — si se reactivan los guardrails, hay que reconectar.
3. Firebase proyecto `chatbot-voyagers` es distinto de `latin-trails-8723e` — el dashboard necesita dos providers.
4. El dashboard NO es custom element — es una app web normal con routing Vue Router.
