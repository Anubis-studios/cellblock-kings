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
  { id: 'new_jersey', name: 'New Jersey', minLvl: 1, maxLvl: 4, cellSize: '3x3', pop: 767, cost: 2000 },
  { id: 'san_quentin', name: 'San Quentin', minLvl: 5, maxLvl: 8, cellSize: '4x4', pop: 1265, cost: 5000 },
  { id: 'alcatraz', name: 'Alcatraz', minLvl: 9, maxLvl: 14, cellSize: '5x5', pop: 1785, cost: 8500 },
  { id: 'south_dakota', name: 'South Dakota', minLvl: 15, maxLvl: 20, cellSize: '6x6', pop: 1203, cost: 15000 }
];

const ITEMS = [
  { id: 1, name: 'Rolled Blunt', type: 'drug', price: 25, effect: 'nrv', value: 5 },
  { id: 2, name: 'Energy Drink', type: 'item', price: 60, effect: 'energy', value: 20 },
  { id: 3, name: 'Water Bottle', type: 'item', price: 100, effect: 'stamina', value: 30 },
  { id: 4, name: 'Chocolate Bar', type: 'item', price: 250, effect: 'hp', value: 100 },
  { id: 5, name: 'Shank', type: 'weapon', price: 300, str: 5, spd: 1 },
  { id: 6, name: 'Baseball Bat', type: 'weapon', price: 700, str: 12, spd: 2 },
  { id: 7, name: 'Leather Jacket', type: 'armor', price: 500, def: 8 },
  { id: 8, name: 'Kevlar Vest', type: 'armor', price: 1200, def: 20 }
];

const AMENITIES = [
  { id: 1, name: 'Headphones', category: 'Electronics', cost: 3, str: 0, def: 0, spd: 0, nrv: 2, energy: 0, stamina: 0 },
  { id: 2, name: 'Radio', category: 'Electronics', cost: 4, str: 0, def: 0, spd: 0, nrv: 0, energy: 2, stamina: 0 },
  { id: 3, name: 'TV', category: 'Electronics', cost: 7, str: 0, def: 0, spd: 0, nrv: 3, energy: 3, stamina: 0 },
  { id: 4, name: 'Stereo System', category: 'Electronics', cost: 12, str: 0, def: 0, spd: 0, nrv: 5, energy: 5, stamina: 0 },
  { id: 5, name: 'Poster', category: 'Media', cost: 1, str: 0, def: 0, spd: 0, nrv: 1, energy: 0, stamina: 0 },
  { id: 6, name: 'Magazine', category: 'Media', cost: 4, str: 0, def: 0, spd: 0, nrv: 2, energy: 0, stamina: 0 },
  { id: 7, name: 'DVD Player', category: 'Media', cost: 7, str: 0, def: 0, spd: 0, nrv: 3, energy: 2, stamina: 0 },
  { id: 8, name: 'Gaming Console', category: 'Media', cost: 12, str: 0, def: 0, spd: 0, nrv: 4, energy: 4, stamina: 0 },
  { id: 9, name: 'Chair', category: 'Furniture', cost: 6, str: 0, def: 2, spd: 0, nrv: 0, energy: 2, stamina: 0 },
  { id: 10, name: 'Bed', category: 'Furniture', cost: 20, str: 0, def: 0, spd: 0, nrv: 5, energy: 10, stamina: 5 },
  { id: 11, name: 'Desk', category: 'Furniture', cost: 22, str: 0, def: 0, spd: 0, nrv: 3, energy: 3, stamina: 3 },
  { id: 12, name: 'Book', category: 'Books', cost: 8, str: 0, def: 0, spd: 0, nrv: 4, energy: 0, stamina: 0 },
  { id: 13, name: 'Book Set', category: 'Books', cost: 8, str: 0, def: 0, spd: 0, nrv: 4, energy: 0, stamina: 0 },
  { id: 14, name: 'Bookshelf', category: 'Books', cost: 18, str: 0, def: 0, spd: 0, nrv: 6, energy: 0, stamina: 0 },
  { id: 15, name: 'Yoga Mat', category: 'Accessories', cost: 12, str: 0, def: 0, spd: 2, nrv: 0, energy: 0, stamina: 2 },
  { id: 16, name: 'Guard Dog', category: 'Special', cost: 20, str: 5, def: 5, spd: 0, nrv: 0, energy: 0, stamina: 0 }
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
    const loginRecord = { date: new Date().toISOString(), ip: req.ip };
    await db.collection('users').updateOne({ _id: user._id }, { 
      $set: { online: true, last_seen: Date.now() },
      $push: { recent_logins: { $each: [loginRecord], $slice: -10 } }
    });
    res.redirect('/rap-sheet');
  } else res.render('login', { error: 'Invalid credentials' });
});

