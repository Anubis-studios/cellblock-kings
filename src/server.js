const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const db = require('./database');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: true }));

const auth = (req, res, next) => {
  if (req.session.userId) {
    req.user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (req.user) return next();
  }
  res.redirect('/login');
};

app.get('/', (req, res) => res.redirect('/login'));

app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', async (req, res) => {
  const { tag, pass } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE tag = ?').get(tag);
  if (user && await bcrypt.compare(pass, user.pass)) {
    req.session.userId = user.id;
    db.prepare('UPDATE users SET online=1 WHERE id=?').run(user.id);
    res.redirect('/home');
  } else res.render('login', { error: 'Invalid Tag/Passcode' });
});

app.get('/register', (req, res) => res.render('register', { error: null }));
app.post('/register', async (req, res) => {
  const { tag, email, pass, confirm, gender, rules } = req.body;
  if (pass !== confirm || !rules) return res.render('register', { error: 'Mismatch or Rules not accepted' });
  if (pass.length < 6) return res.render('register', { error: 'Passcode must be 6+ chars' });
  try {
    const hash = await bcrypt.hash(pass, 10);
    const info = db.prepare('INSERT INTO users (tag, email, pass, gender) VALUES (?, ?, ?, ?)').run(tag, email, hash, gender);
    db.prepare('INSERT INTO cells (user_id, combo) VALUES (?, ?)').run(info.lastInsertRowid, '00000');
    req.session.userId = info.lastInsertRowid;
    res.redirect('/home');
  } catch(e) { res.render('register', { error: 'Tag already taken' }); }
});

app.get('/home', auth, (req, res) => {
  const online = db.prepare('SELECT COUNT(*) as c FROM users WHERE online=1').get().c;
  res.render('home', { user: req.user, online });
});

app.post('/crime/:id', auth, (req, res) => {
  const crime = db.prepare('SELECT * FROM crimes WHERE id=?').get(parseInt(req.params.id));
  if (!crime) return res.json({ msg: 'Crime not found' });
  if (req.user.nrv < crime.cost) return res.json({ msg: 'Not enough Nerve!' });
  
  const success = Math.random() > 0.3; 
  if (success) {
    const cash = Math.floor(Math.random() * (crime.reward_max - crime.reward_min + 1)) + crime.reward_min;
    const exp = Math.floor(Math.random() * (crime.exp_max - crime.exp_min + 1)) + crime.exp_min;
    db.prepare('UPDATE users SET cash=cash+?, exp=exp+?, nrv=nrv-? WHERE id=?').run(cash, exp, crime.cost, req.user.id);
    res.json({ msg: `✅ Success! +$${cash} +${exp} EXP` });
  } else {
    db.prepare('UPDATE users SET nrv=nrv-? WHERE id=?').run(crime.cost, req.user.id);
    res.json({ msg: '❌ Failed! Lost Nerve.' });
  }
});

app.get('/logout', (req, res) => {
  if (req.session.userId) db.prepare('UPDATE users SET online=0 WHERE id=?').run(req.session.userId);
  req.session.destroy(() => res.redirect('/login'));
});

