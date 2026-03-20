const db = require("../config/db");
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

exports.getAllUsers = async (req, res) => {
  try {
    const [users] = await db.execute(`
      SELECT DISTINCT u.id, u.username, u.firstname, u.lastname, u.email,
             u.suspended, u.deleted, u.confirmed,
             r.name as role_name
      FROM mdlwa_user u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.id
      ORDER BY u.id
    `);
    
    const usersWithRoles = [];
    const userMap = new Map();

    users.forEach(user => {
      if (!userMap.has(user.id)) {
        userMap.set(user.id, {
          id: user.id,
          username: user.username,
          firstname: user.firstname,
          lastname: user.lastname,
          email: user.email,
          suspended: user.suspended,
          deleted: user.deleted,
          confirmed: user.confirmed,
          roles: []
        });
      }
      
      if (user.role_name) {
        const currentUser = userMap.get(user.id);
        if (!currentUser.roles.includes(user.role_name)) {
          currentUser.roles.push(user.role_name);
        }
      }
    });

    userMap.forEach(user => {
      usersWithRoles.push(user);
    });

    res.json(usersWithRoles);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

exports.assignRole = async (req, res) => {
  try {
    const { userId, roleName } = req.body;

    if (!userId || !roleName) {
      return res.status(400).json({ 
        error: "userId y roleName son requeridos" 
      });
    }

    if (!['admin', 'maestro', 'alumno'].includes(roleName)) {
      return res.status(400).json({ 
        error: "RoleName debe ser 'admin', 'maestro' o 'alumno'" 
      });
    }

    const [userExists] = await db.execute(
      "SELECT id FROM mdlwa_user WHERE id = ?",
      [userId]
    );

    if (userExists.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    const [role] = await db.execute(
      "SELECT id FROM roles WHERE name = ?",
      [roleName]
    );

    if (role.length === 0) {
      return res.status(404).json({ error: "Rol no encontrado" });
    }

    const [existingRole] = await db.execute(
      "SELECT * FROM user_roles WHERE user_id = ? AND role_id = ?",
      [userId, role[0].id]
    );

    if (existingRole.length === 0) {
      await db.execute(
        "INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)",
        [userId, role[0].id]
      );
    }

    res.json({ 
      message: `Rol '${roleName}' asignado correctamente al usuario ${userId}` 
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

exports.assignMultipleRoles = async (req, res) => {
  try {
    const { userId, roleNames } = req.body;

    if (!userId || !roleNames || !Array.isArray(roleNames) || roleNames.length === 0) {
      return res.status(400).json({ 
        error: "userId y roleNames (array) son requeridos" 
      });
    }

    for (const roleName of roleNames) {
      if (!['admin', 'maestro', 'alumno'].includes(roleName)) {
        return res.status(400).json({ 
          error: "Cada rol debe ser 'admin', 'maestro' o 'alumno'" 
        });
      }
    }

    const [userExists] = await db.execute(
      "SELECT id FROM mdlwa_user WHERE id = ?",
      [userId]
    );

    if (userExists.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      const roleIds = [];
      for (const roleName of roleNames) {
        const [role] = await connection.execute(
          "SELECT id FROM roles WHERE name = ?",
          [roleName]
        );

        if (role.length === 0) {
          await connection.rollback();
          connection.release();
          return res.status(404).json({ error: `Rol '${roleName}' no encontrado` });
        }
        roleIds.push(role[0].id);
      }

      for (const roleId of roleIds) {
        await connection.execute(
          "INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)",
          [userId, roleId]
        );
      }

      await connection.commit();
      connection.release();

      const [updatedRoles] = await db.execute(
        `SELECT r.name as role_name
         FROM user_roles ur
         JOIN roles r ON ur.role_id = r.id
         WHERE ur.user_id = ?`,
        [userId]
      );

      res.json({ 
        message: `Roles [${roleNames.join(', ')}] asignados correctamente al usuario ${userId}`,
        roles: updatedRoles.map(r => r.role_name)
      });

    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

exports.removeRoles = async (req, res) => {
  try {
    const { userId, roleNames } = req.body;

    if (!userId || !roleNames || !Array.isArray(roleNames) || roleNames.length === 0) {
      return res.status(400).json({ 
        error: "userId y roleNames (array) son requeridos" 
      });
    }

    for (const roleName of roleNames) {
      if (!['admin', 'maestro', 'alumno'].includes(roleName)) {
        return res.status(400).json({ 
          error: "Cada rol debe ser 'admin', 'maestro' o 'alumno'" 
        });
      }
    }

    const [userExists] = await db.execute(
      "SELECT id FROM mdlwa_user WHERE id = ?",
      [userId]
    );

    if (userExists.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      const roleIds = [];
      for (const roleName of roleNames) {
        const [role] = await connection.execute(
          "SELECT id FROM roles WHERE name = ?",
          [roleName]
        );

        if (role.length > 0) {
          roleIds.push(role[0].id);
        }
      }

      if (roleIds.length === 0) {
        await connection.rollback();
        connection.release();
        return res.status(404).json({ error: "No se encontraron roles válidos para eliminar" });
      }

      const placeholders = roleIds.map(() => '?').join(',');
      const [result] = await connection.execute(
        `DELETE FROM user_roles WHERE user_id = ? AND role_id IN (${placeholders})`,
        [userId, ...roleIds]
      );

      await connection.commit();
      connection.release();

      const [updatedRoles] = await db.execute(
        `SELECT r.name as role_name
         FROM user_roles ur
         JOIN roles r ON ur.role_id = r.id
         WHERE ur.user_id = ?`,
        [userId]
      );

      res.json({ 
        message: `Roles [${roleNames.join(', ')}] eliminados correctamente del usuario ${userId}`,
        rolesEliminados: result.affectedRows,
        rolesActuales: updatedRoles.map(r => r.role_name)
      });

    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

exports.getAllClasses = async (req, res) => {
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
          FROM clase_maestros cm
          JOIN mdlwa_user u ON cm.maestro_id = u.id
          WHERE cm.clase_id = c.id
        ) as maestros,
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
      ORDER BY c.nombre
    `);

    res.json(clases.map(clase => ({
      ...clase,
      horarios: clase.horarios || [],
      maestros: clase.maestros || [],
      alumnos: clase.alumnos || []
    })));

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

exports.createClass = async (req, res) => {
  try {
    const { nombre, horarios, maestrosIds } = req.body;

    if (!nombre) {
      return res.status(400).json({ error: "El nombre de la clase es requerido" });
    }

    if (!horarios || !Array.isArray(horarios) || horarios.length === 0) {
      return res.status(400).json({ error: "Se requiere al menos un horario" });
    }

    for (const horario of horarios) {
      if (!horario.dia_semana || !horario.hora_inicio || !horario.hora_fin) {
        return res.status(400).json({ 
          error: "Cada horario debe tener dia_semana, hora_inicio y hora_fin" 
        });
      }
      
      if (horario.dia_semana < 1 || horario.dia_semana > 7) {
        return res.status(400).json({ 
          error: "dia_semana debe ser entre 1 (Lunes) y 7 (Domingo)" 
        });
      }

      const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/;
      if (!timeRegex.test(horario.hora_inicio) || !timeRegex.test(horario.hora_fin)) {
        return res.status(400).json({ 
          error: "Formato de hora inválido. Use HH:MM:SS" 
        });
      }
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      const [result] = await connection.execute(
        `INSERT INTO clases (nombre, created_by) VALUES (?, ?)`,
        [nombre, req.user.id]
      );

      const claseId = result.insertId;

      for (const horario of horarios) {
        await connection.execute(
          `INSERT INTO horarios_clase (clase_id, dia_semana, hora_inicio, hora_fin) 
           VALUES (?, ?, ?, ?)`,
          [claseId, horario.dia_semana, horario.hora_inicio, horario.hora_fin]
        );
      }

      if (maestrosIds && Array.isArray(maestrosIds) && maestrosIds.length > 0) {
        for (const maestroId of maestrosIds) {
          await connection.execute(
            "INSERT IGNORE INTO clase_maestros (clase_id, maestro_id) VALUES (?, ?)",
            [claseId, maestroId]
          );
        }
      }

      await connection.commit();

      const [nuevaClase] = await db.execute(`
        SELECT 
          c.id, 
          c.nombre,
          IFNULL(
            JSON_ARRAYAGG(
              JSON_OBJECT(
                'id', h.id,
                'dia_semana', h.dia_semana,
                'hora_inicio', h.hora_inicio,
                'hora_fin', h.hora_fin
              )
            ), JSON_ARRAY()
          ) as horarios,
          IFNULL(
            JSON_ARRAYAGG(
              JSON_OBJECT(
                'id', u.id,
                'nombre', CONCAT(u.firstname, ' ', u.lastname)
              )
            ), JSON_ARRAY()
          ) as maestros
        FROM clases c
        LEFT JOIN horarios_clase h ON c.id = h.clase_id
        LEFT JOIN clase_maestros cm ON c.id = cm.clase_id
        LEFT JOIN mdlwa_user u ON cm.maestro_id = u.id
        WHERE c.id = ?
        GROUP BY c.id
      `, [claseId]);

      res.status(201).json({
        message: "Clase creada exitosamente",
        clase: {
          ...nuevaClase[0],
          horarios: nuevaClase[0].horarios || [],
          maestros: nuevaClase[0].maestros || []
        }
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

exports.updateClassName = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre } = req.body;

    if (!nombre) {
      return res.status(400).json({ error: "El nombre de la clase es requerido" });
    }

    const [clase] = await db.execute(
      "SELECT id FROM clases WHERE id = ?",
      [id]
    );

    if (clase.length === 0) {
      return res.status(404).json({ error: "Clase no encontrada" });
    }

    await db.execute(
      "UPDATE clases SET nombre = ? WHERE id = ?",
      [nombre, id]
    );

    res.json({ 
      message: "Nombre de la clase actualizado correctamente",
      clase: {
        id: parseInt(id),
        nombre
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

exports.updateHorarios = async (req, res) => {
  try {
    const { id } = req.params;
    const { horarios } = req.body;

    if (!horarios || !Array.isArray(horarios)) {
      return res.status(400).json({ error: "Se requiere un array de horarios" });
    }

    for (const horario of horarios) {
      if (!horario.dia_semana || !horario.hora_inicio || !horario.hora_fin) {
        return res.status(400).json({ 
          error: "Cada horario debe tener dia_semana, hora_inicio y hora_fin" 
        });
      }
      
      if (horario.dia_semana < 1 || horario.dia_semana > 7) {
        return res.status(400).json({ 
          error: "dia_semana debe ser entre 1 (Lunes) y 7 (Domingo)" 
        });
      }
    }

    const [clase] = await db.execute(
      "SELECT id FROM clases WHERE id = ?",
      [id]
    );

    if (clase.length === 0) {
      return res.status(404).json({ error: "Clase no encontrada" });
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      await connection.execute(
        "DELETE FROM horarios_clase WHERE clase_id = ?",
        [id]
      );

      for (const horario of horarios) {
        await connection.execute(
          `INSERT INTO horarios_clase (clase_id, dia_semana, hora_inicio, hora_fin) 
           VALUES (?, ?, ?, ?)`,
          [id, horario.dia_semana, horario.hora_inicio, horario.hora_fin]
        );
      }

      await connection.commit();

      res.json({ 
        message: "Horarios actualizados correctamente",
        horarios: horarios
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

exports.asignarMaestros = async (req, res) => {
  try {
    const { id } = req.params;
    const { maestrosIds } = req.body;

    if (!maestrosIds || !Array.isArray(maestrosIds)) {
      return res.status(400).json({ error: "Se requiere un array de IDs de maestros" });
    }

    const [clase] = await db.execute(
      "SELECT id FROM clases WHERE id = ?",
      [id]
    );

    if (clase.length === 0) {
      return res.status(404).json({ error: "Clase no encontrada" });
    }

    const placeholders = maestrosIds.map(() => '?').join(',');
    const [maestrosValidos] = await db.execute(
      `SELECT DISTINCT u.id 
       FROM mdlwa_user u
       JOIN user_roles ur ON u.id = ur.user_id
       JOIN roles r ON ur.role_id = r.id
       WHERE u.id IN (${placeholders}) AND r.name = 'maestro'`,
      maestrosIds
    );

    const idsValidos = maestrosValidos.map(m => m.id);
    
    if (idsValidos.length === 0) {
      return res.status(400).json({ error: "No se encontraron maestros válidos" });
    }

    let asignados = 0;
    for (const maestroId of idsValidos) {
      const [result] = await db.execute(
        "INSERT IGNORE INTO clase_maestros (clase_id, maestro_id) VALUES (?, ?)",
        [id, maestroId]
      );
      if (result.affectedRows > 0) asignados++;
    }

    res.json({
      message: `Maestros asignados correctamente`,
      totalSolicitados: maestrosIds.length,
      totalAsignados: asignados
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

exports.removerMaestro = async (req, res) => {
  try {
    const { id, maestroId } = req.params;

    const [result] = await db.execute(
      "DELETE FROM clase_maestros WHERE clase_id = ? AND maestro_id = ?",
      [id, maestroId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "El maestro no está asignado a esta clase" });
    }

    res.json({ message: "Maestro removido de la clase correctamente" });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

exports.removerAlumno = async (req, res) => {
  try {
    const { id, alumnoId } = req.params;

    const [result] = await db.execute(
      "DELETE FROM clase_alumnos WHERE clase_id = ? AND alumno_id = ?",
      [id, alumnoId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "El alumno no está asignado a esta clase" });
    }

    res.json({ message: "Alumno removido de la clase correctamente" });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

exports.asignarAlumnos = async (req, res) => {
  try {
    const { id } = req.params;
    const { alumnosIds } = req.body;

    if (!alumnosIds || !Array.isArray(alumnosIds)) {
      return res.status(400).json({ error: "Se requiere un array de IDs de alumnos" });
    }

    const [clase] = await db.execute(
      "SELECT id FROM clases WHERE id = ?",
      [id]
    );

    if (clase.length === 0) {
      return res.status(404).json({ error: "Clase no encontrada" });
    }

    const placeholders = alumnosIds.map(() => '?').join(',');
    const [alumnosValidos] = await db.execute(
      `SELECT DISTINCT u.id 
       FROM mdlwa_user u
       JOIN user_roles ur ON u.id = ur.user_id
       JOIN roles r ON ur.role_id = r.id
       WHERE u.id IN (${placeholders}) AND r.name = 'alumno'`,
      alumnosIds
    );

    const idsValidos = alumnosValidos.map(a => a.id);
    
    if (idsValidos.length === 0) {
      return res.status(400).json({ error: "No se encontraron alumnos válidos" });
    }

    let asignados = 0;
    for (const alumnoId of idsValidos) {
      const [result] = await db.execute(
        "INSERT IGNORE INTO clase_alumnos (clase_id, alumno_id) VALUES (?, ?)",
        [id, alumnoId]
      );
      if (result.affectedRows > 0) asignados++;
    }

    res.json({
      message: `Alumnos asignados correctamente`,
      totalSolicitados: alumnosIds.length,
      totalAsignados: asignados
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

exports.descargarReporteExcel = async (req, res) => {
  try {
    const { claseId, fechaInicio, fechaFin } = req.query;

    let query = `
      SELECT 
        c.nombre as clase_nombre,
        u.firstname as alumno_nombre,
        u.lastname as alumno_apellido,
        a.fecha,
        a.presente,
        a.registrado_por,
        a.observacion,
        rc.id as reprogramacion_id,
        rc.fecha_reprogramada,
        rc.hora_inicio as hora_reprogramada_inicio,
        rc.hora_fin as hora_reprogramada_fin,
        rc.dia_semana as dia_reprogramado,
        rc.ya_tomada,
        rc.fecha_original as fecha_original_reprogramacion,
        CONCAT(m.firstname, ' ', m.lastname) as maestro_nombre,
        CASE 
          WHEN a.reprogramacion_id IS NOT NULL THEN 'Sí'
          ELSE 'No'
        END as es_reprogramada
      FROM asistencia a
      JOIN clases c ON a.clase_id = c.id
      JOIN mdlwa_user u ON a.alumno_id = u.id
      LEFT JOIN clase_maestros cm ON c.id = cm.clase_id
      LEFT JOIN mdlwa_user m ON cm.maestro_id = m.id
      LEFT JOIN reprogramaciones_clase rc ON a.reprogramacion_id = rc.id
      WHERE 1=1
    `;
    
    const params = [];

    if (claseId) {
      query += ` AND a.clase_id = ?`;
      params.push(claseId);
    }

    if (fechaInicio) {
      query += ` AND a.fecha >= ?`;
      params.push(fechaInicio);
    }

    if (fechaFin) {
      query += ` AND a.fecha <= ?`;
      params.push(fechaFin);
    }

    query += ` ORDER BY a.fecha DESC, c.nombre, u.firstname`;

    const [asistencias] = await db.execute(query, params);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Asistencias');

    worksheet.columns = [
      { header: 'Clase', key: 'clase', width: 30 },
      { header: 'Alumno', key: 'alumno', width: 30 },
      { header: 'Fecha', key: 'fecha', width: 15 },
      { header: 'Asistió', key: 'presente', width: 10 },
      { header: 'Registrado Por', key: 'registrado_por', width: 15 },
      { header: 'Es Reprogramada', key: 'es_reprogramada', width: 15 },
      { header: 'Fecha Original', key: 'fecha_original', width: 15 },
      { header: 'Fecha Reprogramada', key: 'fecha_reprogramada', width: 15 },
      { header: 'Horario Reprogramado', key: 'horario_reprogramado', width: 20 },
      { header: 'Observación', key: 'observacion', width: 40 },
      { header: 'Maestro', key: 'maestro', width: 30 }
    ];

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4F81BD' }
    };
    worksheet.getRow(1).font = { color: { argb: 'FFFFFFFF' }, bold: true };

    asistencias.forEach(a => {
      let observacion = a.observacion || '';
      let horarioReprogramado = '';
      let fechaOriginal = '';
      
      if (a.reprogramacion_id) {
        const fechaOriginalObj = new Date(a.fecha_original_reprogramacion || a.fecha);
        const fechaOriginalFormateada = fechaOriginalObj.toLocaleDateString('es-MX');
        const horaInicio = a.hora_reprogramada_inicio ? a.hora_reprogramada_inicio.substring(0,5) : '';
        const horaFin = a.hora_reprogramada_fin ? a.hora_reprogramada_fin.substring(0,5) : '';
        
        horarioReprogramado = `${horaInicio} - ${horaFin}`;
        fechaOriginal = fechaOriginalFormateada;
        
        if (!observacion) {
          observacion = `Esta es la asistencia de la clase original del ${fechaOriginalFormateada}`;
        }
      }

      worksheet.addRow({
        clase: a.clase_nombre,
        alumno: `${a.alumno_nombre} ${a.alumno_apellido}`,
        fecha: a.fecha,
        presente: a.presente ? 'Sí' : 'No',
        registrado_por: a.registrado_por,
        es_reprogramada: a.es_reprogramada,
        fecha_original: fechaOriginal,
        fecha_reprogramada: a.fecha_reprogramada || '',
        horario_reprogramado: horarioReprogramado,
        observacion: observacion,
        maestro: a.maestro_nombre
      });
    });

    worksheet.addRow([]);
    worksheet.addRow(['Resumen', '', '', '', '', '', '', '', '', '', '']);
    worksheet.addRow(['Total registros:', asistencias.length, '', '', '', '', '', '', '', '', '']);
    
    const presentes = asistencias.filter(a => a.presente).length;
    worksheet.addRow(['Total asistencias:', presentes, '', '', '', '', '', '', '', '', '']);
    const sistema = asistencias.filter(a => a.registrado_por === 'sistema').length;
    worksheet.addRow(['Registradas por sistema:', sistema, '', '', '', '', '', '', '', '', '']);
    const maestro = asistencias.filter(a => a.registrado_por === 'maestro').length;
    worksheet.addRow(['Registradas por maestro:', maestro, '', '', '', '', '', '', '', '', '']);
    const reprogramadas = asistencias.filter(a => a.reprogramacion_id).length;
    worksheet.addRow(['Clases reprogramadas:', reprogramadas, '', '', '', '', '', '', '', '', '']);
    
    if (asistencias.length > 0) {
      worksheet.addRow(['Porcentaje asistencia:', `${((presentes / asistencias.length) * 100).toFixed(2)}%`, '', '', '', '', '', '', '', '', '']);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=reporte_asistencias_${new Date().toISOString().split('T')[0]}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al generar reporte Excel" });
  }
};

exports.descargarReportePDF = async (req, res) => {
  try {
    const { claseId, fechaInicio, fechaFin } = req.query;

    let query = `
      SELECT 
        c.nombre as clase_nombre,
        u.firstname as alumno_nombre,
        u.lastname as alumno_apellido,
        a.fecha,
        a.presente,
        a.registrado_por,
        a.observacion,
        rc.id as reprogramacion_id,
        rc.fecha_reprogramada,
        rc.hora_inicio as hora_reprogramada_inicio,
        rc.hora_fin as hora_reprogramada_fin,
        rc.dia_semana as dia_reprogramado,
        rc.fecha_original as fecha_original_reprogramacion,
        CONCAT(m.firstname, ' ', m.lastname) as maestro_nombre,
        CASE 
          WHEN a.reprogramacion_id IS NOT NULL THEN 'Sí'
          ELSE 'No'
        END as es_reprogramada
      FROM asistencia a
      JOIN clases c ON a.clase_id = c.id
      JOIN mdlwa_user u ON a.alumno_id = u.id
      LEFT JOIN clase_maestros cm ON c.id = cm.clase_id
      LEFT JOIN mdlwa_user m ON cm.maestro_id = m.id
      LEFT JOIN reprogramaciones_clase rc ON a.reprogramacion_id = rc.id
      WHERE 1=1
    `;
    
    const params = [];

    if (claseId) {
      query += ` AND a.clase_id = ?`;
      params.push(claseId);
    }

    if (fechaInicio) {
      query += ` AND a.fecha >= ?`;
      params.push(fechaInicio);
    }

    if (fechaFin) {
      query += ` AND a.fecha <= ?`;
      params.push(fechaFin);
    }

    query += ` ORDER BY a.fecha DESC, c.nombre, u.firstname`;

    const [asistencias] = await db.execute(query, params);

    const doc = new PDFDocument({ margin: 50, size: 'A4', layout: 'landscape' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=reporte_asistencias_${new Date().toISOString().split('T')[0]}.pdf`);

    doc.pipe(res);

    doc.fontSize(18).text('Reporte de Asistencias', { align: 'center' });
    doc.moveDown();

    doc.fontSize(10).text(`Fecha de generación: ${new Date().toLocaleDateString()}`, { align: 'right' });
    if (claseId) {
      const [clase] = await db.execute("SELECT nombre FROM clases WHERE id = ?", [claseId]);
      if (clase.length > 0) {
        doc.text(`Clase: ${clase[0].nombre}`);
      }
    }
    if (fechaInicio) doc.text(`Desde: ${fechaInicio}`);
    if (fechaFin) doc.text(`Hasta: ${fechaFin}`);
    doc.moveDown();

    const tableTop = 150;
    const itemSpacing = 20;
    
    doc.fontSize(7).font('Helvetica-Bold');
    doc.text('Clase', 50, tableTop);
    doc.text('Alumno', 130, tableTop);
    doc.text('Fecha', 210, tableTop);
    doc.text('Asistió', 250, tableTop);
    doc.text('Registró', 280, tableTop);
    doc.text('Reprog.', 310, tableTop);
    doc.text('Fecha Original', 340, tableTop);
    doc.text('Horario Reprog.', 400, tableTop);
    doc.text('Observación', 470, tableTop);
    doc.text('Maestro', 550, tableTop);

    doc.moveTo(50, tableTop + 15).lineTo(600, tableTop + 15).stroke();

    let yPosition = tableTop + 25;
    doc.font('Helvetica');

    let totalPresentes = 0;
    let totalSistema = 0;
    let totalMaestro = 0;
    let totalReprogramadas = 0;

    asistencias.forEach((a, i) => {
      if (yPosition > 550) {
        doc.addPage();
        yPosition = 50;
        
        doc.fontSize(7).font('Helvetica-Bold');
        doc.text('Clase', 50, yPosition);
        doc.text('Alumno', 130, yPosition);
        doc.text('Fecha', 210, yPosition);
        doc.text('Asistió', 250, yPosition);
        doc.text('Registró', 280, yPosition);
        doc.text('Reprog.', 310, yPosition);
        doc.text('Fecha Original', 340, yPosition);
        doc.text('Horario Reprog.', 400, yPosition);
        doc.text('Observación', 470, yPosition);
        doc.text('Maestro', 550, yPosition);
        
        doc.moveTo(50, yPosition + 15).lineTo(600, yPosition + 15).stroke();
        yPosition += 25;
        doc.font('Helvetica');
      }

      let observacion = a.observacion || '';
      let horarioReprogramado = '';
      let fechaOriginal = '';
      
      if (a.reprogramacion_id) {
        totalReprogramadas++;
        const fechaOriginalObj = new Date(a.fecha_original_reprogramacion || a.fecha);
        const fechaOriginalFormateada = fechaOriginalObj.toLocaleDateString('es-MX');
        const horaInicio = a.hora_reprogramada_inicio ? a.hora_reprogramada_inicio.substring(0,5) : '';
        const horaFin = a.hora_reprogramada_fin ? a.hora_reprogramada_fin.substring(0,5) : '';
        
        horarioReprogramado = `${horaInicio}-${horaFin}`;
        fechaOriginal = fechaOriginalFormateada;
        
        if (!observacion) {
          observacion = `Asistencia de clase original ${fechaOriginalFormateada}`;
        }
      }

      doc.fontSize(6).text(a.clase_nombre.substring(0, 12), 50, yPosition);
      doc.text(`${a.alumno_nombre} ${a.alumno_apellido}`.substring(0, 12), 130, yPosition);
      doc.text(new Date(a.fecha).toLocaleDateString(), 210, yPosition);
      doc.text(a.presente ? 'Sí' : 'No', 250, yPosition);
      doc.text(a.registrado_por, 280, yPosition);
      doc.text(a.es_reprogramada, 310, yPosition);
      doc.text(fechaOriginal.substring(0, 10), 340, yPosition);
      doc.text(horarioReprogramado, 400, yPosition);
      doc.text(observacion.substring(0, 15), 470, yPosition);
      doc.text(a.maestro_nombre ? a.maestro_nombre.substring(0, 10) : '', 550, yPosition);

      if (a.presente) totalPresentes++;
      if (a.registrado_por === 'sistema') totalSistema++;
      if (a.registrado_por === 'maestro') totalMaestro++;
      
      yPosition += itemSpacing;
    });

    doc.moveDown(2);
    doc.font('Helvetica-Bold').fontSize(9);
    doc.text('RESUMEN:', 50, yPosition + 20);
    doc.font('Helvetica').fontSize(8);
    doc.text(`Total registros: ${asistencias.length}`, 50, yPosition + 35);
    doc.text(`Total asistencias: ${totalPresentes}`, 50, yPosition + 50);
    doc.text(`Registradas por sistema: ${totalSistema}`, 50, yPosition + 65);
    doc.text(`Registradas por maestro: ${totalMaestro}`, 50, yPosition + 80);
    doc.text(`Clases reprogramadas: ${totalReprogramadas}`, 50, yPosition + 95);
    if (asistencias.length > 0) {
      doc.text(`Porcentaje asistencia: ${((totalPresentes / asistencias.length) * 100).toFixed(2)}%`, 50, yPosition + 110);
    }

    doc.end();

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al generar reporte PDF" });
  }
};