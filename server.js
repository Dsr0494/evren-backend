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
  const origin = req.headers.origin;
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }
  
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(express.json({ limit: '50mb' })); 

// ==========================================
// 🚀 CONEXIÓN A LA NUBE (MONGODB ATLAS)
// ==========================================
if (!process.env.MONGO_URI) {
  console.error('❌ FATAL: MONGO_URI no está definido en el archivo .env o en las variables de entorno de Render.');
  process.exit(1);
}

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('🔥 ¡Bóveda conectada! MongoDB Atlas en línea.'))
  .catch(err => console.error('❌ Error fatal al conectar a MongoDB:', err));

// ==========================================
// 📦 MODELOS DE MONGODB (Esquemas Flexibles)
// ==========================================
const catalogoSchema = new mongoose.Schema({ tipo: String, data: mongoose.Schema.Types.Mixed });
const Catalogo = mongoose.model('Catalogo', catalogoSchema);

const ventaSchema = new mongoose.Schema({}, { strict: false, timestamps: true });
const Venta = mongoose.model('Venta', ventaSchema);

const cotizacionSchema = new mongoose.Schema({}, { strict: false, timestamps: true });
const Cotizacion = mongoose.model('Cotizacion', cotizacionSchema);

const traspasoSchema = new mongoose.Schema({}, { strict: false, timestamps: true });
const Traspaso = mongoose.model('Traspaso', traspasoSchema);


