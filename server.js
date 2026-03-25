require('dotenv').config();
const dns = require('node:dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs'); 
const mongoose = require('mongoose'); 
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');

const upload = multer({ dest: 'uploads/' }); 
const express = require('express');
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ==========================================
// 🛡️ GUARDIA DE SEGURIDAD MANUAL (CORS)
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

// ==========================================
// 📦 MODELOS DE MONGODB
// ==========================================
const catalogoSchema = new mongoose.Schema({ tipo: String, data: mongoose.Schema.Types.Mixed });
const Catalogo = mongoose.model('Catalogo', catalogoSchema);

const ventaSchema = new mongoose.Schema({}, { strict: false, timestamps: true });
const Venta = mongoose.model('Venta', ventaSchema);

const cotizacionSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true }
}, { strict: false, timestamps: true });
const Cotizacion = mongoose.model('Cotizacion', cotizacionSchema);

const traspasoSchema = new mongoose.Schema({}, { strict: false, timestamps: true });
const Traspaso = mongoose.model('Traspaso', traspasoSchema);

const perfilSchema = new mongoose.Schema({
  usuario: { type: String, required: true, unique: true },
  avatar: { type: String } 
});
const Perfil = mongoose.models.Perfil || mongoose.model('Perfil', perfilSchema);

const equipoSchema = new mongoose.Schema({
  imei: { type: String, required: true, unique: true },
  modelo: { type: String, required: true },
  marca: { type: String },
  sku: { type: String },
  iccid: { type: String }, 
  proveedor: { type: String },
  referencia: { type: String },
  folioCompra: { type: String },
  sucursal: { type: String, default: 'GENERAL' },
  estado: { type: String, default: 'Disponible' },
  fechaIngreso: { type: String },
  fechaRegistro: { type: Date, default: Date.now }
});
const Equipo = mongoose.models.Equipo || mongoose.model('Equipo', equipoSchema);

const simSchema = new mongoose.Schema({
  icc: { type: String, required: true, unique: true },
  tipo: { type: String, default: 'SIM' },
  modelo: { type: String },
  sku: { type: String },
  proveedor: { type: String },
  referencia: { type: String },
  folioCompra: { type: String },
  sucursal: { type: String, default: 'GENERAL' },
  estado: { type: String, default: 'Disponible' },
  fechaIngreso: { type: String },
  fechaRegistro: { type: Date, default: Date.now }
});
const Sim = mongoose.models.Sim || mongoose.model('Sim', simSchema);

const usuarioSchema = new mongoose.Schema({
  nombre: { type: String, required: true, uppercase: true },
  usuario: { type: String, required: true, unique: true, uppercase: true },
  contrasenaEncriptada: { type: String, required: true },
  categoria: { type: String, required: true, uppercase: true },
  organizacion: { type: String, required: true, uppercase: true },
  sucursal: { type: String, required: true, uppercase: true },
  nivelAcceso: { type: String, required: true, uppercase: true, enum: ['ADMINISTRADOR', 'USUARIO'] },
  dosPasosActivo: { type: Boolean, default: false },
  dosPasosSecreto: { type: String, default: null },
  activo: { type: Boolean, default: true }, 
  fechaCreacion: { type: Date, default: Date.now }
});
const Usuario = mongoose.models.Usuario || mongoose.model('Usuario', usuarioSchema);

const SECRET_KEY = process.env.SECRET_KEY || "clave_de_respaldo_segura"; 

