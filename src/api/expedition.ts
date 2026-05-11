const BASE_URL = process.env.EXPEDITION_API_URL!;
const TOKEN = process.env.EXPEDITION_API_TOKEN!;
// ExpeditionAPI validates the Origin header against authorized domains
const ORIGIN = process.env.SERVER_DOMAIN ?? 'https://mcp.voyagers.travel';

// Voyagers site API (for search)
const VOYAGERS_API_URL = process.env.VOYAGERS_API_URL!;
const VOYAGERS_TOKEN   = process.env.VOYAGERS_API_TOKEN!;

async function voyagersFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${VOYAGERS_API_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${VOYAGERS_TOKEN}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`VoyagersAPI error ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json',
      Origin: ORIGIN,
    },
  });

  if (!res.ok) {
    throw new Error(`ExpeditionAPI error ${res.status}: ${path}`);
  }

  return res.json() as Promise<T>;
}

// ─── Availability Cruises ────────────────────────────────────────────────────
// These use slug-based IDs (e.g. "infinity", "seaman-journey")

export interface Cruise {
  id: string;   // URL slug — use this for getCruiseAvailability()
  name: string;
  origin: string;
}

export interface CabinAvailability {
  type: string;
  available: number;
  hold: number;
  price?: number;
}

export interface CruiseDate {
  startDate: string;
  endDate: string;
  days: number;
  nights: number;
  spaces: number;
  rackRate: number;
  cabins: CabinAvailability[];
  promotionalRate?: number;
  promotionDetails?: string;
  itinerary?: string;
  observation?: string;
}

export interface CruiseAvailability {
  product: {
    id: string;
    name: string;
    image: string;
    type: string;
    capacity: number;
    category: string;
    shortDescription: string;
    specifications: string[];
  };
  dates: CruiseDate[];
}

export const listCruises = (origin = 'all') =>
  apiFetch<Cruise[]>(`/availability/cruises?origin=${origin}`);

const VOYAGERS_AVAILABILITY_TOKEN = process.env.VOYAGERS_AVAILABILITY_TOKEN!;

// Voyagers availability API URL format: ends with &date= (or ?date=), caller appends YYYY-MM-DD
async function getCruiseAvailabilityUrl(slug: string): Promise<string | null> {
  const origins = ['galapagos', 'antarctica', 'costa-rica'];
  for (const origin of origins) {
    try {
      const data = await graphqlFetch<{
        getCruise: { availabilityUrl: string } | null;
      }>(`{ getCruise(origin:"${origin}" url:"${slug}" id:"") { availabilityUrl } }`);
      const url = data.getCruise?.availabilityUrl;
      if (url) return url;
    } catch {
      // try next origin
    }
  }
  return null;
}

interface VoyagersAvailabilityItem {
  cruise: string;
  itinerary: string;
  cabin_type: string;
  days: number;
  nights: number;
  start: string;
  end: string;
  spaces: number;
  hold: number;
  rackRate: number;
  promotion?: string;
  promotionalRate?: number | null;
  cabins?: { type: string; available: number; hold: number }[];
}

async function fetchVoyagersAvailabilityDates(availabilityUrl: string): Promise<CruiseDate[]> {
  // Normalize host: latintrails → voyagers.travel
  const base = availabilityUrl.replace('app.latintrails.com', 'app.voyagers.travel');
  const today = new Date().toISOString().slice(0, 10);
  const nextYear = `${new Date().getFullYear() + 1}-01-01`;

  async function fetchOne(date: string): Promise<VoyagersAvailabilityItem[]> {
    const url = `${base}${date}&allYear=true&groupDates=true`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${VOYAGERS_AVAILABILITY_TOKEN}` },
    });
    if (!res.ok) return [];
    const json = await res.json() as VoyagersAvailabilityItem[] | { dates?: VoyagersAvailabilityItem[] };
    return Array.isArray(json) ? json : (json.dates ?? []);
  }

  const [a, b] = await Promise.all([fetchOne(today), fetchOne(nextYear)]);

  // Deduplicate by start+end key, prefer item with more spaces
  const map = new Map<string, VoyagersAvailabilityItem>();
  for (const item of [...a, ...b]) {
    const key = `${item.start}|${item.end}`;
    if (!map.has(key) || item.spaces > map.get(key)!.spaces) map.set(key, item);
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  return [...map.values()]
    .filter(item => item.start >= todayStr)
    .sort((a, b) => a.start.localeCompare(b.start))
    .map(item => ({
      startDate:       item.start,
      endDate:         item.end,
      days:            item.days,
      nights:          item.nights,
      spaces:          item.spaces,
      rackRate:        item.rackRate,
      cabins:          (item.cabins ?? []).map(c => ({ type: c.type, available: c.available, hold: c.hold })),
      promotionalRate: item.promotionalRate ?? undefined,
      promotionDetails: item.promotion,
      itinerary:       item.itinerary,
    }));
}

