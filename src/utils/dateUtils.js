function getDiaSemanaString(dia) {
  const dias = {
    1: 'Lunes',
    2: 'Martes',
    3: 'Miércoles',
    4: 'Jueves',
    5: 'Viernes',
    6: 'Sábado',
    7: 'Domingo'
  };
  return dias[dia] || 'Desconocido';
}

function formatearHorario(horario) {
  return `${getDiaSemanaString(horario.dia_semana)} ${horario.hora_inicio.substring(0,5)} - ${horario.hora_fin.substring(0,5)}`;
}

function getHoraActual() {
  const now = new Date();
  return now.toTimeString().split(' ')[0].substring(0,5);
}

function getDiaSemanaActual() {
  const now = new Date();
  // En JavaScript, domingo=0, lunes=1, etc. Convertimos a nuestro formato (lunes=1, domingo=7)
  let dia = now.getDay();
  return dia === 0 ? 7 : dia;
}

module.exports = { 
  getDiaSemanaString, 
  formatearHorario,
  getHoraActual,
  getDiaSemanaActual
};