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

app.use(session({ secret: process.env.SESSION_SECRET || 'secret', resave: false, saveUninitialized: true }));

const client = new MongoClient(process.env.MONGODB_URI);
let db;

const PRISONS = [
  { id: 'ironhold', name: 'Ironhold', minLvl: 1, maxLvl: 4, desc: 'Minimum Security. Low walls, a dry fountain, and a laundry that never closes.' },
  { id: 'stonewall', name: 'Stonewall', minLvl: 5, maxLvl: 9, desc: 'Medium Security. Harder inmates, harder crimes.' },
  { id: 'pinecrest', name: 'Pinecrest', minLvl: 10, maxLvl: 14, desc: 'High Security. Forest prison with hidden dangers.' },
  { id: 'dustbowl', name: 'Dustbowl', minLvl: 15, maxLvl: 19, desc: 'Maximum Security. Desert hellhole.' },
  { id: 'blackridge', name: 'Blackridge', minLvl: 20, maxLvl: 70, desc: 'Supermax. The elite only.' }
];

const CRIMES = [
  { id: 1, name: 'Pickpocket a Guard', location: 'main_block', nerve: 2, totalNerve: 4, speed: 40, payoutMin: 120, payoutMax: 260, expMin: 8, expMax: 18, odds: 71, desc: 'Two fingers, one pocket, no second chances.' },
  { id: 2, name: 'Shake Down a Rookie', location: 'yard', nerve: 3, totalNerve: 6, speed: 60, payoutMin: 200, payoutMax: 420, expMin: 12, expMax: 26, odds: 66, desc: 'New fish. Empty pockets. Easy money.' },
  { id: 3, name: 'Smuggle Contraband', location: 'mess_hall', nerve: 5, totalNerve: 10, speed: 90, payoutMin: 380, payoutMax: 760, expMin: 22, expMax: 44, odds: 58, desc: 'A phone through the kitchen line.' },
  { id: 4, name: 'Bribe the Cook', location: 'mess_hall', nerve: 4, totalNerve: 8, speed: 70, payoutMin: 260, payoutMax: 540, expMin: 14, expMax: 32, odds: 63, desc: 'A little grease for the grease.' },
  { id: 5, name: 'Crack the Vending Machine', location: 'main_block', nerve: 4, totalNerve: 12, speed: 110, payoutMin: 620, payoutMax: 980, expMin: 30, expMax: 58, odds: 53, desc: 'Rocks, coils, every bag of chips in the block.' }
];

const ITEMS = [
  { id: 1, name: 'Water Bottle', type: 'common', price: 25, sellPrice: 11, effect: 'stamina', value: 20 },
  { id: 2, name: 'Prison Burger', type: 'common', price: 110, sellPrice: 50, effect: 'hp', value: 250 },
  { id: 3, name: 'Chocolate Bar', type: 'common', price: 80, sellPrice: 35, effect: 'nrv', value: 5 },
  { id: 4, name: 'Bandage', type: 'common', price: 70, sellPrice: 32, effect: 'hp', value: 100 },
  { id: 5, name: 'Energy Drink', type: 'common', price: 190, sellPrice: 85, effect: 'energy', value: 60 },
  { id: 6, name: 'Med Kit', type: 'common', price: 430, sellPrice: 200, effect: 'hp', value: 500 },
  { id: 7, name: 'Cigarettes', type: 'drug', price: 60, sellPrice: 28, effect: 'nrv', value: 2 },
  { id: 8, name: 'Cocaine', type: 'drug', price: 520, sellPrice: 240, effect: 'str', value: 12, risk: 30 },
  { id: 9, name: 'Steroids', type: 'drug', price: 640, sellPrice: 300, effect: 'str', value: 14, risk: 30 },
  { id: 10, name: 'Caffeine Pills', type: 'drug', price: 300, sellPrice: 140, effect: 'energy', value: 18, risk: 5 },
  { id: 11, name: 'Painkillers', type: 'drug', price: 420, sellPrice: 200, effect: 'def', value: 8, risk: 30 },
  { id: 12, name: 'Adderall', type: 'drug', price: 700, sellPrice: 330, effect: 'spd', value: 10, risk: 30 },
  { id: 13, name: 'Shrooms', type: 'drug', price: 380, sellPrice: 180, effect: 'all', value: 6, risk: 50 },
  { id: 14, name: 'Bottles Blue', type: 'drug', price: 240, sellPrice: 110, effect: 'energy', value: 30, risk: 30 },
  { id: 15, name: 'Shank', type: 'weapon', price: 300, sellPrice: 140, str: 5, spd: 1, reqLvl: 1 },
  { id: 16, name: 'Bone Shiv', type: 'weapon', price: 700, sellPrice: 330, str: 9, spd: 2, reqLvl: 3 },
  { id: 17, name: 'Steel Pipe', type: 'weapon', price: 1400, sellPrice: 650, str: 14, def: 2, reqLvl: 5 },
  { id: 18, name: 'Pillow', type: 'weapon', price: 120, sellPrice: 55, str: 2, reqLvl: 1 },
  { id: 19, name: 'Magazine Vest', type: 'armor', price: 600, sellPrice: 280, def: 6, reqLvl: 2 },
  { id: 20, name: 'Padded Jacket', type: 'armor', price: 900, sellPrice: 420, def: 11, hp: 40, reqLvl: 4 }
];

