// src/services/service-category.service.js
import { supabase } from "../config/supabase.js";

function mapServiceCategoryRow(row) {
  return {
    id: row.id,
    displayName: row.display_name,
  };
}

export async function getServiceCategories() {
  const { data, error } = await supabase
    .from("service_categories")
    .select("*")
    .order("display_name", { ascending: true });

  if (error) throw error;
  return data.map(mapServiceCategoryRow);
}
