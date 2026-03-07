const express = require("express");
const router = express.Router();
const { protect, isMaestro } = require("../middleware/authMiddleware");
const { 
  getUserData, 
  asignarAlumno, 
  marcarAsistencia,
  getAlumnosDisponibles 
} = require("../controllers/usersController");

router.use(protect); // todas requieren login

// Rutas para usuarios autenticados
router.get("/me", getUserData);

// Rutas solo para maestros
router.post("/asignar-alumno", isMaestro, asignarAlumno);
router.post("/marcar-asistencia", isMaestro, marcarAsistencia);
router.get("/alumnos-disponibles/:claseId", isMaestro, getAlumnosDisponibles);

module.exports = router;