const JOBS = [
  { id: 1, name: 'Laundry Detail', reqStat: 'def', reqVal: 8, pay: 50 },
  { id: 2, name: 'Kitchen Porter', reqStat: 'str', reqVal: 12, pay: 80 },
  { id: 3, name: 'Yard Rake', reqStat: 'spd', reqVal: 10, pay: 120 }
];

const AMENITIES = [
  { id: 1, name: 'Steel Bunk', price: 940, credits: 4, hp: 50 },
  { id: 2, name: 'Treadmill', price: 1440, credits: 6, spd: 1 },
  { id: 3, name: 'Weight Bench', price: 1440, credits: 6, str: 2 },
  { id: 4, name: 'Punching Bag', price: 720, credits: 3, str: 1 },
  { id: 5, name: 'Dumbbell Rack', price: 2400, credits: 10, str: 3 },
  { id: 6, name: 'Dumbbell Set', price: 540, credits: 2, str: 1 },
  { id: 7, name: 'Upright Track', price: 2640, credits: 11, spd: 1 },
  { id: 8, name: 'Bookshelf', price: 1080, credits: 4, def: 2 },
  { id: 9, name: 'Chess Table', price: 840, credits: 3 },
  { id: 10, name: 'Meditation Mat', price: 1080, credits: 4, def: 1, spd: 1 },
  { id: 11, name: 'Workbench', price: 1320, credits: 5, str: 1, def: 1 },
  { id: 12, name: 'Lockbox', price: 1200, credits: 5, bank: 2000 },
  { id: 13, name: 'Floor Safe', price: 6200, credits: 25, bank: 20000 },
  { id: 14, name: 'Guard Dog', price: 6000, credits: 24, def: 4 },
  { id: 15, name: 'Metal Detector', price: 3000, credits: 12, def: 2 },
  { id: 16, name: 'Block TV', price: 1800, credits: 7, hp: 30 },
  { id: 17, name: 'Radio', price: 480, credits: 2, hp: 15 },
  { id: 18, name: 'Pin-Up Poster', price: 72, credits: 0, hp: 5 },
  { id: 19, name: 'Work Rug', price: 180, credits: 1, hp: 10 },
  { id: 20, name: 'Desk Lamp', price: 96, credits: 0 },
  { id: 21, name: 'Steel Toilet', price: 360, credits: 1, hp: 20 },
  { id: 22, name: 'Sink', price: 180, credits: 1, hp: 15 },
  { id: 23, name: 'Shower Head', price: 420, credits: 2, hp: 25 },
  { id: 24, name: 'Shrimp Fan', price: 240, credits: 1 },
  { id: 25, name: 'Coffee Maker', price: 420, credits: 2, hp: 10 },
  { id: 26, name: 'First Aid Kit', price: 720, credits: 3 },
  { id: 27, name: 'Concrete Planter', price: 144, credits: 1, hp: 10 },
  { id: 28, name: 'Payphone', price: 540, credits: 2, hp: 12 }
];

async function startServer() {
  await client.connect();
  db = client.db('cellblock');
  await db.collection('users').createIndex({ tag: 1 }, { unique: true });
  console.log('✅ Connected to MongoDB');
  app.listen(process.env.PORT || 3000, () => console.log('🔒 CELLBLOCK KINGS running'));
}