// ==========================================================================
// 🚀 RUTAS DE 2FA Y LOGIN 
// ==========================================================================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { usuario, contrasena, sucursal, codigo2FA } = req.body;
    const cleanUser = String(usuario).trim().toUpperCase();
    
    const user = await Usuario.findOne({ usuario: cleanUser, activo: true });
    
    if (!user) return res.status(401).json({ mensaje: "Usuario no encontrado o inactivo." });
    
    const contrasenaValida = bcrypt.compareSync(String(contrasena).trim(), user.contrasenaEncriptada);
    if (!contrasenaValida) return res.status(401).json({ mensaje: "Contraseña incorrecta." });
    
    if (user.nivelAcceso !== "ADMINISTRADOR" && user.sucursal !== sucursal) {
      const esMesaControl = user.sucursal && user.sucursal.includes("MESA DE CONTROL");
      if (!esMesaControl) {
        return res.status(403).json({ mensaje: `Acceso denegado al módulo ${sucursal}` });
      }
    }
    
    if (user.dosPasosActivo) {
      if (!codigo2FA) return res.status(206).json({ requiere2FA: true, mensaje: "Ingresa tu código de Authenticator." });
      const tokenValido = speakeasy.totp.verify({ secret: user.dosPasosSecreto, encoding: 'base32', token: codigo2FA, window: 1 });
      if (!tokenValido) return res.status(401).json({ mensaje: "Código Authenticator incorrecto o expirado." });
    }
    
    const token = jwt.sign({ id: user.usuario, nivel: user.nivelAcceso }, SECRET_KEY, { expiresIn: '8h' });
    
    res.json({ 
      token: token, 
      user: { 
        nombre: user.nombre, 
        nivelAcceso: user.nivelAcceso, 
        organizacion: user.organizacion, 
        sucursal: user.sucursal, 
        dosPasosActivo: user.dosPasosActivo 
      } 
    });
  } catch (error) {
    console.error("Error en login:", error);
    res.status(500).json({ mensaje: "Error interno del servidor." });
  }
});

app.post('/api/auth/2fa/disable', async (req, res) => {
  try {
    const { usuario, contrasena } = req.body;
    const user = await Usuario.findOne({ usuario: String(usuario).toUpperCase() });
    if (!user) return res.status(404).json({ mensaje: "Usuario no encontrado" });

    const valida = bcrypt.compareSync(contrasena, user.contrasenaEncriptada);
    if (!valida) return res.status(401).json({ mensaje: "Contraseña incorrecta." });

    user.dosPasosActivo = false;
    user.dosPasosSecreto = null;
    await user.save();
    res.json({ mensaje: "Seguridad 2FA desactivada." });
  } catch (error) { 
    res.status(500).json({ mensaje: "Error del servidor." }); 
  }
});

// ==========================================================================
// 👥 RUTAS DE ADMINISTRACIÓN DE USUARIOS (CRUD)
// ==========================================================================
app.get('/api/usuarios', async (req, res) => {
  try {
    const usuarios = await Usuario.find({ activo: true }).select('-contrasenaEncriptada -dosPasosSecreto').sort({ fechaCreacion: -1 });
    res.json(usuarios);
  } catch (error) { res.status(500).json({ mensaje: "Error al obtener usuarios." }); }
});

app.post('/api/usuarios', async (req, res) => {
  try {
    const { nombre, usuario, contrasena, categoria, organizacion, sucursal, nivelAcceso } = req.body;
    const existe = await Usuario.findOne({ usuario: String(usuario).toUpperCase() });
    if (existe) return res.status(400).json({ mensaje: "El ID de usuario ya está en uso." });

    const contrasenaEncriptada = bcrypt.hashSync(String(contrasena).trim(), 10);
    const nuevoUsuario = new Usuario({ nombre, usuario, contrasenaEncriptada, categoria, organizacion, sucursal, nivelAcceso });
    await nuevoUsuario.save();
    
    const usuarioSafe = nuevoUsuario.toObject();
    delete usuarioSafe.contrasenaEncriptada;
    delete usuarioSafe.dosPasosSecreto;
    res.status(201).json(usuarioSafe);
  } catch (error) { res.status(500).json({ mensaje: "Error al crear el usuario." }); }
});

app.put('/api/usuarios/:id', async (req, res) => {
  try {
    const { nombre, contrasena, categoria, organizacion, sucursal, nivelAcceso } = req.body;
    const usuarioId = String(req.params.id).toUpperCase();
    const updateData = { nombre, categoria, organizacion, sucursal, nivelAcceso };

    if (contrasena && contrasena.trim() !== "") updateData.contrasenaEncriptada = bcrypt.hashSync(String(contrasena).trim(), 10);

    const usuarioActualizado = await Usuario.findOneAndUpdate( { usuario: usuarioId }, { $set: updateData }, { new: true } ).select('-contrasenaEncriptada -dosPasosSecreto');
    if (!usuarioActualizado) return res.status(404).json({ mensaje: "Usuario no encontrado." });
    res.json(usuarioActualizado);
  } catch (error) { res.status(500).json({ mensaje: "Error al actualizar el usuario." }); }
});

