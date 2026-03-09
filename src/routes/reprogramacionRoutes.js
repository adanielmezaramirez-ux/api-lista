const express = require("express");
const router = express.Router();
const { protect, isMaestro, isAdmin } = require("../middleware/authMiddleware");
const reprogramacionController = require("../controllers/reprogramacionController");

router.use(protect);

router.post("/solicitar", isMaestro, reprogramacionController.solicitarReprogramacion);
router.post("/marcar-reprogramada", isMaestro, reprogramacionController.marcarAsistenciaReprogramada);
router.get("/", reprogramacionController.getReprogramaciones);
router.get("/verificar", reprogramacionController.verificarClaseReprogramada);
router.put("/:id/procesar", isAdmin, reprogramacionController.procesarReprogramacion);

module.exports = router;