const auth = async (req, res, next) => {
  if (req.session.userId) {
    req.user = await db.collection('users').findOne({ _id: new ObjectId(req.session.userId) });
    if (req.user) return next();
  }
  res.redirect('/login');
};

// AUTH
app.get('/', (req, res) => res.redirect('/login'));
app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', async (req, res) => {
  const { tag, pass } = req.body;
  const user = await db.collection('users').findOne({ tag });
  if (user && await bcrypt.compare(pass, user.pass)) {
    if (user.banned) return res.render('login', { error: 'BANNED' });
    req.session.userId = user._id.toString();
    await db.collection('users').updateOne({ _id: user._id }, { $set: { online: true, last_seen: Date.now() } });
    res.redirect('/prison-hall');
  } else res.render('login', { error: 'Invalid credentials' });
});

app.get('/register', (req, res) => res.render('register', { error: null }));
app.post('/register', async (req, res) => {
  const { tag, email, pass, confirm, gender } = req.body;
  if (pass !== confirm) return res.render('register', { error: 'Passwords mismatch' });
  try {
    const hash = await bcrypt.hash(pass, 10);
    const result = await db.collection('users').insertOne({
      tag, email, pass: hash, gender: gender || 'male',
      lvl: 1, hp: 200, max_hp: 200, en: 10, max_en: 10, nrv: 5, max_nrv: 5, stm: 100, max_stm: 100,
      str: 10, def: 10, spd: 10, exp: 0, cash: 500, credits: 0,
      prison: 'ironhold', yard_x: 0, yard_y: 0,
      combo: '00000', cell_amenities: [], cell_notes: '',
      job: null, battles_won: 0, muggings: 0,
      vip_until: 0, backpack_slots: 5, has_guard_dog: false,
      online: true, banned: false, created: Date.now(), last_seen: Date.now(),
      activity_log: [{ msg: 'Booked into Ironhold. Sentence begins.', time: Date.now() }]
    });
    req.session.userId = result.insertedId.toString();
    res.redirect('/prison-hall');
  } catch(e) { res.render('register', { error: 'Tag taken' }); }
});

app.get('/logout', async (req, res) => {
  if (req.session.userId) await db.collection('users').updateOne({ _id: new ObjectId(req.session.userId) }, { $set: { online: false } });
  req.session.destroy(() => res.redirect('/login'));
});

// PRISON HALL (Home)
app.get('/prison-hall', auth, async (req, res) => {
  const prison = PRISONS.find(p => p.id === req.user.prison) || PRISONS[0];
  const otherPrisons = PRISONS.filter(p => p.id !== req.user.prison);
  res.render('prison-hall', { user: req.user, prison, otherPrisons });
});

// CRIMES
app.get('/crimes', auth, (req, res) => {
  const location = req.query.loc || 'all';
  const filtered = location === 'all' ? CRIMES : CRIMES.filter(c => c.location === location);
  res.render('crimes', { user: req.user, crimes: filtered, location });
});

app.post('/crime/:id', auth, async (req, res) => {
  const crime = CRIMES.find(c => c.id === parseInt(req.params.id));
  if (!crime) return res.json({ msg: 'Not found' });
  if (req.user.nrv < crime.nerve) return res.json({ msg: 'Not enough Nerve!' });
  
  const success = Math.random() * 100 < crime.odds;
  if (success) {
    const cash = Math.floor(Math.random() * (crime.payoutMax - crime.payoutMin + 1)) + crime.payoutMin;
    const exp = Math.floor(Math.random() * (crime.expMax - crime.expMin + 1)) + crime.expMin;
    await db.collection('users').updateOne({ _id: req.user._id }, { 
      $inc: { cash, exp, nrv: -crime.nerve },
      $push: { activity_log: { $each: [{ msg: `Committed: ${crime.name} - earned $${cash}`, time: Date.now() }], $slice: -50 } }
    });
    res.json({ msg: `Success! +$${cash} +${exp} EXP`, success: true });
  } else {
    await db.collection('users').updateOne({ _id: req.user._id }, { 
      $inc: { nrv: -crime.nerve },
      $push: { activity_log: { $each: [{ msg: `Failed: ${crime.name}`, time: Date.now() }], $slice: -50 } }
    });
    res.json({ msg: 'Failed! Lost Nerve.', success: false });
  }
});

