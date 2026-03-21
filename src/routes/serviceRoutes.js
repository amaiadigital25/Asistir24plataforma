import express from "express";
import {
  solicitarServicio,
  listarServicios,
  aceptarServicio
} from "../controllers/serviceController.js";

const router = express.Router();

router.post("/solicitar", solicitarServicio);
router.get("/", listarServicios);
router.put("/aceptar/:id", aceptarServicio);

export default router;
