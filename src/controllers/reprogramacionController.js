const db = require("../config/db");

exports.solicitarReprogramacion = async (req, res) => {
  try {
    const { 
      claseId, 
      horarioOriginalId, 
      fechaOriginal, 
      fechaReprogramada,
      horaInicio,
      horaFin,
      diaSemana,
      motivo 
    } = req.body;

    if (!claseId || !horarioOriginalId || !fechaOriginal || !fechaReprogramada || 
        !horaInicio || !horaFin || !diaSemana) {
      return res.status(400).json({ 
        error: "Todos los campos son requeridos: claseId, horarioOriginalId, fechaOriginal, fechaReprogramada, horaInicio, horaFin, diaSemana" 
      });
    }

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

    if (diaSemana < 1 || diaSemana > 7) {
      return res.status(400).json({ error: "dia_semana debe ser entre 1 (Lunes) y 7 (Domingo)" });
    }

    const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/;
    if (!timeRegex.test(horaInicio) || !timeRegex.test(horaFin)) {
      return res.status(400).json({ 
        error: "Formato de hora inválido. Use HH:MM:SS" 
      });
    }

    const [existente] = await db.execute(
      `SELECT id FROM reprogramaciones_clase 
       WHERE clase_id = ? AND fecha_original = ? AND horario_original_id = ? 
       AND estado IN ('pendiente', 'aprobada')`,
      [claseId, fechaOriginal, horarioOriginalId]
    );

    if (existente.length > 0) {
      return res.status(400).json({ error: "Ya existe una solicitud pendiente o aprobada para esta clase y fecha original" });
    }

    const [result] = await db.execute(
      `INSERT INTO reprogramaciones_clase 
       (clase_id, horario_original_id, fecha_original, fecha_reprogramada, 
        hora_inicio, hora_fin, dia_semana, motivo, solicitado_por, estado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente')`,
      [claseId, horarioOriginalId, fechaOriginal, fechaReprogramada, 
       horaInicio, horaFin, diaSemana, motivo || null, req.user.id]
    );

    res.status(201).json({
      message: "Solicitud de reprogramación creada exitosamente",
      reprogramacionId: result.insertId,
      reprogramacion: {
        id: result.insertId,
        claseId,
        horarioOriginalId,
        fechaOriginal,
        fechaReprogramada,
        horaInicio,
        horaFin,
        diaSemana,
        motivo: motivo || null,
        estado: 'pendiente'
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

exports.procesarReprogramacion = async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;

    if (!['aprobada', 'rechazada'].includes(estado)) {
      return res.status(400).json({ error: "Estado debe ser 'aprobada' o 'rechazada'" });
    }

    const [solicitud] = await db.execute(
      `SELECT rc.*, c.nombre as clase_nombre,
              h.dia_semana as dia_original,
              h.hora_inicio as hora_inicio_original,
              h.hora_fin as hora_fin_original
       FROM reprogramaciones_clase rc
       JOIN clases c ON rc.clase_id = c.id
       JOIN horarios_clase h ON rc.horario_original_id = h.id
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
         SET estado = ?, aprobado_por = ?
         WHERE id = ?`,
        [estado, req.user.id, id]
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
              `Clase reprogramada para el ${solicitud[0].fecha_reprogramada} a las ${solicitud[0].hora_inicio.substring(0,5)}`,
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
        ho.hora_fin as hora_fin_original
      FROM reprogramaciones_clase rc
      JOIN clases c ON rc.clase_id = c.id
      JOIN mdlwa_user solicitante ON rc.solicitado_por = solicitante.id
      LEFT JOIN mdlwa_user aprobador ON rc.aprobado_por = aprobador.id
      JOIN horarios_clase ho ON rc.horario_original_id = ho.id
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

    if (!reprogramacionId || !alumnoId) {
      return res.status(400).json({ 
        error: "reprogramacionId y alumnoId son requeridos" 
      });
    }

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

    if (reprogramacion[0].ya_tomada) {
      return res.status(400).json({ error: "Esta clase reprogramada ya ha sido tomada" });
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      await connection.execute(
        `INSERT INTO asistencia 
         (clase_id, horario_id, alumno_id, fecha, presente, registrado_por, reprogramacion_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
         presente = VALUES(presente),
         registrado_por = VALUES(registrado_por),
         reprogramacion_id = VALUES(reprogramacion_id)`,
        [
          reprogramacion[0].clase_id,
          reprogramacion[0].horario_original_id,
          alumnoId,
          reprogramacion[0].fecha_reprogramada,
          presente ? 1 : 0,
          'maestro',
          reprogramacionId
        ]
      );

      await connection.execute(
        `UPDATE reprogramaciones_clase 
         SET ya_tomada = TRUE 
         WHERE id = ?`,
        [reprogramacionId]
      );

      await connection.commit();
      
      res.json({ 
        message: "Asistencia en clase reprogramada registrada correctamente",
        reprogramacionId
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

exports.verificarClaseReprogramada = async (req, res) => {
  try {
    const { claseId, fecha } = req.query;

    if (!claseId || !fecha) {
      return res.status(400).json({ error: "claseId y fecha son requeridos" });
    }

    // Verificar si hay una reprogramación aprobada para esta fecha (como fecha original)
    const [reprogramacionesOriginal] = await db.execute(
      `SELECT id, fecha_original, fecha_reprogramada, estado, ya_tomada,
              hora_inicio, hora_fin, dia_semana
       FROM reprogramaciones_clase
       WHERE clase_id = ? AND fecha_original = ? 
       AND estado = 'aprobada'`,
      [claseId, fecha]
    );

    // Verificar si hay una reprogramación aprobada para esta fecha (como fecha reprogramada)
    const [reprogramacionesReprogramada] = await db.execute(
      `SELECT id, fecha_original, fecha_reprogramada, estado, ya_tomada,
              hora_inicio, hora_fin, dia_semana
       FROM reprogramaciones_clase
       WHERE clase_id = ? AND fecha_reprogramada = ? 
       AND estado = 'aprobada'`,
      [claseId, fecha]
    );

    const estaBloqueada = reprogramacionesOriginal.length > 0;
    const esReprogramada = reprogramacionesReprogramada.length > 0;
    
    let reprogramacionInfo = null;
    
    if (estaBloqueada) {
      reprogramacionInfo = {
        id: reprogramacionesOriginal[0].id,
        tipo: 'original_bloqueada',
        fechaOriginal: reprogramacionesOriginal[0].fecha_original,
        fechaReprogramada: reprogramacionesOriginal[0].fecha_reprogramada,
        horario: {
          horaInicio: reprogramacionesOriginal[0].hora_inicio,
          horaFin: reprogramacionesOriginal[0].hora_fin,
          diaSemana: reprogramacionesOriginal[0].dia_semana
        },
        yaTomada: reprogramacionesOriginal[0].ya_tomada === 1
      };
    } else if (esReprogramada) {
      reprogramacionInfo = {
        id: reprogramacionesReprogramada[0].id,
        tipo: 'reprogramada',
        fechaOriginal: reprogramacionesReprogramada[0].fecha_original,
        fechaReprogramada: reprogramacionesReprogramada[0].fecha_reprogramada,
        horario: {
          horaInicio: reprogramacionesReprogramada[0].hora_inicio,
          horaFin: reprogramacionesReprogramada[0].hora_fin,
          diaSemana: reprogramacionesReprogramada[0].dia_semana
        },
        yaTomada: reprogramacionesReprogramada[0].ya_tomada === 1
      };
    }

    const puedeNombrarLista = !estaBloqueada && (!esReprogramada || (esReprogramada && !reprogramacionInfo?.yaTomada));

    res.json({
      claseId: parseInt(claseId),
      fecha,
      estaBloqueada,
      esReprogramada,
      puedeNombrarLista,
      yaTomada: reprogramacionInfo?.yaTomada || false,
      reprogramacion: reprogramacionInfo
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

exports.marcarReprogramacionTomada = async (req, res) => {
  try {
    const { id } = req.params;

    const [reprogramacion] = await db.execute(
      `SELECT * FROM reprogramaciones_clase WHERE id = ?`,
      [id]
    );

    if (reprogramacion.length === 0) {
      return res.status(404).json({ error: "Reprogramación no encontrada" });
    }

    if (reprogramacion[0].estado !== 'aprobada') {
      return res.status(400).json({ error: "Solo se pueden marcar como tomadas las reprogramaciones aprobadas" });
    }

    if (reprogramacion[0].ya_tomada) {
      return res.status(400).json({ error: "Esta reprogramación ya ha sido marcada como tomada" });
    }

    await db.execute(
      `UPDATE reprogramaciones_clase SET ya_tomada = TRUE WHERE id = ?`,
      [id]
    );

    res.json({ 
      message: "Reprogramación marcada como tomada exitosamente",
      reprogramacionId: parseInt(id)
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};