// YARD
app.get('/yard', auth, (req, res) => res.render('yard', { user: req.user }));
app.post('/yard/move', auth, async (req, res) => {
  const { dir } = req.body;
  if (req.user.stm < 2) return res.json({ msg: 'Not enough Stamina!' });
  let x = req.user.yard_x || 0, y = req.user.yard_y || 0;
  if (dir === 'up') y = Math.max(0, y - 1);
  else if (dir === 'down') y = Math.min(5, y + 1);
  else if (dir === 'left') x = Math.max(0, x - 1);
  else if (dir === 'right') x = Math.min(6, x + 1);
  await db.collection('users').updateOne({ _id: req.user._id }, { $set: { yard_x: x, yard_y: y }, $inc: { stm: -2 } });
  res.json({ msg: `Moved to ${x},${y}`, x, y });
});

// GYM
app.get('/gym', auth, (req, res) => res.render('gym', { user: req.user }));
app.post('/gym/train', auth, async (req, res) => {
  const { stat } = req.body;
  if (!['str', 'def', 'spd'].includes(stat)) return res.json({ msg: 'Invalid' });
  if (req.user.en < 5) return res.json({ msg: 'Need 5 Energy!' });
  const gain = Math.floor(1 + Math.random() * 2);
  await db.collection('users').updateOne({ _id: req.user._id }, { $inc: { [stat]: gain, en: -5, exp: 10 } });
  res.json({ msg: `Trained +${gain} ${stat.toUpperCase()}` });
});

// JOBS
app.get('/jobs', auth, (req, res) => {
  const jobs = JOBS.map(j => ({ ...j, hasReq: req.user[j.reqStat] >= j.reqVal, claimed: req.user.job === j.id }));
  res.render('jobs', { user: req.user, jobs });
});
app.post('/jobs/claim/:id', auth, async (req, res) => {
  const job = JOBS.find(j => j.id === parseInt(req.params.id));
  if (!job) return res.json({ msg: 'Not found' });
  if (req.user[job.reqStat] < job.reqVal) return res.json({ msg: `Need ${job.reqVal} ${job.reqStat.toUpperCase()}` });
  await db.collection('users').updateOne({ _id: req.user._id }, { $set: { job: job.id }, $inc: { cash: job.pay } });
  res.json({ msg: `Claimed ${job.name}! +$${job.pay}` });
});

// ALL INMATES
app.get('/inmates', auth, async (req, res) => {
  const prisonFilter = req.query.prison || 'all';
  const lvlFilter = req.query.lvl || 'all';
  let query = { _id: { $ne: req.user._id } };
  if (prisonFilter !== 'all') query.prison = prisonFilter;
  if (lvlFilter !== 'all') {
    const [min, max] = lvlFilter.split('-').map(Number);
    query.lvl = { $gte: min, $lte: max };
  }
  const inmates = await db.collection('users').find(query).project({ tag: 1, lvl: 1, prison: 1, online: 1, last_seen: 1 }).toArray();
  res.render('inmates', { user: req.user, inmates, prisonFilter, lvlFilter });
});

// HITLIST
app.get('/hitlist', auth, async (req, res) => {
  const hits = await db.collection('hitlist').find({ active: true }).toArray();
  const allInmates = await db.collection('users').find().project({ tag: 1, lvl: 1 }).toArray();
  res.render('hitlist', { user: req.user, hits, allInmates });
});
app.post('/hitlist/post', auth, async (req, res) => {
  const { targetId, bounty, duration } = req.body;
  if (req.user.cash < bounty) return res.json({ msg: 'Not enough cash' });
  await db.collection('users').updateOne({ _id: req.user._id }, { $inc: { cash: -bounty } });
  await db.collection('hitlist').insertOne({ target_id: targetId, poster: req.user.tag, bounty, duration: parseInt(duration) || 7, active: true, created: Date.now() });
  res.json({ msg: 'Hit posted!' });
});

