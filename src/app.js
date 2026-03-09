const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/authRoutes");
const usersRoutes = require("./routes/usersRoutes");
const adminRoutes = require("./routes/adminRoutes");
const classRoutes = require("./routes/classRoutes");
const reprogramacionRoutes = require("./routes/reprogramacionRoutes");

const app = express();

app.use(cors({
  //origin: 'http://localhost:3001',
  origin: 'https://front-lista.vercel.app',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

app.use("/auth", authRoutes);
app.use("/users", usersRoutes);
app.use("/admin", adminRoutes);
app.use("/classes", classRoutes);
app.use("/reprogramaciones", reprogramacionRoutes);

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
        verAsistencias: "GET /classes/:claseId/asistencias",
        solicitarReprogramacion: "POST /reprogramaciones/solicitar",
        marcarReprogramada: "POST /reprogramaciones/marcar-reprogramada"
      },
      admin: {
        usuarios: "GET /admin/users",
        asignarRol: "POST /admin/assign-role",
        asignarMultiplesRoles: "POST /admin/assign-multiple-roles",
        removerRoles: "POST /admin/remove-roles",
        clases: "GET /admin/classes",
        crearClase: "POST /admin/classes",
        actualizarHorarios: "PUT /admin/classes/:id/horarios",
        asignarMaestros: "POST /admin/classes/:id/maestros",
        quitarMaestro: "DELETE /admin/classes/:id/maestros/:maestroId",
        asignarAlumnos: "POST /admin/classes/:id/alumnos",
        reporteExcel: "GET /admin/reportes/excel",
        reportePDF: "GET /admin/reportes/pdf",
        reprogramaciones: "GET /reprogramaciones",
        procesarReprogramacion: "PUT /reprogramaciones/:id/procesar"
      }
    }
  });
});

const PORT = 3000;

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto " + PORT);
});