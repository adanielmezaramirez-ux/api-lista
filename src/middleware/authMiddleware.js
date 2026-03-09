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

    const [users] = await db.execute(
      `SELECT id, username, firstname, lastname, email
       FROM mdlwa_user
       WHERE id = ?`,
      [decoded.id]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: "Usuario no encontrado" });
    }

    const user = users[0];

    const [roles] = await db.execute(
      `SELECT DISTINCT r.name as role_name
       FROM user_roles ur
       JOIN roles r ON ur.role_id = r.id
       WHERE ur.user_id = ?`,
      [user.id]
    );

    req.user = user;
    req.user.roles = roles.map(r => r.role_name);

    next();
  } catch (error) {
    console.error(error);
    res.status(401).json({ error: "Token inválido" });
  }
};

exports.isAdmin = (req, res, next) => {
  if (!req.user.roles.includes('admin')) {
    return res.status(403).json({ error: "Se requieren permisos de administrador" });
  }
  next();
};

exports.isMaestro = (req, res, next) => {
  if (!req.user.roles.includes('maestro')) {
    return res.status(403).json({ error: "Se requieren permisos de maestro" });
  }
  next();
};

exports.isAdminOrMaestro = (req, res, next) => {
  if (!req.user.roles.includes('admin') && !req.user.roles.includes('maestro')) {
    return res.status(403).json({ error: "No tienes permisos para esta acción" });
  }
  next();
};