// GAME ROOM
app.get('/game-room', auth, (req, res) => res.render('game-room', { user: req.user }));
app.post('/minigame/:game', auth, async (req, res) => {
  const { bet } = req.body;
  const betAmt = parseInt(bet) || 100;
  if (req.user.cash < betAmt) return res.json({ msg: 'Not enough cash' });
  const win = Math.random() > 0.5;
  if (win) {
    await db.collection('users').updateOne({ _id: req.user._id }, { $inc: { cash: betAmt } });
    res.json({ msg: `Won $${betAmt}!` });
  } else {
    await db.collection('users').updateOne({ _id: req.user._id }, { $inc: { cash: -betAmt } });
    res.json({ msg: `Lost $${betAmt}` });
  }
});

// CELL
app.get('/cell', auth, (req, res) => res.render('cell', { user: req.user, amenities: AMENITIES }));
app.post('/cell/notes', auth, async (req, res) => {
  const { notes } = req.body;
  await db.collection('users').updateOne({ _id: req.user._id }, { $set: { cell_notes: notes } });
  res.json({ msg: 'Notes saved!' });
});
app.post('/cell/combo', auth, async (req, res) => {
  const { combo } = req.body;
  if (!/^\d{5}$/.test(combo)) return res.json({ msg: 'Must be 5 digits' });
  await db.collection('users').updateOne({ _id: req.user._id }, { $set: { combo } });
  res.json({ msg: 'Combo updated!' });
});

// INVENTORY
app.get('/inventory', auth, async (req, res) => {
  const inv = await db.collection('inventory').find({ user_id: req.user._id }).toArray();
  const itemsWithDetails = inv.map(i => {
    const item = ITEMS.find(it => it.id === i.item_id);
    return { ...i, ...item };
  });
  res.render('inventory', { user: req.user, inv: itemsWithDetails });
});
app.post('/inventory/use/:id', auth, async (req, res) => {
  const slot = await db.collection('inventory').findOne({ _id: new ObjectId(req.params.id), user_id: req.user._id });
  if (!slot) return res.json({ msg: 'Not found' });
  const item = ITEMS.find(i => i.id === slot.item_id);
  if (!item) return res.json({ msg: 'Unknown item' });
  const update = {};
  if (item.effect === 'hp') update.hp = Math.min((req.user.hp || 0) + item.value, req.user.max_hp);
  else if (item.effect === 'energy') update.en = Math.min((req.user.en || 0) + item.value, req.user.max_en);
  else if (item.effect === 'stamina') update.stm = Math.min((req.user.stm || 0) + item.value, req.user.max_stm);
  else if (item.effect === 'nrv') update.nrv = Math.min((req.user.nrv || 0) + item.value, req.user.max_nrv);
  if (Object.keys(update).length) await db.collection('users').updateOne({ _id: req.user._id }, { $set: update });
  if (slot.qty > 1) await db.collection('inventory').updateOne({ _id: slot._id }, { $inc: { qty: -1 } });
  else await db.collection('inventory').deleteOne({ _id: slot._id });
  res.json({ msg: `Used ${item.name}!` });
});
app.post('/inventory/sell/:id', auth, async (req, res) => {
  const slot = await db.collection('inventory').findOne({ _id: new ObjectId(req.params.id), user_id: req.user._id });
  if (!slot) return res.json({ msg: 'Not found' });
  const item = ITEMS.find(i => i.id === slot.item_id);
  if (!item) return res.json({ msg: 'Unknown' });
  const sellPrice = Math.floor(item.sellPrice || item.price * 0.5);
  await db.collection('users').updateOne({ _id: req.user._id }, { $inc: { cash: sellPrice } });
  if (slot.qty > 1) await db.collection('inventory').updateOne({ _id: slot._id }, { $inc: { qty: -1 } });
  else await db.collection('inventory').deleteOne({ _id: slot._id });
  res.json({ msg: `Sold for $${sellPrice}` });
});

// MARKET
app.get('/market', auth, (req, res) => {
  const category = req.query.cat || 'all';
  const filtered = category === 'all' ? ITEMS : ITEMS.filter(i => i.type === category);
  res.render('market', { user: req.user, items: filtered, category });
});
app.post('/market/buy/:id', auth, async (req, res) => {
  const item = ITEMS.find(i => i.id === parseInt(req.params.id));
  if (!item) return res.json({ msg: 'Not found' });
  if (req.user.cash < item.price) return res.json({ msg: 'Not enough cash' });
  await db.collection('users').updateOne({ _id: req.user._id }, { $inc: { cash: -item.price } });
  await db.collection('inventory').updateOne({ user_id: req.user._id, item_id: item.id }, { $inc: { qty: 1 } }, { upsert: true });
  res.json({ msg: `Bought ${item.name}` });
});

