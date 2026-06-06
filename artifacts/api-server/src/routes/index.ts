import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import oauthRouter from "./oauth.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(oauthRouter);

export default router;
