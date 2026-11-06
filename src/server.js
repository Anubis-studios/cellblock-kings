const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
require('dotenv').config();

// Initialize Stripe safely (won't crash if key is missing)
let stripe;
try {
  const Stripe = require('stripe');
  stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
  if (!process.env.STRIPE_SECRET_KEY) console.warn('⚠️ STRIPE_SECRET_KEY not found. Premium payments will be disabled until added in Render.');
} catch (e) {
  console.warn('⚠️ Stripe module not found.');
}

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

app.use(session({ 
  secret: process.env.SESSION_SECRET || 'cellblock_secret', 
  resave: false, 
  saveUninitialized: true 
}));

const client = new MongoClient(process.env.MONGODB_URI);
let db;

const PREMIUM_ITEMS = [
  { id: 'favors_100', name: '100 Surgeon Favors', price: 499, amount: 100, type: 'favors' },
  { id: 'favors_500', name: '500 Surgeon Favors', price: 1999, amount: 500, type: 'favors' },
  { id: 'respected_30', name: 'Respected Status (30 Days)', price: 1200, amount: 30, type: 'vip_days' },
  { id: 'pack_gangster', name: 'Gangster Surgeon Pack', price: 999, amount: 1, type: 'pack', packId: 'gangster' },
  { id: 'pack_luchador', name: 'Luchador Surgeon Pack', price: 1499, amount: 1, type: 'pack', packId: 'luchador' }
];

async function startServer() {
  try {
    await client.connect();
    db = client.db('cellblock');
    await db.collection('users').createIndex({ tag: 1 }, { unique: true });
    console.log('✅ Connected to MongoDB');
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`🔒 CELLBLOCK KINGS running on port ${PORT}`));
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err);
  }
}

const auth = async (req, res, next) => {
  if (req.session.userId) {
    req.user = await db.collection('users').findOne({ _id: new ObjectId(req.session.userId) });
    if (req.user) return next();
  }
  res.redirect('/login');
};

// --- AUTH ROUTES ---
app.get('/', (req, res) => res.redirect('/login'));
app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', async (req, res) => {
  const { tag, pass } = req.body;
  const user = await db.collection('users').findOne({ tag });
  if (user && await bcrypt.compare(pass, user.pass)) {
    req.session.userId = user._id.toString();
    res.redirect('/rap-sheet');
  } else {
    res.render('login', { error: 'Invalid credentials' });
  }
});

app.get('/register', (req, res) => res.render('register', { error: null }));
app.post('/register', async (req, res) => {
  const { tag, email, pass, confirm } = req.body;
  if (pass !== confirm) return res.render('register', { error: 'Passwords mismatch' });
  try {
    const hash = await bcrypt.hash(pass, 10);
    const result = await db.collection('users').insertOne({
      tag, email, pass: hash, lvl: 1, hp: 200, max_hp: 200, en: 10, max_en: 10, nrv: 10, max_nrv: 10, stm: 100, max_stm: 100,
      str: 10, def: 10, spd: 10, exp: 0, cash: 500, favors: 0, prison: 'new_jersey',
      character: { baseHead: 'default', layers: {}, colors: {}, presets: [null,null,null,null], unlockedPackages: ['default'] },
      equipped_weapon: 'fists', equipped_gear: null, inventory_weapons: ['fists'], inventory_gear: [],
      vip_until: 0, created: Date.now(), last_seen: Date.now()
    });
    req.session.userId = result.insertedId.toString();
    res.redirect('/rap-sheet');
  } catch(e) { 
    res.render('register', { error: 'Tag already taken' }); 
  }
});

app.get('/logout', async (req, res) => {
  if (req.session.userId) await db.collection('users').updateOne({ _id: new ObjectId(req.session.userId) }, { $set: { online: false } });
  req.session.destroy(() => res.redirect('/login'));
});

// --- DASHBOARD ---
app.get('/rap-sheet', auth, async (req, res) => {
  const news = await db.collection('news').find().sort({ date: -1 }).limit(5).toArray();
  res.render('rap-sheet', { user: req.user, news });
});

// --- SURGEON ROUTES ---
app.get('/surgeon', auth, async (req, res) => {
  const packages = await db.collection('surgeon_packages').find({}).toArray();
  const items = await db.collection('surgeon_items').find({}).toArray();
  res.render('surgeon', { 
    user: req.user, 
    packages, 
    items: JSON.stringify(items),
    character: req.user.character || {}
  });
});

app.get('/api/surgeon/items/:category', auth, async (req, res) => {
  const items = await db.collection('surgeon_items').find({ category: req.params.category }).toArray();
  res.json(items);
});

app.post('/api/surgeon/save', auth, async (req, res) => {
  await db.collection('users').updateOne({ _id: req.user._id }, { $set: { character: req.body.character } });
  res.json({ msg: 'Character saved!' });
});