app.get('/register', (req, res) => res.render('register', { error: null }));
app.post('/register', async (req, res) => {
  const { tag, email, pass, confirm, gender } = req.body;
  if (pass !== confirm) return res.render('register', { error: 'Passwords mismatch' });
  try {
    const hash = await bcrypt.hash(pass, 10);
    const referralCode = tag.toUpperCase() + Math.random().toString(36).substr(2, 5);
    const result = await db.collection('users').insertOne({
      tag, email, pass: hash, gender: gender || 'male',
      lvl: 1, hp: 200, max_hp: 200, en: 10, max_en: 10, nrv: 10, max_nrv: 10, stm: 100, max_stm: 100,
      str: 10, def: 10, spd: 10, exp: 0, cash: 500, points: 25,
      prison: 'new_jersey', cell_size: '3x3',
      combo: '00000', cell_amenities: [], cell_grid: [],
      job: 'Unemployed', battles_won: 0, battles_lost: 0,
      crimes_attempted: 0, crimes_succeeded: 0,
      hits_completed: 0, favors: 0,
      vip_until: 0, backpack_slots: 5,
      online: true, banned: false, created: Date.now(), last_seen: Date.now(),
      about_me: '', forum_signature: '', referral_code: referralCode,
      referrals: [], friends: [], enemies: [], blocklist: [],
      mail_settings: { who_can_mail: 'anyone' },
      game_settings: { battle_speed: 'fast', map_highlighting: true },
      forum_settings: { mention_notifications: true, auto_subscribe: 'both' },
      recent_logins: [{ date: new Date().toISOString(), ip: req.ip }],
      transactions: [], notes: '',
      outgoing_raids: [], incoming_raids: [],
      missions: [], equipment: { weapon: null, armor: null, gear: null },
      quick_items: [], backpack: [], drugs: [],
      training_history: [], bank_balance: 0, bank_interest: 5,
      mail: { inbox: [], outbox: [] }, hits: [],
      avatar: 'default', theme_packs: 0,
      activity_log: [{ msg: 'Booked into New Jersey. Sentence begins.', time: Date.now() }]
    });
    req.session.userId = result.insertedId.toString();
    res.redirect('/rap-sheet');
  } catch(e) { res.render('register', { error: 'Tag taken' }); }
});

app.get('/logout', async (req, res) => {
  if (req.session.userId) await db.collection('users').updateOne({ _id: new ObjectId(req.session.userId) }, { $set: { online: false } });
  req.session.destroy(() => res.redirect('/login'));
});

// RAP SHEET
app.get('/rap-sheet', auth, async (req, res) => {
  const news = await db.collection('news').find().sort({ date: -1 }).limit(5).toArray();
  res.render('rap-sheet', { user: req.user, news });
});

