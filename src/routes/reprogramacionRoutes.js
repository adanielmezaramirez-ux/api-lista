const express = require("express");
const router = express.Router();
const { protect, isMaestro, isAdmin } = require("../middleware/authMiddleware");
const reprogramacionController = require("../controllers/reprogramacionController");

router.use(protect);

// Rutas para maestros
router.post("/solicitar", isMaestro, reprogramacionController.solicitarReprogramacion);
router.post("/marcar-reprogramada", isMaestro, reprogramacionController.marcarAsistenciaReprogramada);
router.put("/:id/marcar-tomada", isMaestro, reprogramacionController.marcarReprogramacionTomada);

// Rutas para todos (con filtros según rol)
router.get("/", reprogramacionController.getReprogramaciones);
router.get("/verificar", reprogramacionController.verificarClaseReprogramada);

// Rutas solo para admin
router.put("/:id/procesar", isAdmin, reprogramacionController.procesarReprogramacion);

module.exports = router;