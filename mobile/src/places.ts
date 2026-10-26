import { Place, api } from "./api";

export const PLACES: Place[] = [
  { id: "suva-city", name: "Suva City Centre", short_name: "Suva CBD", type: "city", lat: -18.1416, lng: 178.4419, region: "Suva" },
  { id: "suva-albert-park", name: "Albert Park", short_name: "Albert Park", type: "landmark", lat: -18.1402, lng: 178.4309, region: "Suva" },
  { id: "suva-bus-station", name: "Suva Bus Station", short_name: "Bus Station", type: "landmark", lat: -18.1369, lng: 178.4455, region: "Suva" },
  { id: "suva-independence-park", name: "Independence Park", short_name: "Independence Park", type: "landmark", lat: -18.1440, lng: 178.4214, region: "Suva" },
  { id: "suva-port", name: "Suva Port", short_name: "Suva Wharf", type: "city", lat: -18.1400, lng: 178.4290, region: "Suva" },
  { id: "lami-town", name: "Lami Town", short_name: "Lami", type: "town", lat: -18.1097, lng: 178.4025, region: "Suva" },
  { id: "suva-nabua", name: "Nabua Shopping Centre", short_name: "Nabua", type: "town", lat: -18.1167, lng: 178.4500, region: "Suva" },
  { id: "colo-i-suva", name: "Colo-i-Suva Forest Park", short_name: "Colo-i-Suva", type: "landmark", lat: -18.0575, lng: 178.4414, region: "Suva" },
  { id: "fnu-samabula", name: "FNU Samabula Campus", short_name: "FNU Samabula", type: "landmark", lat: -18.1329, lng: 178.4511, region: "Suva" },
  { id: "pacific-harbour", name: "Pacific Harbour", short_name: "Pacific Harbour", type: "city", lat: -18.2103, lng: 178.0134, region: "Coral Coast" },
  { id: "pacific-harbour-junction", name: "Pacific Harbour Junction", short_name: "PH Junction", type: "landmark", lat: -18.1700, lng: 178.1270, region: "Coral Coast" },
  { id: "nadi-airport", name: "Nadi International Airport", short_name: "Nadi Airport", type: "airport", lat: -17.7554, lng: 177.4436, region: "Nadi" },
  { id: "nadi-town", name: "Nadi Town", short_name: "Nadi", type: "city", lat: -17.8029, lng: 177.4159, region: "Nadi" },
  { id: "denarau", name: "Denarau Island & Marina", short_name: "Denarau", type: "resort", lat: -17.7751, lng: 177.3682, region: "Nadi" },
  { id: "martintar", name: "Martintar", short_name: "Martintar", type: "city", lat: -17.7940, lng: 177.4580, region: "Nadi" },
  { id: "namaka", name: "Namaka", short_name: "Namaka", type: "city", lat: -17.7600, lng: 177.4280, region: "Nadi" },
  { id: "wailoaloa-beach", name: "Wailoaloa Beach", short_name: "Wailoaloa", type: "beach", lat: -17.7936, lng: 177.4010, region: "Nadi" },
  { id: "sigatoka-town", name: "Sigatoka Town", short_name: "Sigatoka", type: "city", lat: -18.1440, lng: 177.5060, region: "Coral Coast" },
  { id: "sigatoka-beach", name: "Sigatoka Beach", short_name: "Sigatoka Sands", type: "beach", lat: -18.1660, lng: 177.4980, region: "Coral Coast" },
  { id: "korolevu-beach", name: "Korolevu Beach", short_name: "Korolevu", type: "beach", lat: -18.2176, lng: 177.7225, region: "Coral Coast" },
  { id: "coral-coast", name: "Coral Coast (Queens Highway)", short_name: "Coral Coast", type: "landmark", lat: -18.2167, lng: 177.7833, region: "Coral Coast" },
  { id: "lautoka-city", name: "Lautoka City", short_name: "Lautoka", type: "city", lat: -17.6161, lng: 177.4508, region: "Lautoka" },
];

export async function loadPlaces(): Promise<Place[]> {
  try {
    const data = await api<{ places: Place[] }>("/places");
    if (data.places && data.places.length) return data.places;
  } catch {
    // backend not reachable — fall back to seeds
  }
  return PLACES;
}