export const getCruiseAvailability = async (id: string, start?: string): Promise<CruiseAvailability> => {
  const startParam = start ?? new Date().toISOString().slice(0, 7) + '-01';
  const primary = await apiFetch<CruiseAvailability>(`/availability/cruise/${id}?start=${startParam}`);

  if (primary.dates.length > 0) return primary;

  // Fallback: Voyagers availability API (has data for ships like Natural Paradise)
  const availabilityUrl = await getCruiseAvailabilityUrl(id);
  if (!availabilityUrl) return primary;

  const dates = await fetchVoyagersAvailabilityDates(availabilityUrl);
  return { ...primary, dates };
};

// ─── Hotels ─────────────────────────────────────────────────────────────────

export interface Hotel {
  id: string;
  name: string;
}

export interface HotelAvailability {
  product: { id: string; name: string };
  dates: unknown[];
}

export const listHotels = () => apiFetch<Hotel[]>('/availability/hotels');

export const getHotelAvailability = (id: string, arriveDate: string, nights: string) =>
  apiFetch<HotelAvailability>(
    `/availability/hotel/${id}?arriveDate=${arriveDate}&nights=${nights}`
  );

// ─── Tours / Itineraries ─────────────────────────────────────────────────────
// These use Firebase IDs for cruise filtering (different from availability slugs)

export interface TourSummary {
  title: string;
  url: string;         // Pass this as tour_id to getItinerary()
  destination: string;
  shortDescription: string;
  duration: number;
  voyagersUrl?: string | null;  // Direct voyagers.travel page URL
  cruise?: { name: string; id: string; url?: string }[];  // Ships that operate this tour
}

export interface ItineraryDay {
  day: string;         // e.g. "Day 1", "Day 2"
  title: string;
  details: string;     // May contain HTML — stripped before display
  meals?: string[];
}

export interface ItineraryCruise {
  name: string;
  id: string;          // Firebase ID — use this as cruise filter in listTours()
  type: string;
  category: string;
  image: string;
}

export interface Itinerary {
  title: string;
  url: string;
  destination: string;
  shortDescription: string;
  description: string;
  itinerary?: string;  // Itinerary code letter (A, B, C, C1, D…)
  duration: number;
  days: ItineraryDay[];
  cruise: ItineraryCruise[];  // Which ships operate this tour
  includes: string[];
  notInclude: string[];
  highlights: string[];
  images: { title: string; image: string }[];
}

// CruiseShip returned by /itineraries/cruise — uses Firebase IDs
export interface CruiseShip {
  id: string;   // Firebase ID — use this as cruise filter in listTours()
  name: string;
}

// The endpoint returns { cruises: [...] }
interface CruiseShipsResponse {
  cruises: CruiseShip[];
}

export const listCruiseShips = async (origin: string): Promise<CruiseShip[]> => {
  const data = await apiFetch<CruiseShipsResponse | CruiseShip[]>(
    `/itineraries/cruise?origin=${origin}`
  );
  // Handle both possible response shapes
  if (Array.isArray(data)) return data;
  return (data as CruiseShipsResponse).cruises ?? [];
};