// MARKET & INVENTORY SYSTEM
app.get("/market", auth, (req, res) => {
  const items = db.prepare("SELECT * FROM items WHERE level_req <= ?").all(req.user.lvl);
  res.render("market", { user: req.user, items });
});
app.post("/buy/:id", auth, (req, res) => {
  const item = db.prepare("SELECT * FROM items WHERE id=?").get(parseInt(req.params.id));
  if (!item) return res.json({msg:"Item not found"});
  if (req.user.cash < item.price) return res.json({msg:"Not enough cash!"});
  const invCount = db.prepare("SELECT COUNT(*) as c FROM inventory WHERE user_id=?").get(req.user.id).c;
  if (invCount >= 10) return res.json({msg:"Inventory full! (Max 10 slots)"});
  db.prepare("UPDATE users SET cash=cash-? WHERE id=?").run(item.price, req.user.id);
  const existing = db.prepare("SELECT * FROM inventory WHERE user_id=? AND item_id=?").get(req.user.id, item.id);
  if (existing) { db.prepare("UPDATE inventory SET qty=qty+1 WHERE id=?").run(existing.id); }
  else { db.prepare("INSERT INTO inventory (user_id, item_id, qty, equipped) VALUES (?,?,1,0)").run(req.user.id, item.id); }
  res.json({msg:`Bought ${item.name}!`});
});
app.get("/inventory", auth, (req, res) => {
  const inv = db.prepare("SELECT inv.id as slot_id, inv.qty, inv.equipped, i.* FROM inventory inv JOIN items i ON inv.item_id=i.id WHERE inv.user_id=?").all(req.user.id);
  res.render("inventory", { user: req.user, inv });
});
app.post("/use/:id", auth, (req, res) => {
  const slot = db.prepare("SELECT inv.id as slot_id, inv.qty, i.* FROM inventory inv JOIN items i ON inv.item_id=i.id WHERE inv.id=? AND inv.user_id=?").get(parseInt(req.params.id), req.user.id);
  if (!slot) return res.json({msg:"Item not found"});
  if (slot.type !== "food" && slot.type !== "drink") return res.json({msg:"Cannot use this item"});
  let msg = `Used ${slot.name}! `;
  if (slot.heal > 0) { db.prepare("UPDATE users SET hp=MIN(hp+?, max_hp) WHERE id=?").run(slot.heal, req.user.id); msg += `+${slot.heal} HP. `; }
  if (slot.energy > 0) { db.prepare("UPDATE users SET en=MIN(en+?, max_en) WHERE id=?").run(slot.energy, req.user.id); msg += `+${slot.energy} Energy.`; }
  if (slot.qty > 1) db.prepare("UPDATE inventory SET qty=qty-1 WHERE id=?").run(slot.slot_id);
  else db.prepare("DELETE FROM inventory WHERE id=?").run(slot.slot_id);
  res.json({msg});
});
app.post("/equip/:id", auth, (req, res) => {
  const slot = db.prepare("SELECT inv.id as slot_id, inv.equipped, i.* FROM inventory inv JOIN items i ON inv.item_id=i.id WHERE inv.id=? AND inv.user_id=?").get(parseInt(req.params.id), req.user.id);
  if (!slot || (slot.type !== "weapon" && slot.type !== "armor")) return res.json({msg:"Invalid item"});
  db.prepare("UPDATE inventory SET equipped=0 WHERE user_id=? AND item_id IN (SELECT id FROM items WHERE type=?)").run(req.user.id, slot.type);
  const newStatus = slot.equipped ? 0 : 1;
  db.prepare("UPDATE inventory SET equipped=? WHERE id=?").run(newStatus, slot.slot_id);
  res.json({msg: newStatus ? `Equipped ${slot.name}!` : `Unequipped ${slot.name}.`});
});

// GYM PAGE
// MARKET & INVENTORY SYSTEM
app.get('/market', auth, (req, res) => {
  const items = db.prepare('SELECT * FROM items WHERE level_req <= ?').all(req.user.lvl);
  res.render('market', { user: req.user, items });
});

app.post('/buy/:id', auth, (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id=?').get(parseInt(req.params.id));
  if (!item) return res.json({msg:'Item not found'});
  if (req.user.cash < item.price) return res.json({msg:'Not enough cash!'});
  const invCount = db.prepare('SELECT COUNT(*) as c FROM inventory WHERE user_id=?').get(req.user.id).c;
  if (invCount >= 10) return res.json({msg:'Inventory full! (Max 10 slots)'});
  
  db.prepare('UPDATE users SET cash=cash-? WHERE id=?').run(item.price, req.user.id);
  const existing = db.prepare('SELECT * FROM inventory WHERE user_id=? AND item_id=?').get(req.user.id, item.id);
  if (existing) {
    db.prepare('UPDATE inventory SET qty=qty+1 WHERE id=?').run(existing.id);
  } else {
    db.prepare('INSERT INTO inventory (user_id, item_id, qty, equipped) VALUES (?,?,1,0)').run(req.user.id, item.id);
  }
  res.json({msg:`Bought ${item.name}!`});
});

app.get('/inventory', auth, (req, res) => {
  const inv = db.prepare('SELECT inv.id as slot_id, inv.qty, inv.equipped, i.* FROM inventory inv JOIN items i ON inv.item_id=i.id WHERE inv.user_id=?').all(req.user.id);
  res.render('inventory', { user: req.user, inv });
});

