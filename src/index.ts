import 'dotenv/config';
import { randomUUID } from 'crypto';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import {
  listCruises,
  getCruiseAvailability,
  listHotels,
  getHotelAvailability,
  listCruiseShips,
  listTours,
  getItinerary,
} from './api/expedition';
import { generateBrochurePDF } from './pdf/brochure';

const server = new McpServer(
  { name: 'expedition-api', version: '0.1.0' },
  {
    instructions:
      'IMPORTANT — Two separate ID systems exist:\n' +
      '  • Availability slugs (e.g. "infinity", "seaman-journey"): returned by list_cruises, used ONLY in get_cruise_availability.\n' +
      '  • Firebase IDs (e.g. "aUyAM5thkArgNV7dXrxJ"): returned by list_ships, used ONLY as the cruise filter in list_tours.\n' +
      '  • Tour URLs (e.g. "infinity-galapagos-cruise-8-days-itinerary-b"): returned by list_tours, used in get_itinerary and generate_brochure.\n' +
      '\n' +
      'Tool usage guide:\n' +
      '- User asks about tours for a specific ship → list_ships(origin) → find the ship Firebase ID → list_tours(origin, cruise=<firebase_id>)\n' +
      '- User asks about all tours for a destination → list_tours(origin) without cruise filter\n' +
      '- User asks about itinerary details / day program → get_itinerary(origin, url) using the "url" from list_tours\n' +
      '- User asks what ship a tour runs on → get_itinerary() — the "cruise" array in the response lists all vessels\n' +
      '- User asks about prices, dates, availability → list_cruises(origin) to get slug → get_cruise_availability(slug)\n' +
      '- User asks for a PDF/brochure → list_tours first to get the url, then generate_brochure(origin, url)\n' +
      '- NEVER guess IDs — always call the appropriate list tool first.',
  }
);

// ─── Temporary PDF store (30-minute TTL) ────────────────────────────────────

interface PdfEntry {
  buffer: Buffer;
  filename: string;
  title: string;
  expiresAt: number;
}

const pdfStore = new Map<string, PdfEntry>();

// Clean up expired entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of pdfStore) {
    if (entry.expiresAt < now) pdfStore.delete(id);
  }
}, 10 * 60 * 1000);

// ─── Cruises ────────────────────────────────────────────────────────────────

