import { searchProviders, searchOffers } from "../services/search.service.js";

export async function searchProvidersController(req, res) {
  try {
    const items = await searchProviders(req.query);
    return res.json({ data: items });
  } catch (err) {
    return res.status(500).json({ error: "Could not search providers" });
  }
}

export async function searchOffersController(req, res) {
  try {
    const items = await searchOffers(req.query);
    return res.json({ data: items });
  } catch (err) {
    return res.status(500).json({ error: "Could not search offers" });
  }
}