app.post('/api/surgeon/save-preset', auth, async (req, res) => {
  const { slot, preset } = req.body;
  const presets = req.user.character?.presets || [null, null, null, null];
  presets[slot] = { ...preset, savedAt: Date.now() };
  await db.collection('users').updateOne({ _id: req.user._id }, { $set: { 'character.presets': presets } });
  res.json({ msg: `Preset ${parseInt(slot) + 1} saved!` });
});

app.post('/api/surgeon/load-preset', auth, async (req, res) => {
  const { slot } = req.body;
  const presets = req.user.character?.presets || [null, null, null, null];
  if (!presets[slot]) return res.status(404).json({ msg: 'Empty slot' });
  await db.collection('users').updateOne({ _id: req.user._id }, { $set: { character: presets[slot] } });
  res.json({ msg: 'Preset loaded!', character: presets[slot] });
});

app.post('/api/surgeon/buy-package', auth, async (req, res) => {
  const { packageId } = req.body;
  const pkg = await db.collection('surgeon_packages').findOne({ id: packageId });
  if (!pkg) return res.status(404).json({ msg: 'Package not found' });
  if ((req.user.favors || 0) < pkg.cost) return res.status(400).json({ msg: 'Not enough Favors' });
  
  const unlocked = req.user.character?.unlockedPackages || ['default'];
  if (unlocked.includes(packageId)) return res.status(400).json({ msg: 'Already owned' });
  
  await db.collection('users').updateOne({ _id: req.user._id }, { 
    $inc: { favors: -pkg.cost },
    $push: { 'character.unlockedPackages': packageId }
  });
  res.json({ msg: `Purchased ${pkg.name}!` });
});

// --- PREMIUM / STRIPE ROUTES ---
app.get('/premium', auth, (req, res) => {
  res.render('premium', { user: req.user, items: PREMIUM_ITEMS, stripeEnabled: !!stripe });
});