server.registerTool(
  'list_cruises',
  {
    description:
      'List cruise vessels filtered by origin. Returns slug-based IDs used ONLY for get_cruise_availability. ' +
      'These IDs are different from the Firebase IDs used by list_ships/list_tours. ' +
      'Use this when the user asks about prices, dates, or availability of a vessel.',
    inputSchema: {
      origin: z
        .enum(['galapagos', 'antarctica', 'all'])
        .default('all')
        .describe('Destination origin'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ origin }) => {
    const cruises = await listCruises(origin);
    return { content: [{ type: 'text', text: JSON.stringify(cruises, null, 2) }] };
  }
);

server.registerTool(
  'get_cruise_availability',
  {
    description:
      'Get real-time availability, pricing, and cabin types for a specific cruise vessel. ' +
      'Use the slug-based cruise ID from list_cruises (e.g. "infinity", "seaman-journey"). ' +
      'Do NOT use Firebase IDs from list_ships here.',
    inputSchema: {
      cruise_id: z.string().describe('Cruise slug from list_cruises (e.g. "infinity", "seaman-journey")'),
      start_date: z
        .string()
        .optional()
        .describe('Start date in YYYY-MM-DD format. Defaults to the current month.'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ cruise_id, start_date }) => {
    const availability = await getCruiseAvailability(cruise_id, start_date) as any;
    // Strip image URLs, HTML descriptions, gallery, deckPlans — keep only what the LLM needs
    const slim = {
      product: {
        id: availability.product?.id,
        name: availability.product?.name,
        type: availability.product?.type,
        capacity: availability.product?.capacity,
        category: availability.product?.category,
        shortDescription: availability.product?.shortDescription,
        specifications: availability.product?.specifications,
      },
      dates: (availability.dates ?? []).map((d: any) => ({
        startDate: d.startDate,
        endDate: d.endDate,
        days: d.days,
        nights: d.nights,
        spaces: d.spaces,
        rackRate: d.rackRate,
        promotionalRate: d.promotionalRate,
        promotionDetails: d.promotionDetails,
        itinerary: d.itinerary,
        observation: d.observation,
        cabins: (d.cabins ?? []).map((c: any) => ({
          type: c.type,
          available: c.available,
          hold: c.hold,
          price: c.price,
        })),
      })),
    };
    return { content: [{ type: 'text', text: JSON.stringify(slim, null, 2) }] };
  }
);

// ─── Hotels ─────────────────────────────────────────────────────────────────

server.registerTool(
  'list_hotels',
  {
    description: 'List available hotels.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    const hotels = await listHotels();
    return { content: [{ type: 'text', text: JSON.stringify(hotels, null, 2) }] };
  }
);

server.registerTool(
  'get_hotel_availability',
  {
    description: 'Get availability for a specific hotel by arrival date and number of nights.',
    inputSchema: {
      hotel_id: z.string().describe('Hotel ID from list_hotels'),
      arrive_date: z.string().describe('Arrival date in YYYY-MM-DD format'),
      nights: z.string().describe('Number of nights'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ hotel_id, arrive_date, nights }) => {
    const availability = await getHotelAvailability(hotel_id, arrive_date, nights);
    return { content: [{ type: 'text', text: JSON.stringify(availability, null, 2) }] };
  }
);

// ─── Tours / Itineraries ─────────────────────────────────────────────────────

server.registerTool(
  'list_ships',
  {
    description:
      'List cruise ships (vessels) that have tours for a destination. Returns Firebase-based IDs — use these IDs ' +
      'as the cruise filter in list_tours. These IDs are NOT the same as the slugs from list_cruises. ' +
      'Call this when the user asks about tours for a specific ship (e.g. "tours on the Infinity").',
    inputSchema: {
      origin: z
        .enum(['galapagos', 'antarctica'])
        .describe('Destination origin'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ origin }) => {
    try {
      const ships = await listCruiseShips(origin);
      return { content: [{ type: 'text', text: JSON.stringify(ships, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error listing ships: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  'list_tours',
  {
    description:
      'List available tours/itineraries for a destination. ' +
      'To filter by vessel: first call list_ships to get the ship\'s Firebase ID, then pass it as the cruise parameter here. ' +
      'Each result includes a "url" field — pass that exact value as tour_id to get_itinerary or generate_brochure.',
    inputSchema: {
      origin: z
        .enum(['galapagos', 'antarctica'])
        .describe('Destination origin'),
      cruise: z.string().optional().describe('Firebase ship ID from list_ships — filters tours to a specific vessel (optional)'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ origin, cruise }) => {
    const tours = await listTours(origin, cruise);
    // Include cruise array so agent knows which ship(s) each tour runs on
    return { content: [{ type: 'text', text: JSON.stringify(tours.map(({ title, url, destination, duration }) => ({ title, url, destination, duration })), null, 2) }] };
  }
);

server.registerTool(
  'get_itinerary',
  {
    description:
      'Get full details for a specific tour: day-by-day program, which vessels operate it, includes/excludes, and highlights. ' +
      'The response includes a "cruise" array showing all ships that run this itinerary — useful when user asks what ship a tour uses.',
    inputSchema: {
      origin: z.enum(['galapagos', 'antarctica']).describe('Destination origin'),
      tour_id: z.string().describe('The exact "url" value from list_tours (e.g. "infinity-galapagos-cruise-8-days-itinerary-b")'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ origin, tour_id }) => {
    try {
      const itinerary = await getItinerary(origin, tour_id);
      // Strip image URLs to save tokens, keep everything else including cruise array
      const slim = {
        title: itinerary.title,
        url: itinerary.url,
        destination: itinerary.destination,
        itinerary: itinerary.itinerary,
        duration: itinerary.duration,
        shortDescription: itinerary.shortDescription,
        description: itinerary.description,
        highlights: itinerary.highlights,
        includes: itinerary.includes,
        notInclude: itinerary.notInclude,
        cruise: itinerary.cruise.map(({ name, id, type, category }) => ({ name, id, type, category })),
        days: itinerary.days.map(({ day, title, details, meals }) => ({ day, title, details, meals })),
      };
      return { content: [{ type: 'text', text: JSON.stringify(slim, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error fetching itinerary: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

// ─── Brochure PDF ────────────────────────────────────────────────────────────

const PUBLIC_URL = process.env.SERVER_DOMAIN ?? 'https://mcp.voyagers.travel';

server.registerTool(
  'generate_brochure',
  {
    description:
      'Generate a PDF brochure for a tour and return a download URL. Use this only when the user explicitly requests a brochure or PDF download. You must call list_tours first to get the exact "url" value to pass as tour_id.',
    inputSchema: {
      origin: z.enum(['galapagos', 'antarctica']).describe('Destination origin'),
      tour_id: z.string().describe('The exact "url" value returned by list_tours — not the title'),
    },
  },
  async ({ origin, tour_id }) => {
    try {
      const itinerary = await getItinerary(origin, tour_id);
      const base64 = await generateBrochurePDF(itinerary);
      const buffer = Buffer.from(base64, 'base64');
      const filename = `${tour_id}-brochure.pdf`;
      const id = randomUUID();

      pdfStore.set(id, {
        buffer,
        filename,
        title: itinerary.title,
        expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes
      });

      const downloadUrl = `${PUBLIC_URL}/pdf/${id}`;

      return {
        content: [{ type: 'text', text: `Brochure ready. Download URL: ${downloadUrl}` }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error generating brochure: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

// ─── Express + MCP Transport ─────────────────────────────────────────────────

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', server: 'expedition-mcp' });
});

// PDF download endpoint — serves the stored brochure and deletes it after download
app.get('/pdf/:id', (req, res) => {
  const entry = pdfStore.get(req.params.id);
  if (!entry || entry.expiresAt < Date.now()) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(404).json({ error: 'PDF not found or expired' });
    return;
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${entry.filename}"`);
  res.send(entry.buffer);
  pdfStore.delete(req.params.id);
});

app.post('/mcp', async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });
  res.on('close', () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => {
  console.log(`Expedition MCP server running on http://localhost:${PORT}/mcp`);
});
