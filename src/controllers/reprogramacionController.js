const db = require("../config/db");

exports.solicitarReprogramacion = async (req, res) => {
  try {
    const { claseId, horarioOriginalId, fechaOriginal, fechaReprogramada, motivo } = req.body;

    const [acceso] = await db.execute(
      "SELECT * FROM clase_maestros WHERE clase_id = ? AND maestro_id = ?",
      [claseId, req.user.id]
    );

    if (acceso.length === 0) {
      return res.status(403).json({ error: "No tienes permiso para esta clase" });
    }

    const [horario] = await db.execute(
      "SELECT * FROM horarios_clase WHERE id = ? AND clase_id = ?",
      [horarioOriginalId, claseId]
    );

    if (horario.length === 0) {
      return res.status(400).json({ error: "Horario no válido para esta clase" });
    }

    const [existente] = await db.execute(
      `SELECT id FROM reprogramaciones_clase 
       WHERE clase_id = ? AND fecha_original = ? AND horario_original_id = ? 
       AND estado IN ('pendiente', 'aprobada')`,
      [claseId, fechaOriginal, horarioOriginalId]
    );

    if (existente.length > 0) {
      return res.status(400).json({ error: "Ya existe una solicitud pendiente o aprobada para esta clase y fecha" });
    }

    const [result] = await db.execute(
      `INSERT INTO reprogramaciones_clase 
       (clase_id, horario_original_id, fecha_original, fecha_reprogramada, motivo, solicitado_por, estado)
       VALUES (?, ?, ?, ?, ?, ?, 'pendiente')`,
      [claseId, horarioOriginalId, fechaOriginal, fechaReprogramada, motivo, req.user.id]
    );

    res.status(201).json({
      message: "Solicitud de reprogramación creada exitosamente",
      reprogramacionId: result.insertId
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

exports.procesarReprogramacion = async (req, res) => {
  try {
    const { id } = req.params;
    const { estado, horarioReprogramadoId } = req.body;

    if (!['aprobada', 'rechazada'].includes(estado)) {
      return res.status(400).json({ error: "Estado debe ser 'aprobada' o 'rechazada'" });
    }

    const [solicitud] = await db.execute(
      `SELECT rc.*, c.nombre as clase_nombre 
       FROM reprogramaciones_clase rc
       JOIN clases c ON rc.clase_id = c.id
       WHERE rc.id = ?`,
      [id]
    );

    if (solicitud.length === 0) {
      return res.status(404).json({ error: "Solicitud no encontrada" });
    }

    if (solicitud[0].estado !== 'pendiente') {
      return res.status(400).json({ error: "Esta solicitud ya fue procesada" });
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      await connection.execute(
        `UPDATE reprogramaciones_clase 
         SET estado = ?, aprobado_por = ?, horario_reprogramado_id = ?
         WHERE id = ?`,
        [estado, req.user.id, horarioReprogramadoId || null, id]
      );

      if (estado === 'aprobada') {
        const [alumnos] = await connection.execute(
          "SELECT alumno_id FROM clase_alumnos WHERE clase_id = ?",
          [solicitud[0].clase_id]
        );

        for (const alumno of alumnos) {
          await connection.execute(
            `INSERT INTO asistencia 
             (clase_id, horario_id, alumno_id, fecha, presente, registrado_por, observacion, reprogramacion_id)
             VALUES (?, ?, ?, ?, ?, 'sistema', ?, ?)
             ON DUPLICATE KEY UPDATE
             presente = VALUES(presente),
             registrado_por = VALUES(registrado_por),
             observacion = VALUES(observacion),
             reprogramacion_id = VALUES(reprogramacion_id)`,
            [
              solicitud[0].clase_id,
              solicitud[0].horario_original_id,
              alumno.alumno_id,
              solicitud[0].fecha_original,
              0,
              `Clase reprogramada para el ${solicitud[0].fecha_reprogramada}`,
              id
            ]
          );
        }
      }

      await connection.commit();
      res.json({ 
        message: `Solicitud ${estado} correctamente`,
        solicitud: solicitud[0]
      });

    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

exports.getReprogramaciones = async (req, res) => {
  try {
    const { estado, claseId } = req.query;
    let query = `
      SELECT 
        rc.*,
        c.nombre as clase_nombre,
        CONCAT(solicitante.firstname, ' ', solicitante.lastname) as solicitado_por_nombre,
        CONCAT(aprobador.firstname, ' ', aprobador.lastname) as aprobado_por_nombre,
        ho.dia_semana as dia_original,
        ho.hora_inicio as hora_inicio_original,
        ho.hora_fin as hora_fin_original,
        hr.dia_semana as dia_reprogramado,
        hr.hora_inicio as hora_inicio_reprogramado,
        hr.hora_fin as hora_fin_reprogramado
      FROM reprogramaciones_clase rc
      JOIN clases c ON rc.clase_id = c.id
      JOIN mdlwa_user solicitante ON rc.solicitado_por = solicitante.id
      LEFT JOIN mdlwa_user aprobador ON rc.aprobado_por = aprobador.id
      JOIN horarios_clase ho ON rc.horario_original_id = ho.id
      LEFT JOIN horarios_clase hr ON rc.horario_reprogramado_id = hr.id
      WHERE 1=1
    `;

    const params = [];

    if (estado) {
      query += ` AND rc.estado = ?`;
      params.push(estado);
    }

    if (claseId) {
      query += ` AND rc.clase_id = ?`;
      params.push(claseId);
    }

    if (req.user.roles.includes('maestro') && !req.user.roles.includes('admin')) {
      query += ` AND rc.clase_id IN (SELECT clase_id FROM clase_maestros WHERE maestro_id = ?)`;
      params.push(req.user.id);
    }

    query += ` ORDER BY rc.created_at DESC`;

    const [reprogramaciones] = await db.execute(query, params);
    res.json(reprogramaciones);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

exports.marcarAsistenciaReprogramada = async (req, res) => {
  try {
    const { reprogramacionId, alumnoId, presente } = req.body;

    const [reprogramacion] = await db.execute(
      `SELECT rc.*, cm.maestro_id 
       FROM reprogramaciones_clase rc
       JOIN clase_maestros cm ON rc.clase_id = cm.clase_id
       WHERE rc.id = ? AND rc.estado = 'aprobada'`,
      [reprogramacionId]
    );

    if (reprogramacion.length === 0) {
      return res.status(404).json({ error: "Reprogramación no encontrada o no aprobada" });
    }

    const esMaestroClase = reprogramacion.some(r => r.maestro_id === req.user.id);
    if (!esMaestroClase && !req.user.roles.includes('admin')) {
      return res.status(403).json({ error: "No tienes permiso para esta clase" });
    }

    await db.execute(
      `INSERT INTO asistencia 
       (clase_id, horario_id, alumno_id, fecha, presente, registrado_por, reprogramacion_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
       presente = VALUES(presente),
       registrado_por = VALUES(registrado_por),
       reprogramacion_id = VALUES(reprogramacion_id)`,
      [
        reprogramacion[0].clase_id,
        reprogramacion[0].horario_reprogramado_id || reprogramacion[0].horario_original_id,
        alumnoId,
        reprogramacion[0].fecha_reprogramada,
        presente,
        'maestro',
        reprogramacionId
      ]
    );

    res.json({ message: "Asistencia en clase reprogramada registrada correctamente" });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

exports.verificarClaseReprogramada = async (req, res) => {
  try {
    const { claseId, fecha } = req.query;

    if (!claseId || !fecha) {
      return res.status(400).json({ error: "claseId y fecha son requeridos" });
    }

    const [reprogramaciones] = await db.execute(
      `SELECT id, fecha_original, fecha_reprogramada, estado
       FROM reprogramaciones_clase
       WHERE clase_id = ? 
       AND (fecha_original = ? OR fecha_reprogramada = ?)
       AND estado IN ('pendiente', 'aprobada')`,
      [claseId, fecha, fecha]
    );

    const estaBloqueada = reprogramaciones.some(r => 
      r.fecha_original === fecha && (r.estado === 'pendiente' || r.estado === 'aprobada')
    );

    const esReprogramada = reprogramaciones.some(r => 
      r.fecha_reprogramada === fecha && r.estado === 'aprobada'
    );

    const reprogramacionInfo = reprogramaciones[0] || null;

    res.json({
      claseId: parseInt(claseId),
      fecha,
      estaBloqueada,
      esReprogramada,
      reprogramacion: reprogramacionInfo ? {
        id: reprogramacionInfo.id,
        estado: reprogramacionInfo.estado,
        fechaOriginal: reprogramacionInfo.fecha_original,
        fechaReprogramada: reprogramacionInfo.fecha_reprogramada
      } : null
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};