// État global de l'application (un seul objet mutable + re-render).

export const state = {
  data: null,            // bootstrap serveur : user, factory, projects, orders…
  view: "dashboard",
  loginError: "",
  filters: { search: "", status: "", reseller: "", material: "", week: "", from: "", to: "" },
  catalogTab: "materials",
  catalogSearch: "",
  selectedOrderIds: [],
  statsRange: { from: "", to: "" },
  // Configurateur
  configurator: null,    // { projectId, step, selectedPieceId, zoom, panX, panY, wallViewId, detailPieceId }
  aiProposal: null,      // dernière analyse DXF/PDF en attente de validation
};

export function resetConfigurator(projectId, step = "material") {
  state.configurator = {
    projectId,
    step,
    selectedPieceId: null,
    zoom: 1,
    panX: 0,
    panY: 0,
    wallViewId: null,
    detailPieceId: null,
    nudgeMm: 15,
    freeAngle: 45,
  };
}

export function currentProject() {
  if (!state.configurator || !state.data) return null;
  return state.data.projects.find((p) => p.id === state.configurator.projectId) || null;
}
