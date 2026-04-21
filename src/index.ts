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
  getCruiseInfo,
  searchPages,
  getDeals,
  getVoyagersTours,
  getVoyagersTourDetail,
} from './api/expedition';
import { generateBrochurePDF, generateCruiseBrochurePDF } from './pdf/brochure';

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
      '- User asks which cruises visit a specific island (e.g. Bartolome) → list_tours(origin), then call get_itinerary for up to 3 tours maximum. Do NOT check every tour — summarize findings and offer to check more if needed.\n' +
      '- User asks about deals, promotions, discounts, offers → get_deals(origin). Do NOT use RAG or list_cruises for this.\n' +
      '- NEVER guess IDs — always call the appropriate list tool first.\n' +
      '- When sharing tour links, use ONLY the exact "voyagersUrl" from list_tours. If voyagersUrl is null for a tour, do NOT construct or guess a URL — simply omit the link for that tour.',
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

server.registerTool(
  'get_availability_summary',
  {
    description:
      'Get a consolidated availability summary across ALL cruise vessels for a given month and destination. ' +
      'Use this when the user asks what is available in a specific month or period (e.g. "what cruises are available in July?", "¿qué hay disponible en agosto?"). ' +
      'Returns ships that have departures in that month with dates, spaces, and price range. ' +
      'Much more efficient than calling get_cruise_availability for each ship individually.',
    inputSchema: {
      origin: z
        .enum(['galapagos', 'antarctica', 'all'])
        .default('all')
        .describe('Destination origin'),
      month: z
        .string()
        .describe('Month to check in YYYY-MM format (e.g. "2026-07" for July 2026)'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ origin, month }) => {
    try {
      const cruises = await listCruises(origin) as any[];
      const startDate = `${month}-01`;

      // Fetch all in parallel
      const results = await Promise.allSettled(
        cruises.map(async (cruise) => {
          const avail = await getCruiseAvailability(cruise.id, startDate) as any;
          const datesInMonth = (avail.dates ?? []).filter((d: any) =>
            d.startDate?.startsWith(month)
          );
          if (!datesInMonth.length) return null;
          return {
            ship: avail.product?.name ?? cruise.name,
            origin: cruise.origin,
            dates: datesInMonth.map((d: any) => ({
              startDate: d.startDate,
              endDate: d.endDate,
              days: d.days,
              spaces: d.spaces,
              price: d.promotionalRate ?? d.rackRate,
              promotion: d.promotionDetails ?? null,
            })),
          };
        })
      );

      const available = results
        .filter((r) => r.status === 'fulfilled' && r.value !== null)
        .map((r) => (r as PromiseFulfilledResult<any>).value);

      if (!available.length) {
        return { content: [{ type: 'text', text: `No departures found for ${month}.` }] };
      }

      return { content: [{ type: 'text', text: JSON.stringify(available, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error fetching availability summary: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

// ─── Hotels ─────────────────────────────────────────────────────────────────

server.registerTool(
  'list_hotels',
  {
    description: 'List available hotels with their IDs. Call this first before get_hotel_availability. Use when user asks about hotel options or land packages.',
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
    description: 'Get room availability and pricing for a specific hotel. Always call list_hotels first to get the hotel_id. Use when user asks about hotel prices, availability, or rooms.',
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
        .enum(['galapagos', 'antarctica', 'costa-rica'])
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
      'Each result includes: "url" (pass to get_itinerary or generate_brochure), "voyagersUrl" (direct link to the tour page on voyagers.travel — share this when the user asks for a link), and "cruise" (which ships operate this tour — verify this matches before generating a brochure).',
    inputSchema: {
      origin: z
        .enum(['galapagos', 'antarctica', 'costa-rica'])
        .describe('Destination origin'),
      cruise: z.string().optional().describe('Firebase ship ID from list_ships — filters tours to a specific vessel (optional)'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ origin, cruise }) => {
    const tours = await listTours(origin, cruise);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(
          tours.map(({ title, url, destination, duration, voyagersUrl, cruise: ships }) => {
            const cruiseUrl = (ships as any)?.[0]?.url as string | undefined;
            const resolvedUrl = voyagersUrl ?? (() => {
              if (origin === 'antarctica') return `https://www.voyagers.travel/antarctica/itineraries/${url}`;
              return cruiseUrl ? `https://www.voyagers.travel/${origin}/cruises/${cruiseUrl}/${url}` : null;
            })();
            return {
              title,
              url,
              destination,
              duration,
              voyagersUrl: resolvedUrl,
              ships: (ships ?? []).map((s: any) => s.name),
            };
          }),
          null, 2
        ),
      }],
    };
  }
);

server.registerTool(
  'get_itinerary',
  {
    description:
      'Get full details for a specific tour: day-by-day program, which vessels operate it, includes/excludes, and highlights. ' +
      'The response includes a "cruise" array showing all ships that run this itinerary — useful when user asks what ship a tour uses.',
    inputSchema: {
      origin: z.enum(['galapagos', 'antarctica', 'costa-rica']).describe('Destination origin'),
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

// ─── Cruise Info ─────────────────────────────────────────────────────────────

server.registerTool(
  'get_cruise_info',
  {
    description:
      'Get detailed information about a specific cruise vessel: description, type, category, capacity, cabin types, and specifications. ' +
      'Use the Firebase ship ID from list_ships — always pass the cruise parameter to avoid fetching all ships. ' +
      'Use this when the user asks about a specific ship (e.g. "tell me about the Magellan Explorer"), NOT for prices or availability.',
    inputSchema: {
      origin: z.enum(['galapagos', 'antarctica', 'costa-rica']).describe('Destination origin'),
      cruise_id: z.string().describe('Firebase ship ID from list_ships — required, do not omit'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ origin, cruise_id }) => {
    try {
      const results = await getCruiseInfo(origin, cruise_id);
      const cruise = Array.isArray(results) ? results[0] : results;
      if (!cruise) {
        return { content: [{ type: 'text', text: 'Cruise not found.' }], isError: true };
      }
      const slim = {
        name: cruise.name,
        type: cruise.type,
        category: cruise.category,
        capacity: cruise.capacity,
        shortDescription: cruise.shortDescription,
        description: cruise.description,
        specifications: cruise.specifications,
        cabins: cruise.cabins,
        includes: cruise.includes,
        notInclude: cruise.notInclude,
      };
      return { content: [{ type: 'text', text: JSON.stringify(slim, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error fetching cruise info: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  'generate_cruise_brochure',
  {
    description:
      'Generate a PDF brochure for a cruise vessel (ship profile: description, cabins, specs, includes). ' +
      'Use this when the user asks for a brochure or PDF of a ship itself — NOT a specific tour itinerary. ' +
      'You must call list_ships first to get the Firebase ship ID.',
    inputSchema: {
      origin: z.enum(['galapagos', 'antarctica', 'costa-rica']).describe('Destination origin'),
      cruise_id: z.string().describe('Firebase ship ID from list_ships — required'),
    },
  },
  async ({ origin, cruise_id }) => {
    try {
      const results = await getCruiseInfo(origin, cruise_id);
      const cruise = Array.isArray(results) ? results[0] : results;
      if (!cruise) {
        return { content: [{ type: 'text', text: 'Cruise not found.' }], isError: true };
      }
      const base64 = await generateCruiseBrochurePDF(cruise);
      const buffer = Buffer.from(base64, 'base64');
      const filename = `${cruise.name.toLowerCase().replace(/\s+/g, '-')}-brochure.pdf`;
      const id = randomUUID();

      pdfStore.set(id, {
        buffer,
        filename,
        title: cruise.name,
        expiresAt: Date.now() + 30 * 60 * 1000,
      });

      const downloadUrl = `${PUBLIC_URL}/pdf/${id}`;
      return {
        content: [{ type: 'text', text: `Brochure ready. Download URL: ${downloadUrl}` }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error generating cruise brochure: ${err instanceof Error ? err.message : String(err)}` }],
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
      origin: z.enum(['galapagos', 'antarctica', 'costa-rica']).describe('Destination origin'),
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

// ─── Site Search ─────────────────────────────────────────────────────────────

server.registerTool(
  'search_page',
  {
    description:
      'Search voyagers.travel pages by keyword and return matching page titles and URLs. ' +
      'Use this when the user asks for a link to a page, wants to know if a topic is covered on the site, ' +
      'or needs a URL to share (e.g. "what is the URL for the Infinity cruise page?"). ' +
      'Returns results grouped by category with title, URL, and short summary.',
    inputSchema: {
      query: z.string().describe('Search keywords — e.g. "Infinity cruise", "Galapagos deals", "Antarctica expedition"'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ query }) => {
    try {
      const categories = await searchPages(query);
      // Return slim result: category, title, url only
      const slim = categories.map(cat => ({
        category: cat.category,
        pages: cat.pages.map(({ title, url }) => ({ title, url })),
      }));
      return { content: [{ type: 'text', text: JSON.stringify(slim, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error searching pages: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

// ─── Deals ───────────────────────────────────────────────────────────────────

server.registerTool(
  'get_deals',
  {
    description:
      'Get current cruise deals, promotions, and discounts from Voyagers Travel. ' +
      'Use this when the user asks about: deals, promotions, discounts, offers, last-minute prices, ' +
      '"best price", "any promotions?", "special offers", "¿hay ofertas?", "¿descuentos disponibles?", "¿hay promociones?". ' +
      'Returns only real active discounts sorted by price, with savings percentage and direct link.',
    inputSchema: {
      origin: z
        .enum(['galapagos', 'antarctica', 'ecuador'])
        .describe('Destination to fetch deals for'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ origin }) => {
    try {
      const deals = await getDeals(origin);
      if (!deals.length) {
        return { content: [{ type: 'text', text: `No active deals found for ${origin} at this time.` }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(deals, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error fetching deals: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

// ─── Voyagers Tours (non-Expedition destinations) ────────────────────────────

server.registerTool(
  'get_voyagers_tours',
  {
    description:
      'Get tours and itineraries from Voyagers Travel for any destination. ' +
      'Use this for destinations NOT covered by list_tours (which only covers galapagos, antarctica, costa-rica): ' +
      'colombia, peru, patagonia, bolivia, ecuador (land tours), chile, nordic, arctic, africa, argentina. ' +
      'Also use for general tour listings of any destination when the user asks "what tours do you have in X?". ' +
      'Returns tour titles, duration, type, price, and direct voyagers.travel link.',
    inputSchema: {
      destination: z
        .enum([
          'galapagos', 'ecuador', 'colombia', 'peru', 'patagonia',
          'bolivia', 'argentina', 'chile', 'costa-rica',
          'antartida', 'arctic', 'polar', 'nordic', 'africa',
        ])
        .describe('Destination — use "antartida" for Antarctica'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ destination }) => {
    try {
      const tours = await getVoyagersTours(destination);
      if (!tours.length) {
        return { content: [{ type: 'text', text: `No tours found for ${destination}.` }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(tours, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error fetching tours: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  'get_voyagers_tour_detail',
  {
    description:
      'Get full details of a specific Voyagers Travel tour: description, day-by-day itinerary, ' +
      'what is included/not included, highlights, fitness requirements, accommodation, and tips. ' +
      'Use the "url" field from get_voyagers_tours results — NOT the full link, just the url slug. ' +
      'Call get_voyagers_tours first to get the list, then call this for a specific tour the user wants to know more about.',
    inputSchema: {
      destination: z
        .enum([
          'galapagos', 'ecuador', 'colombia', 'peru', 'patagonia',
          'bolivia', 'argentina', 'chile', 'costa-rica',
          'antartida', 'arctic', 'polar', 'nordic', 'africa',
        ])
        .describe('Destination of the tour'),
      url: z.string().describe('Tour URL slug from get_voyagers_tours results (e.g. "fitz-roy-trek")'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ destination, url }) => {
    try {
      const detail = await getVoyagersTourDetail(destination, url);
      if (!detail) {
        return { content: [{ type: 'text', text: `Tour not found: ${url}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(detail, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error fetching tour detail: ${err instanceof Error ? err.message : String(err)}` }],
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
