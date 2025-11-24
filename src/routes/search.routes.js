import { Router } from "express";

import {
  searchProvidersController,
  searchOffersController,
} from "../controllers/search.controller.js";

const router = Router();

router.get("/providers", searchProvidersController);
router.get("/offers", searchOffersController);

export default router;