// ==========================================
// BASE DE DATOS LOCAL (CONTRASEÑAS UNIFICADAS Y SUCURSALES EXACTAS)
// ==========================================
const usuariosDB = [
  { nombre: "LAURA BAUTISTA CONDE", usuario: "LB9748", contrasena: "12345", categoria: "ED S&R GERENTE DE TIENDA", organizacion: "HD3 - EVREN VENTA NO PRESENCIAL", sucursal: "TELEMARKETING", nivelAcceso: "USUARIO" },
  { nombre: "LAURA GALEANA VALENCIANA", usuario: "LG220B", contrasena: "12345", categoria: "ED S&R EJECUTIVO UNIVERSAL", organizacion: "HD3 - EVREN VENTA NO PRESENCIAL", sucursal: "TELEMARKETING", nivelAcceso: "USUARIO" },
  { nombre: "JOSE ADRIAN FUENTES MENDIOLA", usuario: "JF2778", contrasena: "12345", categoria: "ED S&R GERENTE DE TIENDA", organizacion: "HD3 - EVREN VENTA NO PRESENCIAL", sucursal: "TELEMARKETING", nivelAcceso: "USUARIO" },
  { nombre: "MARCIA ELENA SUAREZ ROSALES", usuario: "MX5476", contrasena: "12345", categoria: "ED S&R EJECUTIVO UNIVERSAL", organizacion: "HD3 - EVREN VENTA NO PRESENCIAL", sucursal: "TELEMARKETING", nivelAcceso: "USUARIO" },
  { nombre: "EDGAR JAVIER IBARRA FUENTES", usuario: "EI7886", contrasena: "12345", categoria: "ED S&R EJECUTIVO UNIVERSAL", organizacion: "IF2 - EVREN PLAZA VIA SAN JUAN CDMX", sucursal: "TIENDA", nivelAcceso: "USUARIO" },
  { nombre: "LESLIE GUADALUPE LUNA VILLEGAS", usuario: "LL3908", contrasena: "12345", categoria: "ED S&R EJECUTIVO UNIVERSAL", organizacion: "IF2 - EVREN PLAZA VIA SAN JUAN CDMX", sucursal: "TIENDA", nivelAcceso: "USUARIO" },
  { nombre: "MARIANA VANESSA ESPINOSA LAGUNAS", usuario: "ME5986", contrasena: "12345", categoria: "ED S&R EJECUTIVO UNIVERSAL", organizacion: "IF2 - EVREN PLAZA VIA SAN JUAN CDMX", sucursal: "TIENDA", nivelAcceso: "USUARIO" },
  { nombre: "MARTHA LUCIA URIBE ROSAS", usuario: "MU8925", contrasena: "12345", categoria: "ED S&R EJECUTIVO UNIVERSAL", organizacion: "IF2 - EVREN PLAZA VIA SAN JUAN CDMX", sucursal: "TIENDA", nivelAcceso: "USUARIO" },
  { nombre: "MIGUEL RODRIGO FLORES GONZALEZ", usuario: "MF5730", contrasena: "12345", categoria: "ED S&R GERENTE DE TIENDA", organizacion: "IF2 - EVREN PLAZA VIA SAN JUAN CDMX", sucursal: "TIENDA", nivelAcceso: "USUARIO" },
  { nombre: "ABIGAIL ALBERTO VILLANUEVA", usuario: "AA544V", contrasena: "12345", categoria: "ED S&R EJECUTIVO UNIVERSAL", organizacion: "GC8 - EVREN TLAHUAC CENTRO", sucursal: "TIENDA", nivelAcceso: "USUARIO" },
  { nombre: "CARLOS ALEXANDER CALDERON LOPEZ", usuario: "CC534D", contrasena: "12345", categoria: "ED S&R EJECUTIVO UNIVERSAL", organizacion: "ED1 - EVREN XOCHIMILCO CENTRO", sucursal: "TIENDA", nivelAcceso: "USUARIO" },
  { nombre: "DANIEL SANTANA ROSALES", usuario: "DS400G", contrasena: "0", categoria: "ED S&R GERENTE DE TIENDA", organizacion: "HZ9 - EVREN SAN PEDRO MARTIR CDMX", sucursal: "TIENDA", nivelAcceso: "ADMINISTRADOR" },
  { nombre: "GABRIEL CORIA SEGURA", usuario: "GC1480", contrasena: "12345", categoria: "ED S&R GERENTE DE TIENDA", organizacion: "HZ9 - EVREN SAN PEDRO MARTIR CDMX", sucursal: "TIENDA", nivelAcceso: "USUARIO" },
  { nombre: "JESUS GALEANA VALENCIANA", usuario: "JG215P", contrasena: "12345", categoria: "ED S&R GERENTE DE TIENDA", organizacion: "ED1 - EVREN XOCHIMILCO CENTRO", sucursal: "TIENDA", nivelAcceso: "USUARIO" },
  { nombre: "JONATHAN CARRASCO CRUZ", usuario: "JO5517", contrasena: "12345", categoria: "ED S&R GERENTE DE TIENDA", organizacion: "HT5 - EVREN CORP TULANCINGO HGO", sucursal: "TIENDA", nivelAcceso: "USUARIO" },
  { nombre: "MARCO ANTONIO LUCERO HERNANDEZ", usuario: "ML069A", contrasena: "12345", categoria: "ED S&R GERENTE DE TIENDA", organizacion: "HT9 - EVREN PEDREGAL DE SAN NICOLAS CDMX", sucursal: "TIENDA", nivelAcceso: "USUARIO" },
  { nombre: "MAYRA JAZMIN MAR CRUZ", usuario: "MM877B", contrasena: "12345", categoria: "ED S&R GERENTE DE TIENDA", organizacion: "GC8 - EVREN TLAHUAC CENTRO", sucursal: "TIENDA", nivelAcceso: "USUARIO" },
  { nombre: "SHARON MICHELLE ARROYO MARTINEZ", usuario: "SA9485", contrasena: "12345", categoria: "ED S&R GERENTE DE TIENDA", organizacion: "ED1 - EVREN XOCHIMILCO CENTRO", sucursal: "TIENDA", nivelAcceso: "USUARIO" },
  { nombre: "ANGEL ROSAS HERNANDEZ", usuario: "AR788A", contrasena: "12345", categoria: "ED S&R GERENTE DE TIENDA", organizacion: "HD3 - EVREN VENTA NO PRESENCIAL", sucursal: "TELEMARKETING", nivelAcceso: "USUARIO" },
  { nombre: "ESAU ROSALES TINOCO", usuario: "ER1982", contrasena: "12345", categoria: "ED S&R EJECUTIVO UNIVERSAL", organizacion: "HD3 - EVREN VENTA NO PRESENCIAL", sucursal: "TELEMARKETING", nivelAcceso: "USUARIO" },
  { nombre: "OWEN GAEL CARBAJAL GONZALEZ", usuario: "OC8710", contrasena: "12345", categoria: "ED S&R EJECUTIVO UNIVERSAL", organizacion: "HD3 - EVREN VENTA NO PRESENCIAL", sucursal: "TELEMARKETING", nivelAcceso: "USUARIO" },
  { nombre: "CARLOS ALBERTO ROSAS GARCIA", usuario: "CR6501", contrasena: "12345", categoria: "EJECUTIVO EMPRESARIAL", organizacion: "VENTA EMPRESARIAL", sucursal: "EMPRESAS", nivelAcceso: "USUARIO" }
];

