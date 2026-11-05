const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: true }));

const client = new MongoClient(process.env.MONGODB_URI);
let db;

async function startServer() {
  await client.connect();
  db = client.db('cellblock');
  await db.collection('users').createIndex({ tag: 1 }, { unique: true });
  console.log('✅ Connected to MongoDB Atlas');
  app.listen(process.env.PORT, () => console.log(`🔒 CELLBLOCK KINGS v2.0 running`));
}

const auth = async (req, res, next) => {
  if (req.session.userId) {
    req.user = await db.collection('users').findOne({ _id: new ObjectId(req.session.userId) });
    if (req.user) return next();
  }
  res.redirect('/login');
};

app.get('/', (req, res) => res.redirect('/login'));
app.get('/login', (req, res) => res.render('login', { error: null }));

app.post('/login', async (req, res) => {
  const { tag, pass } = req.body;
  const user = await db.collection('users').findOne({ tag });
  if (user && await bcrypt.compare(pass, user.pass)) {
    if (user.banned) return res.render('login', { error: 'You are BANNED.' });
    req.session.userId = user._id.toString();
    res.redirect('/home');
  } else res.render('login', { error: 'Invalid Tag/Passcode' });
});

app.get('/register', (req, res) => res.render('register', { error: null }));
app.post('/register', async (req, res) => {
  const { tag, email, pass, confirm } = req.body;
  if (pass !== confirm) return res.render('register', { error: 'Passwords do not match' });
  try {
    const hash = await bcrypt.hash(pass, 10);
    const result = await db.collection('users').insertOne({
      tag, email, pass: hash,
      lvl: 1, hp: 200, max_hp: 200, en: 10, max_en: 10, nrv: 5, max_nrv: 5, stm: 100,
      str: 10, def: 10, spd: 10, exp: 0, cash: 1000, bank_balance: 0,
      online: true, banned: false, combo: '00000', last_login: 0, streak: 0,
      buff_str: 0, buff_def: 0, buff_spd: 0, buff_expires: 0, gang_id: null
    });
    req.session.userId = result.insertedId.toString();
    res.redirect('/home');
  } catch(e) { res.render('register', { error: 'Tag already taken' }); }
});

app.get('/home', auth, async (req, res) => {
  const online = await db.collection('users').countDocuments({});
  res.render('home', { user: req.user, online });
});

app.post('/crime/:id', auth, async (req, res) => {
  const crimes = { 1: { cost: 1, min: 50, max: 150, exp: 15 }, 2: { cost: 2, min: 100, max: 300, exp: 30 } };
  const crime = crimes[req.params.id];
  if (!crime || req.user.nrv < crime.cost) return res.json({ msg: 'Not enough Nerve!' });
  if (Math.random() > 0.3) {
    const cash = Math.floor(Math.random() * (crime.max - crime.min + 1)) + crime.min;
    await db.collection('users').updateOne({ _id: req.user._id }, { $inc: { cash, exp: crime.exp, nrv: -crime.cost } });
    res.json({ msg: `Success! +$${cash} +${crime.exp} EXP` });
  } else {
    await db.collection('users').updateOne({ _id: req.user._id }, { $inc: { nrv: -crime.cost } });
    res.json({ msg: 'Failed! Lost Nerve.' });
  }
});

// MARKET ROUTE - THIS WAS MISSING!
app.get('/market', auth, async (req, res) => {
  const items = [
    { id: 1, name: 'Burger', type: 'food', price: 20, heal: 50, energy: 0, level_req: 1 },
    { id: 2, name: 'Energy Drink', type: 'drink', price: 50, heal: 0, energy: 5, level_req: 1 },
    { id: 3, name: 'Rusty Shank', type: 'weapon', price: 150, stat_mod: 5, stat_type: 'str', level_req: 1 },
    { id: 4, name: 'Baseball Bat', type: 'weapon', price: 400, stat_mod: 12, stat_type: 'str', level_req: 3 },
    { id: 5, name: 'Leather Jacket', type: 'armor', price: 300, stat_mod: 8, stat_type: 'def', level_req: 2 },
    { id: 6, name: 'Kevlar Vest', type: 'armor', price: 800, stat_mod: 20, stat_type: 'def', level_req: 5 }
  ];
  const availableItems = items.filter(i => i.level_req <= req.user.lvl);
  res.render('market', { user: req.user, items: availableItems });
});