app.post('/api/stripe/create-checkout', auth, async (req, res) => {
  if (!stripe) return res.status(500).json({ msg: 'Stripe is not configured. Please add STRIPE_SECRET_KEY to Render Environment Variables.' });
  
  const { itemId } = req.body;
  const item = PREMIUM_ITEMS.find(i => i.id === itemId);
  if (!item) return res.status(404).json({ msg: 'Item not found' });

  try {
    const session = await stripe.checkout.sessions.create({
      // payment_method_types removed - managed in Stripe Dashboard
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: `Cellblock Kings: ${item.name}` },
          unit_amount: item.price,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${req.headers.origin}/api/stripe/verify?session_id={CHECKOUT_SESSION_ID}&itemId=${item.id}`,
      cancel_url: `${req.headers.origin}/premium?canceled=true`,
      metadata: { userId: req.user._id.toString(), itemId: item.id }
    });
    res.json({ url: session.url });
  } catch (error) {
    console.error('Stripe Error:', error);
    res.status(500).json({ msg: 'Stripe error: ' + error.message });
  }
});

app.get('/api/stripe/verify', auth, async (req, res) => {
  if (!stripe) return res.redirect('/premium?error=stripe_disabled');
  
  const { session_id, itemId } = req.query;
  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status === 'paid') {
      const item = PREMIUM_ITEMS.find(i => i.id === itemId);
      const update = {};
      
      if (item.type === 'favors') update.$inc = { favors: item.amount };
      if (item.type === 'vip_days') update.$set = { vip_until: Date.now() + (item.amount * 24 * 60 * 60 * 1000) };
      if (item.type === 'pack') update.$push = { 'character.unlockedPackages': item.packId };

      await db.collection('users').updateOne({ _id: req.user._id }, update);
      res.render('stripe-success', { user: req.user, item });
    } else {
      res.redirect('/premium?error=payment_failed');
    }
  } catch (error) {
    console.error('Verification Error:', error);
    res.redirect('/premium?error=verification_failed');
  }
});

// --- GAMEPLAY ROUTES ---
app.get('/shop', auth, async (req, res) => {
  const weapons = await db.collection('weapons').find({}).toArray();
  res.render('shop', { user: req.user, weapons });
});

app.post('/shop/buy/:id', auth, async (req, res) => {
  const weapon = await db.collection('weapons').findOne({ id: req.params.id });
  if (!weapon) return res.json({ msg: 'Not found' });
  if (req.user.cash < weapon.price) return res.json({ msg: 'Not enough cash' });
  
  const isGear = ['phone_book', 'leather_jacket', 'kevlar'].includes(weapon.id);
  const invField = isGear ? 'inventory_gear' : 'inventory_weapons';
  
  if (req.user[invField]?.includes(weapon.id)) return res.json({ msg: 'Already owned' });
  
  await db.collection('users').updateOne({ _id: req.user._id }, { 
    $inc: { cash: -weapon.price },
    $push: { [invField]: weapon.id }
  });
  res.json({ msg: `Bought ${weapon.name}!` });
});

app.post('/shop/equip/:id', auth, async (req, res) => {
  const weapon = await db.collection('weapons').findOne({ id: req.params.id });
  if (!weapon) return res.json({ msg: 'Not found' });
  
  const isGear = ['phone_book', 'leather_jacket', 'kevlar'].includes(weapon.id);
  const invField = isGear ? 'inventory_gear' : 'inventory_weapons';
  const equipField = isGear ? 'equipped_gear' : 'equipped_weapon';
  
  if (!req.user[invField]?.includes(weapon.id)) return res.json({ msg: "You don't own this" });
  
  await db.collection('users').updateOne({ _id: req.user._id }, { $set: { [equipField]: weapon.id } });
  res.json({ msg: `Equipped ${weapon.name}!` });
});

app.get('/prison-transport', auth, async (req, res) => {
  const prisons = await db.collection('prisons').find({}).sort({ minLvl: 1 }).toArray();
  res.render('prison-transport', { user: req.user, prisons });
});

app.post('/prison-transport/transfer', auth, async (req, res) => {
  const { prisonId } = req.body;
  const prison = await db.collection('prisons').findOne({ id: prisonId });
  if (!prison) return res.json({ msg: 'Prison not found' });
  if (req.user.lvl < prison.minLvl) return res.json({ msg: `Need level ${prison.minLvl}` });
  if (req.user.cash < prison.cost) return res.json({ msg: `Need $${prison.cost}` });
  
  const unlocked = req.user.unlocked_prisons || [];
  if (!unlocked.includes(prisonId)) unlocked.push(prisonId);
  
  await db.collection('users').updateOne({ _id: req.user._id }, { 
    $set: { prison: prisonId, unlocked_prisons: unlocked },
    $inc: { cash: -prison.cost }
  });
  res.json({ msg: `Transport approved! Welcome to ${prison.name}.` });
});

app.get('/prison-jobs', auth, async (req, res) => {
  const jobs = await db.collection('prison_jobs').find({ prison: req.user.prison }).toArray();
  res.render('prison-jobs', { user: req.user, jobs });
});

app.post('/prison-jobs/claim/:id', auth, async (req, res) => {
  const job = await db.collection('prison_jobs').findOne({ _id: new ObjectId(req.params.id) });
  if (!job) return res.json({ msg: 'Job not found' });
  if (req.user[job.reqStat] < job.reqVal) return res.json({ msg: `Need ${job.reqVal} ${job.reqStat.toUpperCase()}` });
  if (req.user.en < job.energy) return res.json({ msg: 'Not enough energy' });
  
  await db.collection('users').updateOne({ _id: req.user._id }, { 
    $inc: { cash: job.pay, en: -job.energy, exp: Math.floor(job.pay / 10) },
    $set: { job_name: job.name, last_job_claim: Date.now() }
  });
  res.json({ msg: `Claimed ${job.name}! +$${job.pay}` });
});

app.get('/npcs', auth, async (req, res) => {
  const npcs = await db.collection('prison_npcs').find({ prison: req.user.prison }).toArray();
  const weapons = await db.collection('weapons').find({}).toArray();
  res.render('npcs', { user: req.user, npcs, weapons });
});

app.post('/combat/attack/:id', auth, async (req, res) => {
  const npc = await db.collection('prison_npcs').findOne({ _id: new ObjectId(req.params.id) });
  if (!npc) return res.json({ msg: 'NPC not found' });
  if (req.user.en < 10) return res.json({ msg: 'Need 10 Energy to attack!' });
  
  const pWeapon = await db.collection('weapons').findOne({ id: req.user.equipped_weapon || 'fists' });
  const pGear = req.user.equipped_gear ? await db.collection('weapons').findOne({ id: req.user.equipped_gear }) : null;
  const nWeapon = await db.collection('weapons').findOne({ id: npc.weapon || 'fists' });
  const nGear = npc.gear ? await db.collection('weapons').findOne({ id: npc.gear }) : null;
  
  const pStr = req.user.str + (pWeapon?.strBonus || 0);
  const pDef = req.user.def + (pGear?.defBonus || 0);
  const pSpd = req.user.spd + (pWeapon?.spdBonus || 0) + (pGear?.spdBonus || 0);
  
  const nStr = npc.str + (nWeapon?.strBonus || 0);
  const nDef = npc.def + (nGear?.defBonus || 0);
  const nSpd = npc.spd + (nWeapon?.spdBonus || 0) + (nGear?.spdBonus || 0);
  
  const pPower = (pStr * 1.5) + (pSpd * 1.2) + (pDef * 0.8);
  const nPower = (nStr * 1.5) + (nSpd * 1.2) + (nDef * 0.8);
  const winChance = pPower / (pPower + nPower);
  
  await db.collection('users').updateOne({ _id: req.user._id }, { $inc: { en: -10 } });
  
  if (Math.random() < winChance) {
    const cashReward = Math.floor(npc.cash * (0.5 + Math.random() * 0.5));
    const expReward = Math.floor(npc.lvl * 15);
    await db.collection('users').updateOne({ _id: req.user._id }, { 
      $inc: { cash: cashReward, exp: expReward, battles_won: 1, total_battles: 1 }
    });
    res.json({ msg: `VICTORY! You defeated ${npc.tag}!`, details: `Stole $${cashReward} | +${expReward} EXP`, win: true });
  } else {
    const hpLoss = Math.floor(20 + Math.random() * 30);
    await db.collection('users').updateOne({ _id: req.user._id }, { 
      $inc: { hp: -hpLoss, battles_lost: 1, total_battles: 1 },
      $set: { hospitalized_until: Date.now() + (15 * 60 * 1000) }
    });
    res.json({ msg: `DEFEAT! ${npc.tag} beat you!`, details: `Lost ${hpLoss} HP | Sent to Med Bay for 15 min`, win: false });
  }
});

app.get('/shoutbox', auth, async (req, res) => {
  const messages = await db.collection('shoutbox').find().sort({ time: -1 }).limit(50).toArray();
  res.render('shoutbox', { user: req.user, messages: messages.reverse() });
});

app.post('/shoutbox', auth, async (req, res) => {
  if (req.body.msg && req.body.msg.length < 200) {
    await db.collection('shoutbox').insertOne({ user: req.user.tag, msg: req.body.msg, time: Date.now() });
  }
  res.redirect('/shoutbox');
});

startServer().catch(console.error);

// Missing routes
app.get('/my-account', auth, (req, res) => {
  res.render('my-account', { user: req.user });
});

app.get('/rules', auth, (req, res) => {
  res.render('rules', { user: req.user });
});

// --- MISSING ROUTES FIX ---
app.get('/profile', auth, (req, res) => {
  res.render('profile', { user: req.user });
});

app.post('/profile/update', auth, async (req, res) => {
  const { about_me, forum_signature } = req.body;
  await db.collection('users').updateOne(
    { _id: req.user._id },
    { $set: { about_me, forum_signature } }
  );
  res.json({ msg: 'Profile updated!' });
});

app.get('/referrals', auth, (req, res) => {
  res.render('referrals', { user: req.user });
});

app.get('/transactions', auth, async (req, res) => {
  const transactions = await db.collection('transactions')
    .find({ user_id: req.user._id })
    .sort({ date: -1 })
    .limit(50)
    .toArray();
  res.render('transactions', { user: req.user, transactions });
});

app.get('/notes', auth, (req, res) => {
  res.render('notes', { user: req.user });
});

app.post('/notes/save', auth, async (req, res) => {
  const { notes } = req.body;
  await db.collection('users').updateOne(
    { _id: req.user._id },
    { $set: { notes: notes } }
  );
  res.json({ msg: 'Notes saved!' });
});

// Admin check middleware
const isAdmin = (req, res, next) => {
  if (req.user && req.user.is_admin === true) {
    req.isAdmin = true;
    return next();
  }
  res.status(403).send('Access Denied: Admin privileges required');
};

// Admin panel route
app.get('/admin', isAdmin, async (req, res) => {
  const allUsers = await db.collection('users').find({}).toArray();
  const stats = {
    totalUsers: allUsers.length,
    onlineUsers: allUsers.filter(u => u.online).length,
    totalCash: allUsers.reduce((sum, u) => sum + (u.cash || 0), 0)
  };
  res.render('admin', { user: req.user, stats, allUsers });
});

// Admin commands
app.post('/admin/grant-favors', isAdmin, async (req, res) => {
  const { userId, amount } = req.body;
  await db.collection('users').updateOne(
    { _id: new ObjectId(userId) },
    { $inc: { favors: parseInt(amount) } }
  );
  res.json({ msg: `Granted ${amount} favors!` });
});

app.post('/admin/set-level', isAdmin, async (req, res) => {
  const { userId, level } = req.body;
  await db.collection('users').updateOne(
    { _id: new ObjectId(userId) },
    { $set: { lvl: parseInt(level) } }
  );
  res.json({ msg: `Level set to ${level}!` });
});

app.post('/admin/add-cash', isAdmin, async (req, res) => {
  const { userId, amount } = req.body;
  await db.collection('users').updateOne(
    { _id: new ObjectId(userId) },
    { $inc: { cash: parseInt(amount) } }
  );
  res.json({ msg: `Added $${amount}!` });
});