app.post('/use/:id', auth, (req, res) => {
  const slot = db.prepare('SELECT inv.id as slot_id, inv.qty, i.* FROM inventory inv JOIN items i ON inv.item_id=i.id WHERE inv.id=? AND inv.user_id=?').get(parseInt(req.params.id), req.user.id);
  if (!slot) return res.json({msg:'Item not found'});
  if (slot.type !== 'food' && slot.type !== 'drink') return res.json({msg:'Cannot use this item'});
  
  let msg = `Used ${slot.name}! `;
  if (slot.heal > 0) { db.prepare('UPDATE users SET hp=MIN(hp+?, max_hp) WHERE id=?').run(slot.heal, req.user.id); msg += `+${slot.heal} HP. `; }
  if (slot.energy > 0) { db.prepare('UPDATE users SET en=MIN(en+?, max_en) WHERE id=?').run(slot.energy, req.user.id); msg += `+${slot.energy} Energy.`; }
  
  if (slot.qty > 1) db.prepare('UPDATE inventory SET qty=qty-1 WHERE id=?').run(slot.slot_id);
  else db.prepare('DELETE FROM inventory WHERE id=?').run(slot.slot_id);
  res.json({msg});
});

app.post('/equip/:id', auth, (req, res) => {
  const slot = db.prepare('SELECT inv.id as slot_id, inv.equipped, i.* FROM inventory inv JOIN items i ON inv.item_id=i.id WHERE inv.id=? AND inv.user_id=?').get(parseInt(req.params.id), req.user.id);
  if (!slot || (slot.type !== 'weapon' && slot.type !== 'armor')) return res.json({msg:'Invalid item'});
  
  db.prepare('UPDATE inventory SET equipped=0 WHERE user_id=? AND item_id IN (SELECT id FROM items WHERE type=?)').run(req.user.id, slot.type);
  const newStatus = slot.equipped ? 0 : 1;
  db.prepare('UPDATE inventory SET equipped=? WHERE id=?').run(newStatus, slot.slot_id);
  res.json({msg: newStatus ? `Equipped ${slot.name}!` : `Unequipped ${slot.name}.`});
});

app.get("/gym", auth, (req, res) => {
  res.render("gym", { user: req.user });
});

// TRAIN AT GYM
app.post("/train", auth, (req, res) => {
  const { stat } = req.body;
  const validStats = ["str", "def", "spd"];
  if (!validStats.includes(stat)) return res.json({ msg: "Invalid stat!" });
  if (req.user.en < 2) return res.json({ msg: "Not enough Energy! Need 2." });
  const gain = Math.floor(1 + (req.user.stm / 50));
  db.prepare(`UPDATE users SET ${stat}=${stat}+?, en=en-2, exp=exp+5 WHERE id=?`).run(gain, req.user.id);
  const updatedUser = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
  const expNeeded = updatedUser.lvl * 100;
  if (updatedUser.exp >= expNeeded) {
    db.prepare("UPDATE users SET lvl=lvl+1, max_hp=max_hp+50, max_en=max_en+2, max_nrv=max_nrv+1, hp=max_hp+50, en=max_en+2, nrv=max_nrv+1 WHERE id=?").run(req.user.id);
    res.json({ msg: `✅ Trained +${gain} ${stat.toUpperCase()}! 🎉 LEVEL UP! Now level ${updatedUser.lvl + 1}!` });
  } else {
    res.json({ msg: `✅ Trained +${gain} ${stat.toUpperCase()}! (${updatedUser.exp}/${expNeeded} EXP to next level)` });
  }
});


// BANK SYSTEM
app.get('/bank', auth, (req, res) => res.render('bank', { user: req.user }));
app.post('/bank/deposit', auth, (req, res) => {
  const amount = parseInt(req.body.amount);
  if (!amount || amount <= 0) return res.json({ msg: 'Invalid amount' });
  if (req.user.cash < amount) return res.json({ msg: 'Not enough cash on hand!' });
  db.prepare('UPDATE users SET cash=cash-?, bank_balance=bank_balance+? WHERE id=?').run(amount, amount, req.user.id);
  res.json({ msg: `Deposited ${amount} safely in the bank!` });
});
app.post('/bank/withdraw', auth, (req, res) => {
  const amount = parseInt(req.body.amount);
  if (!amount || amount <= 0) return res.json({ msg: 'Invalid amount' });
  if (req.user.bank_balance < amount) return res.json({ msg: 'Not enough in the bank!' });
  db.prepare('UPDATE users SET cash=cash+?, bank_balance=bank_balance-? WHERE id=?').run(amount, amount, req.user.id);
  res.json({ msg: `Withdrew ${amount} from the bank!` });
});

