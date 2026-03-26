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

// ==========================================
// ☁️ CONFIGURACIÓN DE AWS S3
// ==========================================
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
// 🌟 NUEVO: Importamos el generador de URLs pre-firmadas (Tickets VIP)
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});
const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || process.env.AWS_BUCKET_NAME;

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
// 🛠️ FUNCIÓN HELPER: SUBIR BASE64 A S3 (MÉTODO ANTIGUO / FALLBACK)
// ==========================================================================
const uploadBase64ToS3 = async (base64String, folder, fileName) => {
  if (!base64String || !base64String.includes('base64,')) return base64String; 

  try {
    const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) return base64String;

    const type = matches[1];
    const buffer = Buffer.from(matches[2], 'base64');
    
    // Generar un nombre único para evitar colisiones
    const uniqueName = `${folder}/${Date.now()}_${Math.random().toString(36).substring(7)}_${fileName.replace(/[^a-zA-Z0-9.]/g, '_')}`;

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: uniqueName,
      Body: buffer,
      ContentType: type,
    });

    await s3Client.send(command);
    return `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${uniqueName}`;
  } catch (error) {
    console.error("Error subiendo a S3:", error);
    return base64String; // Fallback: si falla S3, guarda el Base64 original en MongoDB
  }
};

// ==========================================================================
// 🏎️ TICKET VIP: GENERADOR DE URLS PRE-FIRMADAS PARA S3
// ==========================================================================
app.post('/api/s3/presigned-url', async (req, res) => {
  try {
    const { fileName, fileType, folder } = req.body;
    if (!fileName || !fileType) return res.status(400).json({ error: "Faltan datos del archivo" });

    // Limpiamos el nombre del archivo para evitar caracteres raros en la URL
    const cleanFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const uniqueName = `${folder || 'tramites'}/${Date.now()}_${Math.random().toString(36).substring(7)}_${cleanFileName}`;

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: uniqueName,
      ContentType: fileType
    });

    // Pedimos a AWS una URL válida por 5 minutos (300 segundos) para hacer un PUT directo
    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });

    // Calculamos cómo quedará la URL pública final una vez que el cliente suba el archivo
    const publicUrl = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${uniqueName}`;

    res.json({ presignedUrl, publicUrl });
  } catch (error) {
    console.error("Error generando Presigned URL:", error);
    res.status(500).json({ error: "Error interno al generar el ticket de subida a S3" });
  }
});


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
    
    // Subir avatar a AWS S3 si viene en base64
    let avatarUrl = avatar;
    if (avatar && avatar.includes('base64,')) {
        avatarUrl = await uploadBase64ToS3(avatar, 'avatares', `${usuario}_avatar.jpg`);
    }

    await Perfil.findOneAndUpdate({ usuario: String(usuario).toUpperCase() }, { usuario: String(usuario).toUpperCase(), avatar: avatarUrl || "" }, { upsert: true, new: true });
    res.status(200).json({ mensaje: "Avatar actualizado exitosamente" });
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

// Optimizada: Devuelve todo porque los Base64 ya no existen, ¡ahora son URLs de AWS!
app.get('/api/cotizaciones', async (req, res) => { 
  try { 
      const cotizacionesLigeras = await Cotizacion.find().sort({ _id: -1 }); 
      res.json(cotizacionesLigeras); 
  } 
  catch (error) { res.status(500).json({ error: "Error al obtener cotizaciones" }); } 
});

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

// 🚀 CREAR COTIZACIÓN (VENDEDOR SUBE DOCUMENTOS AL CAPTURAR)
app.post('/api/cotizaciones', async (req, res) => { 
  try { 
    let bodyData = { ...req.body };
    const folio = bodyData.id || bodyData.folio;

    if (bodyData.datos) {
        const uploadPromises = [];
        
        // Subimos el Frente del INE
        if (bodyData.datos.ineFrontBase64 && bodyData.datos.ineFrontBase64.includes('base64,')) {
            uploadPromises.push(uploadBase64ToS3(bodyData.datos.ineFrontBase64, folio, bodyData.datos.ineFrontNombre || 'INE_Frente.jpg').then(url => { bodyData.datos.ineFrontBase64 = url; }));
        }
        
        // Subimos el Reverso del INE
        if (bodyData.datos.ineBackBase64 && bodyData.datos.ineBackBase64.includes('base64,')) {
            uploadPromises.push(uploadBase64ToS3(bodyData.datos.ineBackBase64, folio, bodyData.datos.ineBackNombre || 'INE_Reverso.jpg').then(url => { bodyData.datos.ineBackBase64 = url; }));
        }

        // Subimos Comprobante
        if (bodyData.datos.comprobanteBase64 && bodyData.datos.comprobanteBase64.includes('base64,')) {
            uploadPromises.push(uploadBase64ToS3(bodyData.datos.comprobanteBase64, folio, bodyData.datos.comprobanteNombre || 'Comprobante.jpg').then(url => { bodyData.datos.comprobanteBase64 = url; }));
        }
        
        // Por si acaso se mandó un INE viejo unificado
        if (bodyData.datos.identificacionBase64 && bodyData.datos.identificacionBase64.includes('base64,')) {
            uploadPromises.push(uploadBase64ToS3(bodyData.datos.identificacionBase64, folio, bodyData.datos.identificacionNombre || 'INE.jpg').then(url => { bodyData.datos.identificacionBase64 = url; }));
        }

        if (uploadPromises.length > 0) await Promise.all(uploadPromises);
    }

    const nuevaCotizacion = new Cotizacion({ ...bodyData, id: folio }); 
    await nuevaCotizacion.save(); 
    res.status(201).json({ message: "Cotización guardada", data: nuevaCotizacion }); 
  } 
  catch (error) { 
      console.error(error);
      res.status(500).json({ error: "Error al guardar cotización" }); 
  } 
});

// 🚀 ACTUALIZAR COTIZACIÓN (MESA SUBE CONTRATOS O VENDEDOR SUBE FIRMAS)
app.put('/api/cotizaciones/:id', async (req, res) => {
  try {
      const { id } = req.params;
      let bodyData = { ...req.body };
      const uploadPromises = []; 

      // 1. Si la Mesa manda el Paquete de Contratos (Paso 8)
      if (bodyData.paqueteMesa) {
          const p = bodyData.paqueteMesa;
          const docsMesa = ['contrato', 'buro', 'responsabilidad', 'resumen', 'qrPago', 'pagoFormal'];
          for (let doc of docsMesa) {
              if (p[doc] && p[doc].base64 && p[doc].base64.includes('base64,')) {
                  uploadPromises.push(uploadBase64ToS3(p[doc].base64, `${id}/mesa`, p[doc].name || `${doc}.pdf`).then(url => p[doc].base64 = url));
              }
          }
      }

      // 2. Si el Vendedor sube el Expediente Firmado o la Ficha de Pago (Paso 10)
      if (bodyData.datos) {
          if (bodyData.datos.fichaPagoBase64 && bodyData.datos.fichaPagoBase64.includes('base64,')) {
              uploadPromises.push(uploadBase64ToS3(bodyData.datos.fichaPagoBase64, `${id}/firmados`, bodyData.datos.fichaPagoNombre || 'FichaPago.pdf').then(url => bodyData.datos.fichaPagoBase64 = url));
          }
          if (bodyData.datos.paqueteFirmadoVendedor) {
              const pf = bodyData.datos.paqueteFirmadoVendedor;
              const docsVendedor = ['contrato', 'buro', 'responsabilidad', 'resumen'];
              for (let doc of docsVendedor) {
                  if (pf[doc] && pf[doc].base64 && pf[doc].base64.includes('base64,')) {
                      uploadPromises.push(uploadBase64ToS3(pf[doc].base64, `${id}/firmados`, pf[doc].name || `${doc}_firmado.pdf`).then(url => pf[doc].base64 = url));
                  }
              }
          }
      }

      // 3. También si el body principal trae paqueteFirmadoVendedor directamente
      if (bodyData.paqueteFirmadoVendedor) {
          const pf = bodyData.paqueteFirmadoVendedor;
          const docsVendedor = ['contrato', 'buro', 'responsabilidad', 'resumen'];
          for (let doc of docsVendedor) {
              if (pf[doc] && pf[doc].base64 && pf[doc].base64.includes('base64,')) {
                  uploadPromises.push(uploadBase64ToS3(pf[doc].base64, `${id}/firmados`, pf[doc].name || `${doc}_firmado.pdf`).then(url => pf[doc].base64 = url));
              }
          }
      }
      
      if (uploadPromises.length > 0) await Promise.all(uploadPromises);
      
      let condicionesBusqueda = [ { id: id }, { folio: id }, { 'datos.id': id }, { 'datos.folio': id } ];
      if (/^[0-9a-fA-F]{24}$/.test(id)) { condicionesBusqueda.push({ _id: new mongoose.Types.ObjectId(id) }); }

      const cotizacionActualizada = await Cotizacion.findOneAndUpdate(
          { $or: condicionesBusqueda },
          { $set: bodyData },
          { new: true }
      );

      if (!cotizacionActualizada) return res.status(404).json({ mensaje: "Trámite no encontrado." });

      res.status(200).json({ message: "Cotización actualizada", data: cotizacionActualizada });
  } catch (error) {
      console.error("Error al actualizar cotización:", error);
      res.status(500).json({ error: "Error interno" });
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
      console.log("🌱 Verificando usuarios maestros...");
      const usuariosIniciales = [
        { nombre: "LAURA BAUTISTA CONDE", usuario: "LB9748", contrasena: "12345", categoria: "ED S&R GERENTE DE TIENDA", organizacion: "HD3 - EVREN VENTA NO PRESENCIAL", sucursal: "TELEMARKETING", nivelAcceso: "USUARIO" },
        { nombre: "LAURA GALEANA VALENCIANA", usuario: "LG220B", contrasena: "12345", categoria: "ED S&R EJECUTIVO UNIVERSAL", organizacion: "HD3 - EVREN VENTA NO PRESENCIAL", sucursal: "TELEMARKETING", nivelAcceso: "USUARIO" },
        { nombre: "DANIEL SANTANA ROSALES", usuario: "DS400G", contrasena: "0", categoria: "ED S&R GERENTE DE TIENDA", organizacion: "HZ9 - EVREN SAN PEDRO MARTIR CDMX", sucursal: "MESA DE CONTROL", nivelAcceso: "ADMINISTRADOR" },
        { nombre: "USUARIO MESA 1", usuario: "MC001", contrasena: "12345", categoria: "MESA DE CONTROL", organizacion: "EVREN CORP", sucursal: "MESA DE CONTROL", nivelAcceso: "USUARIO" }
      ];

      for (let u of usuariosIniciales) {
         const existe = await Usuario.findOne({ usuario: u.usuario });
         if (!existe) {
            u.contrasenaEncriptada = bcrypt.hashSync(String(u.contrasena), 10);
            await Usuario.create(u);
         }
      }
  } catch (error) {
    console.error("❌ Error sembrando usuarios:", error);
  }
};

// ==========================================================================
// 🚀 INICIALIZACIÓN SINCRONIZADA (BASE DE DATOS -> SERVIDOR)
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