export const listTours = (origin: string, cruise?: string) => {
  const cruiseParam = cruise ? `&cruise=${cruise}` : '';
  return apiFetch<TourSummary[]>(`/itineraries/voyagers-url?origin=${origin}${cruiseParam}`);
};

export const getItinerary = (origin: string, id: string) =>
  apiFetch<Itinerary>(`/itineraries/itinerary?origin=${origin}&id=${id}`);

// ─── Cruise Info (voyagers) ───────────────────────────────────────────────────
// Uses Firebase ID from list_ships. Always pass cruise param to avoid fetching all.

export interface CruiseProduct {
  id: string;
  name: string;
  capacity: number;
  origin: string;
  type: string;
  category: string;
  shortDescription: string;
  description: string;
  specifications: string[];
  includes: string[];
  notInclude: string[];
  cabins: any[];
  mainImage?: { url: string }[];
  card?: { url: string }[];
}

export const getCruiseInfo = (origin: string, cruiseId: string) =>
  apiFetch<CruiseProduct[]>(`/cruises/voyagers?origin=${origin}&cruise=${cruiseId}`);

// ─── Voyagers Site Search ─────────────────────────────────────────────────────

export interface SearchPage {
  title: string;
  url: string;
  image: string;
  summary: string;
}

export interface SearchCategory {
  category: string;
  pages: SearchPage[];
}

export const searchPages = (q: string): Promise<SearchCategory[]> =>
  voyagersFetch<SearchCategory[]>(`/database/search-pages?q=${encodeURIComponent(q)}`);

// ─── Voyagers GraphQL ─────────────────────────────────────────────────────────