app.delete('/api/usuarios/:id', async (req, res) => {
  try {
    const usuarioId = String(req.params.id).toUpperCase();
    const usuarioEliminado = await Usuario.findOneAndUpdate( { usuario: usuarioId }, { $set: { activo: false } }, { new: true } );
    if (!usuarioEliminado) return res.status(404).json({ mensaje: "Usuario no encontrado." });
    res.json({ mensaje: "Usuario eliminado correctamente." });
  } catch (error) { res.status(500).json({ mensaje: "Error al eliminar el usuario." }); }
});

// ==========================================
// 📸 RUTAS DE PERFIL, AVATARES Y PASSWORD
// ==========================================
app.post('/api/perfil/password', async (req, res) => {
  try {
    const { usuario, passActual, passNueva } = req.body;
    const user = await Usuario.findOne({ usuario: String(usuario).toUpperCase() });
    if (!user) return res.status(404).json({ mensaje: "Usuario no encontrado" });

    const valida = bcrypt.compareSync(passActual, user.contrasenaEncriptada);
    if (!valida) return res.status(401).json({ mensaje: "La contraseña actual es incorrecta." });

    user.contrasenaEncriptada = bcrypt.hashSync(passNueva, 10);
    await user.save();
    res.json({ mensaje: "Contraseña actualizada exitosamente." });
  } catch (error) { res.status(500).json({ mensaje: "Error del servidor." }); }
});

app.post('/api/perfil/avatar', async (req, res) => {
  try {
    const { usuario, avatar } = req.body;
    if (!usuario) return res.status(400).json({ mensaje: "Falta el usuario" });
    await Perfil.findOneAndUpdate({ usuario: String(usuario).toUpperCase() }, { usuario: String(usuario).toUpperCase(), avatar: avatar || "" }, { upsert: true, new: true });
    res.status(200).json({ mensaje: "Avatar actualizado exitosamente en MongoDB" });
  } catch (error) { res.status(500).json({ mensaje: "Error interno del servidor" }); }
});

app.get('/api/perfil/avatar/:usuario', async (req, res) => {
  try {
    const perfil = await Perfil.findOne({ usuario: String(req.params.usuario).toUpperCase() });
    if (!perfil || !perfil.avatar) return res.status(404).json({ mensaje: "No hay foto" });
    res.status(200).json({ avatar: perfil.avatar });
  } catch (error) { res.status(500).json({ mensaje: "Error interno" }); }
});

// ==========================================
// 🚀 RUTAS DE CATÁLOGOS Y VENTAS
// ==========================================
app.post('/api/catalogos', async (req, res) => {
  const { tipo, data } = req.body;
  if (!tipo || !data) return res.status(400).json({ mensaje: "Faltan datos o el tipo de catálogo." });
  try { await Catalogo.findOneAndUpdate({ tipo: tipo }, { tipo: tipo, data: data }, { upsert: true, new: true }); res.status(200).json({ exito: true, mensaje: `Catálogo ${tipo} sincronizado en la Nube.` }); } catch (error) { res.status(500).json({ mensaje: "Error interno." }); }
});

app.get('/api/catalogos/:tipo', async (req, res) => {
  try { const catalogo = await Catalogo.findOne({ tipo: req.params.tipo }); if (catalogo) res.status(200).json(catalogo.data); else res.status(404).json({ mensaje: "Catálogo no encontrado." }); } catch (error) { res.status(500).json({ error: "Error al buscar catálogo" }); }
});

app.get('/api/ventas', async (req, res) => { try { const ventas = await Venta.find().sort({ _id: -1 }); res.json(ventas); } catch (error) { res.status(500).json({ error: "Error al obtener ventas" }); } });

app.post('/api/ventas', async (req, res) => { try { const nuevaVenta = new Venta(req.body); await nuevaVenta.save(); res.status(201).json({ message: "Venta guardada", data: nuevaVenta }); } catch (error) { res.status(500).json({ error: "Error al guardar venta" }); } });

