import { Router, type IRouter } from "express";
import healthRouter from "./health";
import interviewsRouter from "./interviews";

const router: IRouter = Router();

router.use(healthRouter);
router.use(interviewsRouter);

export default router;