usuariosDB.forEach(user => {
  user.contrasenaEncriptada = bcrypt.hashSync(String(user.contrasena), 10);
  user.dosPasosActivo = false; 
  user.dosPasosSecreto = null; 
});

const SECRET_KEY = process.env.SECRET_KEY || "clave_de_respaldo_segura"; 

// ==========================================
// 🚀 RUTAS DE 2FA (GOOGLE AUTHENTICATOR)
// ==========================================
app.post('/api/auth/2fa/setup', (req, res) => {
  const { usuario } = req.body;
  const user = usuariosDB.find(u => u.usuario === usuario);
  
  if (!user) return res.status(404).json({ mensaje: "Usuario no encontrado." });

  const secret = speakeasy.generateSecret({
    name: `Evren Corp (${user.usuario})`
  });

  user.dosPasosSecreto = secret.base32;

  qrcode.toDataURL(secret.otpauth_url, (err, data_url) => {
    if (err) return res.status(500).json({ mensaje: "Error al generar el Código QR" });
    
    res.json({
      secretoManual: secret.base32,
      qrCode: data_url
    });
  });
});

app.post('/api/auth/2fa/verify-setup', (req, res) => {
  const { usuario, token2fa } = req.body;
  const user = usuariosDB.find(u => u.usuario === usuario);

  if (!user || !user.dosPasosSecreto) {
    return res.status(400).json({ mensaje: "Configuración 2FA no iniciada." });
  }

  const verificado = speakeasy.totp.verify({
    secret: user.dosPasosSecreto,
    encoding: 'base32',
    token: token2fa,
    window: 1 
  });

  if (verificado) {
    user.dosPasosActivo = true; 
    res.json({ mensaje: "Autenticación de Dos Pasos activada exitosamente." });
  } else {
    res.status(400).json({ mensaje: "Código incorrecto. Intenta de nuevo." });
  }
});

// ==========================================
// RUTAS DE AUTENTICACIÓN (LOGIN BLINDADO)
// ==========================================
app.post('/api/auth/login', (req, res) => {
  setTimeout(() => {
    const { usuario, contrasena, sucursal, codigo2FA } = req.body;
    
    // 🛡️ Blindaje 1: Quitamos espacios fantasma y forzamos mayúsculas
    const cleanUser = String(usuario).trim().toUpperCase();
    const user = usuariosDB.find(u => u.usuario === cleanUser);

    if (!user) return res.status(401).json({ mensaje: "Usuario no encontrado." });

    // 🛡️ Blindaje 2: Comparamos la contraseña eliminando espacios accidentales
    const contrasenaValida = bcrypt.compareSync(String(contrasena).trim(), user.contrasenaEncriptada);

    if (!contrasenaValida) return res.status(401).json({ mensaje: "Contraseña incorrecta." });

    if (user.nivelAcceso !== "ADMINISTRADOR" && user.sucursal !== sucursal) {
      return res.status(403).json({ mensaje: `Acceso denegado al módulo ${sucursal}` });
    }

    if (user.dosPasosActivo) {
      if (!codigo2FA) {
        return res.status(206).json({ requiere2FA: true, mensaje: "Ingresa tu código de Authenticator." });
      }

      const tokenValido = speakeasy.totp.verify({
        secret: user.dosPasosSecreto,
        encoding: 'base32',
        token: codigo2FA,
        window: 1
      });

      if (!tokenValido) {
        return res.status(401).json({ mensaje: "Código Authenticator incorrecto o expirado." });
      }
    }

    const token = jwt.sign(
      { id: user.usuario, nivel: user.nivelAcceso }, 
      SECRET_KEY, 
      { expiresIn: '8h' } 
    );

    res.json({
      token: token,
      user: {
        nombre: user.nombre,
        nivelAcceso: user.nivelAcceso,
        organizacion: user.organizacion,
        sucursal: user.sucursal
      }
    });
  }, 800);
});

