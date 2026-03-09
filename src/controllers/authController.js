const db = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        error: "Usuario y contraseña requeridos"
      });
    }

    const [users] = await db.execute(
      `SELECT id, username, password, firstname, lastname, email,
              suspended, deleted, confirmed
       FROM mdlwa_user
       WHERE username = ?`,
      [username]
    );

    if (users.length === 0) {
      return res.status(401).json({
        error: "Usuario no encontrado"
      });
    }

    const user = users[0];

    if (user.deleted === 1) {
      return res.status(403).json({ error: "Usuario eliminado" });
    }

    if (user.suspended === 1) {
      return res.status(403).json({ error: "Usuario suspendido" });
    }

    if (user.confirmed === 0) {
      return res.status(403).json({ error: "Usuario no confirmado" });
    }

    const [userRoles] = await db.execute(
      `SELECT DISTINCT r.name as role_name
       FROM user_roles ur
       JOIN roles r ON ur.role_id = r.id
       WHERE ur.user_id = ?`,
      [user.id]
    );
    
    const roles = userRoles.map(r => r.role_name);

    if (!roles.includes('admin') && !roles.includes('maestro')) {
      return res.status(403).json({ 
        error: "Acceso denegado. No tienes permisos para acceder al sistema." 
      });
    }

    const hashMoodle = user.password.replace(/^\$2y/, "$2a");
    const match = await bcrypt.compare(password, hashMoodle);

    if (!match) {
      return res.status(401).json({
        error: "Contraseña incorrecta"
      });
    }

    const primaryRole = roles.includes('admin') ? 'admin' : 'maestro';

    const token = jwt.sign(
      { 
        id: user.id, 
        username: user.username,
        role: primaryRole
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    let responseData = {
      message: "Login correcto",
      token,
      user: {
        id: user.id,
        username: user.username,
        firstname: user.firstname,
        lastname: user.lastname,
        email: user.email,
        roles: roles
      }
    };

    if (roles.includes('admin')) {
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

      responseData.clases = clases.map(clase => ({
        ...clase,
        horarios: clase.horarios || [],
        maestros: clase.maestros || [],
        alumnos: clase.alumnos || []
      }));
    } else if (roles.includes('maestro')) {
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
        ORDER BY c.nombre
      `, [user.id]);

      responseData.clases = clases.map(clase => ({
        ...clase,
        horarios: clase.horarios || [],
        alumnos: clase.alumnos || []
      }));
    }

    res.json(responseData);

  } catch (error) {
    console.error("Error en login:", error);
    res.status(500).json({
      error: "Error en el servidor"
    });
  }
};