async function graphqlFetch<T>(query: string): Promise<T> {
  const res = await fetch(`${VOYAGERS_API_URL}/graphql`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${VOYAGERS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`GraphQL error ${res.status}`);
  const json = await res.json() as { data: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(`GraphQL: ${json.errors[0]!.message}`);
  return json.data;
}

// ─── Voyagers Tours (GraphQL) ─────────────────────────────────────────────────

export interface VoyagersTour {
  title: string;
  url: string;      // Pass this to get_voyagers_tour_detail for full info
  duration: number;
  type: string;
  price: number;
  offer?: number;
  destination: string;
  link: string;
}

export interface VoyagersTourDetail {
  title: string;
  destination: string;
  duration: number;
  price: number;
  shortDescription: string;
  highlights: string[];
  includes: string[];
  notInclude: string[];
  days: { day: string; title: string; details: string; meals?: string[] }[];
  fitnessRequirements?: string;
  accommodation?: string;
  recommendedAge?: string;
  travelTips?: string;
  link: string;
}

// Maps DB destination key → { urlSegment, tourPath }
// urlSegment: the destination part of the URL
// tourPath: the path segment before the tour slug (null = no extra segment)
const DEST_URL_CONFIG: Record<string, { seg: string; path: string | null }> = {
  antartida:    { seg: 'antarctica', path: 'itineraries' },
  ecuador:      { seg: 'ecuador',    path: 'tours' },
  galapagos:    { seg: 'galapagos',  path: 'tours' },
  'costa-rica': { seg: 'costa-rica', path: 'tours' },
  peru:         { seg: 'peru',       path: 'tours' },
  colombia:     { seg: 'colombia',   path: 'tours' },
  bolivia:      { seg: 'bolivia',    path: 'tours' },
  nordic:       { seg: 'nordic',     path: 'tours' },
  patagonia:    { seg: 'patagonia',  path: 'tours' },
  chile:        { seg: 'chile',      path: 'tours' },
  argentina:    { seg: 'argentina',  path: 'tours' },
  africa:       { seg: 'africa',     path: 'tours' },
  arctic:       { seg: 'arctic',     path: 'tours' },
};

function buildTourLink(dest: string, url: string): string {
  const cfg = DEST_URL_CONFIG[dest] ?? { seg: dest, path: 'tours' };
  const base = `https://www.voyagers.travel/${cfg.seg}`;
  return cfg.path ? `${base}/${cfg.path}/${url}` : `${base}/${url}`;
}

export const getVoyagersTours = async (destination: string): Promise<VoyagersTour[]> => {
  const dest = destination.toLowerCase();
  const data = await graphqlFetch<{
    getTours: {
      title: string;
      url: string;
      duration: number;
      type: string;
      price: number;
      offer?: number;
      destination: string;
    }[];
  }>(`{
    getTours(domain:"voyagers.travel" destination:"${dest}") {
      title url duration type price offer destination
    }
  }`);
  return (data.getTours ?? []).map(t => ({
    title:       t.title,
    url:         t.url,
    duration:    t.duration,
    type:        t.type,
    price:       t.offer ?? t.price,
    offer:       t.offer,
    destination: t.destination,
    link:        buildTourLink(dest, t.url),
  }));
};

// getItineraries — correct endpoint for land/vacation tours on voyagers.travel
// The frontend pages (peru, colombia, patagonia, galapagos/tours, etc.) all use getItineraries,
// NOT getTours(domain:). getTours is only for cruise itinerary packages.
export const getDestinationItineraries = async (destination: string): Promise<VoyagersTour[]> => {
  const dest = destination.toLowerCase();
  const data = await graphqlFetch<{
    getItineraries: {
      title: string;
      url: string;
      duration: number;
      type: string;
      price: number;
      destination: string;
    }[];
  }>(`{
    getItineraries(destination:"${dest}") {
      title url duration type price destination
    }
  }`);
  return (data.getItineraries ?? []).map(t => ({
    title:       t.title,
    url:         t.url,
    duration:    t.duration,
    type:        t.type,
    price:       t.price,
    offer:       undefined,
    destination: t.destination,
    link:        buildTourLink(dest, t.url),
  }));
};

// Keep old name as alias for backward compat during deploy
export const getGalapagosLandTours = () => getDestinationItineraries('galapagos');

export const getVoyagersTourDetail = async (destination: string, url: string): Promise<VoyagersTourDetail | null> => {
  const dest = destination.toLowerCase();

  function strip(raw: string | null | undefined): string {
    if (!raw) return '';
    return raw
      .replace(/<\/(p|div|h[1-6]|li|br|tr|td)>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ').replace(/&rsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"')
      .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/\s{2,}/g, ' ').trim();
  }

  const data = await graphqlFetch<{
    getTour: {
      title: string;
      url: string;
      destination: string;
      duration: number;
      price: number;
      offer?: number;
      shortDescription: string;
      highlights: { highlights: string }[];
      includes: { item: string }[];
      notInclude: { item: string }[];
      days: { day: string; title: string; details: string; meals?: string[] }[];
      fitnessRequirements?: string;
      accommodation?: string;
      recommendedAge?: string;
      travelTips?: string;
    } | null;
  }>(`{
    getTour(domain:"voyagers.travel" destination:"${dest}" url:"${url}") {
      title url destination duration price offer
      shortDescription
      highlights { highlights }
      includes { item }
      notInclude { item }
      days { day title details meals }
      fitnessRequirements accommodation recommendedAge travelTips
    }
  }`);

  const t = data.getTour;
  if (!t) return null;

  return {
    title:               t.title,
    destination:         t.destination,
    duration:            t.duration,
    price:               t.offer ?? t.price,
    shortDescription:    strip(t.shortDescription),
    highlights:          (t.highlights ?? []).map(h => strip(h.highlights)).filter(Boolean),
    includes:            (t.includes ?? []).map(i => strip(i.item)).filter(Boolean),
    notInclude:          (t.notInclude ?? []).map(i => strip(i.item)).filter(Boolean),
    days:                (t.days ?? []).map(d => ({ day: d.day, title: d.title, details: strip(d.details), meals: d.meals })),
    fitnessRequirements: strip(t.fitnessRequirements),
    accommodation:       strip(t.accommodation),
    recommendedAge:      strip(t.recommendedAge),
    travelTips:          strip(t.travelTips),
    link:                buildTourLink(dest, t.url),
  };
};

// ─── GraphQL cruise fallback (for generate_brochure when expedition API lacks itinerary) ──

const GQL_ORIGINS = ['galapagos', 'antartida', 'costa-rica', 'ecuador', 'amazon'];

export const getCruiseBySlugGraphQL = async (slug: string): Promise<CruiseProduct | null> => {
  for (const origin of GQL_ORIGINS) {
    try {
      const data = await graphqlFetch<{
        getCruise: {
          id: string;
          name: string;
          capacity: number;
          origin: string;
          type: string;
          category: string;
          shortDescription: string;
          description: string;
          specifications: { specification: string }[];
          cruiseIncludes: { include: string }[];
          cruiseDoesNotInclude: { notInclude: string }[];
          cabins: { title?: string; name?: string; size?: string; maxOccupancy?: number; description?: string }[];
          mainImage: { url: string }[];
          card: { url: string }[];
        } | null;
      }>(`{
        getCruise(origin:"${origin}" url:"${slug}" id:"") {
          id name capacity origin type category
          shortDescription description
          specifications { specification }
          cruiseIncludes { include }
          cruiseDoesNotInclude { notInclude }
          cabins { title size maxOccupancy description }
          mainImage { url }
          card { url }
        }
      }`);
      const c = data.getCruise;
      if (!c?.name) continue;
      return {
        id:               c.id,
        name:             c.name,
        capacity:         c.capacity,
        origin:           c.origin,
        type:             c.type,
        category:         c.category,
        shortDescription: c.shortDescription,
        description:      c.description,
        specifications:   (c.specifications ?? []).map(s => s.specification).filter(Boolean),
        includes:         (c.cruiseIncludes ?? []).map(i => i.include).filter(Boolean),
        notInclude:       (c.cruiseDoesNotInclude ?? []).map(i => i.notInclude).filter(Boolean),
        cabins:           c.cabins ?? [],
        mainImage:        c.mainImage ?? [],
        card:             c.card ?? [],
      };
    } catch {
      // try next origin
    }
  }
  return null;
};

const DEALS_ORIGIN_MAP: Record<string, 'galapagos' | 'antartida' | 'ecuador'> = {
  galapagos:  'galapagos',
  antarctica: 'antartida',
  antartida:  'antartida',
  ecuador:    'ecuador',
};

export interface Deal {
  ship: string;
  category: string;
  origin: string;
  startDate: string;
  endDate: string;
  normalPrice: number;
  offerPrice: number;
  savingsPercent: number;
  details: string;
  link: string;
}

export const getDeals = async (origin: string): Promise<Deal[]> => {
  const mapped = DEALS_ORIGIN_MAP[origin.toLowerCase()] ?? 'galapagos';
  const data = await graphqlFetch<{
    getDeals: {
      cruise: { name: string; category: string; origin: string; url: string; type: string };
      startDate: string;
      endDate: string;
      normalPrice: number;
      offerPrice: number;
      category: string;
      details: string[];
    }[];
  }>(`{
    getDeals(category:"deal" origin:"${mapped}") {
      cruise { name category origin url type }
      startDate endDate normalPrice offerPrice category details
    }
  }`);
  const today = new Date().toISOString().slice(0, 10);
  return (data.getDeals ?? [])
    .filter(d => d.startDate > today && d.offerPrice < d.normalPrice)
    .sort((a, b) => a.offerPrice - b.offerPrice)
    .map(d => ({
      ship:           d.cruise.name,
      category:       d.cruise.category,
      origin:         d.cruise.origin,
      startDate:      d.startDate,
      endDate:        d.endDate,
      normalPrice:    d.normalPrice,
      offerPrice:     d.offerPrice,
      savingsPercent: Math.round((1 - d.offerPrice / d.normalPrice) * 100),
      details:        (d.details ?? [])[0] ?? '',
      link:           `https://www.voyagers.travel/${d.cruise.origin === 'antartida' ? 'antarctica' : d.cruise.origin}/cruises/${d.cruise.url}`,
    }));
};