// HITLIST SYSTEM
app.get('/hitlist', auth, (req, res) => {
  const hits = db.prepare('SELECT h.*, u1.tag as target_tag, u2.tag as poster_tag FROM hitlist h JOIN users u1 ON h.target_id=u1.id JOIN users u2 ON h.poster_id=u2.id WHERE h.status="active"').all();
  res.render('hitlist', { user: req.user, hits });
});
app.post('/hitlist/post', auth, (req, res) => {
  const { targetId, bounty } = req.body;
  if (req.user.cash < bounty) return res.json({ msg: 'Not enough cash for bounty!' });
  db.prepare('UPDATE users SET cash=cash-? WHERE id=?').run(bounty, req.user.id);
  db.prepare('INSERT INTO hitlist (target_id, poster_id, bounty) VALUES (?, ?, ?)').run(targetId, req.user.id, bounty);
  res.json({ msg: 'Bounty posted successfully!' });
});
app.post('/hitlist/claim/:id', auth, (req, res) => {
  const hit = db.prepare('SELECT * FROM hitlist WHERE id=? AND status="active"').get(parseInt(req.params.id));
  if (!hit) return res.json({ msg: 'Hit already claimed or removed.' });
  db.prepare('UPDATE hitlist SET status="claimed" WHERE id=?').run(hit.id);
  db.prepare('UPDATE users SET cash=cash+? WHERE id=?').run(hit.bounty, req.user.id);
  res.json({ msg: `Contract claimed! You earned ${hit.bounty}!` });
});

// CELL SYSTEM
app.get('/cell', auth, (req, res) => {
  const cell = db.prepare('SELECT * FROM cells WHERE user_id=?').get(req.user.id) || { combo: '00000' };
  res.render('cell', { user: req.user, cell });
});
app.post('/cell/combo', auth, (req, res) => {
  const { combo } = req.body;
  if (!/^\d{5}$/.test(combo)) return res.json({ msg: 'Combo must be exactly 5 digits!' });
  db.prepare('INSERT OR REPLACE INTO cells (user_id, combo) VALUES (?, ?)').run(req.user.id, combo);
  res.json({ msg: 'Cell combo updated!' });
});
app.post('/cell/raid/:id', auth, (req, res) => {
  const targetId = parseInt(req.params.id);
  const { guess } = req.body;
  const targetCell = db.prepare('SELECT * FROM cells WHERE user_id=?').get(targetId);
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(targetId);
  
  if (!targetCell || !target) return res.json({ msg: 'Target has no cell.' });
  if (req.user.nrv < 10) return res.json({ msg: 'Raiding costs 10 Nerve!' });
  
  db.prepare('UPDATE users SET nrv=nrv-10 WHERE id=?').run(req.user.id);
  
  if (guess === targetCell.combo) {
    const stolenCash = Math.floor(target.cash * 0.15);
    db.prepare('UPDATE users SET cash=cash-? WHERE id=?').run(stolenCash, targetId);
    db.prepare('UPDATE users SET cash=cash+? WHERE id=?').run(stolenCash, req.user.id);
    // Reset combo after successful raid
    const newCombo = Math.floor(10000 + Math.random() * 90000).toString();
    db.prepare('UPDATE cells SET combo=? WHERE user_id=?').run(newCombo, targetId);
    res.json({ msg: `🔓 RAID SUCCESS! You cracked the combo and stole ${stolenCash}!` });
  } else {
    // Generate feedback (Mastermind style)
    let feedback = '';
    for (let i = 0; i < 5; i++) {
      if (guess[i] === targetCell.combo[i]) feedback += '🟢';
      else if (targetCell.combo.includes(guess[i])) feedback += '🟡';
      else feedback += '🔴';
    }
    res.json({ msg: `❌ RAID FAILED! Combo hint: ${feedback}. You lost 10 Nerve.` });
  }
});

