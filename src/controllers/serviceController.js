	mport { createService, getServices, updateService } from "../models/Service.js";

export const solicitarServicio = (req, res) => {
  const { usuario, tipo, ubicacion } = req.body;

  if (!usuario || !tipo) {
    return res.status(400).json({ error: "Faltan datos" });
  }

  const servicio = createService({
    usuario,
    tipo,
    ubicacion,
  });

  res.json(servicio);
};

export const listarServicios = (req, res) => {
  const servicios = getServices();
  res.json(servicios);
};

export const aceptarServicio = (req, res) => {
  const { id } = req.params;
  const { proveedor } = req.body;

  const servicio = updateService(id, {
    estado: "aceptado",
    proveedor,
  });

  if (!servicio) {
    return res.status(404).json({ error: "No encontrado" });
  }

  res.json(servicio);
};
