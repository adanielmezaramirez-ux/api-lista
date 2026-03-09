const db = require("../config/db");

exports.getMisClases = async (req, res) => {
  try {
    const [clases] = await db.execute(`
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
          ORDER BY h.dia_semana, h.hora_inicio
        ) as horarios,
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
      GROUP BY c.id
      ORDER BY c.nombre
    `, [req.user.id]);

    const clasesProcesadas = clases.map(clase => ({
      ...clase,
      horarios: clase.horarios || [],
      alumnos: clase.alumnos || []
    }));

    res.json(clasesProcesadas);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

exports.getClassById = async (req, res) => {
  try {
    const { id } = req.params;

    const [acceso] = await db.execute(
      "SELECT * FROM clase_maestros WHERE clase_id = ? AND maestro_id = ?",
      [id, req.user.id]
    );

    if (acceso.length === 0) {
      return res.status(403).json({ error: "No tienes acceso a esta clase" });
    }

    const [clases] = await db.execute(`
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
          ORDER BY h.dia_semana, h.hora_inicio
        ) as horarios
      FROM clases c
      WHERE c.id = ?
      GROUP BY c.id
    `, [id]);

    if (clases.length === 0) {
      return res.status(404).json({ error: "Clase no encontrada" });
    }

    const clase = {
      ...clases[0],
      horarios: clases[0].horarios || []
    };

    const [alumnos] = await db.execute(
      `SELECT 
        u.id, 
        CONCAT(u.firstname, ' ', u.lastname) as nombre,
        u.firstname,
        u.lastname,
        u.email
       FROM mdlwa_user u
       JOIN clase_alumnos ca ON u.id = ca.alumno_id
       WHERE ca.clase_id = ?
       ORDER BY u.firstname, u.lastname`,
      [id]
    );

    clase.alumnos = alumnos;

    const [reprogramaciones] = await db.execute(
      `SELECT id, fecha_original, fecha_reprogramada, estado
       FROM reprogramaciones_clase
       WHERE clase_id = ? AND estado IN ('pendiente', 'aprobada')`,
      [id]
    );

    clase.reprogramaciones = reprogramaciones;

    res.json(clase);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

exports.marcarAsistencia = async (req, res) => {
  try {
    const { claseId, alumnoId, fecha, presente, horarioId, observacion } = req.body;

    console.log('Recibida solicitud de asistencia:', { claseId, alumnoId, fecha, presente, horarioId, observacion });

    const [acceso] = await db.execute(
      "SELECT * FROM clase_maestros WHERE clase_id = ? AND maestro_id = ?",
      [claseId, req.user.id]
    );

    if (acceso.length === 0) {
      return res.status(403).json({ error: "No tienes permiso para esta clase" });
    }

    const [reprogramaciones] = await db.execute(
      `SELECT id FROM reprogramaciones_clase 
       WHERE clase_id = ? AND fecha_original = ? 
       AND estado IN ('pendiente', 'aprobada')`,
      [claseId, fecha]
    );

    if (reprogramaciones.length > 0) {
      return res.status(403).json({ 
        error: "No se puede marcar asistencia. Esta clase fue reprogramada para esta fecha." 
      });
    }

    const [inscripcion] = await db.execute(
      "SELECT * FROM clase_alumnos WHERE clase_id = ? AND alumno_id = ?",
      [claseId, alumnoId]
    );

    if (inscripcion.length === 0) {
      return res.status(400).json({ error: "El alumno no está inscrito en esta clase" });
    }

    if (horarioId) {
      const [horario] = await db.execute(
        "SELECT * FROM horarios_clase WHERE id = ? AND clase_id = ?",
        [horarioId, claseId]
      );
      
      if (horario.length === 0) {
        console.warn('Horario no válido para esta clase:', horarioId);
      }
    }

    const [existente] = await db.execute(
      "SELECT id FROM asistencia WHERE clase_id = ? AND alumno_id = ? AND fecha = ?",
      [claseId, alumnoId, fecha]
    );

    if (existente.length > 0) {
      await db.execute(
        `UPDATE asistencia 
         SET presente = ?, horario_id = ?, registrado_por = 'maestro', observacion = ?
         WHERE clase_id = ? AND alumno_id = ? AND fecha = ?`,
        [presente, horarioId || null, observacion || null, claseId, alumnoId, fecha]
      );
      console.log('Asistencia actualizada para alumno:', alumnoId, 'horario_id:', horarioId || null);
    } else {
      await db.execute(
        `INSERT INTO asistencia 
         (clase_id, horario_id, alumno_id, fecha, presente, registrado_por, observacion)
         VALUES (?, ?, ?, ?, ?, 'maestro', ?)`,
        [claseId, horarioId || null, alumnoId, fecha, presente, observacion || null]
      );
      console.log('Asistencia insertada para alumno:', alumnoId, 'horario_id:', horarioId || null);
    }

    res.json({ 
      message: "Asistencia registrada",
      horario_id: horarioId || null 
    });

  } catch (error) {
    console.error('Error al marcar asistencia:', error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

exports.getAsistencias = async (req, res) => {
  try {
    const { claseId } = req.params;
    const { fecha } = req.query;

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
        CONCAT(u.firstname, ' ', u.lastname) as alumno_nombre,
        a.fecha,
        a.presente,
        a.horario_id,
        h.dia_semana,
        h.hora_inicio,
        h.hora_fin,
        a.registrado_por,
        a.observacion,
        a.reprogramacion_id
      FROM asistencia a
      JOIN mdlwa_user u ON a.alumno_id = u.id
      LEFT JOIN horarios_clase h ON a.horario_id = h.id
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