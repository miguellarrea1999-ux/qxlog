import { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

// --- Auth ---------------------------------------------------------------
// Supabase Auth via raw REST (keeps the no-dependency pattern of the rest of
// the app). The user's access token — not the anon key — is what proves
// identity to the database; RLS then allows only authenticated requests.
const SESSION_KEY = "qxlog_session";
let accessToken = null; // module-level: read by sbFetch on every DB call
let onAuthLost = () => {}; // App sets this to bounce the UI back to login

const auth = {
  session: JSON.parse(localStorage.getItem(SESSION_KEY) || "null"),
  save(s) {
    this.session = s;
    accessToken = s?.access_token || null;
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  },
  clear() {
    this.session = null;
    accessToken = null;
    localStorage.removeItem(SESSION_KEY);
  },
  isExpired() {
    const exp = this.session?.expires_at; // unix seconds
    return !exp || Date.now() / 1000 > exp - 60;
  },
  async signIn(email, password) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error("Credenciales incorrectas");
    const s = await res.json();
    this.save(s);
    return s;
  },
  async refresh() {
    if (!this.session?.refresh_token) { this.clear(); return null; }
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: this.session.refresh_token }),
    });
    if (!res.ok) { this.clear(); return null; }
    const s = await res.json();
    this.save(s);
    return s;
  },
  async signOut() {
    try {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: "POST",
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${this.session?.access_token}` },
      });
    } catch { /* ignore network errors on logout */ }
    this.clear();
  },
};
accessToken = auth.session?.access_token || null;

// --- Data access --------------------------------------------------------
// Every request carries the anon key as `apikey` (the gateway key) and the
// user's JWT as `Authorization` (the identity). On a 401 we transparently
// refresh the token once; if that fails we hand control back to the login gate.
async function authFetch(url, options = {}, retry = true) {
  const res = await fetch(url, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${accessToken || SUPABASE_KEY}`,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401 && retry) {
    const refreshed = await auth.refresh();
    if (refreshed) return authFetch(url, options, false);
    onAuthLost();
  }
  return res;
}
const sbFetch = (path, options, retry) => authFetch(`${SUPABASE_URL}/rest/v1/${path}`, options, retry);

