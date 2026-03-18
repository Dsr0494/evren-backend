// server.js
require('dotenv').config(); 
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs'); 
const mongoose = require('mongoose');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');

const app = express();

// ==========================================
// 🛡️ 1. GUARDIA DE SEGURIDAD MANUAL (BYPASS TOTAL DE CORS)
// ==========================================
app.use((req, res, next) => {
  // Modo Espejo Absoluto: Deja pasar a quien sea que toque la puerta
  const origin = req.headers.origin;
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }
  
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');

  // Si es el "mensaje fantasma" (OPTIONS), le abrimos la puerta inmediatamente
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  next();
});

// ==========================================
// ⚙️ 2. CONFIGURACIONES BÁSICAS
// ==========================================
app.use(express.json({ limit: '50mb' })); 
const SECRET_KEY = process.env.SECRET_KEY || "clave_de_respaldo_segura"; 

// ==========================================
// 🚀 3. CONEXIÓN Y MODELOS DE MONGODB ATLAS
// ==========================================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('🔥 ¡Bóveda conectada! MongoDB Atlas en línea.'))
  .catch(err => console.error('❌ Error fatal al conectar a MongoDB:', err));

const Usuario = mongoose.model('Usuario', new mongoose.Schema({
  nombre: String,
  usuario: { type: String, unique: true },
  contrasenaEncriptada: String,
  categoria: String,
  organizacion: String,
  sucursal: String,
  nivelAcceso: String,
  dosPasosActivo: { type: Boolean, default: false },
  dosPasosSecreto: String
}));

const Venta = mongoose.model('Venta', new mongoose.Schema({}, { strict: false, timestamps: true }));
const Cotizacion = mongoose.model('Cotizacion', new mongoose.Schema({}, { strict: false, timestamps: true }));
const Traspaso = mongoose.model('Traspaso', new mongoose.Schema({}, { strict: false, timestamps: true }));
const Catalogo = mongoose.model('Catalogo', new mongoose.Schema({ tipo: String, data: Object }, { timestamps: true }));

// ==========================================
// 🚀 4. AUTO-POBLADOR DE USUARIOS (¡Recuperados!)
// ==========================================
const poblarUsuarios = async () => {
  const count = await Usuario.countDocuments();
  if (count === 0) {
    console.log("⏳ Subiendo usuarios a la nube por primera vez...");
    const usuariosBase = [
      { nombre: "LAURA BAUTISTA CONDE", usuario: "LB9748", contrasena: "A7k3$B91d2", categoria: "ED S&R GERENTE DE TIENDA", organizacion: "HD3 - EVREN VENTA NO PRESENCIAL", sucursal: "TELEMARKETING", nivelAcceso: "USUARIO" },
      { nombre: "DANIEL SANTANA ROSALES", usuario: "DS400G", contrasena: "0", categoria: "ED S&R GERENTE DE TIENDA", organizacion: "HZ9 - EVREN SAN PEDRO MARTIR CDMX", sucursal: "TIENDA", nivelAcceso: "ADMINISTRADOR" },
      { nombre: "CARLOS ALBERTO ROSAS GARCIA", usuario: "CR6501", contrasena: "kT9a3$M7Q2", categoria: "EJECUTIVO EMPRESARIAL", organizacion: "VENTA EMPRESARIAL", sucursal: "EMPRESAS", nivelAcceso: "USUARIO" }
    ];

    for (let u of usuariosBase) {
      const hash = bcrypt.hashSync(String(u.contrasena), 10);
      await Usuario.create({ ...u, contrasenaEncriptada: hash });
    }
    console.log("✅ ¡Usuarios subidos a MongoDB exitosamente!");
  }
};
poblarUsuarios();

// ==========================================
// 🚀 5. RUTAS DE 2FA (GOOGLE AUTHENTICATOR)
// ==========================================
app.post('/api/auth/2fa/setup', async (req, res) => {
  const { usuario } = req.body;
  const user = await Usuario.findOne({ usuario });
  if (!user) return res.status(404).json({ mensaje: "Usuario no encontrado." });

  const secret = speakeasy.generateSecret({ name: `Evren Corp (${user.usuario})` });
  
  user.dosPasosSecreto = secret.base32;
  await user.save();

  qrcode.toDataURL(secret.otpauth_url, (err, data_url) => {
    if (err) return res.status(500).json({ mensaje: "Error al generar el Código QR" });
    res.json({ secretoManual: secret.base32, qrCode: data_url });
  });
});

