import { useState, useEffect, useRef, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { usePricing } from './usePricing';
import { 
  CONDICIONES_CREDITO, defaultPlanesEstandar, defaultTelefonosEstandar, TIPOS_VENTA_ESTANDAR, 
  PLANES_EMPRESARIAL, CATALOGO_TELEFONOS_EMPRESARIAL, TIPOS_VENTA_EMPRESARIAL
} from '../config/catalogs';
import { 
  SEGUROS_ATT, getCatalog, getPlazosDisponibles
} from '../utils/ventasHelpers';

const API_URL = import.meta.env.VITE_API_URL || 'https://evren-backend.onrender.com/api';

const CATALOGO_TITANIO_FALLBACK = [];
const PLAN_TITANIO_FALLBACK = { id: "PLAN_TITANIO_42", nombre: "Titanio (42GB)", parrilla: "TITANIO", matrizKey: "TITANIO", importe: 1599 };

const CATALOGO_MISEL_FALLBACK = [];
const PLAN_MISEL_FALLBACK = { id: "PLAN_MI_SELECCION", nombre: "Mi Selección (Black 42GB)", parrilla: "MI_SELECCION", matrizKey: "MI_SELECCION", importe: 825 };

export const useGestorVentas = ({ session, modoCotizador, showToast, setVistaActiva }) => {
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [folioId, setFolioId] = useState("");
  const [ejecutivosTMK, setEjecutivosTMK] = useState([]);

  const [catalogoEquipos, setCatalogoEquipos] = useState([]);
  const [catalogoTitanio, setCatalogoTitanio] = useState(CATALOGO_TITANIO_FALLBACK); 
  const [catalogoMiSeleccion, setCatalogoMiSeleccion] = useState(CATALOGO_MISEL_FALLBACK);
  const [catalogoPlanes, setCatalogoPlanes] = useState([]);
  const [isCatalogLoading, setIsCatalogLoading] = useState(true);
  
  const isAdmin = String(session?.nivel || "").toUpperCase().includes("ADMIN");
  const esEmpresarial = session?.sucursalEntrada === "EMPRESAS";
  const esTelemarketing = session?.sucursalEntrada === "TELEMARKETING"; 
  const esTienda = session?.sucursalEntrada === "TIENDAS" || session?.sucursalEntrada === "TIENDA";
  const sucursalRealUsuario = String(session?.org || session?.sucursalEntrada || "").toUpperCase();
  const nombreVendedorSeguro = String(session?.nombre || "Usuario").trim().toUpperCase();

  useEffect(() => { setEjecutivosTMK(["OWEN GAEL CARBAJAL GONZALEZ", "ESAU ROSALES TINOCO", "ANGEL ROSAS HERNANDEZ", "EJECUTIVO PRUEBA"]); }, []);

  useEffect(() => {
    const fetchCatalogos = async () => {
      setIsCatalogLoading(true);
      try {
        const [resEq, resTit, resPlan, resMiSel] = await Promise.all([
          fetch(`${API_URL}/catalogos/evren_telefonos_estandar`, { cache: 'no-store' }),
          fetch(`${API_URL}/catalogos/evren_telefonos_titanio`, { cache: 'no-store' }),
          fetch(`${API_URL}/catalogos/evren_planes_estandar`, { cache: 'no-store' }),
          fetch(`${API_URL}/catalogos/evren_telefonos_mi_seleccion`, { cache: 'no-store' })
        ]);
        if (resEq.ok) { const data = await resEq.json(); if (data && data.length > 0) setCatalogoEquipos(data); else setCatalogoEquipos(defaultTelefonosEstandar); } else setCatalogoEquipos(defaultTelefonosEstandar);
        if (resTit.ok) { const data = await resTit.json(); if (data && data.length > 0) setCatalogoTitanio(data); else setCatalogoTitanio(CATALOGO_TITANIO_FALLBACK); } else setCatalogoTitanio(CATALOGO_TITANIO_FALLBACK);
        if (resPlan.ok) { const data = await resPlan.json(); if (data && data.length > 0) setCatalogoPlanes(data); else setCatalogoPlanes(defaultPlanesEstandar); } else setCatalogoPlanes(defaultPlanesEstandar);
        if (resMiSel.ok) { const data = await resMiSel.json(); if (data && data.length > 0) setCatalogoMiSeleccion(data); else setCatalogoMiSeleccion(CATALOGO_MISEL_FALLBACK); } else setCatalogoMiSeleccion(CATALOGO_MISEL_FALLBACK);
      } catch (error) {
        setCatalogoEquipos(defaultTelefonosEstandar); setCatalogoTitanio(CATALOGO_TITANIO_FALLBACK); setCatalogoPlanes(defaultPlanesEstandar); setCatalogoMiSeleccion(CATALOGO_MISEL_FALLBACK);
      } finally { setIsCatalogLoading(false); }
    };
    fetchCatalogos();
  }, []);

  const PLANES_ACTIVOS = useMemo(() => {
    const base = esEmpresarial ? [...PLANES_EMPRESARIAL] : [...catalogoPlanes];
    if (!base.find(p => p.parrilla === "TITANIO" || p.nombre === "Titanio (42GB)")) base.push(PLAN_TITANIO_FALLBACK);
    if (!base.find(p => p.parrilla === "MI_SELECCION" || p.nombre === "Mi Selección (Black 42GB)")) base.push(PLAN_MISEL_FALLBACK);
    return base;
  }, [esEmpresarial, catalogoPlanes]);

  const CATALOGO_ACTIVO = useMemo(() => esEmpresarial ? CATALOGO_TELEFONOS_EMPRESARIAL : catalogoEquipos, [esEmpresarial, catalogoEquipos]);
  const TIPOS_VENTA_ACTIVOS = esEmpresarial ? TIPOS_VENTA_EMPRESARIAL : TIPOS_VENTA_ESTANDAR;
  const TIPOS_VENTA_ACTIVOS_FILTRADOS = useMemo(() => {
    if (!TIPOS_VENTA_ACTIVOS) return {};
    const filtrado = {};
    Object.keys(TIPOS_VENTA_ACTIVOS).forEach(key => { if (key.trim().toUpperCase().includes('NUEVA') || key.trim().toUpperCase().includes('RENOVACI')) filtrado[key] = TIPOS_VENTA_ACTIVOS[key]; });
    return filtrado;
  }, [TIPOS_VENTA_ACTIVOS]);
  
  const MARCAS_UNICAS_ACTIVAS = useMemo(() => [...new Set(CATALOGO_ACTIVO.map(t => String(t.marca || "").trim().toUpperCase()))].filter(Boolean).sort(), [CATALOGO_ACTIVO]);

  useEffect(() => { setFolioId(modoCotizador ? `C-${Math.floor(Date.now() / 1000)}` : `V-${Math.floor(Date.now() / 1000)}`); }, [modoCotizador]);

  const draftKey = `evren_draft_${modoCotizador ? 'cot' : 'cap'}_${session?.id}`;
  const defaultValues = useMemo(() => getCatalog(draftKey, { 
    marcaSeleccionada: "", equipoId: "", planId: "", soloPlan: false, soloSeguro: false, aplicaCondicion: false, tipoCondicion: "", montoCondicion: "", titanioCero: false, miSeleccionCero: false, tipoCaptura: "Presencial", atendioTMK: "", numeroOrden: "",
    email: "", ref1Nombre: "", ref1Telefono: "", ref2Nombre: "", ref2Telefono: "", identificacionBase64: "", identificacionNombre: "", requiereComprobante: false, comprobanteBase64: "", comprobanteNombre: "", bloqueadoPorMesa: false, condicionesMesa: [], cotizacionOriginalId: "",
    paqueteFirmadoVendedor: null, nipPortabilidad: "", paqueteMesaDescarga: null, seriesAsignadasMesa: false, estatusActual: "", alertaRiesgo: null, fichaPagoBase64: "", fichaPagoNombre: "", linkBiometricos: ""
  }), [draftKey]);

  const { register, handleSubmit, watch, setValue, reset, setFocus } = useForm({ defaultValues });
  const formValues = watch(); 

  const isSinEquipo = formValues.soloPlan;
  const esPortabilidad = formValues.subtipoVenta?.includes("Portabilidad");
  const aplicaPromoPorta = formValues.categoriaVenta === "Línea Nueva" && formValues.subtipoVenta === "Portabilidad";
  
  const rawTel = String(formValues.telefono || "").replace(/\D/g, '');
  const rawImei = String(formValues.imei || "").replace(/\D/g, '');
  const iccLength = String(formValues.icc || "").length; 
  const rawTelRef1 = String(formValues.ref1Telefono || "").replace(/\D/g, '');
  const rawTelRef2 = String(formValues.ref2Telefono || "").replace(/\D/g, '');

  const equipoSeleccionado = (formValues.titanioCero ? catalogoTitanio : (formValues.miSeleccionCero ? catalogoMiSeleccion : CATALOGO_ACTIVO)).find(e => String(e.id) === String(formValues.equipoId));
  
  let valorContadoBase = Number(equipoSeleccionado?.precioContado) || 0;
  if (equipoSeleccionado && valorContadoBase === 0) {
      const eqNormal = CATALOGO_ACTIVO.find(e => String(e.modelo).trim().toLowerCase() === String(equipoSeleccionado.modelo).trim().toLowerCase());
      if (eqNormal) valorContadoBase = Number(eqNormal.precioContado) || 0;
  }

  const planSeleccionadoDetectado = formValues.soloSeguro ? SEGUROS_ATT.find(p => String(p.id) === String(formValues.planId)) : PLANES_ACTIVOS.find(p => String(p.id) === String(formValues.planId));
  
  const planesFiltrados = useMemo(() => {
    if (formValues.soloSeguro) {
      if (equipoSeleccionado) {
         let p = valorContadoBase;
         if (p >= 500 && p <= 4000) return [SEGUROS_ATT[0]];
         if (p >= 4001 && p <= 6000) return [SEGUROS_ATT[1]];
         if (p >= 6001 && p <= 13000) return [SEGUROS_ATT[2]];
         if (p >= 13001 && p <= 38000) return [SEGUROS_ATT[3]];
         if (p >= 38001 && p <= 60000) return [SEGUROS_ATT[4]];
         return []; 
      }
      return SEGUROS_ATT;
    }
    if (formValues.soloPlan) return PLANES_ACTIVOS.filter(p => p.parrilla?.toLowerCase() === 'lite' || p.parrilla?.toLowerCase() === 'premium' || p.nombre?.toLowerCase().includes('azul 0'));
    
    let planesBase = PLANES_ACTIVOS.filter(p => p.parrilla?.toLowerCase() === 'premium' || p.parrilla?.toLowerCase().includes('titanio') || p.parrilla === 'MI_SELECCION');
    if (equipoSeleccionado && equipoSeleccionado.diferencia) planesBase = planesBase.filter(p => equipoSeleccionado.diferencia[p.nombre] !== undefined);
    
    if (!formValues.titanioCero) planesBase = planesBase.filter(p => !(p.nombre?.toLowerCase().includes('titanio') || p.parrilla?.toLowerCase().includes('titanio') || p.matrizKey?.toLowerCase() === "titanio"));
    if (!formValues.miSeleccionCero) planesBase = planesBase.filter(p => p.parrilla !== "MI_SELECCION" && p.nombre !== "Mi Selección (Black 42GB)");
    
    return planesBase;
  }, [PLANES_ACTIVOS, formValues.soloPlan, formValues.soloSeguro, formValues.titanioCero, formValues.miSeleccionCero, equipoSeleccionado, valorContadoBase]);

  const planSeleccionado = useMemo(() => { if (!planSeleccionadoDetectado) return null; return { ...planSeleccionadoDetectado, nombre: planSeleccionadoDetectado.nombre || "PLAN BASE", parrilla: planSeleccionadoDetectado.parrilla || "PREMIUM" }; }, [planSeleccionadoDetectado]);

  const isPlanTitanio = planSeleccionado?.nombre?.toLowerCase().includes('titanio') || planSeleccionado?.parrilla?.toLowerCase().includes('titanio') || planSeleccionado?.matrizKey?.toLowerCase() === "titanio";
  const seguroInvalidoPorMonto = equipoSeleccionado && (valorContadoBase < 500 || valorContadoBase > 60000);
  const esComprobanteObligatorio = isPlanTitanio || formValues.titanioCero || formValues.marcaSeleccionada === "APPLE";

  const equiposFiltrados = useMemo(() => {
    if (!formValues.marcaSeleccionada && !formValues.titanioCero && !formValues.miSeleccionCero) return [];
    let lista = formValues.titanioCero ? catalogoTitanio : (formValues.miSeleccionCero ? catalogoMiSeleccion : CATALOGO_ACTIVO);
    if (isPlanTitanio || formValues.titanioCero) lista = lista.filter(e => String(e.marca || "").trim().toUpperCase() === 'APPLE');
    else if (formValues.marcaSeleccionada) lista = lista.filter(e => String(e.marca || "").trim().toUpperCase() === String(formValues.marcaSeleccionada).trim().toUpperCase());
    if (planSeleccionado && formValues.plazo && !formValues.titanioCero) lista = lista.filter(eq => eq.diferencia && eq.diferencia[planSeleccionado.nombre] && eq.diferencia[planSeleccionado.nombre][formValues.plazo] !== undefined);
    const equiposUnicos = []; const idsVistos = new Set();
    for (const equipo of lista) { if (!idsVistos.has(equipo.id)) { idsVistos.add(equipo.id); equiposUnicos.push(equipo); } }
    return equiposUnicos;
  }, [CATALOGO_ACTIVO, catalogoTitanio, catalogoMiSeleccion, formValues.titanioCero, formValues.miSeleccionCero, formValues.marcaSeleccionada, isPlanTitanio, planSeleccionado, formValues.plazo]);
  
  let opcionesPlazo = planSeleccionado ? getPlazosDisponibles(planSeleccionado.parrilla) : [];
  if (!opcionesPlazo || opcionesPlazo.length === 0) opcionesPlazo = [24, 30, 36]; 
  if (isPlanTitanio || formValues.titanioCero) opcionesPlazo = [24]; 
  if (formValues.miSeleccionCero) opcionesPlazo = [24, 30, 36];
  
  const safePlanParaPricing = planSeleccionado;
  const safeEquipoParaPricing = useMemo(() => {
    if (!equipoSeleccionado) return null;
    const planName = safePlanParaPricing?.nombre || "DUMMY"; const parrilla = safePlanParaPricing?.parrilla || "PREMIUM";
    const diffReal = (equipoSeleccionado.diferencia && equipoSeleccionado.diferencia[planName]) ? equipoSeleccionado.diferencia[planName] : { "24": 0, "30": 0, "36": 0 };
    return { ...equipoSeleccionado, diferencia: { ...(equipoSeleccionado.diferencia || {}), [planName]: diffReal, [parrilla]: diffReal, "PREMIUM": diffReal, "TITANIO": diffReal, "MI_SELECCION": diffReal } };
  }, [equipoSeleccionado, safePlanParaPricing]);

  const fullPricing = usePricing({ formValues, planSeleccionado: safePlanParaPricing, equipoSeleccionado: safeEquipoParaPricing, aplicaPromoPorta }) || {};
  const maxEnganche = fullPricing.costoEquipoOriginal || 0; 

  const uniqueConds = useMemo(() => {
    const condsCompletas = CONDICIONES_CREDITO.includes("Aportación voluntaria") ? CONDICIONES_CREDITO : [...CONDICIONES_CREDITO, "Aportación voluntaria"];
    return isSinEquipo ? condsCompletas.filter(c => c.toLowerCase().includes("garant") && !c.toLowerCase().includes("equipo")) : condsCompletas;
  }, [isSinEquipo]);
  
  const placeholderMonto = fullPricing.engancheAplicado > 0 ? `Monto (Máx: $${maxEnganche.toLocaleString()})` : "Monto ($)";
  const errorMonto = formValues.aplicaCondicion && (Number(formValues.montoCondicion) > maxEnganche);

  useEffect(() => { 
    const timeoutId = setTimeout(() => { 
      try {
        const draftSeguro = { ...formValues }; delete draftSeguro.identificacionBase64; delete draftSeguro.comprobanteBase64; delete draftSeguro.fichaPagoBase64; delete draftSeguro.paqueteMesaDescarga; delete draftSeguro.paqueteFirmadoVendedor;
        localStorage.setItem(draftKey, JSON.stringify(draftSeguro)); 
      } catch (e) {}
    }, 1000); 
    return () => clearTimeout(timeoutId); 
  }, [formValues, draftKey]);
  
  const prevTitanioCero = useRef(formValues.titanioCero);
  const prevMiSeleccionCero = useRef(formValues.miSeleccionCero);
  useEffect(() => {
    if (formValues.titanioCero && !prevTitanioCero.current) {
      setValue("soloPlan", false); setValue("soloSeguro", false); setValue("miSeleccionCero", false); setValue("marcaSeleccionada", "APPLE", { shouldValidate: true });
      const pTit = PLANES_ACTIVOS.find(p => p.nombre?.toLowerCase().includes('titanio') || p.parrilla?.toLowerCase().includes('titanio') || p.matrizKey?.toLowerCase() === "titanio");
      if (pTit) setValue("planId", String(pTit.id)); setValue("plazo", "24"); setValue("equipoId", ""); 
    }
    prevTitanioCero.current = formValues.titanioCero;
  }, [formValues.titanioCero, formValues.marcaSeleccionada, isPlanTitanio, PLANES_ACTIVOS, setValue]);

  useEffect(() => {
    if (formValues.miSeleccionCero && !prevMiSeleccionCero.current) {
      setValue("soloPlan", false); setValue("soloSeguro", false); setValue("titanioCero", false); setValue("marcaSeleccionada", "", { shouldValidate: true });
      const pMisel = PLANES_ACTIVOS.find(p => p.parrilla === "MI_SELECCION" || p.nombre === "Mi Selección (Black 42GB)");
      if (pMisel) setValue("planId", String(pMisel.id)); setValue("plazo", "24"); setValue("equipoId", ""); 
    }
    prevMiSeleccionCero.current = formValues.miSeleccionCero;
  }, [formValues.miSeleccionCero, PLANES_ACTIVOS, setValue]);

  const handleReset = () => { 
    localStorage.removeItem(draftKey); 
    reset({ categoriaVenta: "", subtipoVenta: "", nombreCliente: "", telefono: "", marcaSeleccionada: "", equipoId: "", planId: "", plazo: "", aplicaControl: false, aplicaSeguro: false, icc: "", imei: "", aplicaCondicion: false, tipoCondicion: "", montoCondicion: "", formaPago: "", folioPago: "", numeroOrden: "", comentarios: "", soloPlan: false, soloSeguro: false, titanioCero: false, miSeleccionCero: false, tipoCaptura: "Presencial", atendioTMK: "", email: "", ref1Nombre: "", ref1Telefono: "", ref2Nombre: "", ref2Telefono: "", identificacionBase64: "", identificacionNombre: "", requiereComprobante: false, comprobanteBase64: "", comprobanteNombre: "", bloqueadoPorMesa: false, condicionesMesa: [], cotizacionOriginalId: "", paqueteFirmadoVendedor: null, nipPortabilidad: "", paqueteMesaDescarga: null, seriesAsignadasMesa: false, estatusActual: "", alertaRiesgo: null, fichaPagoBase64: "", fichaPagoNombre: "", linkBiometricos: "" });
    setFolioId(modoCotizador ? `C-${Math.floor(Date.now() / 1000)}` : `V-${Math.floor(Date.now() / 1000)}`); 
  };

  const handleSeleccionarMarca = (marca) => { 
      if (formValues.marcaSeleccionada === marca) { setValue("marcaSeleccionada", ""); setValue("equipoId", ""); if (formValues.soloSeguro) setValue("planId", ""); setValue("requiereComprobante", false); 
      } else { setValue("equipoId", ""); setValue("marcaSeleccionada", marca); if (marca.toUpperCase() !== "APPLE" && isPlanTitanio && !formValues.miSeleccionCero) setValue("planId", ""); if (formValues.soloSeguro) setValue("planId", ""); }
  };

  const MAX_LOCAL_SIZE = 50 * 1024 * 1024; 
  
  // 🚀 ADVERTENCIA INTELIGENTE DE PESO
  const processFile = (file, base64Key, nameKey) => {
    if (!file) return;
    if (file.size > MAX_LOCAL_SIZE) { if(showToast) showToast({text: "⚠️ Archivo demasiado pesado.", type: "error"}); return; }
    
    if (file.type === 'application/pdf') {
        // Si el PDF pesa más de 1MB, avisamos que se va a tardar
        if (file.size > 1024 * 1024) {
            if(showToast) showToast({text: "⚠️ Estás subiendo un PDF muy pesado. El envío será lento. ¡Es mejor usar fotos (JPG/PNG) para que sea instantáneo!", type: "warning"});
        }
        const reader = new FileReader(); 
        reader.onloadend = () => { setValue(base64Key, reader.result); setValue(nameKey, file.name); }; 
        reader.readAsDataURL(file);
        return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 1200; const MAX_HEIGHT = 1200;
            let width = img.width; let height = img.height;

            if (width > height) { if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; } } 
            else { if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; } }

            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, width, height);
            const compressedBase64 = canvas.toDataURL('image/jpeg', 0.6);
            setValue(base64Key, compressedBase64); setValue(nameKey, file.name);
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const handleIdentificacionUpload = (e) => processFile(e.target.files[0], "identificacionBase64", "identificacionNombre");
  const handleComprobanteUpload = (e) => processFile(e.target.files[0], "comprobanteBase64", "comprobanteNombre");
  const handleFichaPagoUpload = (e) => processFile(e.target.files[0], "fichaPagoBase64", "fichaPagoNombre");
  const exportarCSV = () => { if(showToast) showToast({ text: "Exportando...", type: "success" }); };

  const cargarCotizacion = (cotizacion, paraRevision = false) => {
    const payload = { ...cotizacion.datos, cotizacionOriginalId: cotizacion.id || cotizacion._id || cotizacion.folio, paqueteMesaDescarga: cotizacion.paqueteMesa, estatusActual: cotizacion.estatus };
    if (!payload.marcaSeleccionada && payload.equipoId) { const eq = CATALOGO_ACTIVO.find(e => String(e.id) === String(payload.equipoId)); if (eq) payload.marcaSeleccionada = eq.marca; }

    if (payload.bloqueadoPorMesa && Array.isArray(payload.condicionesMesa) && payload.condicionesMesa.length > 0) {
        const enganche = payload.condicionesMesa.find(c => c.tipo.toLowerCase().includes('enganche'));
        const garantia = payload.condicionesMesa.find(c => c.tipo.toLowerCase().includes('garant'));
        if (enganche) { payload.aplicaCondicion = true; payload.tipoCondicion = "Enganche por el equipo"; payload.montoCondicion = enganche.monto; } 
        else if (garantia) { payload.aplicaCondicion = true; payload.tipoCondicion = garantia.tipo; payload.montoCondicion = garantia.monto; }
    }

    reset(payload); setFolioId(cotizacion.id || cotizacion._id || cotizacion.folio);
    if(showToast) showToast({ text: paraRevision ? "Dictamen cargado." : "Trámite recuperado.", type: "success" });
    if(setVistaActiva) setVistaActiva('formulario'); return true; 
  };

  const actualizarEnServidor = async (id, payload) => {
    if (!id) return false;
    try { const response = await fetch(`${API_URL}/cotizaciones/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.token}` }, body: JSON.stringify(payload) }); return response.ok; } catch (error) { return false; }
  };

  const crearEnServidor = async (payload, esVenta = false) => {
    try { const endpoint = esVenta ? `${API_URL}/ventas` : `${API_URL}/cotizaciones`; const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.token}` }, body: JSON.stringify(payload) }); return response.ok; } catch (error) { return false; }
  };

  const cancelarCotizacion = async (identificador, motivo) => {
    let targetId = (!identificador) ? null : (typeof identificador === 'string' ? identificador : identificador._id || identificador.id || identificador.folio);
    if (!targetId) return false;
    setIsSaving(true);
    const exitoApi = await actualizarEnServidor(targetId, { estatus: 'Cancelada', datos: { motivoCancelacion: motivo || 'Cancelada por el usuario' } });
    setIsSaving(false);
    if(showToast) showToast({ text: "Trámite Cancelado.", type: "success" });
    handleReset(); if(setVistaActiva) setVistaActiva('cotizaciones');
    return exitoApi; 
  };

  const finalizarBiometricos = async (identificador) => {
    let targetId = (!identificador) ? null : (typeof identificador === 'string' ? identificador : identificador._id || identificador.id || identificador.folio);
    if (!targetId) return false;
    setIsSaving(true);
    const exitoApi = await actualizarEnServidor(targetId, { estatus: 'Validando Biométricos' });
    setIsSaving(false);
    if(showToast) showToast({ text: exitoApi ? "Biométricos enviados a Mesa para validación." : "Error de red.", type: exitoApi ? "success" : "error" });
    return exitoApi;
  };

  const onSave = async (formData) => {
    let data = { ...formData };
    if (data && (data.nativeEvent || data._reactName || data.type === 'click')) { data = formValues; }

    try {
        setIsSaving(true);
        const vendedorFijo = nombreVendedorSeguro; 
        data.vendedor = vendedorFijo;
        data.sucursal = sucursalRealUsuario;

        const estatusSeguro = data.estatusActual || formValues.estatusActual;
        const idCotizacion = data.cotizacionOriginalId || folioId;
        
        if (estatusSeguro === 'Dictaminada') {
            const seguroRemovido = !data.aplicaSeguro; 
            const addonRemovido = !data.aplicaControl; 
            const modalidadCambiada = (data.soloPlan) || (data.soloSeguro);

            if (seguroRemovido || addonRemovido || modalidadCambiada) {
                data.condicionesMesa = [];
                data.bloqueadoPorMesa = false;
                data.estatusActual = 'Validando Biométricos'; 
                data.tipoCondicion = ""; data.montoCondicion = ""; data.aplicaCondicion = false;
                data.alertaRiesgo = `El ejecutivo modificó condiciones comerciales. Requiere nuevo dictamen.`;
                
                const ok = await actualizarEnServidor(idCotizacion, { estatus: 'Validando Biométricos', datos: data, detallesFinancieros: fullPricing, equipoNombre: equipoSeleccionado ? equipoSeleccionado.modelo : "Sin Equipo", planNombre: planSeleccionado ? planSeleccionado.nombre : "Sin Plan" });

                if (ok) {
                    if(showToast) showToast({ text: `Oferta modificada. Regresó a Mesa para nuevo dictamen.`, type: "error" });
                    handleReset(); if(typeof setVistaActiva === 'function') setVistaActiva('cotizaciones');
                } else { if(showToast) showToast({ text: "Error al contactar con el servidor.", type: "error" }); }
            } else {
                data.alertaRiesgo = 'EL EJECUTIVO ACEPTÓ EL DICTAMEN. PREPARAR MEDIOS DE PAGO Y CONTRATOS.';
                data.bloqueadoPorMesa = true;
                
                const ok = await actualizarEnServidor(idCotizacion, { estatus: 'Aprobada por Ejecutivo', datos: data, detallesFinancieros: fullPricing, equipoNombre: equipoSeleccionado ? equipoSeleccionado.modelo : "Sin Equipo", planNombre: planSeleccionado ? planSeleccionado.nombre : "Sin Plan" });

                if (ok) {
                    if(showToast) showToast({ text: "Oferta Aceptada. Esperando contratos y formatos de pago de Mesa.", type: "success" });
                    handleReset(); if(typeof setVistaActiva === 'function') setVistaActiva('cotizaciones');
                } else { if(showToast) showToast({ text: "Error al comunicar con el servidor.", type: "error" }); }
            }
            return; 
        }

        if (!modoCotizador || data.bloqueadoPorMesa) {
          if (data.tipoCaptura === 'No Presencial' || data.bloqueadoPorMesa) {
            if (!data.email || !data.email.includes('@')) { if(showToast) showToast({ text: "Falta Correo.", type: "error" }); return; }
            if (data.bloqueadoPorMesa) {
                const p = data.paqueteFirmadoVendedor;
                if (!p || !p.contrato || !p.buro || !p.responsabilidad || !p.resumen) { if(showToast) showToast({ text: "Faltan PDFs.", type: "error" }); return; }
                if (fullPricing.pagoInicialFinal > 0 && !data.fichaPagoBase64) { if(showToast) showToast({ text: "Falta Ficha de Pago.", type: "error" }); return; }
            }
            
            const ok = await actualizarEnServidor(idCotizacion, { estatus: data.bloqueadoPorMesa ? 'Firma Subida' : 'Esperando Expediente', datos: data, detallesFinancieros: fullPricing, fechaEnvioContrato: new Date().toISOString(), paqueteFirmadoVendedor: data.paqueteFirmadoVendedor, equipoNombre: equipoSeleccionado ? equipoSeleccionado.modelo : "Sin Equipo", planNombre: planSeleccionado ? planSeleccionado.nombre : "Sin Plan" });
            
            if (ok) { setShowConfetti(true); setShowSuccess(true); setTimeout(() => { setShowSuccess(false); setShowConfetti(false); handleReset(); if(typeof setVistaActiva === 'function') setVistaActiva('cotizaciones'); }, 2000); }
            return;
          }

          const ok = await crearEnServidor({ ...data, folio: folioId, vendedor: vendedorFijo, sucursal: sucursalRealUsuario, fechaVenta: new Date().toISOString(), detallesFinancieros: fullPricing, equipoNombre: equipoSeleccionado ? equipoSeleccionado.modelo : "Sin Equipo", planNombre: planSeleccionado ? planSeleccionado.nombre : "Sin Plan" }, true);
          if (ok) { setShowSuccess(true); setShowConfetti(true); setTimeout(() => { setShowSuccess(false); setShowConfetti(false); handleReset(); if(typeof setVistaActiva === 'function') setVistaActiva('historial_ventas'); }, 2000); }
          return;
        }

        const isRemoto = data.tipoCaptura === 'No Presencial';
        if (isRemoto) {
          if (esPortabilidad && data.nipPortabilidad?.length !== 4) return;
          if (!data.email || !data.email.includes('@')) return;
          if (!data.ref1Nombre || String(data.ref1Telefono || "").replace(/\D/g, '').length !== 10) return;
          if (!data.ref2Nombre || String(data.ref2Telefono || "").replace(/\D/g, '').length !== 10) return;
          if (estatusSeguro !== 'Dictaminada' && !data.identificacionBase64) return;
        }

        const ok = await crearEnServidor({ id: folioId, folio: folioId, fecha: new Date().toISOString(), expira: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), datos: data, detallesFinancieros: fullPricing, equipoNombre: equipoSeleccionado ? equipoSeleccionado.modelo : "Sin Equipo", planNombre: planSeleccionado ? planSeleccionado.nombre : "Sin Plan", cliente: data.nombreCliente || "Cliente Anónimo", estatus: isRemoto ? 'Pendiente' : 'Guardada', sucursal: sucursalRealUsuario, vendedor: vendedorFijo }, false);
        if (ok) { setShowConfetti(true); setShowSuccess(true); setTimeout(() => { setShowSuccess(false); setShowConfetti(false); handleReset(); if(typeof setVistaActiva === 'function') setVistaActiva('cotizaciones'); }, 2500); }

    } catch (error) {
        console.error("Error:", error);
        if(showToast) showToast({ text: "Ocurrió un error inesperado al contactar con la nube.", type: "error" });
    } finally {
        setIsSaving(false); 
    }
  };

  return {
    register, handleSubmit, watch, setValue, setFocus, formValues,
    isSaving, showSuccess, showConfetti, folioId, ejecutivosTMK,
    isAdmin, esEmpresarial, esTienda, esTelemarketing, sucursalRealUsuario, MAX_LOCAL_SIZE,
    MARCAS_UNICAS_ACTIVAS, TIPOS_VENTA_ACTIVOS_FILTRADOS,
    equiposFiltrados, planesFiltrados, opcionesPlazo, isCatalogLoading,
    planSeleccionado, equipoSeleccionado, isSinEquipo, esPortabilidad, rawTel, rawImei, iccLength, rawTelRef1, rawTelRef2,
    fullPricing, maxEnganche, uniqueConds, placeholderMonto, errorMonto, isPlanTitanio, seguroInvalidoPorMonto,
    handleReset, handleSeleccionarMarca, handleIdentificacionUpload, handleComprobanteUpload, handleFichaPagoUpload, onSave, cargarCotizacion, exportarCSV, cancelarCotizacion,
    finalizarBiometricos, esComprobanteObligatorio 
  };
};