import { Router } from "express";
import { cacheMiddleware } from "../middlewares/cache.middleware.js";
import { listCities, searchCities, getCityDetail, nearbyCities } from "../controllers/city.controller.js";

const router = Router();

// Liste des villes (cache 24h - données statiques)
router.get(
  "/",
  cacheMiddleware({ ttl: 86400 }), // 24 heures
  listCities
);
router.get("/search", searchCities);         // GET /api/v1/cities/search?q=
router.get("/detail/:id", getCityDetail);    // GET /api/v1/cities/detail/:id
router.get("/nearby", nearbyCities);         // GET /api/v1/cities/nearby?lat=&lng=&radius=

export default router;
