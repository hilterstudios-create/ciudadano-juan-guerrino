require('dotenv').config();
console.log('SERVER START - env probe:');
console.log('  SUPABASE_URL=', process.env.SUPABASE_URL);
console.log('  SUPABASE_SERVICE_ROLE_KEY=', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log('  MONGODB_URI=', !!process.env.MONGODB_URI);
console.log('  GOOGLE_CLIENT_ID=', !!process.env.GOOGLE_CLIENT_ID);
console.log('  GOOGLE_CLIENT_SECRET=', !!process.env.GOOGLE_CLIENT_SECRET);
const express = require('express');
const mongoose = require('mongoose');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');

const app = express();
app.set('trust proxy', 1); // necesario en Render/GCP/Heroku para URLs generadas con https

const PORT = process.env.PORT || 5500;
const JWT_SECRET = process.env.JWT_SECRET || 'cambia-esto-en-produccion';

// ── SUPABASE (solo imágenes / Storage) ──────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── MONGODB (texto: usuarios, casos, guías, denuncias) ───────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB conectado'))
  .catch(err => console.error('❌ MongoDB error:', err));

// ── MIDDLEWARE ───────────────────────────────────────────────
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// ── SESSION Y PASSPORT ────────────────────────────────────────
app.use(session({
  secret: JWT_SECRET,
  resave: false,
  saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

// Configurar Passport con Google OAuth
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || 'https://ciudadano-juan-guerrino.onrender.com/auth/google/callback';

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: GOOGLE_CALLBACK_URL
}, async (accessToken, refreshToken, profile, done) => {
  try {
    // Buscar usuario por googleId
    let usuario = await Usuario.findOne({ googleId: profile.id });
    if (!usuario) {
      // Si no existe, crear uno nuevo
      usuario = new Usuario({
        nombre: profile.displayName,
        email: profile.emails[0].value,
        googleId: profile.id,
        foto: profile.photos[0].value, // foto de perfil de Google
        rol: 'usuario' // por defecto
      });
      await usuario.save();
    } else {
      // Actualizar foto si cambió
      if (usuario.foto !== profile.photos[0].value) {
        usuario.foto = profile.photos[0].value;
        await usuario.save();
      }
    }
    return done(null, usuario);
  } catch (err) {
    return done(err, null);
  }
}));

passport.serializeUser((user, done) => done(null, user._id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await Usuario.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

// Multer en memoria para subir imágenes a Supabase
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB máx por archivo
});

// ── ESQUEMAS MONGODB ─────────────────────────────────────────

const usuarioSchema = new mongoose.Schema({
  nombre:   { type: String, required: true },
  email:    { type: String, required: true, unique: true },
  password: { type: String, required: false }, // opcional para Google auth
  googleId: { type: String, sparse: true }, // único para usuarios de Google
  foto:     { type: String }, // URL de foto de perfil de Google
  rol:      { type: String, enum: ['superadmin', 'editor', 'autor', 'moderador', 'usuario'], default: 'usuario' },
  activo:   { type: Boolean, default: true },
  creadoEn: { type: Date, default: Date.now }
});
const Usuario = mongoose.model('Usuario', usuarioSchema);

const casoSchema = new mongoose.Schema({
  titulo:       String,
  descripcion:  String,
  categoria:    { type: String, enum: ['vereda','drenaje','obra','otro'] },
  ubicacion:    String,
  estado:       { type: String, default: 'pendiente',
                  enum: ['pendiente','en_inspeccion','con_orden_municipal','resuelto'] },
  evidencia:    [String], // URLs públicas de Supabase Storage
  reportadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
  fecha:        { type: Date, default: Date.now }
});
const Caso = mongoose.model('Caso', casoSchema);

const denunciaSchema = new mongoose.Schema({
  titulo:      String,
  descripcion: String,
  tipo:        String,
  hechos:      String,
  ubicacion:   String,
  danos:       String,
  baseLegal:   { type: String, default: 'RNE / Ordenanza municipal' },
  evidencia:   [String], // URLs públicas de Supabase Storage
  estado:      { type: String, default: 'en_revision',
                 enum: ['en_revision','enviada','respondida','archivada'] },
  fecha:       { type: Date, default: Date.now }
});
const Denuncia = mongoose.model('Denuncia', denunciaSchema);

const guiaSchema = new mongoose.Schema({
  titulo:        { type: String, required: true },
  descripcion:   String,
  categoria:     { type: String, enum: ['vereda','drenaje','licencia','accesibilidad','otro'], default: 'otro' },
  norma:         String,
  contenido:     String,  // HTML con el detalle
  enlaceExterno: String,  // URL al PDF oficial
  icono:         { type: String, default: 'fa-solid fa-book' },
  color:         { type: String, default: 'verde' },
  publicado:     { type: Boolean, default: true },
  creadoPor:     { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
  fecha:         { type: Date, default: Date.now }
});
const Guia = mongoose.model('Guia', guiaSchema);

const noticiaSchema = new mongoose.Schema({
  titulo:        { type: String, required: true },
  resumen:       { type: String, required: true }, // resumen corto para listados
  contenido:     [{ // array de bloques ordenados
    tipo:         { type: String, enum: ['texto', 'imagen', 'link', 'separador'], required: true },
    contenido:    { type: String, required: true }, // texto, URL de imagen, URL de link, o vacío para separador
    alt:          String, // para imágenes
    tituloLink:   String // para links
  }],
  imagenPrincipal: String, // URL de Supabase
  mediaInterna:   [String], // lista de URLs de imágenes/links embebidos en Supabase
  tags:           [String], // categorías/tags
  categoria:      { type: String, enum: ['seguridad', 'infraestructura', 'medioambiente', 'gobierno', 'otro'], default: 'otro' },
  fechaPublicacion: { type: Date },
  estado:         { type: String, enum: ['borrador', 'revision', 'publicado', 'programado', 'archivado'], default: 'borrador' },
  prioridad:      { type: String, enum: ['normal', 'destacada'], default: 'normal' },
  autor:          { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
  version:        { type: Number, default: 1 },
  versiones:      [{ // historial de versiones
    version:      Number,
    contenido:    [{ tipo: String, contenido: String, alt: String, tituloLink: String }],
    fecha:        { type: Date, default: Date.now },
    autor:        { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' }
  }],
  creadoEn:       { type: Date, default: Date.now },
  actualizadoEn:  { type: Date, default: Date.now }
});
const Noticia = mongoose.model('Noticia', noticiaSchema);

// ── HELPER: subir archivos a Supabase Storage ────────────────
async function subirArchivos(files, carpeta = 'evidencia') {
  const urls = [];
  for (const file of files) {
    const ext    = file.originalname.split('.').pop();
    const nombre = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage
      .from('observatorio') // nombre del bucket — créalo en Supabase Storage
      .upload(`${carpeta}/${nombre}`, file.buffer, { contentType: file.mimetype });
    if (error) throw error;
    const { data } = supabase.storage
      .from('observatorio')
      .getPublicUrl(`${carpeta}/${nombre}`);
    urls.push(data.publicUrl);
  }
  return urls;
}

// ── MIDDLEWARES DE AUTH ──────────────────────────────────────

function verificarToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(403).json({ error: 'Token inválido o expirado' });
  }
}

function soloAdmin(req, res, next) {
  if (!['superadmin', 'editor', 'autor', 'moderador'].includes(req.usuario.rol))
    return res.status(403).json({ error: 'Acceso denegado. Solo roles editoriales.' });
  next();
}

// ── RUTAS: SUBIDA DE IMÁGENES ────────────────────────────────
// POST /api/upload — sube archivos y devuelve URLs públicas
app.post('/api/upload', verificarToken, upload.array('archivos', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0)
      return res.status(400).json({ error: 'No se enviaron archivos' });
    const carpeta = req.body.carpeta || 'evidencia';
    const urls = await subirArchivos(req.files, carpeta);
    res.json({ urls });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── RUTAS: AUTH ──────────────────────────────────────────────

app.post('/api/auth/registro', async (req, res) => {
  try {
    const { nombre, email, password } = req.body;
    if (!nombre || !email || !password)
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    if (await Usuario.findOne({ email }))
      return res.status(409).json({ error: 'El email ya está registrado' });
    const hash = await bcrypt.hash(password, 12);
    await new Usuario({ nombre, email, password: hash }).save();
    res.status(201).json({ mensaje: 'Usuario registrado correctamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const usuario = await Usuario.findOne({ email });
    if (!usuario || !usuario.activo)
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    if (!await bcrypt.compare(password, usuario.password))
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    const token = jwt.sign(
      { id: usuario._id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ token, usuario: { nombre: usuario.nombre, email: usuario.email, rol: usuario.rol } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', verificarToken, (req, res) => {
  res.json({ usuario: req.usuario });
});

// ── RUTAS: GOOGLE OAUTH ──────────────────────────────────────

// Iniciar autenticación con Google
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

// Callback de Google
app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    // Generar JWT para el usuario autenticado
    const token = jwt.sign(
      { id: req.user._id, nombre: req.user.nombre, email: req.user.email, foto: req.user.foto, rol: req.user.rol },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    // Redirigir al frontend con el token
    res.redirect(`/?token=${token}`);
  }
);

// ── RUTAS: CASOS ─────────────────────────────────────────────

app.get('/api/casos', async (req, res) => {
  try {
    const filtro = {};
    if (req.query.categoria) filtro.categoria = req.query.categoria;
    if (req.query.estado)    filtro.estado    = req.query.estado;
    res.json(await Caso.find(filtro).sort({ fecha: -1 }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crea caso con texto + imágenes en un solo request (multipart/form-data)
app.post('/api/casos', upload.array('archivos', 10), async (req, res) => {
  try {
    const urls = req.files?.length > 0 ? await subirArchivos(req.files, 'evidencia') : [];
    const caso = new Caso({ ...req.body, evidencia: urls });
    await caso.save();
    res.status(201).json(caso);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/casos/:id', async (req, res) => {
  try {
    const caso = await Caso.findById(req.params.id);
    if (!caso) return res.status(404).json({ error: 'Caso no encontrado' });
    res.json(caso);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/casos/:id', verificarToken, soloAdmin, async (req, res) => {
  try {
    const caso = await Caso.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!caso) return res.status(404).json({ error: 'Caso no encontrado' });
    res.json(caso);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── RUTAS: DENUNCIAS ─────────────────────────────────────────

app.get('/api/denuncias', verificarToken, async (req, res) => {
  try {
    res.json(await Denuncia.find().sort({ fecha: -1 }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/denuncias', upload.array('archivos', 10), async (req, res) => {
  try {
    const urls = req.files?.length > 0 ? await subirArchivos(req.files, 'denuncias') : [];
    const denuncia = new Denuncia({ ...req.body, evidencia: urls });
    await denuncia.save();
    res.status(201).json(denuncia);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── RUTAS: GUÍAS TÉCNICAS ────────────────────────────────────

app.get('/api/guias', async (req, res) => {
  try {
    const filtro = { publicado: true };
    if (req.query.categoria) filtro.categoria = req.query.categoria;
    res.json(await Guia.find(filtro).sort({ fecha: -1 }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/guias/:id', async (req, res) => {
  try {
    const guia = await Guia.findById(req.params.id);
    if (!guia) return res.status(404).json({ error: 'Guía no encontrada' });
    res.json(guia);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/guias', verificarToken, soloAdmin, async (req, res) => {
  try {
    const guia = new Guia({ ...req.body, creadoPor: req.usuario.id });
    await guia.save();
    res.status(201).json(guia);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/guias/:id', verificarToken, soloAdmin, async (req, res) => {
  try {
    const guia = await Guia.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!guia) return res.status(404).json({ error: 'Guía no encontrada' });
    res.json(guia);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/guias/:id', verificarToken, soloAdmin, async (req, res) => {
  try {
    await Guia.findByIdAndDelete(req.params.id);
    res.json({ mensaje: 'Guía eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── RUTAS: NOTICIAS/ALERTAS ──────────────────────────────────

// GET /api/noticias — lista pública de noticias publicadas
app.get('/api/noticias', async (req, res) => {
  try {
    const filtro = { estado: 'publicado' };
    if (req.query.categoria) filtro.categoria = req.query.categoria;
    if (req.query.tag) filtro.tags = { $in: [req.query.tag] };
    const noticias = await Noticia.find(filtro)
      .populate('autor', 'nombre foto')
      .sort({ prioridad: -1, fechaPublicacion: -1 });
    res.json(noticias);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/noticias/:id — detalle de noticia
app.get('/api/noticias/:id', async (req, res) => {
  try {
    const noticia = await Noticia.findById(req.params.id).populate('autor', 'nombre foto');
    if (!noticia || noticia.estado !== 'publicado') return res.status(404).json({ error: 'Noticia no encontrada' });
    res.json(noticia);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/noticias — crear nueva noticia (editorial)
app.post('/api/noticias', verificarToken, soloAdmin, async (req, res) => {
  try {
    const noticia = new Noticia({ ...req.body, autor: req.usuario.id });
    await noticia.save();
    res.status(201).json(noticia);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/noticias/:id — editar noticia (editorial)
app.put('/api/noticias/:id', verificarToken, soloAdmin, async (req, res) => {
  try {
    const noticia = await Noticia.findById(req.params.id);
    if (!noticia) return res.status(404).json({ error: 'Noticia no encontrada' });
    // Guardar versión anterior
    noticia.versiones.push({
      version: noticia.version,
      contenido: noticia.contenido,
      autor: noticia.autor,
      fecha: noticia.actualizadoEn
    });
    noticia.version += 1;
    Object.assign(noticia, req.body);
    noticia.actualizadoEn = new Date();
    await noticia.save();
    res.json(noticia);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/noticias/:id — archivar noticia (editorial)
app.delete('/api/noticias/:id', verificarToken, soloAdmin, async (req, res) => {
  try {
    const noticia = await Noticia.findByIdAndUpdate(req.params.id, { estado: 'archivado' }, { new: true });
    if (!noticia) return res.status(404).json({ error: 'Noticia no encontrada' });
    res.json({ mensaje: 'Noticia archivada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/noticias/admin — lista para admin (todos los estados)
app.get('/api/noticias/admin', verificarToken, soloAdmin, async (req, res) => {
  try {
    const filtro = {};
    if (req.query.estado) filtro.estado = req.query.estado;
    const noticias = await Noticia.find(filtro)
      .populate('autor', 'nombre foto')
      .sort({ actualizadoEn: -1 });
    res.json(noticias);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── INICIO ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Servidor en http://localhost:${PORT}`);
  console.log('📦 MongoDB  → texto (casos, usuarios, guías, denuncias)');
  console.log('🖼️  Supabase → imágenes (evidencia y fotos)');
});
