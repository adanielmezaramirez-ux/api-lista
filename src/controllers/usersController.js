// src/controllers/usersController.js
const db = require("../config/db");

// Obtener info de usuario + sus clases
exports.getUserData = async (req, res) => {
  try {
    const userId = req.user.id;

    // Obtener el rol del usuario
    const [userRole] = await db.execute(
      `SELECT r.name as role_name
       FROM user_roles ur
       JOIN roles r ON ur.role_id = r.id
       WHERE ur.user_id = ?`,
      [userId]
    );

    const role = userRole[0]?.role_name;

    let clases = [];
    
    if (role === 'maestro') {
      // Si es maestro, obtener clases que enseña
      [clases] = await db.execute(
        `SELECT id, nombre, horario, dias
         FROM clases
         WHERE maestro_id = ?`,
        [userId]
      );
    } else if (role === 'alumno') {
      // Si es alumno, obtener clases a las que está inscrito
      [clases] = await db.execute(
        `SELECT c.id, c.nombre, c.horario, c.dias,
                u.firstname as maestro_nombre, u.lastname as maestro_apellido
         FROM clases c
         JOIN clase_alumnos ca ON c.id = ca.clase_id
         JOIN mdlwa_user u ON c.maestro_id = u.id
         WHERE ca.alumno_id = ?`,
        [userId]
      );
    }

    res.json({
      userId,
      role,
      clases
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

// Asignar alumno a clase (solo maestro)
exports.asignarAlumno = async (req, res) => {
  try {
    const { claseId, alumnoId } = req.body;

    // Verificar que el alumno existe y tiene rol de alumno
    const [alumno] = await db.execute(
      `SELECT u.id 
       FROM mdlwa_user u
       JOIN user_roles ur ON u.id = ur.user_id
       JOIN roles r ON ur.role_id = r.id
       WHERE u.id = ? AND r.name = 'alumno'`,
      [alumnoId]
    );

    if (alumno.length === 0) {
      return res.status(404).json({ error: "Alumno no encontrado o no tiene rol de alumno" });
    }

    // Verificar que la clase pertenece al maestro
    const [clase] = await db.execute(
      "SELECT maestro_id FROM clases WHERE id = ?",
      [claseId]
    );

    if (!clase.length || clase[0].maestro_id !== req.user.id) {
      return res.status(403).json({ error: "No tienes permiso para asignar a esta clase" });
    }

    await db.execute(
      "INSERT IGNORE INTO clase_alumnos (clase_id, alumno_id) VALUES (?, ?)",
      [claseId, alumnoId]
    );

    res.json({ message: "Alumno asignado correctamente" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

// Marcar asistencia
exports.marcarAsistencia = async (req, res) => {
  try {
    const { claseId, alumnoId, fecha, presente } = req.body;

    // Verificar que la clase pertenece al maestro
    const [clase] = await db.execute(
      "SELECT maestro_id FROM clases WHERE id = ?",
      [claseId]
    );

    if (!clase.length || clase[0].maestro_id !== req.user.id) {
      return res.status(403).json({ error: "No tienes permiso para esta clase" });
    }

    // Verificar que el alumno está inscrito en la clase
    const [inscripcion] = await db.execute(
      "SELECT * FROM clase_alumnos WHERE clase_id = ? AND alumno_id = ?",
      [claseId, alumnoId]
    );

    if (inscripcion.length === 0) {
      return res.status(400).json({ error: "El alumno no está inscrito en esta clase" });
    }

    await db.execute(
      `INSERT INTO asistencia (clase_id, alumno_id, fecha, presente)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE presente = ?`,
      [claseId, alumnoId, fecha, presente, presente]
    );

    res.json({ message: "Asistencia registrada" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

// Obtener alumnos disponibles para asignar a una clase
exports.getAlumnosDisponibles = async (req, res) => {
  try {
    const { claseId } = req.params;

    // Verificar que la clase pertenece al maestro
    const [clase] = await db.execute(
      "SELECT maestro_id FROM clases WHERE id = ?",
      [claseId]
    );

    if (!clase.length || clase[0].maestro_id !== req.user.id) {
      return res.status(403).json({ error: "No tienes permiso" });
    }

    // Obtener alumnos que no están en la clase
    const [alumnos] = await db.execute(
      `SELECT u.id, u.firstname, u.lastname, u.email
       FROM mdlwa_user u
       JOIN user_roles ur ON u.id = ur.user_id
       JOIN roles r ON ur.role_id = r.id
       WHERE r.name = 'alumno'
       AND u.id NOT IN (
         SELECT alumno_id FROM clase_alumnos WHERE clase_id = ?
       )`,
      [claseId]
    );

    res.json(alumnos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};