db.ready.then(() => {
  app.listen(process.env.PORT, () => console.log(`🔒 CELLBLOCK KINGS running on http://localhost:${process.env.PORT}`));
});

// INMATES LIST
app.get('/inmates', auth, (req, res) => {
  const now = Date.now();
  // Show all users except self. If hospitalized, show time remaining.
  const inmates = db.prepare('SELECT id, tag, lvl, str, def, spd, cash, hospitalized_until FROM users WHERE id != ?').all(req.user.id);
  res.render('inmates', { user: req.user, inmates, now });
});

// ATTACK PLAYER
app.post('/attack/:id', auth, (req, res) => {
  const targetId = parseInt(req.params.id);
  if (targetId === req.user.id) return res.json({ msg: "You can't attack yourself!" });
  
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(targetId);
  if (!target) return res.json({ msg: 'Inmate not found.' });
  
  // Check if target is in Med Bay
  if (target.hospitalized_until && target.hospitalized_until > Date.now()) {
    const minsLeft = Math.ceil((target.hospitalized_until - Date.now()) / 60000);
    return res.json({ msg: `${target.tag} is in the Med Bay for ${minsLeft} more minutes!` });
  }
  
  // Check if attacker is in Med Bay
  if (req.user.hospitalized_until && req.user.hospitalized_until > Date.now()) {
    return res.json({ msg: 'You are in the Med Bay! Wait to recover.' });
  }
  
  if (req.user.en < 5) return res.json({ msg: 'Not enough Energy! Need 5.' });
  
  // Get equipped gear
  const atkWeapon = db.prepare("SELECT i.stat_mod FROM inventory inv JOIN items i ON inv.item_id=i.id WHERE inv.user_id=? AND i.type='weapon' AND inv.equipped=1").get(req.user.id);
  const atkArmor = db.prepare("SELECT i.stat_mod FROM inventory inv JOIN items i ON inv.item_id=i.id WHERE inv.user_id=? AND i.type='armor' AND inv.equipped=1").get(req.user.id);
  const defWeapon = db.prepare("SELECT i.stat_mod FROM inventory inv JOIN items i ON inv.item_id=i.id WHERE inv.user_id=? AND i.type='weapon' AND inv.equipped=1").get(target.id);
  const defArmor = db.prepare("SELECT i.stat_mod FROM inventory inv JOIN items i ON inv.item_id=i.id WHERE inv.user_id=? AND i.type='armor' AND inv.equipped=1").get(target.id);
  
  const atkPower = req.user.str + (atkWeapon ? atkWeapon.stat_mod : 0);
  const defPower = target.def + (defArmor ? defArmor.stat_mod : 0);
  
  // Combat math
  const atkRoll = Math.floor(Math.random() * 20) + atkPower;
  const defRoll = Math.floor(Math.random() * 20) + defPower;
  
  db.prepare('UPDATE users SET en=en-5 WHERE id=?').run(req.user.id);
  
  if (atkRoll > defRoll) {
    // Attacker wins
    const stolen = Math.floor(target.cash * 0.1);
    const expGain = 25;
    db.prepare('UPDATE users SET cash=cash+?, exp=exp+? WHERE id=?').run(stolen, expGain, req.user.id);
    db.prepare('UPDATE users SET cash=cash-? WHERE id=?').run(stolen, target.id);
    
    // Send loser to Med Bay for 10 minutes
    const medBayTime = Date.now() + (10 * 60 * 1000);
    db.prepare('UPDATE users SET hospitalized_until=? WHERE id=?').run(medBayTime, target.id);
    
    res.json({ msg: `⚔️ VICTORY! You beat ${target.tag} and stole $${stolen}! (+${expGain} EXP). They are in the Med Bay for 10 mins.` });
  } else {
    // Defender wins (Attacker loses)
    const medBayTime = Date.now() + (15 * 60 * 1000);
    db.prepare('UPDATE users SET hospitalized_until=? WHERE id=?').run(medBayTime, req.user.id);
    res.json({ msg: `💀 DEFEAT! ${target.tag} beat you and sent you to the Med Bay for 15 mins!` });
  }
});
