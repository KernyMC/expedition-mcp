const BASE_URL = process.env.EXPEDITION_API_URL!;
const TOKEN = process.env.EXPEDITION_API_TOKEN!;
// ExpeditionAPI validates the Origin header against authorized domains
const ORIGIN = process.env.SERVER_DOMAIN ?? 'https://mcp.voyagers.travel';

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

// ─── Cruises ────────────────────────────────────────────────────────────────

export interface Cruise {
  id: string;
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

export interface TourSummary {
  title: string;
  url: string;
  destination: string;
  shortDescription: string;
  duration: number;
}

export interface ItineraryDay {
  day: number;
  title: string;
  details: string;
  meals: string[];
}

export interface Itinerary {
  title: string;
  url: string;
  destination: string;
  shortDescription: string;
  description: string;
  duration: number;
  days: ItineraryDay[];
  cruise: { name: string; id: string }[];
  includes: string[];
  notInclude: string[];
  highlights: string[];
  images: string[];
}

export const listTours = (origin: string, cruise?: string) => {
  const cruiseParam = cruise ? `&cruise=${cruise}` : '';
  return apiFetch<TourSummary[]>(`/itineraries/?origin=${origin}${cruiseParam}`);
};

export const getItinerary = (origin: string, id: string) =>
  apiFetch<Itinerary>(`/itineraries/itinerary?origin=${origin}&id=${id}`);
