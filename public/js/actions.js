// Registre central des actions déclenchées par data-action="…".
// Chaque vue enregistre ses handlers ; main.js fait la délégation d'événements.

export const actions = {};

export function register(map) {
  Object.assign(actions, map);
}
