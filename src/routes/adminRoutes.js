// src/routes/adminRoutes.js
const express = require("express");
const router = express.Router();
const { protect, isAdmin } = require("../middleware/authMiddleware");
const adminController = require("../controllers/adminController");

// Todas las rutas requieren autenticación y permisos de admin
router.use(protect);
router.use(isAdmin);

// Gestión de usuarios
router.get("/users", adminController.getAllUsers);
router.post("/assign-role", adminController.assignRole);

// Gestión de clases - VERIFICAR QUE TODOS ESTOS CONTROLADORES EXISTAN
router.get("/classes", adminController.getAllClasses);
router.post("/classes", adminController.createClass);
router.put("/classes/:id/horarios", adminController.updateHorarios);
router.post("/classes/:id/maestros", adminController.asignarMaestros);
router.delete("/classes/:id/maestros/:maestroId", adminController.removerMaestro);
router.post("/classes/:id/alumnos", adminController.asignarAlumnos);

// Reportes
router.get("/reportes/excel", adminController.descargarReporteExcel);
router.get("/reportes/pdf", adminController.descargarReportePDF);

module.exports = router;