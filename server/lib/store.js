// Stockage JSON sur disque avec écriture atomique (fichier temporaire + rename).
// Suffisant pour une usine et ses revendeurs ; interchangeable plus tard avec une
// vraie base sans toucher au reste du serveur.

import fs from "node:fs";
import path from "node:path";

export class Store {
  constructor(filePath, seedFactory) {
    this.filePath = filePath;
    this.seedFactory = seedFactory;
    this.data = null;
    this.saveTimer = null;
  }

  load({ reset = false } = {}) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!reset && fs.existsSync(this.filePath)) {
      try {
        this.data = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
        return this.data;
      } catch (error) {
        const backup = `${this.filePath}.corrupted-${Date.now()}`;
        fs.copyFileSync(this.filePath, backup);
        console.error(`Base illisible, sauvegardée dans ${backup} :`, error.message);
      }
    }
    this.data = this.seedFactory();
    this.saveNow();
    return this.data;
  }

  save() {
    // Regroupe les écritures rapprochées pour éviter de marteler le disque.
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 150);
  }

  saveNow() {
    clearTimeout(this.saveTimer);
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.filePath);
  }
}