// ==========================================
// 🚀 RUTAS DE COTIZACIONES (MESA DE CONTROL)
// ==========================================

// 🚀 FIX: ESTA ES LA RUTA NUEVA, LIGERA Y OPTIMIZADA PARA MESA DE CONTROL
app.get('/api/cotizaciones', async (req, res) => { 
  try { 
      // Seleccionamos TODO EXCEPTO los campos Base64 pesados.
      const cotizacionesLigeras = await Cotizacion.find({}, {
          'datos.identificacionBase64': 0,
          'datos.comprobanteBase64': 0,
          'datos.fichaPagoBase64': 0,
          'paqueteMesa.contrato.base64': 0,
          'paqueteMesa.buro.base64': 0,
          'paqueteMesa.responsabilidad.base64': 0,
          'paqueteMesa.resumen.base64': 0,
          'paqueteMesa.qrPago.base64': 0,
          'paqueteMesa.pagoFormal.base64': 0,
          'datos.paqueteFirmadoVendedor.contrato.base64': 0,
          'datos.paqueteFirmadoVendedor.buro.base64': 0,
          'datos.paqueteFirmadoVendedor.responsabilidad.base64': 0,
          'datos.paqueteFirmadoVendedor.resumen.base64': 0,
      }).sort({ _id: -1 }); 
      res.json(cotizacionesLigeras); 
  } 
  catch (error) { res.status(500).json({ error: "Error al obtener cotizaciones" }); } 
});

// 🚀 FIX: ESTA RUTA NUEVA SE USARÁ SOLO CUANDO LE DEN CLIC AL TRÁMITE PARA VER LOS PDFs
app.get('/api/cotizaciones/detalle/:id', async (req, res) => {
    try {
        const { id } = req.params;
        let condicionesBusqueda = [ { id: id }, { folio: id }, { 'datos.id': id }, { 'datos.folio': id } ];
        if (/^[0-9a-fA-F]{24}$/.test(id)) { condicionesBusqueda.push({ _id: new mongoose.Types.ObjectId(id) }); }
        
        const cotizacionCompleta = await Cotizacion.findOne({ $or: condicionesBusqueda });
        if (!cotizacionCompleta) return res.status(404).json({ mensaje: "Trámite no encontrado." });
        
        res.status(200).json(cotizacionCompleta);
    } catch (error) {
        res.status(500).json({ error: "Error al obtener detalles de la cotización." });
    }
});

app.post('/api/cotizaciones', async (req, res) => { 
  try { 
    const nuevaCotizacion = new Cotizacion({ ...req.body, id: req.body.id || req.body.folio }); 
    await nuevaCotizacion.save(); 
    res.status(201).json({ message: "Cotización guardada", data: nuevaCotizacion }); 
  } 
  catch (error) { res.status(500).json({ error: "Error al guardar cotización" }); } 
});

app.put('/api/cotizaciones/:id', async (req, res) => {
  try {
      const { id } = req.params;
      
      let condicionesBusqueda = [
          { id: id },
          { folio: id },
          { 'datos.id': id },
          { 'datos.folio': id }
      ];
      
      if (/^[0-9a-fA-F]{24}$/.test(id)) {
          condicionesBusqueda.push({ _id: new mongoose.Types.ObjectId(id) });
      }

      const cotizacionActualizada = await Cotizacion.findOneAndUpdate(
          { $or: condicionesBusqueda },
          { $set: req.body },
          { new: true }
      );

      if (!cotizacionActualizada) {
          return res.status(404).json({ mensaje: "Trámite no encontrado en la base de datos." });
      }

      res.status(200).json({ message: "Cotización actualizada exitosamente", data: cotizacionActualizada });
  } catch (error) {
      console.error("Error al actualizar cotización:", error);
      res.status(500).json({ error: "Error interno del servidor" });
  }
});


// ==========================================
// 📦 RUTAS DE INVENTARIO (NUBE)
// ==========================================
app.get('/api/inventario/equipos', async (req, res) => {
  try { const equipos = await Equipo.find().sort({ fechaRegistro: -1 }); res.json(equipos); } catch (error) { res.status(500).json({ error: "Error al obtener equipos" }); }
});

