let services = [];

export const createService = (data) => {
  const newService = {
    id: Date.now().toString(),
    ...data,
    estado: "pendiente",
    proveedor: null,
  };

  services.push(newService);
  return newService;
};

export const getServices = () => services;

export const updateService = (id, data) => {
  const index = services.findIndex(s => s.id === id);
  if (index === -1) return null;

  services[index] = { ...services[index], ...data };
  return services[index];
};
