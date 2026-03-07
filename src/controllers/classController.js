// src/controllers/classController.js
const db = require("../config/db");

// Obtener clases del maestro con horarios múltiples
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

    // Procesar los resultados para asegurar que horarios y alumnos sean arrays
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

// Obtener detalle de una clase específica con horarios
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

    // Obtener información de la clase con horarios
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

    // Obtener alumnos inscritos en la clase
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

    res.json(clase);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

// Marcar asistencia (solo maestro) - VERSIÓN ACTUALIZADA CON HORARIO_ID
exports.marcarAsistencia = async (req, res) => {
  try {
    const { claseId, alumnoId, fecha, presente, horarioId } = req.body;

    console.log('📝 Recibida solicitud de asistencia:', { claseId, alumnoId, fecha, presente, horarioId });

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

    // Si se proporciona horarioId, verificar que pertenece a la clase
    if (horarioId) {
      const [horario] = await db.execute(
        "SELECT * FROM horarios_clase WHERE id = ? AND clase_id = ?",
        [horarioId, claseId]
      );
      
      if (horario.length === 0) {
        console.warn('⚠️ Horario no válido para esta clase:', horarioId);
        // No bloqueamos la operación, solo advertimos
      }
    }

    // Verificar si ya existe un registro para este alumno en esta fecha
    const [existente] = await db.execute(
      "SELECT id, horario_id FROM asistencia WHERE clase_id = ? AND alumno_id = ? AND fecha = ?",
      [claseId, alumnoId, fecha]
    );

    let result;
    
    if (existente.length > 0) {
      // Actualizar registro existente, incluyendo horario_id
      result = await db.execute(
        `UPDATE asistencia 
         SET presente = ?, horario_id = ? 
         WHERE clase_id = ? AND alumno_id = ? AND fecha = ?`,
        [presente, horarioId || null, claseId, alumnoId, fecha]
      );
      console.log('✅ Asistencia actualizada para alumno:', alumnoId, 'horario_id:', horarioId || null);
    } else {
      // Insertar nuevo registro con horario_id
      result = await db.execute(
        `INSERT INTO asistencia (clase_id, alumno_id, fecha, presente, horario_id)
         VALUES (?, ?, ?, ?, ?)`,
        [claseId, alumnoId, fecha, presente, horarioId || null]
      );
      console.log('✅ Asistencia insertada para alumno:', alumnoId, 'horario_id:', horarioId || null);
    }

    res.json({ 
      message: "Asistencia registrada",
      horario_id: horarioId || null 
    });

  } catch (error) {
    console.error('❌ Error al marcar asistencia:', error);
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
        CONCAT(u.firstname, ' ', u.lastname) as alumno_nombre,
        a.fecha,
        a.presente,
        a.horario_id,
        h.dia_semana,
        h.hora_inicio,
        h.hora_fin
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