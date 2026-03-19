const express = require("express");
const router = express.Router();
const { protect, isAdmin } = require("../middleware/authMiddleware");
const adminController = require("../controllers/adminController");

router.use(protect);
router.use(isAdmin);

router.get("/users", adminController.getAllUsers);
router.post("/assign-role", adminController.assignRole);
router.post("/assign-multiple-roles", adminController.assignMultipleRoles);
router.post("/remove-roles", adminController.removeRoles);

router.get("/classes", adminController.getAllClasses);
router.post("/classes", adminController.createClass);
router.put("/classes/:id/nombre", adminController.updateClassName);
router.put("/classes/:id/horarios", adminController.updateHorarios);
router.post("/classes/:id/maestros", adminController.asignarMaestros);
router.delete("/classes/:id/maestros/:maestroId", adminController.removerMaestro);
router.post("/classes/:id/alumnos", adminController.asignarAlumnos);
router.delete("/classes/:id/alumnos/:alumnoId", adminController.removerAlumno);

router.get("/reportes/excel", adminController.descargarReporteExcel);
router.get("/reportes/pdf", adminController.descargarReportePDF);

module.exports = router;