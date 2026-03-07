// src/controllers/adminController.js
const db = require("../config/db");
const bcrypt = require("bcrypt");
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

// Obtener todos los usuarios con sus roles
exports.getAllUsers = async (req, res) => {
  try {
    const [users] = await db.execute(`
      SELECT u.id, u.username, u.firstname, u.lastname, u.email,
             u.suspended, u.deleted, u.confirmed,
             r.name as role_name
      FROM mdlwa_user u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.id
      ORDER BY u.id
    `);
    
    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

// Asignar rol a un usuario (solo admin)
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

    // Verificar que el usuario existe
    const [userExists] = await db.execute(
      "SELECT id FROM mdlwa_user WHERE id = ?",
      [userId]
    );

    if (userExists.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    // Obtener el ID del rol
    const [role] = await db.execute(
      "SELECT id FROM roles WHERE name = ?",
      [roleName]
    );

    if (role.length === 0) {
      return res.status(404).json({ error: "Rol no encontrado" });
    }

    // Verificar si ya tiene rol
    const [existingRole] = await db.execute(
      "SELECT * FROM user_roles WHERE user_id = ?",
      [userId]
    );

    if (existingRole.length > 0) {
      // Actualizar rol existente
      await db.execute(
        "UPDATE user_roles SET role_id = ? WHERE user_id = ?",
        [role[0].id, userId]
      );
    } else {
      // Insertar nuevo rol
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

// Obtener todas las clases con sus horarios
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

// Crear una nueva clase con múltiples horarios
exports.createClass = async (req, res) => {
  try {
    const { nombre, horarios, maestrosIds } = req.body;

    if (!nombre) {
      return res.status(400).json({ error: "El nombre de la clase es requerido" });
    }

    if (!horarios || !Array.isArray(horarios) || horarios.length === 0) {
      return res.status(400).json({ error: "Se requiere al menos un horario" });
    }

    // Validar horarios
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

      // Validar formato de hora (HH:MM:SS)
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
      // Insertar clase
      const [result] = await connection.execute(
        `INSERT INTO clases (nombre, created_by) VALUES (?, ?)`,
        [nombre, req.user.id]
      );

      const claseId = result.insertId;

      // Insertar horarios
      for (const horario of horarios) {
        await connection.execute(
          `INSERT INTO horarios_clase (clase_id, dia_semana, hora_inicio, hora_fin) 
           VALUES (?, ?, ?, ?)`,
          [claseId, horario.dia_semana, horario.hora_inicio, horario.hora_fin]
        );
      }

      // Asignar maestros si se proporcionaron
      if (maestrosIds && Array.isArray(maestrosIds) && maestrosIds.length > 0) {
        for (const maestroId of maestrosIds) {
          await connection.execute(
            "INSERT IGNORE INTO clase_maestros (clase_id, maestro_id) VALUES (?, ?)",
            [claseId, maestroId]
          );
        }
      }

      await connection.commit();

      // Obtener la clase creada con sus horarios y maestros
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

// Actualizar horarios de una clase
exports.updateHorarios = async (req, res) => {
  try {
    const { id } = req.params;
    const { horarios } = req.body;

    if (!horarios || !Array.isArray(horarios)) {
      return res.status(400).json({ error: "Se requiere un array de horarios" });
    }

    // Validar horarios
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

    // Verificar que la clase existe
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
      // Eliminar horarios existentes
      await connection.execute(
        "DELETE FROM horarios_clase WHERE clase_id = ?",
        [id]
      );

      // Insertar nuevos horarios
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

// Asignar maestros a una clase
exports.asignarMaestros = async (req, res) => {
  try {
    const { id } = req.params;
    const { maestrosIds } = req.body;

    if (!maestrosIds || !Array.isArray(maestrosIds)) {
      return res.status(400).json({ error: "Se requiere un array de IDs de maestros" });
    }

    // Verificar que la clase existe
    const [clase] = await db.execute(
      "SELECT id FROM clases WHERE id = ?",
      [id]
    );

    if (clase.length === 0) {
      return res.status(404).json({ error: "Clase no encontrada" });
    }

    // Verificar que los maestros existen y tienen rol de maestro
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

    // Insertar las asignaciones
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

// Quitar maestro de una clase
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

// Asignar alumnos a una clase
exports.asignarAlumnos = async (req, res) => {
  try {
    const { id } = req.params;
    const { alumnosIds } = req.body;

    if (!alumnosIds || !Array.isArray(alumnosIds)) {
      return res.status(400).json({ error: "Se requiere un array de IDs de alumnos" });
    }

    // Verificar que la clase existe
    const [clase] = await db.execute(
      "SELECT id FROM clases WHERE id = ?",
      [id]
    );

    if (clase.length === 0) {
      return res.status(404).json({ error: "Clase no encontrada" });
    }

    // Verificar que los alumnos existen y tienen rol de alumno
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

    // Insertar las asignaciones
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

// Generar reporte de asistencia en Excel
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
        CONCAT(m.firstname, ' ', m.lastname) as maestro_nombre
      FROM asistencia a
      JOIN clases c ON a.clase_id = c.id
      JOIN mdlwa_user u ON a.alumno_id = u.id
      JOIN clase_maestros cm ON c.id = cm.clase_id
      JOIN mdlwa_user m ON cm.maestro_id = m.id
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

    // Crear libro de Excel
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Asistencias');

    // Definir columnas
    worksheet.columns = [
      { header: 'Clase', key: 'clase', width: 30 },
      { header: 'Alumno', key: 'alumno', width: 30 },
      { header: 'Fecha', key: 'fecha', width: 15 },
      { header: 'Asistió', key: 'presente', width: 10 },
      { header: 'Maestro', key: 'maestro', width: 30 }
    ];

    // Estilo para encabezados
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4F81BD' }
    };
    worksheet.getRow(1).font = { color: { argb: 'FFFFFFFF' }, bold: true };

    // Agregar datos
    asistencias.forEach(a => {
      worksheet.addRow({
        clase: a.clase_nombre,
        alumno: `${a.alumno_nombre} ${a.alumno_apellido}`,
        fecha: a.fecha,
        presente: a.presente ? 'Sí' : 'No',
        maestro: a.maestro_nombre
      });
    });

    // Agregar resumen
    worksheet.addRow([]);
    worksheet.addRow(['Resumen', '', '', '', '']);
    worksheet.addRow(['Total registros:', asistencias.length, '', '', '']);
    
    const presentes = asistencias.filter(a => a.presente).length;
    worksheet.addRow(['Total asistencias:', presentes, '', '', '']);
    if (asistencias.length > 0) {
      worksheet.addRow(['Porcentaje asistencia:', `${((presentes / asistencias.length) * 100).toFixed(2)}%`, '', '', '']);
    }

    // Configurar respuesta
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=reporte_asistencias_${new Date().toISOString().split('T')[0]}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al generar reporte Excel" });
  }
};

// Generar reporte de asistencia en PDF
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
        CONCAT(m.firstname, ' ', m.lastname) as maestro_nombre
      FROM asistencia a
      JOIN clases c ON a.clase_id = c.id
      JOIN mdlwa_user u ON a.alumno_id = u.id
      JOIN clase_maestros cm ON c.id = cm.clase_id
      JOIN mdlwa_user m ON cm.maestro_id = m.id
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

    // Crear PDF
    const doc = new PDFDocument({ margin: 50, size: 'A4', layout: 'landscape' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=reporte_asistencias_${new Date().toISOString().split('T')[0]}.pdf`);

    doc.pipe(res);

    // Título
    doc.fontSize(18).text('Reporte de Asistencias', { align: 'center' });
    doc.moveDown();

    // Filtros aplicados
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

    // Crear tabla
    const tableTop = 150;
    const itemSpacing = 20;
    
    // Encabezados
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Clase', 50, tableTop);
    doc.text('Alumno', 200, tableTop);
    doc.text('Fecha', 350, tableTop);
    doc.text('Asistió', 420, tableTop);
    doc.text('Maestro', 480, tableTop);

    // Línea separadora
    doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();

    // Datos
    let yPosition = tableTop + 25;
    doc.font('Helvetica');

    let totalPresentes = 0;

    asistencias.forEach((a, i) => {
      if (yPosition > 550) {
        doc.addPage();
        yPosition = 50;
      }

      doc.text(a.clase_nombre.substring(0, 20), 50, yPosition);
      doc.text(`${a.alumno_nombre} ${a.alumno_apellido}`.substring(0, 20), 200, yPosition);
      doc.text(new Date(a.fecha).toLocaleDateString(), 350, yPosition);
      doc.text(a.presente ? 'Sí' : 'No', 420, yPosition);
      doc.text(a.maestro_nombre.substring(0, 20), 480, yPosition);

      if (a.presente) totalPresentes++;
      
      yPosition += itemSpacing;
    });

    // Resumen
    doc.moveDown(2);
    doc.font('Helvetica-Bold');
    doc.text('RESUMEN:', 50, yPosition + 20);
    doc.font('Helvetica');
    doc.text(`Total registros: ${asistencias.length}`, 50, yPosition + 40);
    doc.text(`Total asistencias: ${totalPresentes}`, 50, yPosition + 55);
    if (asistencias.length > 0) {
      doc.text(`Porcentaje asistencia: ${((totalPresentes / asistencias.length) * 100).toFixed(2)}%`, 50, yPosition + 70);
    }

    doc.end();

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al generar reporte PDF" });
  }
};