// BANK
app.get('/bank', auth, async (req, res) => {
  const account = await db.collection('banks').findOne({ user_id: req.user._id });
  res.render('bank', { user: req.user, account });
});
app.post('/bank/open', auth, async (req, res) => {
  if (req.user.cash < 2500) return res.json({ msg: 'Need $2,500' });
  await db.collection('users').updateOne({ _id: req.user._id }, { $inc: { cash: -2500 } });
  await db.collection('banks').insertOne({ user_id: req.user._id, balance: 0, opened: Date.now() });
  res.json({ msg: 'Account opened!' });
});
app.post('/bank/deposit', auth, async (req, res) => {
  const amt = parseInt(req.body.amount);
  if (req.user.cash < amt) return res.json({ msg: 'Not enough cash' });
  await db.collection('users').updateOne({ _id: req.user._id }, { $inc: { cash: -amt } });
  await db.collection('banks').updateOne({ user_id: req.user._id }, { $inc: { balance: amt } });
  res.json({ msg: `Deposited $${amt}` });
});
app.post('/bank/withdraw', auth, async (req, res) => {
  const amt = parseInt(req.body.amount);
  const account = await db.collection('banks').findOne({ user_id: req.user._id });
  if (!account || account.balance < amt) return res.json({ msg: 'Not enough in bank' });
  await db.collection('users').updateOne({ _id: req.user._id }, { $inc: { cash: amt } });
  await db.collection('banks').updateOne({ user_id: req.user._id }, { $inc: { balance: -amt } });
  res.json({ msg: `Withdrew $${amt}` });
});

// STORE
app.get('/store', auth, (req, res) => res.render('store', { user: req.user }));

// FORUMS
app.get('/forums', auth, async (req, res) => {
  const threads = await db.collection('forums').find().sort({ created: -1 }).toArray();
  res.render('forums', { user: req.user, threads });
});
app.post('/forums/new', auth, async (req, res) => {
  const { title, content } = req.body;
  await db.collection('forums').insertOne({ title, content, author: req.user.tag, replies: [], created: Date.now() });
  res.redirect('/forums');
});

// SHOUTBOX
app.get('/shoutbox', auth, async (req, res) => {
  const messages = await db.collection('shoutbox').find().sort({ time: -1 }).limit(50).toArray();
  res.render('shoutbox', { user: req.user, messages: messages.reverse() });
});
app.post('/shoutbox', auth, async (req, res) => {
  const { msg } = req.body;
  if (msg && msg.length < 200) {
    await db.collection('shoutbox').insertOne({ user: req.user.tag, msg, time: Date.now() });
  }
  res.redirect('/shoutbox');
});

// DIRECTOR'S OFFICE
app.get('/directors-office', auth, (req, res) => res.render('directors-office', { user: req.user, amenities: AMENITIES }));
app.post('/directors-office/buy/:id', auth, async (req, res) => {
  const amenity = AMENITIES.find(a => a.id === parseInt(req.params.id));
  if (!amenity) return res.json({ msg: 'Not found' });
  if (req.user.credits < amenity.credits) return res.json({ msg: 'Not enough credits' });
  await db.collection('users').updateOne({ _id: req.user._id }, { 
    $inc: { credits: -amenity.credits },
    $push: { cell_amenities: amenity.name }
  });
  res.json({ msg: `Bought ${amenity.name}!` });
});

// MED BAY
app.get('/med-bay', auth, (req, res) => res.render('med-bay', { user: req.user }));
app.post('/med-bay/release', auth, async (req, res) => {
  await db.collection('users').updateOne({ _id: req.user._id }, { $set: { hp: Math.floor(req.user.max_hp * 0.4) } });
  res.json({ msg: 'Released at 40% HP' });
});

// ACTIVITY LOG
app.get('/activity', auth, (req, res) => res.render('activity', { user: req.user }));

// GUIDE
app.get('/guide', auth, (req, res) => res.render('guide', { user: req.user }));

// CONTACT
app.get('/contact', auth, (req, res) => res.render('contact', { user: req.user }));

startServer().catch(console.error);
