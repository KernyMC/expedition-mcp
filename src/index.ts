import 'dotenv/config';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import {
  listCruises,
  getCruiseAvailability,
  listHotels,
  getHotelAvailability,
  listTours,
  getItinerary,
} from './api/expedition';
import { generateBrochurePDF } from './pdf/brochure';

const server = new McpServer(
  { name: 'expedition-api', version: '0.1.0' },
  {
    instructions:
      'Use list_cruises or list_tours first to discover available options before calling availability or itinerary tools. Call generate_brochure only when the user explicitly requests a PDF or brochure.',
  }
);

// ─── Cruises ────────────────────────────────────────────────────────────────

server.registerTool(
  'list_cruises',
  {
    description:
      'List available cruises filtered by origin. Use this before get_cruise_availability to find a cruise ID.',
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
      'Get real-time availability, pricing, and cabin types for a specific cruise. Requires the cruise ID from list_cruises.',
    inputSchema: {
      cruise_id: z.string().describe('Cruise ID/slug from list_cruises'),
      start_date: z
        .string()
        .optional()
        .describe('Start date in YYYY-MM-DD format. Defaults to the current month.'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ cruise_id, start_date }) => {
    const availability = await getCruiseAvailability(cruise_id, start_date);
    return { content: [{ type: 'text', text: JSON.stringify(availability, null, 2) }] };
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
  'list_tours',
  {
    description:
      'List available tours for a given origin. Optionally filter by cruise name. Returns tour IDs needed for get_itinerary and generate_brochure.',
    inputSchema: {
      origin: z
        .enum(['galapagos', 'antarctica'])
        .describe('Destination origin'),
      cruise: z.string().optional().describe('Filter by cruise name (optional)'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ origin, cruise }) => {
    const tours = await listTours(origin, cruise);
    return { content: [{ type: 'text', text: JSON.stringify(tours, null, 2) }] };
  }
);

server.registerTool(
  'get_itinerary',
  {
    description:
      'Get the full itinerary details for a specific tour: day-by-day program, includes, highlights, and vessel info.',
    inputSchema: {
      origin: z.enum(['galapagos', 'antarctica']).describe('Destination origin'),
      tour_id: z.string().describe('Tour URL/ID from list_tours'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ origin, tour_id }) => {
    const itinerary = await getItinerary(origin, tour_id);
    return { content: [{ type: 'text', text: JSON.stringify(itinerary, null, 2) }] };
  }
);

// ─── Brochure PDF ────────────────────────────────────────────────────────────

server.registerTool(
  'generate_brochure',
  {
    description:
      'Generate a PDF brochure for a tour and return it as base64. Use this only when the user explicitly requests a brochure or PDF download.',
    inputSchema: {
      origin: z.enum(['galapagos', 'antarctica']).describe('Destination origin'),
      tour_id: z.string().describe('Tour URL/ID from list_tours'),
    },
  },
  async ({ origin, tour_id }) => {
    const itinerary = await getItinerary(origin, tour_id);
    const base64 = await generateBrochurePDF(itinerary);
    const filename = `${tour_id}-brochure.pdf`;

    // Return a structured marker so n8n can extract the PDF from the tool response
    const payload = JSON.stringify({
      type: 'EXPEDITION_PDF_ATTACHMENT',
      filename,
      base64,
      title: itinerary.title,
    });

    return {
      content: [{ type: 'text', text: payload }],
    };
  }
);

// ─── Express + MCP Transport ─────────────────────────────────────────────────

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', server: 'expedition-mcp' });
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