app.get('/api/inventario/sims', async (req, res) => {
  try { const sims = await Sim.find().sort({ fechaRegistro: -1 }); res.json(sims); } catch (error) { res.status(500).json({ error: "Error al obtener sims" }); }
});

app.put('/api/inventario/bulk-update', async (req, res) => {
  try {
    const { articulos, estado, sucursal } = req.body;
    const imeis = articulos.filter(a => a.tipo === 'equipos').map(a => a.id);
    const iccs = articulos.filter(a => a.tipo === 'sims').map(a => a.id);
    const updateData = { estado };
    if (sucursal) updateData.sucursal = sucursal;
    if (imeis.length > 0) await Equipo.updateMany({ imei: { $in: imeis } }, { $set: updateData });
    if (iccs.length > 0) await Sim.updateMany({ icc: { $in: iccs } }, { $set: updateData });
    res.json({ success: true, mensaje: "Inventario sincronizado exitosamente." });
  } catch (error) {
    console.error("Error en bulk-update:", error);
    res.status(500).json({ error: 'Error al actualizar el inventario en la base de datos.' });
  }
});

app.put('/api/inventario/articulo', async (req, res) => {
  try {
    const { id, tipo, estado } = req.body;
    if (tipo === 'equipos') await Equipo.findOneAndUpdate({ imei: id }, { estado });
    else await Sim.findOneAndUpdate({ icc: id }, { estado });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar el artículo.' });
  }
});

// ==========================================
// 🛒 RUTAS DE COMPRAS CENTRALIZADAS
// ==========================================
app.post('/api/inventario/cargar-csv', upload.single('archivoCsv'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Falta el archivo CSV.' });
  
  const tipoArticulo = req.body.tipo || 'equipos'; 
  const usuarioCarga = req.body.usuarioCarga || 'SISTEMA';
  const filasDelCsv = []; 
  let numeroFila = 1;
  
  fs.createReadStream(req.file.path).pipe(csv()).on('data', (fila) => filasDelCsv.push({ filaNum: ++numeroFila, ...fila })).on('end', async () => {
    fs.unlinkSync(req.file.path); const resultadosExitosos = []; const filasConError = [];
    
    for (const item of filasDelCsv) {
        const { filaNum, imei, icc, modelo, iccid } = item;
        try {
            if (tipoArticulo === 'equipos') {
                if (!imei || !modelo) { filasConError.push({ fila: filaNum, error: 'Falta IMEI o Modelo' }); continue; }
                const nuevoEquipo = new Equipo({ imei, modelo, iccid }); await nuevoEquipo.save(); resultadosExitosos.push(nuevoEquipo);
            } else if (tipoArticulo === 'sims') {
                const simIcc = icc || iccid; if (!simIcc) { filasConError.push({ fila: filaNum, error: 'Falta el ICC' }); continue; }
                const nuevaSim = new Sim({ icc: simIcc }); await nuevaSim.save(); resultadosExitosos.push(nuevaSim);
            }
        } catch (errorDb) {
            if (errorDb.code === 11000) filasConError.push({ fila: filaNum, error: 'Duplicado.' }); else filasConError.push({ fila: filaNum, error: 'Error interno.' });
        }
    }
    res.status(200).json({ mensaje: 'Completado.', resumen: { guardadosConExito: resultadosExitosos.length, erroresEncontrados: filasConError.length }, nuevosRegistros: resultadosExitosos, detallesErrores: filasConError });
  }).on('error', (error) => { res.status(500).json({ error: 'Error al leer CSV.' }); });
});

