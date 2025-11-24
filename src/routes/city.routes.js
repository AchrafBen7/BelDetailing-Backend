import { Router } from "express";
import { listCities, searchCities, getCityDetail, nearbyCities } from "../controllers/city.controller.js";

const router = Router();

router.get("/", listCities);                 // GET /api/v1/cities
router.get("/search", searchCities);         // GET /api/v1/cities/search?q=
router.get("/detail/:id", getCityDetail);    // GET /api/v1/cities/detail/:id
router.get("/nearby", nearbyCities);         // GET /api/v1/cities/nearby?lat=&lng=&radius=

export default router;
