const db = require("../config/db");

exports.getUserData = async (req, res) => {
  try {
    const userId = req.user.id;

    const [userRoles] = await db.execute(
      `SELECT DISTINCT r.name as role_name
       FROM user_roles ur
       JOIN roles r ON ur.role_id = r.id
       WHERE ur.user_id = ?`,
      [userId]
    );

    const roles = userRoles.map(r => r.role_name);
    let clases = [];
    
    if (roles.includes('maestro')) {
      [clases] = await db.execute(`
        SELECT 
          c.id, 
          c.nombre,
          JSON_ARRAYAGG(
            JSON_OBJECT(
              'id', h.id,
              'dia_semana', h.dia_semana,
              'hora_inicio', h.hora_inicio,
              'hora_fin', h.hora_fin
            )
          ) as horarios
        FROM clases c
        LEFT JOIN horarios_clase h ON c.id = h.clase_id
        JOIN clase_maestros cm ON c.id = cm.clase_id
        WHERE cm.maestro_id = ?
        GROUP BY c.id
        ORDER BY c.nombre
      `, [userId]);
    } else if (roles.includes('alumno')) {
      [clases] = await db.execute(`
        SELECT 
          c.id, 
          c.nombre,
          (
            SELECT JSON_ARRAYAGG(
              JSON_OBJECT(
                'id', h.id,
                'dia_semana', h.dia_semana,
                'hora_inicio', h.hora_inicio,
                'hora_fin', h.hora_fin
              )
            )
            FROM horarios_clase h
            WHERE h.clase_id = c.id
          ) as horarios,
          JSON_ARRAYAGG(
            JSON_OBJECT(
              'id', u.id,
              'nombre', CONCAT(u.firstname, ' ', u.lastname)
            )
          ) as maestros
        FROM clases c
        JOIN clase_alumnos ca ON c.id = ca.clase_id
        JOIN clase_maestros cm ON c.id = cm.clase_id
        JOIN mdlwa_user u ON cm.maestro_id = u.id
        WHERE ca.alumno_id = ?
        GROUP BY c.id
        ORDER BY c.nombre
      `, [userId]);
    }

    res.json({
      userId,
      roles,
      clases: clases.map(clase => ({
        ...clase,
        horarios: clase.horarios || [],
        maestros: clase.maestros || []
      }))
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

exports.asignarAlumno = async (req, res) => {
  try {
    const { claseId, alumnoId } = req.body;

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

    const [acceso] = await db.execute(
      "SELECT * FROM clase_maestros WHERE clase_id = ? AND maestro_id = ?",
      [claseId, req.user.id]
    );

    if (acceso.length === 0) {
      return res.status(403).json({ error: "No tienes permiso para esta clase" });
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

exports.marcarAsistencia = async (req, res) => {
  try {
    const { claseId, alumnoId, fecha, presente } = req.body;

    const [acceso] = await db.execute(
      "SELECT * FROM clase_maestros WHERE clase_id = ? AND maestro_id = ?",
      [claseId, req.user.id]
    );

    if (acceso.length === 0) {
      return res.status(403).json({ error: "No tienes permiso para esta clase" });
    }

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

exports.getAlumnosDisponibles = async (req, res) => {
  try {
    const { claseId } = req.params;

    const [acceso] = await db.execute(
      "SELECT * FROM clase_maestros WHERE clase_id = ? AND maestro_id = ?",
      [claseId, req.user.id]
    );

    if (acceso.length === 0) {
      return res.status(403).json({ error: "No tienes permiso" });
    }

    const [alumnos] = await db.execute(
      `SELECT DISTINCT u.id, u.firstname, u.lastname, u.email
       FROM mdlwa_user u
       JOIN user_roles ur ON u.id = ur.user_id
       JOIN roles r ON ur.role_id = r.id
       WHERE r.name = 'alumno'
       AND u.id NOT IN (
         SELECT alumno_id FROM clase_alumnos WHERE clase_id = ?
       )
       ORDER BY u.firstname, u.lastname`,
      [claseId]
    );

    res.json(alumnos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};