app.post('/api/compras/ingreso-masivo', async (req, res) => {
  try {
    const { sucursalIngreso, fecha, proveedor, referencia, numeroCompra, modelo, sku, cantidad, cajas, seriesProcesadas, usuarioCarga } = req.body; 
    
    const esSim = sku.toUpperCase().includes('SIM') || seriesProcesadas[0].length >= 19;
    
    const nuevosRegistros = seriesProcesadas.map(serie => {
      const articulo = { sucursal: sucursalIngreso, estado: 'Disponible', fechaIngreso: fecha || new Date(), folioCompra: numeroCompra, proveedor, referencia, modelo, sku: sku || 'S/N' };
      if (esSim) { articulo.icc = serie; articulo.tipo = 'SIM'; } else { articulo.imei = serie; articulo.marca = modelo.split(' ')[0]; } return articulo;
    });
    
    let insertados = 0;
    if (esSim) { const resultado = await Sim.insertMany(nuevosRegistros); insertados = resultado.length; } 
    else { const resultado = await Equipo.insertMany(nuevosRegistros); insertados = resultado.length; }

    await mongoose.connection.collection('historialCompras').insertOne({ 
        folio: numeroCompra, referencia, proveedor, sucursalDestino: sucursalIngreso, 
        fecha, modelo, cantidadTotal: cantidad, cajasFisicas: cajas, 
        articulosInsertados: insertados, usuarioCarga: usuarioCarga || 'DESCONOCIDO', 
        timestamp: new Date() 
    });

    res.status(201).json({ mensaje: 'Ingreso masivo exitoso', insertados: insertados });
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ error: 'Duplicados detectados.' }); res.status(500).json({ error: 'Error interno.' });
  }
});

app.get('/api/compras/historial', async (req, res) => {
  try { const historial = await mongoose.connection.collection('historialCompras').find().sort({ timestamp: -1 }).toArray(); res.json(historial); } 
  catch (error) { res.status(500).json({ error: 'Error al obtener historial' }); }
});

app.get('/api/traspasos', async (req, res) => {
  try { const historial = await Traspaso.find().sort({ _id: -1 }); res.json(historial); } 
  catch (error) { res.status(500).json({ error: "Error al obtener traspasos" }); }
});

app.post('/api/traspasos', async (req, res) => {
  try { const registroFinal = { id: Date.now(), fecha: new Date().toLocaleString('es-MX'), ...req.body }; const nuevoTraspaso = new Traspaso(registroFinal); await nuevoTraspaso.save(); res.status(201).json({ mensaje: 'Traspaso auditado.', registro: registroFinal }); } 
  catch (error) { res.status(500).json({ error: "Error al guardar traspaso" }); }
});

// ==========================================
// 🛡️ MANEJO DE ERRORES GLOBALES (PAYLOAD TOO LARGE)
// ==========================================
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    console.error("Payload too large detectado.");
    return res.status(413).json({ 
      error: "El archivo enviado es demasiado pesado.", 
      mensaje: "Los documentos PDF/Imágenes superan el límite del servidor. Por favor sube archivos más ligeros o comprimidos." 
    });
  }
  next(err);
});

