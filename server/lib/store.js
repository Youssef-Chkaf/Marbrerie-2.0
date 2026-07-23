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
    this.dailyBackup();
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.filePath);
  }

  // Sauvegarde quotidienne tournante : avant la première écriture du jour,
  // copie de l'état courant dans data/backups/ (14 jours conservés).
  dailyBackup() {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const day = new Date().toISOString().slice(0, 10);
      const dir = path.join(path.dirname(this.filePath), "backups");
      const target = path.join(dir, `marbexa-${day}.json`);
      if (fs.existsSync(target)) return;
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(this.filePath, target);
      const backups = fs.readdirSync(dir).filter((f) => /^marbexa-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
      for (const old of backups.slice(0, Math.max(0, backups.length - 14))) {
        fs.unlinkSync(path.join(dir, old));
      }
    } catch (error) {
      console.error("Sauvegarde quotidienne impossible :", error.message);
    }
  }
}