// --- Image storage ------------------------------------------------------
// Radiology images live in a private Storage bucket `rx` (see
// supabase/setup-storage.sql). The DB row stores only the object path; the
// image itself is fetched through a short-lived signed URL so it stays private.
const RX_BUCKET = "rx";
const storage = {
  async upload(file) {
    const ext = ((file.name || "rx").split(".").pop() || "jpg").toLowerCase();
    const path = `${crypto.randomUUID()}.${ext}`;
    const res = await authFetch(`${SUPABASE_URL}/storage/v1/object/${RX_BUCKET}/${path}`, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!res.ok) throw new Error("Error al subir imagen");
    return path;
  },
  async signedUrl(path, expiresIn = 3600) {
    const res = await authFetch(`${SUPABASE_URL}/storage/v1/object/sign/${RX_BUCKET}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn }),
    });
    if (!res.ok) throw new Error("Error al firmar URL");
    const { signedURL } = await res.json();
    return `${SUPABASE_URL}/storage/v1${signedURL}`;
  },
  async remove(path) {
    try {
      await authFetch(`${SUPABASE_URL}/storage/v1/object/${RX_BUCKET}/${path}`, { method: "DELETE" });
    } catch { /* best effort — orphaned objects are harmless */ }
  },
};

// Shrink large images before upload (X-ray screenshots can be several MB).
// Falls back to the original file if anything goes wrong or it's already small.
async function downscaleImage(file, maxDim = 1920, quality = 0.85) {
  if (!file.type?.startsWith("image/")) return file;
  if (file.size < 800 * 1024) return file; // already small
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", quality));
    if (!blob) return file;
    return new File([blob], (file.name || "rx").replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

// Is this a storage path (new) rather than an inline data URL (legacy) or http URL?
const isStoragePath = (v) => !!v && !/^(data:|blob:|https?:)/.test(v);

const db = {
  async getAll() {
    const res = await sbFetch(`cirugias?order=fecha.desc`);
    if (!res.ok) throw new Error("Error al cargar");
    return res.json();
  },
  async insert(record) {
    const res = await sbFetch(`cirugias`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(record),
    });
    if (!res.ok) throw new Error("Error al guardar");
    return res.json();
  },
  async update(id, data) {
    const res = await sbFetch(`cirugias?id=eq.${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Error al actualizar");
    return res.json();
  },
  async delete(id) {
    const res = await sbFetch(`cirugias?id=eq.${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Error al eliminar");
  },
};

const EMPTY = {
  fecha:"",nhc:"",edad:"",sexo:"",lado:"",
  asa:"",anticoagulacion:"",anticoagulacion_farmaco:"",osteoporosis:"",
  diabetes:false,irc:false,hta:false,epoc:false,otras_comorbilidades:"",
  tipo_cirugia:"",diagnostico:"",clasificacion_ao:"",clasificacion_especifica:"",clasificacion_nombre:"",
  posicion:"",abordaje:"",tecnica:"",implante_marca:"",implante_tipo:"",
  injerto:"",injerto_cual:"",torniquete:"",ayudante:"",
  complicaciones_intra:"",carga_prescrita:"",observaciones:"",
  fecha_revision:"",consolidacion:"",complicacion_tardia:"",
  resultado_funcional:"",resultado_escala:"",reintervencion:"",reintervencion_motivo:"",
  imagen_url:"",notas_clinicas:"",
};

const CLASIFICACIONES = ["AO/OTA","Garden","Neer","Schatzker","Tile/AO Pelvis","Denis","TLICS","Gustilo-Anderson","Lauge-Hansen","Weber","Hawkins","Gartland","Salter-Harris","Pipkin","Pauwels","Singh (osteoporosis)","Otra"];
const STEPS = [{id:1,icon:"👤",label:"Paciente"},{id:2,icon:"🫀",label:"Riesgo"},{id:3,icon:"🦴",label:"Diagnóstico"},{id:4,icon:"🔧",label:"Cirugía"},{id:5,icon:"📋",label:"Postop"},{id:6,icon:"📅",label:"Seguimiento"}];

const ALL_COLUMNS = [
  {key:"fecha",label:"Fecha"},
  {key:"nhc",label:"NHC"},
  {key:"edad",label:"Edad"},
  {key:"sexo",label:"Sexo"},
  {key:"lado",label:"Lado"},
  {key:"asa",label:"ASA"},
  {key:"anticoagulacion",label:"Anticoagulación"},
  {key:"anticoagulacion_farmaco",label:"Fármaco anticoag."},
  {key:"osteoporosis",label:"Osteoporosis"},
  {key:"hta",label:"HTA",bool:true},
  {key:"diabetes",label:"Diabetes",bool:true},
  {key:"irc",label:"IRC",bool:true},
  {key:"epoc",label:"EPOC",bool:true},
  {key:"otras_comorbilidades",label:"Otras comorbilidades"},
  {key:"tipo_cirugia",label:"Tipo cirugía"},
  {key:"diagnostico",label:"Diagnóstico"},
  {key:"clasificacion_ao",label:"Clasificación AO/OTA"},
  {key:"clasificacion_nombre",label:"Sistema clasificación"},
  {key:"clasificacion_especifica",label:"Grado/subtipo"},
  {key:"posicion",label:"Posición"},
  {key:"torniquete",label:"Torniquete"},
  {key:"abordaje",label:"Abordaje"},
  {key:"tecnica",label:"Técnica"},
  {key:"implante_marca",label:"Implante marca"},
  {key:"implante_tipo",label:"Implante tipo/ref."},
  {key:"injerto",label:"Injerto"},
  {key:"ayudante",label:"Ayudante"},
  {key:"complicaciones_intra",label:"Complicaciones intraop."},
  {key:"carga_prescrita",label:"Carga prescrita"},
  {key:"observaciones",label:"Observaciones"},
  {key:"fecha_revision",label:"Fecha revisión"},
  {key:"consolidacion",label:"Consolidación"},
  {key:"complicacion_tardia",label:"Complicación tardía"},
  {key:"resultado_escala",label:"Escala funcional"},
  {key:"resultado_funcional",label:"Puntuación funcional"},
  {key:"reintervencion",label:"Reintervención"},
  {key:"reintervencion_motivo",label:"Motivo reintervención"},
  {key:"notas_clinicas",label:"Notas clínicas"},
];

const exportCustom = (records, selectedCols) => {
  const rows = records.map(r => {
    const row = {};
    selectedCols.forEach(col => {
      row[col.label] = col.bool ? (r[col.key] ? "Sí" : "No") : (r[col.key] || "");
    });
    return row;
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Cirugías");
  XLSX.writeFile(wb, `QxLog_export_${new Date().toISOString().slice(0,10)}.xlsx`);
};

const generateMemoria = (records) => {
  const byType = {};
  const byImplant = {};
  const byMonth = {};
  records.forEach(r => {
    byType[r.tipo_cirugia||"Sin tipo"] = (byType[r.tipo_cirugia||"Sin tipo"]||0)+1;
    const imp = [r.implante_marca,r.implante_tipo].filter(Boolean).join(" — ")||"Sin implante";
    byImplant[imp] = (byImplant[imp]||0)+1;
    const m = (r.fecha||"").slice(0,7);
    if(m) byMonth[m] = (byMonth[m]||0)+1;
  });
  const compl = records.filter(r=>r.complicaciones_intra&&!["ninguna","no",""].includes((r.complicaciones_intra||"").toLowerCase().trim())).length;
  const reint = records.filter(r=>r.reintervencion==="Sí").length;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    {"Métrica":"Total cirugías","Valor":records.length},
    {"Métrica":"Tasa complicaciones intraop.","Valor":records.length?`${((compl/records.length)*100).toFixed(1)}%`:"—"},
    {"Métrica":"Tasa reintervención","Valor":records.length?`${((reint/records.length)*100).toFixed(1)}%`:"—"},
  ]), "Resumen");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.entries(byType).map(([k,v])=>({Tipo:k,Casos:v}))), "Por tipo");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.entries(byImplant).sort((a,b)=>b[1]-a[1]).slice(0,20).map(([k,v])=>({Implante:k,Casos:v}))), "Implantes top 20");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.entries(byMonth).sort().map(([k,v])=>({Mes:k,Casos:v}))), "Por mes");
  XLSX.writeFile(wb, `QxLog_Memoria_${new Date().getFullYear()}.xlsx`);
};

// UI Components
const SF = ({label,value,onChange,options,required}) => (
  <div className="fg"><label>{label}{required&&<span className="req">*</span>}</label>
    <select value={value} onChange={e=>onChange(e.target.value)}>
      <option value="">— Seleccionar —</option>
      {options.map(o=><option key={typeof o==="string"?o:o.value} value={typeof o==="string"?o:o.value}>{typeof o==="string"?o:o.label}</option>)}
    </select>
  </div>
);
const TF = ({label,value,onChange,placeholder,required,type="text"}) => (
  <div className="fg"><label>{label}{required&&<span className="req">*</span>}</label>
    <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder||""}/>
  </div>
);
const TAF = ({label,value,onChange,placeholder,rows=3}) => (
  <div className="fg"><label>{label}</label>
    <textarea value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder||""} rows={rows}/>
  </div>
);
const CF = ({label,value,onChange}) => (
  <label className="cl"><input type="checkbox" checked={value} onChange={e=>onChange(e.target.checked)}/><span>{label}</span></label>
);

const Bar = ({data,color="#58a6ff"}) => {
  const max = Math.max(...data.map(d=>d.value),1);
  return <div className="chart">{data.map((d,i)=>(
    <div key={i} className="bar-row">
      <div className="bar-label" title={d.label}>{d.label}</div>
      <div className="bar-track"><div className="bar-fill" style={{width:`${(d.value/max)*100}%`,background:color}}/></div>
      <div className="bar-val">{d.value}</div>
    </div>
  ))}</div>;
};

// Renders a radiology image whether it's a legacy inline data URL or a new
// Storage path (resolved to a short-lived signed URL). Renders nothing if empty.
function RxImage({ value, alt = "Rx", style, className }) {
  const needsSign = isStoragePath(value);
  const [signed, setSigned] = useState({ v: null, url: "" });
  useEffect(() => {
    if (!needsSign) return;
    let cancel = false;
    storage.signedUrl(value)
      .then((u) => { if (!cancel) setSigned({ v: value, url: u }); })
      .catch(() => { if (!cancel) setSigned({ v: value, url: "" }); });
    return () => { cancel = true; };
  }, [value, needsSign]);
  // Non-storage values (legacy data:/blob:/http) render directly; storage paths
  // wait for the signed URL that matches the current value.
  const src = needsSign ? (signed.v === value ? signed.url : "") : (value || "");
  if (!src) return null;
  return <img src={src} alt={alt} style={style} className={className} />;
}

function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try { const s = await auth.signIn(email.trim(), password); onLogin(s); }
    catch { setErr("Credenciales incorrectas"); }
    finally { setBusy(false); }
  };
  const wrap = { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0d1117", color: "#e6edf3", fontFamily: "'DM Mono',monospace", padding: 20 };
  const card = { background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 28, width: "100%", maxWidth: 340 };
  const inp = { width: "100%", background: "#0d1117", border: "1px solid #30363d", borderRadius: 8, color: "#e6edf3", fontFamily: "'DM Mono',monospace", fontSize: 13, padding: "9px 11px", marginBottom: 12, outline: "none" };
  const btn = { width: "100%", background: "#58a6ff", color: "#000", border: "none", borderRadius: 8, fontFamily: "'DM Mono',monospace", fontSize: 13, fontWeight: 500, padding: "10px", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 };
  return (
    <div style={wrap}>
      <form style={card} onSubmit={submit}>
        <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 22, color: "#58a6ff", marginBottom: 4 }}>QxLog</div>
        <div style={{ fontSize: 11, color: "#7d8590", marginBottom: 20 }}>Registro quirúrgico · acceso privado</div>
        <input style={inp} type="email" placeholder="Correo" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        <input style={inp} type="password" placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        {err && <div style={{ fontSize: 11, color: "#f85149", marginBottom: 12 }}>{err}</div>}
        <button style={btn} type="submit" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
        {(!SUPABASE_URL || !SUPABASE_KEY) && <div style={{ fontSize: 10, color: "#f85149", marginTop: 12 }}>Falta configurar VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.</div>}
      </form>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(auth.session);
  const [view, setView] = useState("home");
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [records, setRecords] = useState([]);
  const [selected, setSelected] = useState(null);
  const [followForm, setFollowForm] = useState({});
  const [filter, setFilter] = useState("");
  const [filterTipo, setFilterTipo] = useState("");
  const [filterImplante, setFilterImplante] = useState("");
  const [filterYear, setFilterYear] = useState("");
  const [filterAO, setFilterAO] = useState("");
  const [filterAbordaje, setFilterAbordaje] = useState("");
  const [filterCompl, setFilterCompl] = useState("");
  const [filterASA, setFilterASA] = useState("");
  const [filterFechaDesde, setFilterFechaDesde] = useState("");
  const [filterFechaHasta, setFilterFechaHasta] = useState("");
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dbError, setDbError] = useState(false);
  const [quickMode, setQuickMode] = useState(false);
  const [imgPreview, setImgPreview] = useState(null);
  const [uploadingImg, setUploadingImg] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [selectedCols, setSelectedCols] = useState(ALL_COLUMNS.map(c=>c.key));
  const [presentMode, setPresentMode] = useState(false);
  const imgRef = useRef();

  const showToast = (msg,type="success") => { setToast({msg,type}); setTimeout(()=>setToast(null),2500); };

  useEffect(()=>{ onAuthLost = () => { setSession(null); setRecords([]); }; },[]);

  const envMissing = !SUPABASE_URL||!SUPABASE_KEY;
  useEffect(()=>{
    if(!session) return;
    if(envMissing) return;
    let cancelled = false;
    (async()=>{
      if(auth.isExpired()){ const s = await auth.refresh(); if(!s){ setSession(null); return; } }
      setLoading(true);
      try { const data = await db.getAll(); if(!cancelled) setRecords(data); }
      catch { if(!cancelled){ setDbError(true); showToast("Error de conexión","error"); } }
      finally { if(!cancelled) setLoading(false); }
    })();
    return ()=>{ cancelled = true; };
  },[session,envMissing]);

  const handleLogout = async () => { await auth.signOut(); setSession(null); setRecords([]); setView("home"); };

  const set = f => v => setForm(p=>({...p,[f]:v}));

  const handleImageUpload = async e => {
    const file = e.target.files[0];
    if(!file) return;
    setImgPreview(URL.createObjectURL(file)); // instant local preview
    setUploadingImg(true);
    try {
      const compact = await downscaleImage(file);
      const path = await storage.upload(compact);
      setForm(p=>({...p,imagen_url:path}));
      showToast("✓ Imagen subida");
    } catch {
      setImgPreview(null);
      setForm(p=>({...p,imagen_url:""}));
      showToast("Error al subir la imagen","error");
    } finally { setUploadingImg(false); }
  };

  const startEdit = (r) => {
    setForm({...EMPTY,...r});
    setImgPreview(null); // saved image (if any) renders from form.imagen_url via <RxImage>
    setEditId(r.id);
    setStep(1);
    setQuickMode(false);
    setView("new");
  };

  const handleSave = async () => {
    if(!form.fecha||!form.nhc||!form.diagnostico){showToast("Fecha, NHC y diagnóstico son obligatorios","error");return;}
    setLoading(true);
    try {
      if(editId) {
        const [updated] = await db.update(editId, {...form});
        setRecords(p=>p.map(r=>r.id===editId?updated:r));
        showToast("✓ Registro actualizado");
      } else {
        const [saved] = await db.insert({...form,follow_ups:[]});
        setRecords(p=>[saved,...p]);
        showToast("✓ Cirugía registrada");
      }
      setForm(EMPTY); setStep(1); setImgPreview(null); setEditId(null);
      setView("list");
    } catch { showToast("Error al guardar","error"); }
    finally { setLoading(false); }
  };

  const handleDelete = async id => {
    if(!confirm("¿Eliminar este registro?")) return;
    setLoading(true);
    const img = records.find(r=>r.id===id)?.imagen_url;
    try {
      await db.delete(id);
      if(isStoragePath(img)) storage.remove(img); // best effort, don't block
      setRecords(p=>p.filter(r=>r.id!==id)); showToast("Eliminado"); setView("list");
    }
    catch { showToast("Error al eliminar","error"); }
    finally { setLoading(false); }
  };

  const handleAddFollowUp = async id => {
    const record = records.find(r=>r.id===id);
    const updatedFu = [...(record.follow_ups||[]),{...followForm,date:new Date().toISOString()}];
    setLoading(true);
    try {
      const [updated] = await db.update(id,{follow_ups:updatedFu});
      setRecords(p=>p.map(r=>r.id===id?updated:r));
      setSelected(updated); setFollowForm({});
      showToast("✓ Revisión guardada");
    } catch { showToast("Error al guardar revisión","error"); }
    finally { setLoading(false); }
  };

  const handleSaveNotes = async (id, notes) => {
    setLoading(true);
    try {
      const [updated] = await db.update(id,{notas_clinicas:notes});
      setRecords(p=>p.map(r=>r.id===id?updated:r));
      setSelected(updated);
      showToast("✓ Notas guardadas");
    } catch { showToast("Error al guardar notas","error"); }
    finally { setLoading(false); }
  };

  // Filters
  const years = [...new Set(records.map(r=>(r.fecha||"").slice(0,4)).filter(Boolean))].sort().reverse();
  const tipos = [...new Set(records.map(r=>r.tipo_cirugia).filter(Boolean))];
  const implantes = [...new Set(records.map(r=>r.implante_tipo).filter(Boolean))];
  const abordajes = [...new Set(records.map(r=>r.abordaje).filter(Boolean))];

  const filtered = records.filter(r => {
    const q = filter.toLowerCase();
    const matchQ = !filter||(r.diagnostico||"").toLowerCase().includes(q)||(r.nhc||"").includes(q)||(r.implante_tipo||"").toLowerCase().includes(q)||(r.clasificacion_ao||"").toLowerCase().includes(q)||(r.abordaje||"").toLowerCase().includes(q);
    const matchTipo = !filterTipo||r.tipo_cirugia===filterTipo;
    const matchImp = !filterImplante||r.implante_tipo===filterImplante;
    const matchYear = !filterYear||(r.fecha||"").startsWith(filterYear);
    const matchAO = !filterAO||(r.clasificacion_ao||"").toLowerCase().includes(filterAO.toLowerCase());
    const matchAbordaje = !filterAbordaje||r.abordaje===filterAbordaje;
    const matchCompl = !filterCompl||(filterCompl==="si"?r.complicaciones_intra&&!["ninguna","no",""].includes((r.complicaciones_intra||"").toLowerCase().trim()):!r.complicaciones_intra||["ninguna","no",""].includes((r.complicaciones_intra||"").toLowerCase().trim()));
    const matchASA = !filterASA||r.asa===filterASA;
    const matchDesde = !filterFechaDesde||r.fecha>=filterFechaDesde;
    const matchHasta = !filterFechaHasta||r.fecha<=filterFechaHasta;
    return matchQ&&matchTipo&&matchImp&&matchYear&&matchAO&&matchAbordaje&&matchCompl&&matchASA&&matchDesde&&matchHasta;
  });

  const clearFilters = () => {setFilter("");setFilterTipo("");setFilterImplante("");setFilterYear("");setFilterAO("");setFilterAbordaje("");setFilterCompl("");setFilterASA("");setFilterFechaDesde("");setFilterFechaHasta("");};
  const hasFilters = filter||filterTipo||filterImplante||filterYear||filterAO||filterAbordaje||filterCompl||filterASA||filterFechaDesde||filterFechaHasta;

  const stats = {
    total:records.length,
    fracturas:records.filter(r=>r.tipo_cirugia==="Fractura aguda").length,
    electivas:records.filter(r=>r.tipo_cirugia==="Electiva").length,
    artroscopias:records.filter(r=>r.tipo_cirugia==="Artroscopia").length,
    complicaciones:records.filter(r=>r.complicaciones_intra&&!["ninguna","no",""].includes((r.complicaciones_intra||"").toLowerCase().trim())).length,
    reintervenciones:records.filter(r=>r.reintervencion==="Sí").length,
  };

  const byType = tipos.map(t=>({label:t,value:records.filter(r=>r.tipo_cirugia===t).length})).sort((a,b)=>b.value-a.value);
  const byImplant = [...new Set(records.map(r=>r.implante_tipo).filter(Boolean))].map(i=>({label:i,value:records.filter(r=>r.implante_tipo===i).length})).sort((a,b)=>b.value-a.value).slice(0,8);
  const byMonth = (()=>{const m={};records.forEach(r=>{const k=(r.fecha||"").slice(0,7);if(k)m[k]=(m[k]||0)+1;});return Object.entries(m).sort().slice(-12).map(([k,v])=>({label:k.slice(5)+"/"+k.slice(2,4),value:v}));})();
  const learningCurve = (()=>{
    const sorted = [...records].filter(r=>r.fecha&&r.tipo_cirugia).sort((a,b)=>a.fecha.localeCompare(b.fecha));
    const byTypeCurve = {};
    sorted.forEach(r=>{
      if(!byTypeCurve[r.tipo_cirugia]) byTypeCurve[r.tipo_cirugia]=0;
      byTypeCurve[r.tipo_cirugia]++;
    });
    return Object.entries(byTypeCurve).map(([k,v])=>({label:k,value:v})).sort((a,b)=>b.value-a.value);
  })();

  const tagClass = t => t==="Fractura aguda"?"tf":t==="Electiva"?"te":t==="Artroscopia"?"ta":"to";

  // Similar cases
  const getSimilar = r => records.filter(x=>x.id!==r.id&&(x.diagnostico===r.diagnostico||x.implante_tipo===r.implante_tipo)).slice(0,5);

  const [notesEdit, setNotesEdit] = useState("");
  const [editingNotes, setEditingNotes] = useState(false);

  if(!session) return <Login onLogin={setSession}/>;

  return (
    <div className="app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Mono:wght@300;400;500&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        :root{
          --bg:#0d1117;--s1:#161b22;--s2:#1c2330;--bd:#30363d;
          --ac:#58a6ff;--g:#3fb950;--r:#f78166;--p:#d2a8ff;
          --tx:#e6edf3;--tm:#7d8590;--td:#484f58;
          --red:#f85149;--yl:#e3b341;--rr:8px;
        }
        body{background:var(--bg);color:var(--tx);font-family:'DM Mono',monospace;}
        .app{min-height:100vh;display:flex;flex-direction:column;}

        .hdr{background:var(--s1);border-bottom:1px solid var(--bd);padding:0 20px;display:flex;align-items:center;justify-content:space-between;height:56px;position:sticky;top:0;z-index:100;}
        .logo{font-family:'DM Serif Display',serif;font-size:19px;color:var(--ac);white-space:nowrap;}
        .logo span{color:var(--tm);font-size:11px;font-family:'DM Mono',monospace;margin-left:8px;}
        .hdr-r{display:flex;align-items:center;gap:4px;flex-wrap:wrap;}
        .nb{background:none;border:none;color:var(--tm);font-family:'DM Mono',monospace;font-size:11px;padding:5px 9px;border-radius:var(--rr);cursor:pointer;transition:all .15s;white-space:nowrap;}
        .nb:hover{background:var(--s2);color:var(--tx);}
        .nb.act{background:var(--ac);color:#000;font-weight:500;}
        .nb.g{background:var(--g);color:#000;font-weight:500;}
        .nb.outline{border:1px solid var(--bd);}
        .nb.outline:hover{border-color:var(--ac);color:var(--ac);}
        .nb.gout{border:1px solid var(--g);color:var(--g);}
        .nb.pout{border:1px solid var(--p);color:var(--p);}

        .banner{background:rgba(248,81,73,.1);border-bottom:1px solid var(--red);padding:7px 20px;font-size:11px;color:var(--red);text-align:center;}
        .lbar{height:2px;position:fixed;top:56px;left:0;right:0;z-index:99;background:var(--s1);}
        .lbar::after{content:'';display:block;height:100%;background:var(--ac);width:60%;animation:lp 1s ease-in-out infinite alternate;}
        @keyframes lp{from{opacity:.4}to{opacity:1}}

        .main{flex:1;padding:28px 20px;max-width:960px;margin:0 auto;width:100%;}

        .hero{text-align:center;padding:40px 0 32px;}
        .ht{font-family:'DM Serif Display',serif;font-size:40px;line-height:1.1;margin-bottom:10px;}
        .ht em{color:var(--ac);font-style:italic;}
        .hs{color:var(--tm);font-size:12px;max-width:380px;margin:0 auto 32px;line-height:1.6;}
        .sg{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:32px;}
        .sc{background:var(--s1);border:1px solid var(--bd);border-radius:var(--rr);padding:14px 8px;text-align:center;}
        .sn{font-family:'DM Serif Display',serif;font-size:28px;color:var(--ac);line-height:1;}
        .sl{font-size:9px;color:var(--tm);margin-top:3px;text-transform:uppercase;letter-spacing:.5px;}
        .ha{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;}

        .btn{font-family:'DM Mono',monospace;font-size:12px;padding:9px 16px;border-radius:var(--rr);border:1px solid transparent;cursor:pointer;transition:all .15s;font-weight:500;}
        .btn:disabled{opacity:.5;cursor:not-allowed;}
        .bp{background:var(--ac);color:#000;border-color:var(--ac);}
        .bp:hover:not(:disabled){background:#79c0ff;}
        .bs{background:var(--s1);color:var(--tx);border-color:var(--bd);}
        .bs:hover:not(:disabled){border-color:var(--ac);color:var(--ac);}
        .bd2{background:var(--s1);color:var(--red);border-color:var(--bd);}
        .bd2:hover:not(:disabled){border-color:var(--red);}
        .bg2{background:var(--g);color:#000;}
        .bsm{font-size:11px;padding:5px 10px;}
        .byel{background:var(--s1);color:var(--yl);border-color:var(--bd);}
        .byel:hover{border-color:var(--yl);}

        .stp{display:flex;align-items:center;margin-bottom:24px;}
        .si{display:flex;align-items:center;flex:1;}
        .sd{width:28px;height:28px;border-radius:50%;border:2px solid var(--bd);display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;background:var(--s1);transition:all .2s;cursor:pointer;}
        .sd.act{border-color:var(--ac);background:var(--ac);}
        .sd.done{border-color:var(--g);background:var(--g);}
        .sl2{flex:1;height:1px;background:var(--bd);}
        .sl2.done{background:var(--g);}

        .fh{margin-bottom:20px;}
        .ft{font-family:'DM Serif Display',serif;font-size:20px;margin-bottom:3px;}
        .fs{font-size:11px;color:var(--tm);}
        .fg{display:flex;flex-direction:column;gap:5px;}
        .fg label{font-size:10px;color:var(--tm);text-transform:uppercase;letter-spacing:.5px;}
        .req{color:var(--red);margin-left:3px;}
        .fg input,.fg select,.fg textarea{background:var(--s1);border:1px solid var(--bd);border-radius:var(--rr);color:var(--tx);font-family:'DM Mono',monospace;font-size:12px;padding:7px 10px;outline:none;transition:border-color .15s;width:100%;}
        .fg input:focus,.fg select:focus,.fg textarea:focus{border-color:var(--ac);}
        .fg select option{background:var(--s2);}
        .fg textarea{resize:vertical;}
        .g2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;}
        .g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:14px;}
        .g1{display:grid;grid-template-columns:1fr;gap:12px;margin-bottom:14px;}
        .cl{display:flex;align-items:center;gap:7px;cursor:pointer;font-size:12px;}
        .cl input[type=checkbox]{accent-color:var(--ac);width:13px;height:13px;}
        .cr{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:12px;}
        .div{border:none;border-top:1px solid var(--bd);margin:14px 0;}
        .fa{display:flex;justify-content:space-between;align-items:center;margin-top:24px;padding-top:14px;border-top:1px solid var(--bd);}

        .img-box{border:2px dashed var(--bd);border-radius:var(--rr);padding:16px;text-align:center;cursor:pointer;transition:border-color .15s;background:var(--s1);}
        .img-box:hover{border-color:var(--ac);}
        .img-box input{display:none;}
        .img-preview{max-width:100%;border-radius:var(--rr);margin-top:8px;border:1px solid var(--bd);}
        .img-label{font-size:11px;color:var(--tm);}

        /* FILTERS */
        .filter-panel{background:var(--s1);border:1px solid var(--bd);border-radius:var(--rr);padding:16px;margin-bottom:16px;}
        .filter-title{font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:var(--tm);margin-bottom:12px;}
        .filter-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:8px;}
        .filter-grid2{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;}
        .fi{display:flex;flex-direction:column;gap:4px;}
        .fi label{font-size:9px;color:var(--td);text-transform:uppercase;letter-spacing:.5px;}
        .fi input,.fi select{background:var(--s2);border:1px solid var(--bd);border-radius:var(--rr);color:var(--tx);font-family:'DM Mono',monospace;font-size:11px;padding:6px 8px;outline:none;}
        .fi input:focus,.fi select:focus{border-color:var(--ac);}
        .filter-actions{display:flex;justify-content:space-between;align-items:center;margin-top:10px;}
        .filter-count{font-size:11px;color:var(--tm);}
        .active-filter-badge{font-size:9px;background:var(--ac);color:#000;padding:2px 6px;border-radius:10px;margin-left:6px;font-weight:500;}

        .lh{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:10px;flex-wrap:wrap;}
        .lt{font-family:'DM Serif Display',serif;font-size:24px;}
        .rc{background:var(--s1);border:1px solid var(--bd);border-radius:var(--rr);padding:12px 16px;margin-bottom:7px;cursor:pointer;transition:all .15s;display:flex;align-items:center;gap:12px;}
        .rc:hover{border-color:var(--ac);background:var(--s2);}
        .rd{font-size:10px;color:var(--tm);min-width:82px;}
        .rx{flex:1;font-size:12px;}
        .rx strong{color:var(--tx);display:block;margin-bottom:1px;}
        .rx span{color:var(--tm);font-size:10px;}
        .tag{font-size:9px;padding:2px 7px;border-radius:20px;border:1px solid;white-space:nowrap;font-weight:500;}
        .tf{color:var(--r);border-color:var(--r);background:rgba(247,129,102,.1);}
        .te{color:var(--p);border-color:var(--p);background:rgba(210,168,255,.1);}
        .ta{color:var(--g);border-color:var(--g);background:rgba(63,185,80,.1);}
        .to{color:var(--yl);border-color:var(--yl);background:rgba(227,179,65,.1);}
        .tfu{color:var(--ac);border-color:var(--ac);background:rgba(88,166,255,.1);}

        .dh{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;gap:12px;}
        .dt{font-family:'DM Serif Display',serif;font-size:26px;line-height:1.2;}
        .dm{font-size:11px;color:var(--tm);margin-top:4px;}
        .da{display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;}
        .ib{background:var(--s1);border:1px solid var(--bd);border-radius:var(--rr);padding:16px;margin-bottom:12px;}
        .ibt{font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:var(--tm);margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--bd);}
        .ig{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}
        .ii label{font-size:9px;color:var(--td);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:2px;}
        .ii span{font-size:11px;}
        .empty{color:var(--td);}
        .fui{background:var(--s2);border:1px solid var(--bd);border-radius:var(--rr);padding:10px 12px;margin-bottom:6px;font-size:11px;}
        .fud{font-size:9px;color:var(--tm);margin-bottom:4px;}
        .afs{background:var(--s1);border:1px dashed var(--bd);border-radius:var(--rr);padding:16px;margin-top:12px;}
        .aft{font-size:11px;color:var(--ac);margin-bottom:12px;text-transform:uppercase;letter-spacing:.5px;}

        /* NOTES */
        .notes-box{background:var(--s2);border:1px solid var(--bd);border-radius:var(--rr);padding:12px;font-size:12px;color:var(--tx);min-height:80px;line-height:1.6;white-space:pre-wrap;}
        .notes-edit{background:var(--s2);border:1px solid var(--ac);border-radius:var(--rr);padding:12px;font-size:12px;color:var(--tx);width:100%;resize:vertical;font-family:'DM Mono',monospace;min-height:100px;}

        /* SIMILAR */
        .similar-card{background:var(--s2);border:1px solid var(--bd);border-radius:var(--rr);padding:10px 12px;margin-bottom:6px;cursor:pointer;transition:all .15s;font-size:11px;}
        .similar-card:hover{border-color:var(--ac);}

        /* STATS */
        .kpi-row{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px;}
        .kpi{background:var(--s1);border:1px solid var(--bd);border-radius:var(--rr);padding:14px;text-align:center;}
        .kpi-n{font-family:'DM Serif Display',serif;font-size:26px;line-height:1;}
        .kpi-l{font-size:9px;color:var(--tm);margin-top:3px;text-transform:uppercase;}
        .stats-grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
        .stat-block{background:var(--s1);border:1px solid var(--bd);border-radius:var(--rr);padding:16px;}
        .stat-block-title{font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:var(--tm);margin-bottom:12px;padding-bottom:6px;border-bottom:1px solid var(--bd);}
        .chart{display:flex;flex-direction:column;gap:7px;}
        .bar-row{display:flex;align-items:center;gap:7px;}
        .bar-label{font-size:10px;color:var(--tm);min-width:110px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .bar-track{flex:1;background:var(--s2);border-radius:3px;height:7px;overflow:hidden;}
        .bar-fill{height:100%;border-radius:3px;transition:width .4s ease;}
        .bar-val{font-size:10px;color:var(--tx);min-width:20px;text-align:right;}

        /* EXPORT MODAL */
        .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px;}
        .modal{background:var(--s1);border:1px solid var(--bd);border-radius:var(--rr);padding:24px;max-width:600px;width:100%;max-height:80vh;overflow-y:auto;}
        .modal-title{font-family:'DM Serif Display',serif;font-size:20px;margin-bottom:16px;}
        .col-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:16px;}
        .col-item{display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer;}
        .col-item input{accent-color:var(--ac);}
        .modal-actions{display:flex;gap:8px;justify-content:flex-end;}

        /* PRESENT MODE */
        .present-overlay{position:fixed;inset:0;background:#000;z-index:300;overflow-y:auto;padding:40px;}
        .present-content{max-width:800px;margin:0 auto;}
        .present-title{font-family:'DM Serif Display',serif;font-size:36px;margin-bottom:8px;color:#fff;}
        .present-meta{font-size:13px;color:#666;margin-bottom:32px;}
        .present-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;}
        .present-block{background:#111;border:1px solid #222;border-radius:8px;padding:16px;}
        .present-block-title{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#444;margin-bottom:12px;}
        .present-item{margin-bottom:8px;}
        .present-item label{font-size:9px;color:#555;text-transform:uppercase;display:block;margin-bottom:2px;}
        .present-item span{font-size:13px;color:#ccc;}
        .present-close{position:fixed;top:20px;right:20px;background:#111;border:1px solid #333;color:#fff;padding:8px 16px;border-radius:6px;cursor:pointer;font-family:'DM Mono',monospace;font-size:12px;}

        .toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);font-family:'DM Mono',monospace;font-size:12px;font-weight:500;padding:10px 20px;border-radius:40px;z-index:999;animation:fu .3s ease;}
        .toast.success{background:var(--g);color:#000;}
        .toast.error{background:var(--red);color:#fff;}
        @keyframes fu{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}

        .empty-state{text-align:center;padding:50px 0;color:var(--tm);font-size:12px;}
        .empty-state .big{font-size:40px;margin-bottom:8px;}
        .pg-title{font-family:'DM Serif Display',serif;font-size:26px;margin-bottom:20px;}
        .edit-badge{background:var(--yl);color:#000;font-size:9px;padding:2px 7px;border-radius:10px;margin-left:8px;font-weight:500;}

        @media(max-width:600px){
          .sg{grid-template-columns:repeat(3,1fr);}
          .g2,.g3{grid-template-columns:1fr;}
          .ig{grid-template-columns:1fr 1fr;}
          .logo span{display:none;}
          .stats-grid2{grid-template-columns:1fr;}
          .kpi-row{grid-template-columns:1fr 1fr;}
          .filter-grid{grid-template-columns:1fr 1fr;}
          .filter-grid2{grid-template-columns:1fr 1fr;}
          .col-grid{grid-template-columns:1fr 1fr;}
          .present-grid{grid-template-columns:1fr;}
        }
      `}</style>

      {/* PRESENT MODE */}
      {presentMode && selected && (
        <div className="present-overlay">
          <button className="present-close" onClick={()=>setPresentMode(false)}>✕ Cerrar</button>
          <div className="present-content">
            <div className="present-title">{selected.diagnostico||"Sin diagnóstico"}</div>
            <div className="present-meta">NHC: {selected.nhc||"—"} · {selected.edad?`${selected.edad} años`:"—"} · {selected.sexo||"—"} · {selected.fecha||"—"}</div>
            <div className="present-grid">
              <div className="present-block">
                <div className="present-block-title">Clasificación</div>
                <div className="present-item"><label>Tipo cirugía</label><span>{selected.tipo_cirugia||"—"}</span></div>
                <div className="present-item"><label>AO/OTA</label><span>{selected.clasificacion_ao||"—"}</span></div>
                <div className="present-item"><label>Clasificación específica</label><span>{selected.clasificacion_nombre?`${selected.clasificacion_nombre}: ${selected.clasificacion_especifica}`:"—"}</span></div>
              </div>
              <div className="present-block">
                <div className="present-block-title">Riesgo</div>
                <div className="present-item"><label>ASA</label><span>{selected.asa||"—"}</span></div>
                <div className="present-item"><label>Anticoagulación</label><span>{selected.anticoagulacion||"—"}</span></div>
                <div className="present-item"><label>Osteoporosis</label><span>{selected.osteoporosis||"—"}</span></div>
              </div>
              <div className="present-block">
                <div className="present-block-title">Cirugía</div>
                <div className="present-item"><label>Posición</label><span>{selected.posicion||"—"}</span></div>
                <div className="present-item"><label>Abordaje</label><span>{selected.abordaje||"—"}</span></div>
                <div className="present-item"><label>Implante</label><span>{[selected.implante_marca,selected.implante_tipo].filter(Boolean).join(" — ")||"—"}</span></div>
                <div className="present-item"><label>Torniquete</label><span>{selected.torniquete||"—"}</span></div>
              </div>
              <div className="present-block">
                <div className="present-block-title">Resultado</div>
                <div className="present-item"><label>Complicaciones intraop.</label><span>{selected.complicaciones_intra||"—"}</span></div>
                <div className="present-item"><label>Carga prescrita</label><span>{selected.carga_prescrita||"—"}</span></div>
                <div className="present-item"><label>Consolidación</label><span>{selected.consolidacion||"—"}</span></div>
                <div className="present-item"><label>Resultado funcional</label><span>{selected.resultado_escala?`${selected.resultado_escala}: ${selected.resultado_funcional}`:"—"}</span></div>
              </div>
            </div>
            {selected.tecnica&&<div className="present-block" style={{marginBottom:20}}><div className="present-block-title">Técnica quirúrgica</div><p style={{fontSize:13,color:"#bbb",lineHeight:1.6}}>{selected.tecnica}</p></div>}
            {selected.imagen_url&&<RxImage value={selected.imagen_url} style={{maxWidth:"100%",borderRadius:8,border:"1px solid #222"}}/>}
          </div>
        </div>
      )}

      {/* EXPORT MODAL */}
      {showExportModal && (
        <div className="modal-overlay" onClick={()=>setShowExportModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-title">Exportar Excel personalizado</div>
            <div style={{fontSize:11,color:"var(--tm)",marginBottom:12}}>Selecciona las columnas que quieres incluir ({filtered.length} registros)</div>
            <div style={{display:"flex",gap:8,marginBottom:12}}>
              <button className="btn bs bsm" onClick={()=>setSelectedCols(ALL_COLUMNS.map(c=>c.key))}>Todas</button>
              <button className="btn bs bsm" onClick={()=>setSelectedCols([])}>Ninguna</button>
              <button className="btn bs bsm" onClick={()=>setSelectedCols(["fecha","nhc","edad","sexo","tipo_cirugia","diagnostico","clasificacion_ao","implante_tipo","complicaciones_intra"])}>Solo esenciales</button>
            </div>
            <div className="col-grid">
              {ALL_COLUMNS.map(col=>(
                <label key={col.key} className="col-item">
                  <input type="checkbox" checked={selectedCols.includes(col.key)} onChange={e=>{if(e.target.checked)setSelectedCols(p=>[...p,col.key]);else setSelectedCols(p=>p.filter(k=>k!==col.key));}}/>
                  {col.label}
                </label>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn bs" onClick={()=>setShowExportModal(false)}>Cancelar</button>
              <button className="btn bg2" onClick={()=>{exportCustom(filtered,ALL_COLUMNS.filter(c=>selectedCols.includes(c.key)));setShowExportModal(false);}}>↓ Exportar {filtered.length} registros</button>
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <header className="hdr">
        <div className="logo">QxLog <span>COT · Manises</span></div>
        <div className="hdr-r">
          <button className={`nb ${view==="home"?"act":""}`} onClick={()=>setView("home")}>Inicio</button>
          <button className={`nb ${view==="new"&&!editId?"act":""}`} onClick={()=>{setView("new");setStep(1);setForm(EMPTY);setImgPreview(null);setEditId(null);setQuickMode(false);}}>+ Nueva</button>
          <button className="nb g" onClick={()=>{setView("new");setStep(1);setForm(EMPTY);setImgPreview(null);setEditId(null);setQuickMode(true);}}>⚡</button>
          <button className={`nb ${view==="list"?"act":""}`} onClick={()=>setView("list")}>Registro ({records.length})</button>
          <button className={`nb ${view==="stats"?"act":""}`} onClick={()=>setView("stats")}>Stats</button>
          {records.length>0&&<>
            <button className="nb outline" onClick={()=>setShowExportModal(true)}>↓ Excel</button>
            <button className="nb pout" onClick={()=>generateMemoria(records)}>📄</button>
          </>}
          <button className="nb outline" onClick={handleLogout} title="Cerrar sesión">Salir</button>
        </div>
      </header>

      {(dbError||envMissing)&&<div className="banner">⚠️ Sin conexión a Supabase — configura VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY</div>}
      {loading&&<div className="lbar"/>}

      <main className="main">

        {/* HOME */}
        {view==="home"&&<>
          <div className="hero">
            <div className="ht">Registro<br/><em>quirúrgico</em><br/>personal</div>
            <div className="hs">Base de datos permanente · R3 COT · Hospital de Manises</div>
          </div>
          <div className="sg">
            <div className="sc"><div className="sn">{stats.total}</div><div className="sl">Total</div></div>
            <div className="sc"><div className="sn" style={{color:"var(--r)"}}>{stats.fracturas}</div><div className="sl">Fracturas</div></div>
            <div className="sc"><div className="sn" style={{color:"var(--p)"}}>{stats.electivas}</div><div className="sl">Electivas</div></div>
            <div className="sc"><div className="sn" style={{color:"var(--g)"}}>{stats.artroscopias}</div><div className="sl">Artroscopias</div></div>
            <div className="sc"><div className="sn" style={{color:"var(--red)"}}>{stats.complicaciones}</div><div className="sl">Complic.</div></div>
            <div className="sc"><div className="sn" style={{color:"var(--yl)"}}>{stats.reintervenciones}</div><div className="sl">Reinterv.</div></div>
          </div>
          <div className="ha">
            <button className="btn bp" onClick={()=>{setView("new");setStep(1);setForm(EMPTY);setImgPreview(null);setEditId(null);setQuickMode(false);}}>+ Registrar cirugía</button>
            <button className="btn bg2" onClick={()=>{setView("new");setStep(1);setForm(EMPTY);setImgPreview(null);setEditId(null);setQuickMode(true);}}>⚡ Modo rápido</button>
            <button className="btn bs" onClick={()=>setView("stats")}>Ver estadísticas</button>
            {records.length>0&&<button className="btn bs" onClick={()=>setShowExportModal(true)}>↓ Exportar Excel</button>}
            {records.length>0&&<button className="btn bs" onClick={()=>generateMemoria(records)}>📄 Generar memoria</button>}
          </div>
        </>}

        {/* ESTADÍSTICAS */}
        {view==="stats"&&<>
          <div className="pg-title">Estadísticas</div>
          <div className="kpi-row">
            <div className="kpi"><div className="kpi-n">{stats.total}</div><div className="kpi-l">Total cirugías</div></div>
            <div className="kpi"><div className="kpi-n" style={{color:"var(--red)"}}>{stats.total?((stats.complicaciones/stats.total)*100).toFixed(1):0}%</div><div className="kpi-l">Tasa complicaciones</div></div>
            <div className="kpi"><div className="kpi-n" style={{color:"var(--yl)"}}>{stats.total?((stats.reintervenciones/stats.total)*100).toFixed(1):0}%</div><div className="kpi-l">Tasa reintervención</div></div>
          </div>
          {records.length===0?<div className="empty-state"><div className="big">📊</div>Sin datos aún.</div>:
          <div className="stats-grid2">
            <div className="stat-block"><div className="stat-block-title">Casos por tipo</div><Bar data={byType} color="#58a6ff"/></div>
            <div className="stat-block"><div className="stat-block-title">Implantes top 8</div><Bar data={byImplant} color="#d2a8ff"/></div>
            <div className="stat-block"><div className="stat-block-title">Casos por mes (últimos 12)</div><Bar data={byMonth} color="#3fb950"/></div>
            <div className="stat-block"><div className="stat-block-title">Curva de aprendizaje por tipo</div><Bar data={learningCurve} color="#e3b341"/></div>
          </div>}
        </>}

        {/* NUEVO / EDITAR */}
        {view==="new"&&<>
          {editId&&<div style={{marginBottom:16,display:"flex",alignItems:"center"}}><span style={{fontSize:13,color:"var(--yl)",fontWeight:500}}>Editando registro</span><span className="edit-badge">Los cambios sobreescriben el original</span></div>}
          {quickMode&&!editId&&<div style={{marginBottom:16,fontSize:13,color:"var(--g)",fontWeight:500}}>⚡ Modo rápido</div>}

          {!quickMode&&<div className="stp">
            {STEPS.map((s,i)=>(
              <div key={s.id} className="si">
                <div className={`sd ${step===s.id?"act":step>s.id?"done":""}`} onClick={()=>step>s.id&&setStep(s.id)} title={s.label}>{step>s.id?"✓":s.icon}</div>
                {i<STEPS.length-1&&<div className={`sl2 ${step>s.id?"done":""}`}/>}
              </div>
            ))}
          </div>}

          {quickMode&&!editId&&<>
            <div className="g3"><TF label="Fecha" value={form.fecha} onChange={set("fecha")} type="date" required/><TF label="NHC" value={form.nhc} onChange={set("nhc")} placeholder="Nº historia" required/><TF label="Edad" value={form.edad} onChange={set("edad")} type="number"/></div>
            <div className="g3"><SF label="Sexo" value={form.sexo} onChange={set("sexo")} options={["Hombre","Mujer"]}/><SF label="Lado" value={form.lado} onChange={set("lado")} options={["Derecho","Izquierdo","Bilateral","No aplica"]}/><SF label="Tipo de cirugía" value={form.tipo_cirugia} onChange={set("tipo_cirugia")} required options={["Fractura aguda","Electiva","Artroscopia","Revisión / reintervención","Urgencia no traumática","Otra"]}/></div>
            <div className="g2"><TF label="Diagnóstico" value={form.diagnostico} onChange={set("diagnostico")} placeholder="fractura distal de radio…" required/><TF label="Código AO/OTA" value={form.clasificacion_ao} onChange={set("clasificacion_ao")} placeholder="23-C2…"/></div>
            <div className="g2"><SF label="Posición" value={form.posicion} onChange={set("posicion")} options={["Decúbito supino","Decúbito prono","Decúbito lateral derecho","Decúbito lateral izquierdo","Silla de playa","Trendelenburg","Otra"]}/><TF label="Abordaje" value={form.abordaje} onChange={set("abordaje")} placeholder="volar de Henry…"/></div>
            <div className="g2"><TF label="Implante marca" value={form.implante_marca} onChange={set("implante_marca")} placeholder="Synthes…"/><TF label="Implante tipo/ref." value={form.implante_tipo} onChange={set("implante_tipo")} placeholder="LCP 3.5 volar…"/></div>
            <div className="g1"><TF label="Complicaciones intraoperatorias" value={form.complicaciones_intra} onChange={set("complicaciones_intra")} placeholder="Ninguna…"/></div>
            <div className="g1"><TF label="Carga prescrita" value={form.carga_prescrita} onChange={set("carga_prescrita")} placeholder="sin carga 6 semanas…"/></div>
            <div className="fa">
              <button className="btn bs" onClick={()=>setView("home")}>Cancelar</button>
              <button className="btn bg2" onClick={handleSave} disabled={loading}>{loading?"Guardando…":"✓ Guardar"}</button>
            </div>
          </>}

          {(!quickMode||editId)&&<>
            {step===1&&<>
              <div className="fh"><div className="ft">Identificación del paciente</div><div className="fs">Datos básicos del caso</div></div>
              <div className="g3"><TF label="Fecha de cirugía" value={form.fecha} onChange={set("fecha")} type="date" required/><TF label="NHC" value={form.nhc} onChange={set("nhc")} placeholder="Nº historia clínica" required/><TF label="Edad" value={form.edad} onChange={set("edad")} placeholder="años" type="number"/></div>
              <div className="g3"><SF label="Sexo" value={form.sexo} onChange={set("sexo")} options={["Hombre","Mujer"]}/><SF label="Lado" value={form.lado} onChange={set("lado")} options={["Derecho","Izquierdo","Bilateral","No aplica"]}/></div>
            </>}
            {step===2&&<>
              <div className="fh"><div className="ft">Comorbilidades y riesgo</div><div className="fs">Estado preoperatorio</div></div>
              <div className="g2"><SF label="ASA" value={form.asa} onChange={set("asa")} options={[{value:"I",label:"ASA I — Sano"},{value:"II",label:"ASA II — Enfermedad leve"},{value:"III",label:"ASA III — Enfermedad severa"},{value:"IV",label:"ASA IV — Riesgo vital constante"}]}/><SF label="Anticoagulación" value={form.anticoagulacion} onChange={set("anticoagulacion")} options={["No","Sí — suspendida","Sí — mantenida","Bridging"]}/></div>
              {form.anticoagulacion&&form.anticoagulacion!=="No"&&<div className="g1"><TF label="Fármaco anticoagulante" value={form.anticoagulacion_farmaco} onChange={set("anticoagulacion_farmaco")} placeholder="acenocumarol, rivaroxabán…"/></div>}
              <div className="g1"><SF label="Osteoporosis" value={form.osteoporosis} onChange={set("osteoporosis")} options={["No","Osteopenia","Osteoporosis confirmada","Desconocido"]}/></div>
              <hr className="div"/>
              <div className="cr"><CF label="HTA" value={form.hta} onChange={set("hta")}/><CF label="Diabetes" value={form.diabetes} onChange={set("diabetes")}/><CF label="IRC" value={form.irc} onChange={set("irc")}/><CF label="EPOC" value={form.epoc} onChange={set("epoc")}/></div>
              <div className="g1"><TF label="Otras comorbilidades" value={form.otras_comorbilidades} onChange={set("otras_comorbilidades")} placeholder="hepatopatía, neoplasia…"/></div>
            </>}
            {step===3&&<>
              <div className="fh"><div className="ft">Diagnóstico y clasificación</div><div className="fs">Patología intervenida</div></div>
              <div className="g2"><SF label="Tipo de cirugía" value={form.tipo_cirugia} onChange={set("tipo_cirugia")} required options={["Fractura aguda","Electiva","Artroscopia","Revisión / reintervención","Urgencia no traumática","Otra"]}/><TF label="Diagnóstico" value={form.diagnostico} onChange={set("diagnostico")} placeholder="fractura distal de radio…" required/></div>
              <hr className="div"/>
              <div className="g1"><TF label="Código AO/OTA" value={form.clasificacion_ao} onChange={set("clasificacion_ao")} placeholder="23-C2, 31-A2…"/></div>
              <hr className="div"/>
              <div className="g2"><SF label="Clasificación adicional" value={form.clasificacion_nombre} onChange={set("clasificacion_nombre")} options={CLASIFICACIONES}/><TF label="Grado / subtipo" value={form.clasificacion_especifica} onChange={set("clasificacion_especifica")} placeholder="Garden III, Schatzker V…"/></div>
            </>}
            {step===4&&<>
              <div className="fh"><div className="ft">Detalles quirúrgicos</div><div className="fs">Técnica, implante y equipo</div></div>
              <div className="g2"><SF label="Posición del paciente" value={form.posicion} onChange={set("posicion")} options={["Decúbito supino","Decúbito prono","Decúbito lateral derecho","Decúbito lateral izquierdo","Silla de playa","Trendelenburg","Otra"]}/><SF label="Torniquete" value={form.torniquete} onChange={set("torniquete")} options={["No","Sí — isquemia total","Sí — isquemia parcial"]}/></div>
              <div className="g1"><TF label="Abordaje quirúrgico" value={form.abordaje} onChange={set("abordaje")} placeholder="volar de Henry, posterolateral de codo…"/></div>
              <div className="g1"><TAF label="Técnica quirúrgica" value={form.tecnica} onChange={set("tecnica")} placeholder="Descripción breve"/></div>
              <hr className="div"/>
              <div className="g2"><TF label="Implante — Marca" value={form.implante_marca} onChange={set("implante_marca")} placeholder="Synthes, Stryker, Arthrex…"/><TF label="Implante — Tipo/referencia" value={form.implante_tipo} onChange={set("implante_tipo")} placeholder="LCP 3.5 volar, Expert tibial nail…"/></div>
              <div className="g2"><SF label="Injerto / material biológico" value={form.injerto} onChange={set("injerto")} options={["No","Autoinjerto esponjoso","Aloinjerto","Sustituto sintético","PRF/PRP","Otro"]}/><TF label="Ayudante" value={form.ayudante} onChange={set("ayudante")} placeholder="R1, R2, adjunto…"/></div>
              {form.injerto&&form.injerto!=="No"&&<div className="g1"><TF label="Detalle del injerto" value={form.injerto_cual} onChange={set("injerto_cual")} placeholder="Zona donante, marca comercial…"/></div>}
              <hr className="div"/>
              <div className="fg" style={{marginBottom:14}}>
                <label>Imagen radiológica (Rx pre/postoperatoria)</label>
                <div className="img-box" onClick={()=>!uploadingImg&&imgRef.current.click()}>
                  <input ref={imgRef} type="file" accept="image/*" onChange={handleImageUpload}/>
                  {uploadingImg?<div className="img-label">Subiendo imagen…</div>
                   :imgPreview?<img src={imgPreview} alt="Rx" className="img-preview"/>
                   :form.imagen_url?<RxImage value={form.imagen_url} className="img-preview"/>
                   :<div className="img-label">📷 Toca para adjuntar imagen</div>}
                </div>
              </div>
            </>}
            {step===5&&<>
              <div className="fh"><div className="ft">Postoperatorio inmediato</div><div className="fs">Incidencias y prescripción al alta</div></div>
              <div className="g1"><TAF label="Complicaciones intraoperatorias" value={form.complicaciones_intra} onChange={set("complicaciones_intra")} placeholder="Ninguna / sangrado mayor, dificultad técnica…"/></div>
              <div className="g1"><TF label="Prescripción de carga / movilización" value={form.carga_prescrita} onChange={set("carga_prescrita")} placeholder="sin carga 6 semanas, carga parcial inmediata…"/></div>
              <div className="g1"><TAF label="Observaciones" value={form.observaciones} onChange={set("observaciones")} placeholder="Cualquier dato relevante adicional"/></div>
              <div className="g1"><TAF label="Notas clínicas personales" value={form.notas_clinicas} onChange={set("notas_clinicas")} placeholder="Reflexiones técnicas, dificultades, aprendizajes…" rows={4}/></div>
            </>}
            {step===6&&<>
              <div className="fh"><div className="ft">Seguimiento inicial (opcional)</div><div className="fs">Puedes añadirlo después desde el registro</div></div>
              <div className="g2"><TF label="Fecha de primera revisión" value={form.fecha_revision} onChange={set("fecha_revision")} type="date"/><SF label="Consolidación radiológica" value={form.consolidacion} onChange={set("consolidacion")} options={["Sí — completa","Parcial / callo incipiente","No consolidado / retardo","No aplica"]}/></div>
              <div className="g1"><TAF label="Complicación tardía" value={form.complicacion_tardia} onChange={set("complicacion_tardia")} placeholder="Ninguna / describir…"/></div>
              <div className="g2"><SF label="Escala funcional" value={form.resultado_escala} onChange={set("resultado_escala")} options={["QuickDASH","DASH","WOMAC","Oxford Knee","Oxford Hip","AOFAS","EVA dolor","Otra"]}/><TF label="Puntuación" value={form.resultado_funcional} onChange={set("resultado_funcional")} type="number"/></div>
              <div className="g2"><SF label="Reintervención" value={form.reintervencion} onChange={set("reintervencion")} options={["No","Sí"]}/>{form.reintervencion==="Sí"&&<TF label="Motivo" value={form.reintervencion_motivo} onChange={set("reintervencion_motivo")}/>}</div>
            </>}
            <div className="fa">
              <button className="btn bs" onClick={()=>step>1?setStep(s=>s-1):(setView("list"),setEditId(null))}>{step>1?"← Anterior":"Cancelar"}</button>
              <div style={{fontSize:10,color:"var(--tm)"}}>Paso {step} de {STEPS.length}</div>
              {step<STEPS.length?<button className="btn bp" onClick={()=>setStep(s=>s+1)}>Siguiente →</button>:<button className="btn bg2" onClick={handleSave} disabled={loading}>{loading?"Guardando…":editId?"✓ Guardar cambios":"✓ Guardar registro"}</button>}
            </div>
          </>}
        </>}

        {/* LISTA */}
        {view==="list"&&<>
          <div className="lh">
            <div className="lt">Registro quirúrgico {hasFilters&&<span className="active-filter-badge">{filtered.length} filtrados</span>}</div>
            <div style={{display:"flex",gap:6}}>
              {records.length>0&&<button className="btn bs bsm" onClick={()=>setShowExportModal(true)}>↓ Excel ({filtered.length})</button>}
              <button className="btn bp bsm" onClick={()=>{setView("new");setStep(1);setForm(EMPTY);setImgPreview(null);setEditId(null);setQuickMode(false);}}>+ Nueva</button>
            </div>
          </div>

          {/* FILTER PANEL */}
          <div className="filter-panel">
            <div className="filter-title">Filtros</div>
            <div className="filter-grid">
              <div className="fi"><label>Buscar</label><input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="diagnóstico, NHC…"/></div>
              <div className="fi"><label>Tipo cirugía</label><select value={filterTipo} onChange={e=>setFilterTipo(e.target.value)}><option value="">Todos</option>{tipos.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
              <div className="fi"><label>Implante</label><select value={filterImplante} onChange={e=>setFilterImplante(e.target.value)}><option value="">Todos</option>{implantes.map(i=><option key={i} value={i}>{i}</option>)}</select></div>
              <div className="fi"><label>Año</label><select value={filterYear} onChange={e=>setFilterYear(e.target.value)}><option value="">Todos</option>{years.map(y=><option key={y} value={y}>{y}</option>)}</select></div>
            </div>
            <div className="filter-grid2">
              <div className="fi"><label>Clasificación AO</label><input value={filterAO} onChange={e=>setFilterAO(e.target.value)} placeholder="31-A2…"/></div>
              <div className="fi"><label>Abordaje</label><select value={filterAbordaje} onChange={e=>setFilterAbordaje(e.target.value)}><option value="">Todos</option>{abordajes.map(a=><option key={a} value={a}>{a}</option>)}</select></div>
              <div className="fi"><label>ASA</label><select value={filterASA} onChange={e=>setFilterASA(e.target.value)}><option value="">Todos</option>{["I","II","III","IV"].map(a=><option key={a} value={a}>ASA {a}</option>)}</select></div>
              <div className="fi"><label>Complicaciones</label><select value={filterCompl} onChange={e=>setFilterCompl(e.target.value)}><option value="">Todos</option><option value="si">Con complicaciones</option><option value="no">Sin complicaciones</option></select></div>
              <div className="fi"><label>Fecha desde</label><input type="date" value={filterFechaDesde} onChange={e=>setFilterFechaDesde(e.target.value)}/></div>
              <div className="fi"><label>Fecha hasta</label><input type="date" value={filterFechaHasta} onChange={e=>setFilterFechaHasta(e.target.value)}/></div>
            </div>
            <div className="filter-actions">
              <div className="filter-count">{filtered.length} de {records.length} registros</div>
              {hasFilters&&<button className="btn bs bsm" onClick={clearFilters}>✕ Limpiar filtros</button>}
            </div>
          </div>

          {filtered.length===0?<div className="empty-state"><div className="big">🦴</div>{records.length===0?"Aún no hay cirugías registradas.":"Sin resultados con estos filtros."}</div>:
          filtered.map(r=>(
            <div key={r.id} className="rc" onClick={()=>{setSelected(r);setView("detail");}}>
              <div className="rd">{r.fecha||"—"}</div>
              <div className="rx"><strong>{r.diagnostico||"Sin diagnóstico"}</strong><span>{r.nhc?`NHC: ${r.nhc}`:""}{r.edad?` · ${r.edad}a`:""}{r.clasificacion_ao?` · AO: ${r.clasificacion_ao}`:""}{r.implante_tipo?` · ${r.implante_tipo}`:""}</span></div>
              {r.tipo_cirugia&&<span className={`tag ${tagClass(r.tipo_cirugia)}`}>{r.tipo_cirugia}</span>}
              {r.follow_ups?.length>0&&<span className="tag tfu">{r.follow_ups.length} rev.</span>}
              {r.imagen_url&&<span title="Tiene imagen">📷</span>}
              {r.notas_clinicas&&<span title="Tiene notas">📝</span>}
              <span style={{color:"var(--tm)",fontSize:14}}>›</span>
            </div>
          ))}
        </>}

        {/* DETALLE */}
        {view==="detail"&&selected&&<>
          <div className="dh">
            <div>
              <div className="dt">{selected.diagnostico||"Sin diagnóstico"}</div>
              <div className="dm">NHC: {selected.nhc||"—"} · {selected.edad?`${selected.edad} años`:"—"} · {selected.sexo||"—"} · {selected.fecha||"—"}</div>
            </div>
            <div className="da">
              <button className="btn bs bsm" onClick={()=>setView("list")}>← Volver</button>
              <button className="btn byel bsm" onClick={()=>startEdit(selected)}>✏️ Editar</button>
              <button className="btn bs bsm" onClick={()=>setPresentMode(true)}>📊 Presentar</button>
              <button className="btn bd2 bsm" onClick={()=>handleDelete(selected.id)} disabled={loading}>Eliminar</button>
            </div>
          </div>

          <div className="ib">
            <div className="ibt">Riesgo y comorbilidades</div>
            <div className="ig">
              <div className="ii"><label>ASA</label><span className={selected.asa?"":"empty"}>{selected.asa||"—"}</span></div>
              <div className="ii"><label>Anticoagulación</label><span className={selected.anticoagulacion?"":"empty"}>{selected.anticoagulacion||"—"}{selected.anticoagulacion_farmaco?` (${selected.anticoagulacion_farmaco})`:""}</span></div>
              <div className="ii"><label>Osteoporosis</label><span className={selected.osteoporosis?"":"empty"}>{selected.osteoporosis||"—"}</span></div>
              <div className="ii"><label>Otras</label><span>{[selected.hta&&"HTA",selected.diabetes&&"DM",selected.irc&&"IRC",selected.epoc&&"EPOC",selected.otras_comorbilidades].filter(Boolean).join(", ")||<span className="empty">—</span>}</span></div>
            </div>
          </div>

          <div className="ib">
            <div className="ibt">Diagnóstico y clasificación</div>
            <div className="ig">
              <div className="ii"><label>Tipo</label><span className={selected.tipo_cirugia?"":"empty"}>{selected.tipo_cirugia||"—"}</span></div>
              <div className="ii"><label>AO/OTA</label><span className={selected.clasificacion_ao?"":"empty"}>{selected.clasificacion_ao||"—"}</span></div>
              <div className="ii"><label>Clasificación específica</label><span className={selected.clasificacion_nombre?"":"empty"}>{selected.clasificacion_nombre?`${selected.clasificacion_nombre}: ${selected.clasificacion_especifica}`:"—"}</span></div>
            </div>
          </div>

          <div className="ib">
            <div className="ibt">Cirugía</div>
            <div className="ig">
              <div className="ii"><label>Posición</label><span className={selected.posicion?"":"empty"}>{selected.posicion||"—"}</span></div>
              <div className="ii"><label>Torniquete</label><span className={selected.torniquete?"":"empty"}>{selected.torniquete||"—"}</span></div>
              <div className="ii"><label>Ayudante</label><span className={selected.ayudante?"":"empty"}>{selected.ayudante||"—"}</span></div>
              <div className="ii"><label>Abordaje</label><span className={selected.abordaje?"":"empty"}>{selected.abordaje||"—"}</span></div>
              <div className="ii"><label>Implante</label><span className={selected.implante_marca?"":"empty"}>{[selected.implante_marca,selected.implante_tipo].filter(Boolean).join(" — ")||"—"}</span></div>
              <div className="ii"><label>Injerto</label><span className={selected.injerto&&selected.injerto!=="No"?"":"empty"}>{selected.injerto||"—"}</span></div>
            </div>
            {selected.tecnica&&<div style={{marginTop:10}}><div className="ii"><label>Técnica</label><span>{selected.tecnica}</span></div></div>}
            {selected.imagen_url&&<div style={{marginTop:12}}><div className="ii"><label>Imagen radiológica</label></div><RxImage value={selected.imagen_url} style={{maxWidth:"100%",borderRadius:"var(--rr)",marginTop:6,border:"1px solid var(--bd)"}}/></div>}
          </div>

          <div className="ib">
            <div className="ibt">Postoperatorio</div>
            <div className="ig">
              <div className="ii"><label>Complicaciones intraop.</label><span className={selected.complicaciones_intra?"":"empty"}>{selected.complicaciones_intra||"—"}</span></div>
              <div className="ii"><label>Carga prescrita</label><span className={selected.carga_prescrita?"":"empty"}>{selected.carga_prescrita||"—"}</span></div>
            </div>
            {selected.observaciones&&<div style={{marginTop:10}}><div className="ii"><label>Observaciones</label><span>{selected.observaciones}</span></div></div>}
          </div>

          {/* NOTAS CLÍNICAS */}
          <div className="ib">
            <div className="ibt" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span>Notas clínicas personales</span>
              <button className="nb outline" style={{fontSize:10,padding:"3px 8px"}} onClick={()=>{setEditingNotes(!editingNotes);setNotesEdit(selected.notas_clinicas||"");}}>
                {editingNotes?"Cancelar":"✏️ Editar"}
              </button>
            </div>
            {editingNotes?(
              <div>
                <textarea className="notes-edit" value={notesEdit} onChange={e=>setNotesEdit(e.target.value)} placeholder="Reflexiones técnicas, dificultades, aprendizajes…"/>
                <button className="btn bp bsm" style={{marginTop:8}} onClick={()=>{handleSaveNotes(selected.id,notesEdit);setEditingNotes(false);}}>Guardar notas</button>
              </div>
            ):(
              <div className="notes-box">{selected.notas_clinicas||<span style={{color:"var(--td)"}}>Sin notas todavía. Pulsa Editar para añadir.</span>}</div>
            )}
          </div>

          {/* CASOS SIMILARES */}
          {getSimilar(selected).length>0&&<div className="ib">
            <div className="ibt">Casos similares en tu registro</div>
            {getSimilar(selected).map(r=>(
              <div key={r.id} className="similar-card" onClick={()=>setSelected(r)}>
                <strong style={{fontSize:12}}>{r.diagnostico||"—"}</strong>
                <span style={{color:"var(--tm)",fontSize:10,marginLeft:8}}>{r.fecha||"—"} · {r.implante_tipo||"—"}</span>
              </div>
            ))}
          </div>}

          {/* SEGUIMIENTO */}
          <div className="ib">
            <div className="ibt">Seguimiento</div>
            {(selected.follow_ups||[]).length>0?selected.follow_ups.map((fu,i)=>(
              <div key={i} className="fui">
                <div className="fud">Revisión {i+1} — {fu.fecha_revision||new Date(fu.date).toLocaleDateString("es-ES")}</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,fontSize:11}}>
                  <div><label style={{fontSize:9,color:"var(--tm)",display:"block"}}>Consolidación</label>{fu.consolidacion||"—"}</div>
                  <div><label style={{fontSize:9,color:"var(--tm)",display:"block"}}>Escala funcional</label>{fu.resultado_escala?`${fu.resultado_escala}: ${fu.resultado_funcional}`:"—"}</div>
                  <div><label style={{fontSize:9,color:"var(--tm)",display:"block"}}>Reintervención</label>{fu.reintervencion||"—"}</div>
                </div>
                {fu.complicacion_tardia&&<div style={{marginTop:5,fontSize:11}}><label style={{fontSize:9,color:"var(--tm)",display:"block"}}>Complicación tardía</label>{fu.complicacion_tardia}</div>}
              </div>
            )):<div style={{fontSize:11,color:"var(--tm)",marginBottom:10}}>Sin revisiones aún.</div>}

            <div className="afs">
              <div className="aft">+ Añadir revisión</div>
              <div className="g2">
                <TF label="Fecha de revisión" value={followForm.fecha_revision||""} onChange={v=>setFollowForm(f=>({...f,fecha_revision:v}))} type="date"/>
                <SF label="Consolidación" value={followForm.consolidacion||""} onChange={v=>setFollowForm(f=>({...f,consolidacion:v}))} options={["Sí — completa","Parcial / callo incipiente","No consolidado / retardo","No aplica"]}/>
              </div>
              <div className="g2">
                <SF label="Escala funcional" value={followForm.resultado_escala||""} onChange={v=>setFollowForm(f=>({...f,resultado_escala:v}))} options={["QuickDASH","DASH","WOMAC","Oxford Knee","Oxford Hip","AOFAS","EVA dolor","Otra"]}/>
                <TF label="Puntuación" value={followForm.resultado_funcional||""} onChange={v=>setFollowForm(f=>({...f,resultado_funcional:v}))} type="number"/>
              </div>
              <div className="g1"><TAF label="Complicación tardía" value={followForm.complicacion_tardia||""} onChange={v=>setFollowForm(f=>({...f,complicacion_tardia:v}))} placeholder="Ninguna / describir…"/></div>
              <div className="g2">
                <SF label="Reintervención" value={followForm.reintervencion||""} onChange={v=>setFollowForm(f=>({...f,reintervencion:v}))} options={["No","Sí"]}/>
                {followForm.reintervencion==="Sí"&&<TF label="Motivo" value={followForm.reintervencion_motivo||""} onChange={v=>setFollowForm(f=>({...f,reintervencion_motivo:v}))}/>}
              </div>
              <button className="btn bp bsm" style={{marginTop:10}} onClick={()=>handleAddFollowUp(selected.id)} disabled={loading}>{loading?"Guardando…":"Guardar revisión"}</button>
            </div>
          </div>
        </>}
      </main>

      {toast&&<div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
