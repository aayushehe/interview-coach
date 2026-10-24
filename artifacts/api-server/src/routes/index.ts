import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import interviewsRouter from "./interviews";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

router.use(healthRouter); // public
router.use(authRouter); // register / login are public, /auth/me checks the token itself
router.use(requireAuth); // everything below needs a valid sign-in
router.use(interviewsRouter);

export default router;
