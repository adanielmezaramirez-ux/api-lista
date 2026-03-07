// src/routes/classRoutes.js (versión actualizada para maestros)
const express = require("express");
const router = express.Router();
const { protect, isMaestro } = require("../middleware/authMiddleware");
const classController = require("../controllers/classController");

// Todas las rutas requieren autenticación y rol de maestro
router.use(protect);
router.use(isMaestro);

// Rutas para maestros
router.get("/mis-clases", classController.getMisClases);
router.get("/:id", classController.getClassById);
router.post("/asistencia", classController.marcarAsistencia);
router.get("/:claseId/asistencias", classController.getAsistencias);

module.exports = router;