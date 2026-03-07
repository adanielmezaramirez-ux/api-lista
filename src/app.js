// src/app.js
const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/authRoutes");
const usersRoutes = require("./routes/usersRoutes");
const adminRoutes = require("./routes/adminRoutes");
const classRoutes = require("./routes/classRoutes");

const app = express();

// Configurar CORS
app.use(cors({
  //origin: 'https://front-lista.vercel.app',
  origin: 'http://localhost:3001',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

app.use("/auth", authRoutes);
app.use("/users", usersRoutes);
app.use("/admin", adminRoutes);
app.use("/classes", classRoutes);

app.get("/", (req, res) => {
  res.json({
    message: "API funcionando",
    endpoints: {
      login: "POST /auth/login",
      users: {
        me: "GET /users/me"
      },
      maestro: {
        misClases: "GET /classes/mis-clases",
        claseDetalle: "GET /classes/:id",
        marcarAsistencia: "POST /classes/asistencia",
        verAsistencias: "GET /classes/:claseId/asistencias"
      },
      admin: {
        usuarios: "GET /admin/users",
        asignarRol: "POST /admin/assign-role",
        clases: "GET /admin/classes",
        crearClase: "POST /admin/classes",
        actualizarHorarios: "PUT /admin/classes/:id/horarios",
        asignarMaestros: "POST /admin/classes/:id/maestros",
        quitarMaestro: "DELETE /admin/classes/:id/maestros/:maestroId",
        asignarAlumnos: "POST /admin/classes/:id/alumnos",
        reporteExcel: "GET /admin/reportes/excel",
        reportePDF: "GET /admin/reportes/pdf"
      }
    }
  });
});

const PORT = 3000;

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto " + PORT);
});