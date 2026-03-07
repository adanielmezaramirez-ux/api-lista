// src/controllers/classController.js (versión actualizada para maestros)
const db = require("../config/db");

// Obtener clases del maestro
exports.getMisClases = async (req, res) => {
  try {
    const [clases] = await db.execute(`
      SELECT 
        c.id,
        c.nombre,
        c.horario,
        c.dias,
        (
          SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
              'id', u.id,
              'nombre', CONCAT(u.firstname, ' ', u.lastname),
              'email', u.email
            )
          )
          FROM clase_alumnos ca
          JOIN mdlwa_user u ON ca.alumno_id = u.id
          WHERE ca.clase_id = c.id
        ) as alumnos,
        (SELECT COUNT(*) FROM clase_alumnos ca WHERE ca.clase_id = c.id) as total_alumnos
      FROM clases c
      JOIN clase_maestros cm ON c.id = cm.clase_id
      WHERE cm.maestro_id = ?
      ORDER BY c.nombre
    `, [req.user.id]);

    res.json(clases.map(clase => ({
      ...clase,
      alumnos: clase.alumnos || []
    })));

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

// Obtener detalle de una clase específica
exports.getClassById = async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar que el maestro tiene acceso a esta clase
    const [acceso] = await db.execute(
      "SELECT * FROM clase_maestros WHERE clase_id = ? AND maestro_id = ?",
      [id, req.user.id]
    );

    if (acceso.length === 0) {
      return res.status(403).json({ error: "No tienes acceso a esta clase" });
    }

    // Obtener información de la clase
    const [clases] = await db.execute(
      `SELECT c.id, c.nombre, c.horario, c.dias
       FROM clases c
       WHERE c.id = ?`,
      [id]
    );

    if (clases.length === 0) {
      return res.status(404).json({ error: "Clase no encontrada" });
    }

    const clase = clases[0];

    // Obtener alumnos inscritos en la clase
    const [alumnos] = await db.execute(
      `SELECT u.id, u.firstname, u.lastname, u.email
       FROM mdlwa_user u
       JOIN clase_alumnos ca ON u.id = ca.alumno_id
       WHERE ca.clase_id = ?
       ORDER BY u.firstname, u.lastname`,
      [id]
    );

    clase.alumnos = alumnos;

    res.json(clase);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

// Marcar asistencia (solo maestro)
exports.marcarAsistencia = async (req, res) => {
  try {
    const { claseId, alumnoId, fecha, presente } = req.body;

    // Verificar que el maestro tiene acceso a esta clase
    const [acceso] = await db.execute(
      "SELECT * FROM clase_maestros WHERE clase_id = ? AND maestro_id = ?",
      [claseId, req.user.id]
    );

    if (acceso.length === 0) {
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

// Obtener asistencias de una clase
exports.getAsistencias = async (req, res) => {
  try {
    const { claseId } = req.params;
    const { fecha } = req.query;

    // Verificar que el maestro tiene acceso a esta clase
    const [acceso] = await db.execute(
      "SELECT * FROM clase_maestros WHERE clase_id = ? AND maestro_id = ?",
      [claseId, req.user.id]
    );

    if (acceso.length === 0) {
      return res.status(403).json({ error: "No tienes acceso a esta clase" });
    }

    let query = `
      SELECT 
        a.id,
        a.alumno_id,
        u.firstname,
        u.lastname,
        a.fecha,
        a.presente
      FROM asistencia a
      JOIN mdlwa_user u ON a.alumno_id = u.id
      WHERE a.clase_id = ?
    `;
    const params = [claseId];

    if (fecha) {
      query += ` AND a.fecha = ?`;
      params.push(fecha);
    }

    query += ` ORDER BY a.fecha DESC, u.firstname`;

    const [asistencias] = await db.execute(query, params);

    res.json(asistencias);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};