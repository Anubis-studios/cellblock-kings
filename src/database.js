const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'game.db');

class DB {
  constructor() {
    this.db = null;
    this.ready = this.init();
  }

  async init() {
    const SQL = await initSqlJs();
    if (fs.existsSync(DB_PATH)) {
      const buffer = fs.readFileSync(DB_PATH);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }
    this.createTables();
    this.seed();
    this.save();
    console.log('✅ Database initialized and seeded.');
    return this;
  }

  createTables() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag TEXT UNIQUE, email TEXT UNIQUE, pass TEXT, gender TEXT,
        lvl INTEGER DEFAULT 1, hp INTEGER DEFAULT 200, max_hp INTEGER DEFAULT 200,
        en INTEGER DEFAULT 10, max_en INTEGER DEFAULT 10,
        nrv INTEGER DEFAULT 5, max_nrv INTEGER DEFAULT 5,
        stm INTEGER DEFAULT 100, str INTEGER DEFAULT 10, def INTEGER DEFAULT 10, spd INTEGER DEFAULT 10,
        exp INTEGER DEFAULT 0, cash INTEGER DEFAULT 1000, credits INTEGER DEFAULT 0,
        vip INTEGER DEFAULT 0, prison_id INTEGER DEFAULT 1, online INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS crimes (id INTEGER PRIMARY KEY, name TEXT, cost INT, reward_min INT, reward_max INT, exp_min INT, exp_max INT);
      CREATE TABLE IF NOT EXISTS training (user_id INT PRIMARY KEY, str_train INT DEFAULT 0, def_train INT DEFAULT 0, spd_train INT DEFAULT 0);
      CREATE TABLE IF NOT EXISTS cells (user_id INT PRIMARY KEY, combo TEXT);
    `);
  }

  seed() {
    const count = this.db.exec("SELECT COUNT(*) FROM crimes")[0];
    if (count && count.values[0][0] > 0) return;
    this.db.run("INSERT INTO crimes VALUES (1,'Pick Pockets',1,50,150,10,20)");
    this.db.run("INSERT INTO crimes VALUES (2,'Steal Food',2,30,100,15,25)");
    this.db.run("INSERT INTO crimes VALUES (3,'Extort Newbie',3,100,250,20,35)");
    this.db.run("INSERT INTO crimes VALUES (4,'Smuggle Contraband',5,200,500,30,50)");
  }

  save() {
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }

  prepare(sql) {
    return {
      get: (...params) => {
        const stmt = this.db.prepare(sql);
        stmt.bind(params);
        const row = stmt.step() ? stmt.getAsObject() : undefined;
        stmt.free();
        return row;
      },
      all: (...params) => {
        const stmt = this.db.prepare(sql);
        stmt.bind(params);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
      },
      run: (...params) => {
        this.db.run(sql, params);
        this.save();
        const res = this.db.exec("SELECT last_insert_rowid() as id");
        return { lastInsertRowid: res[0] ? res[0].values[0][0] : 0 };
      }
    };
  }
}

module.exports = new DB();