app.post('/buy/:id', auth, async (req, res) => {
  const items = {
    1: { id: 1, name: 'Burger', price: 20, type: 'food' },
    2: { id: 2, name: 'Energy Drink', price: 50, type: 'drink' },
    3: { id: 3, name: 'Rusty Shank', price: 150, type: 'weapon' },
    4: { id: 4, name: 'Baseball Bat', price: 400, type: 'weapon' },
    5: { id: 5, name: 'Leather Jacket', price: 300, type: 'armor' },
    6: { id: 6, name: 'Kevlar Vest', price: 800, type: 'armor' }
  };
  const item = items[req.params.id];
  if (!item) return res.json({ msg: 'Item not found' });
  if (req.user.cash < item.price) return res.json({ msg: 'Not enough cash!' });
  await db.collection('users').updateOne({ _id: req.user._id }, { $inc: { cash: -item.price } });
  await db.collection('inventory').updateOne(
    { user_id: req.user._id, item_id: item.id },
    { $inc: { qty: 1 } },
    { upsert: true }
  );
  res.json({ msg: `Bought ${item.name}!` });
});

app.get('/inventory', auth, async (req, res) => {
  const inv = await db.collection('inventory').find({ user_id: req.user._id }).toArray();
  const itemsMap = {
    1: { name: 'Burger', type: 'food', heal: 50, energy: 0 },
    2: { name: 'Energy Drink', type: 'drink', heal: 0, energy: 5 },
    3: { name: 'Rusty Shank', type: 'weapon', stat_mod: 5, stat_type: 'str' },
    4: { name: 'Baseball Bat', type: 'weapon', stat_mod: 12, stat_type: 'str' },
    5: { name: 'Leather Jacket', type: 'armor', stat_mod: 8, stat_type: 'def' },
    6: { name: 'Kevlar Vest', type: 'armor', stat_mod: 20, stat_type: 'def' }
  };
  const invWithDetails = inv.map(i => ({ ...i, ...itemsMap[i.item_id] }));
  res.render('inventory', { user: req.user, inv: invWithDetails });
});

app.post('/use/:id', auth, async (req, res) => {
  const slot = await db.collection('inventory').findOne({ _id: new ObjectId(req.params.id), user_id: req.user._id });
  if (!slot) return res.json({ msg: 'Not found' });
  const itemsMap = { 1: { heal: 50 }, 2: { energy: 5 } };
  const effect = itemsMap[slot.item_id];
  if (!effect) return res.json({ msg: 'Cannot use' });
  const update = {};
  if (effect.heal) update.hp = Math.min(req.user.hp + effect.heal, req.user.max_hp);
  if (effect.energy) update.en = Math.min(req.user.en + effect.energy, req.user.max_en);
  await db.collection('users').updateOne({ _id: req.user._id }, { $set: update });
  if (slot.qty > 1) await db.collection('inventory').updateOne({ _id: slot._id }, { $inc: { qty: -1 } });
  else await db.collection('inventory').deleteOne({ _id: slot._id });
  res.json({ msg: 'Used item!' });
});

app.get('/daily', auth, async (req, res) => {
  const now = Date.now();
  const canClaim = (now - (req.user.last_login || 0)) > 86400000;
  res.render('daily', { user: req.user, canClaim });
});

app.post('/daily/claim', auth, async (req, res) => {
  const now = Date.now();
  if ((now - (req.user.last_login || 0)) < 86400000) return res.json({ msg: 'Already claimed today!' });
  const baseReward = 500;
  const streakBonus = (req.user.streak || 0) * 100;
  const totalReward = baseReward + streakBonus;
  await db.collection('users').updateOne({ _id: req.user._id }, { $inc: { cash: totalReward, streak: 1 }, $set: { last_login: now } });
  res.json({ msg: `Claimed $${totalReward}! Current Streak: ${(req.user.streak || 0) + 1} days!` });
});

app.get('/drugs', auth, (req, res) => {
  const drugs = [
    { id: 1, name: 'Caffeine Pills', price: 100, effect: 'energy', buff: 20, duration: 10, od_chance: 5 },
    { id: 2, name: 'Steroids', price: 500, effect: 'str', buff: 20, duration: 15, od_chance: 15 },
    { id: 3, name: 'Kevlar Weave', price: 800, effect: 'def', buff: 20, duration: 15, od_chance: 10 },
    { id: 4, name: 'Adrenaline Shot', price: 2000, effect: 'all', buff: 30, duration: 10, od_chance: 25 }
  ];
  res.render('drugs', { user: req.user, drugs });
});