// MY ACCOUNT
app.get('/my-account', auth, (req, res) => res.render('my-account', { user: req.user }));
app.post('/my-account/update', auth, async (req, res) => {
  const { email, pass, confirm, battle_speed, map_highlighting, mention_notifications, auto_subscribe } = req.body;
  const update = { email, game_settings: { battle_speed, map_highlighting: map_highlighting === 'on' }, forum_settings: { mention_notifications: mention_notifications === 'on', auto_subscribe } };
  if (pass && pass === confirm) update.pass = await bcrypt.hash(pass, 10);
  await db.collection('users').updateOne({ _id: req.user._id }, { $set: update });
  res.json({ msg: 'Account updated!' });
});

// PROFILE
app.get('/profile', auth, (req, res) => res.render('profile', { user: req.user }));
app.post('/profile/update', auth, async (req, res) => {
  const { about_me, forum_signature } = req.body;
  await db.collection('users').updateOne({ _id: req.user._id }, { $set: { about_me, forum_signature } });
  res.json({ msg: 'Profile updated!' });
});

// REFERRALS
app.get('/referrals', auth, (req, res) => res.render('referrals', { user: req.user }));

// TRANSACTIONS
app.get('/transactions', auth, (req, res) => res.render('transactions', { user: req.user }));

// NOTES
app.get('/notes', auth, (req, res) => res.render('notes', { user: req.user }));
app.post('/notes/save', auth, async (req, res) => {
  const { notes } = req.body;
  await db.collection('users').updateOne({ _id: req.user._id }, { $set: { notes } });
  res.json({ msg: 'Notes saved!' });
});

// MY CELL
app.get('/my-cell', auth, (req, res) => {
  const cellStats = { str: 0, def: 0, spd: 0, nrv: 0, energy: 0, stamina: 0 };
  (req.user.cell_amenities || []).forEach(a => {
    const amenity = AMENITIES.find(am => am.id === a);
    if (amenity) {
      cellStats.str += amenity.str;
      cellStats.def += amenity.def;
      cellStats.spd += amenity.spd;
      cellStats.nrv += amenity.nrv;
      cellStats.energy += amenity.energy;
      cellStats.stamina += amenity.stamina;
    }
  });
  res.render('my-cell', { user: req.user, cellStats, amenities: AMENITIES });
});

app.post('/my-cell/combo', auth, async (req, res) => {
  const { combo } = req.body;
  if (!/^\d{5}$/.test(combo)) return res.json({ msg: 'Must be 5 digits' });
  await db.collection('users').updateOne({ _id: req.user._id }, { $set: { combo } });
  res.json({ msg: 'Combo updated!' });
});

app.post('/my-cell/amenity', auth, async (req, res) => {
  const { amenityId } = req.body;
  const amenity = AMENITIES.find(a => a.id === parseInt(amenityId));
  if (!amenity) return res.json({ msg: 'Not found' });
  if ((req.user.favors || 0) < amenity.cost) return res.json({ msg: 'Not enough favors' });
  await db.collection('users').updateOne({ _id: req.user._id }, { 
    $inc: { favors: -amenity.cost },
    $push: { cell_amenities: amenity.id }
  });
  res.json({ msg: `Bought ${amenity.name}!` });
});

// CELL RAIDS
app.get('/cell-raids', auth, (req, res) => res.render('cell-raids', { user: req.user }));

// BANK
app.get('/bank', auth, async (req, res) => {
  const account = await db.collection('banks').findOne({ user_id: req.user._id });
  res.render('bank', { user: req.user, account });
});

