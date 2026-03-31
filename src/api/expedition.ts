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

export const getCruiseAvailability = (id: string, start?: string) => {
  const startParam = start ?? new Date().toISOString().slice(0, 7) + '-01';
  return apiFetch<CruiseAvailability>(`/availability/cruise/${id}?start=${startParam}`);
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
  cruise?: { name: string; id: string }[];  // Ships that operate this tour
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