app.post('/drugs/buy/:id', auth, async (req, res) => {
  const drugs = {
    1: { name: 'Caffeine Pills', price: 100, effect: 'energy', buff: 20, duration: 10, od_chance: 5 },
    2: { name: 'Steroids', price: 500, effect: 'str', buff: 20, duration: 15, od_chance: 15 },
    3: { name: 'Kevlar Weave', price: 800, effect: 'def', buff: 20, duration: 15, od_chance: 10 },
    4: { name: 'Adrenaline Shot', price: 2000, effect: 'all', buff: 30, duration: 10, od_chance: 25 }
  };
  const drug = drugs[req.params.id];
  if (!drug) return res.json({ msg: 'Invalid drug.' });
  if (req.user.cash < drug.price) return res.json({ msg: 'Not enough cash!' });
  if (Math.random() * 100 < drug.od_chance) {
    await db.collection('users').updateOne({ _id: req.user._id }, { $inc: { cash: -drug.price }, $set: { hospitalized_until: Date.now() + 30 * 60 * 1000 } });
    return res.json({ msg: '💀 OVERDOSE! You collapsed and are in the Med Bay for 30 minutes!' });
  }
  const update = { $inc: { cash: -drug.price } };
  const expires = Date.now() + (drug.duration * 60 * 1000);
  if (drug.effect === 'str') update.$set = { buff_str: drug.buff, buff_expires: expires };
  else if (drug.effect === 'def') update.$set = { buff_def: drug.buff, buff_expires: expires };
  else if (drug.effect === 'all') update.$set = { buff_str: drug.buff, buff_def: drug.buff, buff_spd: drug.buff, buff_expires: expires };
  await db.collection('users').updateOne({ _id: req.user._id }, update);
  res.json({ msg: `Used ${drug.name}! Buff active for ${drug.duration} mins.` });
});

app.get('/gang', auth, async (req, res) => {
  let gang = null;
  if (req.user.gang_id) gang = await db.collection('gangs').findOne({ _id: new ObjectId(req.user.gang_id) });
  const allGangs = await db.collection('gangs').find().limit(10).toArray();
  res.render('gang', { user: req.user, gang, allGangs });
});

app.post('/gang/create', auth, async (req, res) => {
  const { name } = req.body;
  if (req.user.cash < 5000) return res.json({ msg: 'Need $5,000 to start a gang!' });
  if (req.user.gang_id) return res.json({ msg: 'You are already in a gang!' });
  const result = await db.collection('gangs').insertOne({
    name, leader_id: req.user._id.toString(), members: [req.user._id.toString()], bank: 0
  });
  await db.collection('users').updateOne({ _id: req.user._id }, { $set: { gang_id: result.insertedId.toString() }, $inc: { cash: -5000 } });
  res.json({ msg: `Gang "${name}" created!` });
});

app.post('/gang/join/:id', auth, async (req, res) => {
  if (req.user.gang_id) return res.json({ msg: 'Leave your current gang first!' });
  await db.collection('gangs').updateOne({ _id: new ObjectId(req.params.id) }, { $push: { members: req.user._id.toString() } });
  await db.collection('users').updateOne({ _id: req.user._id }, { $set: { gang_id: req.params.id } });
  res.json({ msg: 'Joined gang!' });
});

app.post('/gang/deposit', auth, async (req, res) => {
  const amount = parseInt(req.body.amount);
  if (!req.user.gang_id) return res.json({ msg: 'Not in a gang!' });
  if (req.user.cash < amount) return res.json({ msg: 'Not enough cash!' });
  await db.collection('gangs').updateOne({ _id: new ObjectId(req.user.gang_id) }, { $inc: { bank: amount } });
  await db.collection('users').updateOne({ _id: req.user._id }, { $inc: { cash: -amount } });
  res.json({ msg: `Deposited $${amount} to gang bank!` });
});

app.get('/chat', auth, async (req, res) => {
  const messages = await db.collection('chat').find().sort({ time: -1 }).limit(50).toArray();
  res.render('chat', { user: req.user, messages: messages.reverse() });
});

app.post('/chat', auth, async (req, res) => {
  const { msg } = req.body;
  if (msg && msg.length < 200) {
    await db.collection('chat').insertOne({ tag: req.user.tag, msg, time: Date.now() });
  }
  res.redirect('/chat');
});

app.get('/leaderboard', auth, async (req, res) => {
  const top = await db.collection('users').find().sort({ exp: -1 }).limit(10).project({ tag: 1, lvl: 1, exp: 1 }).toArray();
  res.render('leaderboard', { user: req.user, top });
});

app.get('/logout', async (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

startServer().catch(console.error);