// ==========================================
// RUTA PARA ADMINISTRACIÓN DE USUARIOS
// ==========================================
app.get('/api/usuarios', (req, res) => {
  const usuariosSeguros = usuariosDB.map(user => {
    const { contrasena, contrasenaEncriptada, dosPasosSecreto, ...datosPublicos } = user;
    return datosPublicos;
  });
  res.json(usuariosSeguros);
});

// ==========================================
// 🚀 RUTAS PARA CATÁLOGOS (AHORA EN MONGODB)
// ==========================================
app.post('/api/catalogos', async (req, res) => {
  const { tipo, data } = req.body;
  if (!tipo || !data) return res.status(400).json({ mensaje: "Faltan datos o el tipo de catálogo." });

  try {
      await Catalogo.findOneAndUpdate(
        { tipo: tipo }, 
        { tipo: tipo, data: data }, 
        { upsert: true, new: true }
      );
      console.log(`[Evren Corp API] Catálogo '${tipo}' blindado en MongoDB.`);
      res.status(200).json({ exito: true, mensaje: `Catálogo ${tipo} sincronizado en la Nube.` });
  } catch (error) {
      console.error("Error al guardar el catálogo en Mongo:", error);
      res.status(500).json({ mensaje: "Error interno al guardar en el servidor." });
  }
});

app.get('/api/catalogos/:tipo', async (req, res) => {
  try {
      const catalogo = await Catalogo.findOne({ tipo: req.params.tipo });
      if (catalogo) {
          res.status(200).json(catalogo.data);
      } else {
          res.status(404).json({ mensaje: "Catálogo no encontrado en MongoDB." });
      }
  } catch (error) {
      res.status(500).json({ error: "Error al buscar catálogo" });
  }
});

// ==========================================================================
// 🚀 RUTAS DE VENTAS Y COTIZACIONES (AHORA EN MONGODB)
// ==========================================================================
app.get('/api/ventas', async (req, res) => {
    try {
        const ventas = await Venta.find().sort({ _id: -1 }); 
        res.json(ventas);
    } catch (error) {
        res.status(500).json({ error: "Error al obtener ventas" });
    }
});

app.get('/api/cotizaciones', async (req, res) => {
    try {
        const cotizaciones = await Cotizacion.find().sort({ _id: -1 });
        res.json(cotizaciones);
    } catch (error) {
        res.status(500).json({ error: "Error al obtener cotizaciones" });
    }
});

app.post('/api/ventas', async (req, res) => {
    try {
        const nuevaVenta = new Venta(req.body);
        await nuevaVenta.save();
        console.log("✅ Venta registrada PERMANENTEMENTE en MongoDB:", req.body.idVenta);
        res.status(201).json({ message: "Venta guardada exitosamente", data: nuevaVenta });
    } catch (error) {
        console.error("Error al guardar venta:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

app.post('/api/cotizaciones', async (req, res) => {
    try {
        const nuevaCotizacion = new Cotizacion(req.body);
        await nuevaCotizacion.save();
        console.log("📄 Cotización guardada PERMANENTEMENTE en MongoDB:", req.body.idVenta);
        res.status(201).json({ message: "Cotización guardada", data: nuevaCotizacion });
    } catch (error) {
        console.error("Error al guardar cotización:", error);
        res.status(500).json({ error: "Error al guardar cotización" });
    }
});

// ==========================================================================
// 🚀 HISTORIAL DE TRASPASOS (AHORA EN MONGODB)
// ============================================================================
app.get('/api/traspasos', async (req, res) => {
  try {
      const historial = await Traspaso.find().sort({ _id: -1 });
      res.json(historial);
  } catch (error) {
      res.status(500).json({ error: "Error al obtener traspasos" });
  }
});

app.post('/api/traspasos', async (req, res) => {
  try {
      const registroFinal = { id: Date.now(), fecha: new Date().toLocaleString('es-MX'), ...req.body };
      const nuevoTraspaso = new Traspaso(registroFinal);
      await nuevoTraspaso.save();
      res.status(201).json({ mensaje: 'Traspaso auditado en MongoDB.', registro: registroFinal });
  } catch (error) {
      res.status(500).json({ error: "Error al guardar traspaso" });
  }
});

// ==========================================
// INICIAR SERVIDOR
// ==========================================
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor Backend de Evren Corp corriendo en el puerto ${PORT}`);
});