app.post('/api/auth/2fa/verify-setup', async (req, res) => {
  const { usuario, token2fa } = req.body;
  const user = await Usuario.findOne({ usuario });

  if (!user || !user.dosPasosSecreto) return res.status(400).json({ mensaje: "Configuración 2FA no iniciada." });

  const verificado = speakeasy.totp.verify({
    secret: user.dosPasosSecreto, encoding: 'base32', token: token2fa, window: 1 
  });

  if (verificado) {
    user.dosPasosActivo = true; 
    await user.save();
    res.json({ mensaje: "Autenticación de Dos Pasos activada exitosamente." });
  } else {
    res.status(400).json({ mensaje: "Código incorrecto. Intenta de nuevo." });
  }
});

// ==========================================
// 🚀 6. RUTAS DE AUTENTICACIÓN (LOGIN)
// ==========================================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { usuario, contrasena, sucursal, codigo2FA } = req.body;
    const user = await Usuario.findOne({ usuario });

    if (!user) return res.status(401).json({ mensaje: "Usuario o contraseña incorrectos." });

    const contrasenaValida = bcrypt.compareSync(String(contrasena), user.contrasenaEncriptada);
    if (!contrasenaValida) return res.status(401).json({ mensaje: "Usuario o contraseña incorrectos." });

    if (user.nivelAcceso !== "ADMINISTRADOR" && user.sucursal !== sucursal) {
      return res.status(403).json({ mensaje: `Acceso denegado al módulo ${sucursal}` });
    }

    if (user.dosPasosActivo) {
      if (!codigo2FA) return res.status(206).json({ requiere2FA: true, mensaje: "Ingresa tu código de Authenticator." });

      const tokenValido = speakeasy.totp.verify({
        secret: user.dosPasosSecreto, encoding: 'base32', token: codigo2FA, window: 1
      });
      if (!tokenValido) return res.status(401).json({ mensaje: "Código Authenticator incorrecto o expirado." });
    }

    const token = jwt.sign({ id: user.usuario, nivel: user.nivelAcceso }, SECRET_KEY, { expiresIn: '8h' });

    res.json({
      token: token,
      user: { nombre: user.nombre, nivelAcceso: user.nivelAcceso, organizacion: user.organizacion }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: "Error interno del servidor" });
  }
});

app.get('/api/usuarios', async (req, res) => {
  const usuarios = await Usuario.find({}, '-contrasenaEncriptada -dosPasosSecreto');
  res.json(usuarios);
});

// ==========================================
// 🚀 7. RUTAS DE VENTAS Y COTIZACIONES 
// ==========================================
app.get('/api/ventas', async (req, res) => {
    const ventas = await Venta.find().sort({ createdAt: -1 });
    res.json(ventas);
});

app.post('/api/ventas', async (req, res) => {
    try {
        const nuevaVenta = new Venta(req.body);
        await nuevaVenta.save();
        res.status(201).json({ message: "Venta guardada exitosamente", data: nuevaVenta });
    } catch (error) {
        res.status(500).json({ error: "Error al guardar venta en la nube" });
    }
});

app.get('/api/cotizaciones', async (req, res) => {
    const cotizaciones = await Cotizacion.find().sort({ createdAt: -1 });
    res.json(cotizaciones);
});

app.post('/api/cotizaciones', async (req, res) => {
    try {
        const nuevaCotizacion = new Cotizacion(req.body);
        await nuevaCotizacion.save();
        res.status(201).json({ message: "Cotización guardada", data: nuevaCotizacion });
    } catch (error) {
        res.status(500).json({ error: "Error al guardar cotización" });
    }
});

// ==========================================
// 🚀 8. RUTAS DE TRASPASOS Y CATÁLOGOS
// ==========================================
app.get('/api/traspasos', async (req, res) => {
  const traspasos = await Traspaso.find().sort({ createdAt: -1 });
  res.json(traspasos);
});

app.post('/api/traspasos', async (req, res) => {
  try {
    const nuevoTraspaso = new Traspaso({ fecha: new Date().toLocaleString('es-MX'), ...req.body });
    await nuevoTraspaso.save();
    res.status(201).json({ mensaje: 'Traspaso auditado correctamente.', registro: nuevoTraspaso });
  } catch (error) {
    res.status(500).json({ error: "Error al guardar traspaso" });
  }
});

app.post('/api/catalogos', async (req, res) => {
  const { tipo, data } = req.body;
  await Catalogo.findOneAndUpdate({ tipo }, { data }, { upsert: true });
  res.status(200).json({ exito: true, mensaje: `Catálogo ${tipo} actualizado en la nube.` });
});

app.get('/api/catalogos/:tipo', async (req, res) => {
  const { tipo } = req.params;
  const catalogo = await Catalogo.findOne({ tipo });
  if (catalogo) res.status(200).json(catalogo.data);
  else res.status(404).json({ mensaje: "Catálogo no encontrado." });
});

// ==========================================
// 🚀 INICIAR SERVIDOR
// ==========================================
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor Backend de Evren Corp corriendo en el puerto ${PORT}`);
});