// ==========================================================================
// 🚀 INICIALIZACIÓN DE LA BASE DE DATOS (MIGRACIÓN ÚNICA)
// ==========================================================================
const sembrarUsuariosIniciales = async () => {
  try {
      console.log("🌱 Forzando sincronización de usuarios maestros...");
      
      const usuariosIniciales = [
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
        
        { nombre: "DANIEL SANTANA ROSALES", usuario: "DS400G", contrasena: "0", categoria: "ED S&R GERENTE DE TIENDA", organizacion: "HZ9 - EVREN SAN PEDRO MARTIR CDMX", sucursal: "MESA DE CONTROL", nivelAcceso: "ADMINISTRADOR" },
        
        { nombre: "GABRIEL CORIA SEGURA", usuario: "GC1480", contrasena: "12345", categoria: "ED S&R GERENTE DE TIENDA", organizacion: "HZ9 - EVREN SAN PEDRO MARTIR CDMX", sucursal: "TIENDA", nivelAcceso: "USUARIO" },
        { nombre: "JESUS GALEANA VALENCIANA", usuario: "JG215P", contrasena: "12345", categoria: "ED S&R GERENTE DE TIENDA", organizacion: "ED1 - EVREN XOCHIMILCO CENTRO", sucursal: "TIENDA", nivelAcceso: "USUARIO" },
        { nombre: "JONATHAN CARRASCO CRUZ", usuario: "JO5517", contrasena: "12345", categoria: "ED S&R GERENTE DE TIENDA", organizacion: "HT5 - EVREN CORP TULANCINGO HGO", sucursal: "TIENDA", nivelAcceso: "USUARIO" },
        { nombre: "MARCO ANTONIO LUCERO HERNANDEZ", usuario: "ML069A", contrasena: "12345", categoria: "ED S&R GERENTE DE TIENDA", organizacion: "HT9 - EVREN PEDREGAL DE SAN NICOLAS CDMX", sucursal: "TIENDA", nivelAcceso: "USUARIO" },
        { nombre: "MAYRA JAZMIN MAR CRUZ", usuario: "MM877B", contrasena: "12345", categoria: "ED S&R GERENTE DE TIENDA", organizacion: "GC8 - EVREN TLAHUAC CENTRO", sucursal: "TIENDA", nivelAcceso: "USUARIO" },
        { nombre: "SHARON MICHELLE ARROYO MARTINEZ", usuario: "SA9485", contrasena: "12345", categoria: "ED S&R GERENTE DE TIENDA", organizacion: "ED1 - EVREN XOCHIMILCO CENTRO", sucursal: "TIENDA", nivelAcceso: "USUARIO" },
        { nombre: "ANGEL ROSAS HERNANDEZ", usuario: "AR788A", contrasena: "12345", categoria: "ED S&R GERENTE DE TIENDA", organizacion: "HD3 - EVREN VENTA NO PRESENCIAL", sucursal: "TELEMARKETING", nivelAcceso: "USUARIO" },
        { nombre: "ESAU ROSALES TINOCO", usuario: "ER1982", contrasena: "12345", categoria: "ED S&R EJECUTIVO UNIVERSAL", organizacion: "HD3 - EVREN VENTA NO PRESENCIAL", sucursal: "TELEMARKETING", nivelAcceso: "USUARIO" },
        { nombre: "OWEN GAEL CARBAJAL GONZALEZ", usuario: "OC8710", contrasena: "12345", categoria: "ED S&R EJECUTIVO UNIVERSAL", organizacion: "HD3 - EVREN VENTA NO PRESENCIAL", sucursal: "TELEMARKETING", nivelAcceso: "USUARIO" },
        { nombre: "CARLOS ALBERTO ROSAS GARCIA", usuario: "CR6501", contrasena: "12345", categoria: "EJECUTIVO EMPRESARIAL", organizacion: "VENTA EMPRESARIAL", sucursal: "EMPRESAS", nivelAcceso: "USUARIO" },
        
        { nombre: "USUARIO MESA 1", usuario: "MC001", contrasena: "12345", categoria: "MESA DE CONTROL", organizacion: "EVREN CORP", sucursal: "MESA DE CONTROL", nivelAcceso: "USUARIO" },
        { nombre: "USUARIO MESA 2", usuario: "MC002", contrasena: "12345", categoria: "MESA DE CONTROL", organizacion: "EVREN CORP", sucursal: "MESA DE CONTROL", nivelAcceso: "USUARIO" }
      ];

      for (let u of usuariosIniciales) {
         u.contrasenaEncriptada = bcrypt.hashSync(String(u.contrasena), 10);
         await Usuario.findOneAndUpdate(
            { usuario: u.usuario }, 
            { $set: u }, 
            { upsert: true, new: true }
         );
      }
      console.log("✅ Usuarios iniciales sincronizados y reseteados con éxito.");

  } catch (error) {
    console.error("❌ Error sembrando usuarios:", error);
  }
};

// ==========================================================================
// 🚀 INICIALIZACIÓN SINCRONIZADA (BASE DE DATOS -> SEMBRADO -> SERVIDOR)
// ==========================================================================
if (!process.env.MONGO_URI) {
  console.error('❌ FATAL: MONGO_URI no está definido en el archivo .env');
  process.exit(1);
}

const arrancarServidor = async () => {
  try {
    console.log('Conectando a MongoDB Atlas...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('🔥 ¡Bóveda conectada! MongoDB Atlas en línea.');

    await sembrarUsuariosIniciales();

    const PORT = process.env.PORT || 4000;
    app.listen(PORT, () => console.log(`🚀 Servidor Backend corriendo en el puerto ${PORT}`));

  } catch (err) {
    console.error('❌ Error fatal durante el arranque del servidor:', err);
    process.exit(1);
  }
};

arrancarServidor();