app.post('/bank/open', auth, async (req, res) => {
  if (req.user.cash < 2500) return res.json({ msg: 'Need $2,500' });
  await db.collection('users').updateOne({ _id: req.user._id }, { $inc: { cash: -2500 } });
  await db.collection('banks').insertOne({ user_id: req.user._id, balance: 0, interest_rate: 5, max_deposit: 10000, opened: Date.now() });
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

// EQUIPMENT
app.get('/equipment', auth, (req, res) => res.render('equipment', { user: req.user, items: ITEMS }));

// INVENTORY
app.get('/inventory', auth, async (req, res) => {
  const inv = await db.collection('inventory').find({ user_id: req.user._id }).toArray();
  const itemsWithDetails = inv.map(i => {
    const item = ITEMS.find(it => it.id === i.item_id);
    return { ...i, ...item };
  });
  res.render('inventory', { user: req.user, inv: itemsWithDetails });
});

app.post('/inventory/use', auth, async (req, res) => {
  const { itemId } = req.body;
  const slot = await db.collection('inventory').findOne({ _id: new ObjectId(itemId), user_id: req.user._id });
  if (!slot) return res.json({ msg: 'Not found' });
  const item = ITEMS.find(i => i.id === slot.item_id);
  if (!item) return res.json({ msg: 'Unknown' });
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

// MARKETPLACE
app.get('/marketplace', auth, (req, res) => res.render('marketplace', { user: req.user }));
app.get('/open-market', auth, async (req, res) => {
  const category = req.query.cat || 'items';
  const listings = await db.collection('market_listings').find({ category, active: true }).toArray();
  res.render('open-market', { user: req.user, listings, category });
});

// GYM
app.get('/gym', auth, (req, res) => res.render('gym', { user: req.user }));
app.post('/gym/train', auth, async (req, res) => {
  const { stat } = req.body;
  if (!['str', 'def', 'spd'].includes(stat)) return res.json({ msg: 'Invalid' });
  if (req.user.en < 10) return res.json({ msg: 'Need 10 Energy!' });
  const gain = Math.floor(1 + Math.random() * 2);
  await db.collection('users').updateOne({ _id: req.user._id }, { 
    $inc: { [stat]: gain, en: -10, exp: 10 },
    $push: { training_history: { $each: [{ stat, gain, date: Date.now() }], $slice: -100 } }
  });
  res.json({ msg: `Trained +${gain} ${stat.toUpperCase()}` });
});

// INFIRMARY
app.get('/infirmary', auth, (req, res) => res.render('infirmary', { user: req.user }));
app.get('/infirmary/icu', auth, async (req, res) => {
  const patients = await db.collection('users').find({ hospitalized_until: { $gt: Date.now() } }).project({ tag: 1, lvl: 1, hospitalized_until: 1 }).toArray();
  res.render('icu', { user: req.user, patients });
});
app.get('/infirmary/isolation', auth, async (req, res) => {
  const isolated = await db.collection('users').find({ isolated_until: { $gt: Date.now() } }).project({ tag: 1, lvl: 1, isolated_until: 1 }).toArray();
  res.render('isolation', { user: req.user, isolated });
});

// EXPLORE PRISON
app.get('/explore-prison', auth, (req, res) => res.render('explore-prison', { user: req.user }));
app.get('/prison-hall', auth, (req, res) => res.render('prison-hall', { user: req.user }));
app.get('/prison-yard', auth, (req, res) => res.render('prison-yard', { user: req.user }));

// GAME ROOM
app.get('/game-room', auth, (req, res) => res.render('game-room', { user: req.user }));

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

// WARDEN
app.get('/warden', auth, (req, res) => res.render('warden', { user: req.user }));
app.get('/warden/redeem-favors', auth, (req, res) => res.render('redeem-favors', { user: req.user }));
app.get('/warden/get-favors', auth, (req, res) => res.render('get-favors', { user: req.user }));
app.get('/warden/earn-favors', auth, (req, res) => res.render('earn-favors', { user: req.user }));
app.get('/warden/become-respected', auth, (req, res) => res.render('become-respected', { user: req.user }));
app.get('/warden/buy-amenities', auth, (req, res) => res.render('buy-amenities', { user: req.user, amenities: AMENITIES }));

// PRISON TRANSPORT
app.get('/prison-transport', auth, (req, res) => res.render('prison-transport', { user: req.user, prisons: PRISONS }));

// MOST WANTED
app.get('/most-wanted', auth, async (req, res) => {
  const wanted = await db.collection('users').find().sort({ lvl: -1 }).limit(50).project({ tag: 1, lvl: 1, prison: 1 }).toArray();
  res.render('most-wanted', { user: req.user, wanted });
});

// LOTTERY
app.get('/lottery', auth, (req, res) => res.render('lottery', { user: req.user }));

// TUTORIAL
app.get('/tutorial', auth, (req, res) => res.render('tutorial', { user: req.user }));

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

// GANGS
app.get('/gangs', auth, async (req, res) => {
  const gangs = await db.collection('gangs').find().toArray();
  res.render('gangs', { user: req.user, gangs });
});

// VOTING
app.get('/voting', auth, (req, res) => res.render('voting', { user: req.user }));

// MAIL
app.get('/mail', auth, (req, res) => res.render('mail', { user: req.user }));

// BATTLES
app.get('/battles', auth, (req, res) => res.render('battles', { user: req.user }));

// SPY LOG
app.get('/spy-log', auth, (req, res) => res.render('spy-log', { user: req.user }));

// FRIENDS
app.get('/friends', auth, (req, res) => res.render('friends', { user: req.user }));

app.post('/friends/add', auth, async (req, res) => {
  const { tag } = req.body;
  await db.collection('users').updateOne({ _id: req.user._id }, { $addToSet: { friends: tag } });
  res.json({ msg: `Added ${tag} as friend` });
});

// ENEMIES
app.get('/enemies', auth, (req, res) => res.render('enemies', { user: req.user }));

app.post('/enemies/add', auth, async (req, res) => {
  const { tag } = req.body;
  await db.collection('users').updateOne({ _id: req.user._id }, { $addToSet: { enemies: tag } });
  res.json({ msg: `Added ${tag} as enemy` });
});

// RULES
app.get('/rules', auth, (req, res) => res.render('rules', { user: req.user }));

// INMATES ONLINE
app.get('/inmates-online', auth, async (req, res) => {
  const inmates = await db.collection('users').find({ online: true }).project({ tag: 1, lvl: 1, last_seen: 1 }).toArray();
  res.render('inmates-online', { user: req.user, inmates });
});

// VIEW PROFILE
app.get('/profile/:tag', auth, async (req, res) => {
  const profile = await db.collection('users').findOne({ tag: req.params.tag });
  if (!profile) return res.status(404).send('Not found');
  res.render('view-profile', { user: req.user, profile });
});

// MISSIONS
app.get('/missions', auth, (req, res) => res.render('missions', { user: req.user }));


// CHARACTER CUSTOMIZER
app.get('/character-customizer', auth, (req, res) => {
  res.render('character-customizer', { user: req.user, config: req.user.character_config || {} });
});

app.post('/api/character/save', auth, async (req, res) => {
  const { config } = req.body;
  if (!config) return res.status(400).json({ msg: 'Invalid config' });
  
  await db.collection('users').updateOne(
    { _id: req.user._id },
    { $set: { character_config: config } }
  );
  res.json({ msg: 'Character saved successfully!' });
});

app.post('/api/character/save-preset', auth, async (req, res) => {
  const { slot, config, name } = req.body;
  if (slot < 0 || slot > 3) return res.status(400).json({ msg: 'Invalid slot' });
  
  const presets = req.user.saved_presets || [null, null, null, null];
  presets[slot] = { name: name || `Preset ${slot + 1}`, config, updatedAt: Date.now() };
  
  await db.collection('users').updateOne(
    { _id: req.user._id },
    { $set: { saved_presets: presets } }
  );
  res.json({ msg: `Preset ${slot + 1} saved!` });
});

app.post('/api/character/load-preset', auth, async (req, res) => {
  const { slot } = req.body;
  const presets = req.user.saved_presets || [null, null, null, null];
  const preset = presets[slot];
  
  if (!preset) return res.status(404).json({ msg: 'No preset in this slot' });
  
  await db.collection('users').updateOne(
    { _id: req.user._id },
    { $set: { character_config: preset.config } }
  );
  res.json({ msg: 'Preset loaded!', config: preset.config });
});

startServer().catch(console.error);
