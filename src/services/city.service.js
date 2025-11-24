import { supabase } from "../config/supabase.js";

function mapCity(row) {
  return {
    id: row.id,
    name: row.name,
    postalCode: row.postal_code,
    lat: row.lat,
    lng: row.lng,
  };
}

export async function getAllCities() {
  const { data, error } = await supabase
    .from("cities")
    .select("*")
    .order("name", { ascending: true });

  if (error) throw error;
  return data.map(mapCity);
}

export async function searchCityByName(query) {
  const { data, error } = await supabase
    .from("cities")
    .select("*")
    .ilike("name", `%${query}%`);

  if (error) throw error;
  return data.map(mapCity);
}

export async function getCityById(id) {
  const { data, error } = await supabase
    .from("cities")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data ? mapCity(data) : null;
}

export async function getNearbyCities(lat, lng, radiusKm) {
  const radiusDeg = radiusKm / 111;

  const { data, error } = await supabase
    .from("cities")
    .select("*")
    .gte("lat", lat - radiusDeg)
    .lte("lat", lat + radiusDeg)
    .gte("lng", lng - radiusDeg)
    .lte("lng", lng + radiusDeg);

  if (error) throw error;
  return data.map(mapCity);
}
