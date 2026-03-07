// src/middleware/authMiddleware.js
const jwt = require("jsonwebtoken");
const db = require("../config/db");

exports.protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Obtener información actualizada del usuario incluyendo rol
    const [users] = await db.execute(
      `SELECT u.id, u.username, u.firstname, u.lastname, u.email,
              r.name as role_name
       FROM mdlwa_user u
       LEFT JOIN user_roles ur ON u.id = ur.user_id
       LEFT JOIN roles r ON ur.role_id = r.id
       WHERE u.id = ?`,
      [decoded.id]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: "Usuario no encontrado" });
    }

    req.user = users[0];
    next();
  } catch (error) {
    console.error(error);
    res.status(401).json({ error: "Token inválido" });
  }
};

// Middleware para validar rol admin
exports.isAdmin = async (req, res, next) => {
  try {
    if (req.user.role_name !== 'admin') {
      return res.status(403).json({ error: "Se requieren permisos de administrador" });
    }
    next();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

// Middleware para validar rol maestro
exports.isMaestro = async (req, res, next) => {
  try {
    if (req.user.role_name !== 'maestro') {
      return res.status(403).json({ error: "Se requieren permisos de maestro" });
    }
    next();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

// Middleware para validar que sea admin o maestro
exports.isAdminOrMaestro = async (req, res, next) => {
  try {
    if (req.user.role_name !== 'admin' && req.user.role_name !== 'maestro') {
      return res.status(403).json({ error: "No tienes permisos para esta acción" });
    }
    next();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};