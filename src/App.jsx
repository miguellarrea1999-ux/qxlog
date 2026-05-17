import { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

const db = {
  async getAll() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/cirugias?order=fecha.desc`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    if (!res.ok) throw new Error("Error al cargar");
    return res.json();
  },
  async insert(record) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/cirugias`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(record),
    });
    if (!res.ok) throw new Error("Error al guardar");
    return res.json();
  },
  async update(id, data) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/cirugias?id=eq.${id}`, {
      method: "PATCH",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Error al actualizar");
    return res.json();
  },
  async delete(id) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/cirugias?id=eq.${id}`, {
      method: "DELETE",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    if (!res.ok) throw new Error("Error al eliminar");
  },
};

const INITIAL_FORM = {
  fecha: "", nhc: "", edad: "", sexo: "", lado: "",
  asa: "", anticoagulacion: "", anticoagulacion_farmaco: "",
  osteoporosis: "", diabetes: false, irc: false, hta: false, epoc: false, otras_comorbilidades: "",
  tipo_cirugia: "", diagnostico: "", clasificacion_ao: "", clasificacion_especifica: "", clasificacion_nombre: "",
  posicion: "", abordaje: "", tecnica: "", implante_marca: "", implante_tipo: "", injerto: "", injerto_cual: "", torniquete: "", ayudante: "",
  complicaciones_intra: "", carga_prescrita: "", observaciones: "",
  fecha_revision: "", consolidacion: "", complicacion_tardia: "", resultado_funcional: "", resultado_escala: "", reintervencion: "", reintervencion_motivo: "",
  imagen_url: "",
};

const CLASIFICACIONES = ["AO/OTA","Garden","Neer","Schatzker","Tile/AO Pelvis","Denis","TLICS","Gustilo-Anderson","Lauge-Hansen","Weber","Hawkins","Gartland","Salter-Harris","Pipkin","Pauwels","Singh (osteoporosis)","Otra"];
const STEPS = [
  { id: 1, label: "Paciente", icon: "👤" },
  { id: 2, label: "Riesgo", icon: "🫀" },
  { id: 3, label: "Diagnóstico", icon: "🦴" },
  { id: 4, label: "Cirugía", icon: "🔧" },
  { id: 5, label: "Postop", icon: "📋" },
  { id: 6, label: "Seguimiento", icon: "📅" },
];

const QUICK_FIELDS = ["fecha","nhc","edad","sexo","lado","tipo_cirugia","diagnostico","clasificacion_ao","posicion","abordaje","implante_marca","implante_tipo","complicaciones_intra","carga_prescrita"];

// ── UTILS ────────────────────────────────────────────────────────────────────
const exportToExcel = (records) => {
  const rows = records.map((r) => ({
    "Fecha": r.fecha||"","NHC": r.nhc||"","Edad": r.edad||"","Sexo": r.sexo||"","Lado": r.lado||"",
    "ASA": r.asa||"","Anticoagulación": r.anticoagulacion||"","Fármaco anticoag.": r.anticoagulacion_farmaco||"",
    "Osteoporosis": r.osteoporosis||"","HTA": r.hta?"Sí":"No","Diabetes": r.diabetes?"Sí":"No","IRC": r.irc?"Sí":"No","EPOC": r.epoc?"Sí":"No",
    "Otras comorbilidades": r.otras_comorbilidades||"","Tipo cirugía": r.tipo_cirugia||"","Diagnóstico": r.diagnostico||"",
    "Clasificación AO/OTA": r.clasificacion_ao||"","Sistema clasificación": r.clasificacion_nombre||"","Grado/subtipo": r.clasificacion_especifica||"",
    "Posición": r.posicion||"","Torniquete": r.torniquete||"","Abordaje": r.abordaje||"","Técnica": r.tecnica||"",
    "Implante marca": r.implante_marca||"","Implante tipo/ref.": r.implante_tipo||"","Injerto": r.injerto||"","Detalle injerto": r.injerto_cual||"",
    "Ayudante": r.ayudante||"","Complicaciones intraop.": r.complicaciones_intra||"","Carga prescrita": r.carga_prescrita||"","Observaciones": r.observaciones||"",
    "Fecha revisión": r.fecha_revision||"","Consolidación": r.consolidacion||"","Complicación tardía": r.complicacion_tardia||"",
    "Escala funcional": r.resultado_escala||"","Puntuación funcional": r.resultado_funcional||"",
    "Reintervención": r.reintervencion||"","Motivo reintervención": r.reintervencion_motivo||"","Nº revisiones": (r.follow_ups||[]).length,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Cirugías");
  const fuRows = [];
  records.forEach((r) => { (r.follow_ups||[]).forEach((fu,i) => { fuRows.push({"NHC":r.nhc||"","Diagnóstico":r.diagnostico||"","Fecha cirugía":r.fecha||"","Revisión nº":i+1,"Fecha revisión":fu.fecha_revision||"","Consolidación":fu.consolidacion||"","Complicación tardía":fu.complicacion_tardia||"","Escala funcional":fu.resultado_escala||"","Puntuación":fu.resultado_funcional||"","Reintervención":fu.reintervencion||"","Motivo":fu.reintervencion_motivo||""}); }); });
  if (fuRows.length > 0) { const ws2 = XLSX.utils.json_to_sheet(fuRows); XLSX.utils.book_append_sheet(wb, ws2, "Seguimientos"); }
  XLSX.writeFile(wb, `QxLog_${new Date().toISOString().slice(0,10)}.xlsx`);
};

const generateAnnualReport = (records) => {
  const year = new Date().getFullYear();
  const yr = records.filter(r => (r.fecha||"").startsWith(year) || (r.fecha||"").startsWith(year-1));
  const byType = {};
  const byImplant = {};
  const byMonth = {};
  yr.forEach(r => {
    byType[r.tipo_cirugia||"Sin tipo"] = (byType[r.tipo_cirugia||"Sin tipo"]||0)+1;
    const imp = [r.implante_marca, r.implante_tipo].filter(Boolean).join(" — ") || "Sin implante";
    byImplant[imp] = (byImplant[imp]||0)+1;
    const m = (r.fecha||"").slice(0,7);
    if (m) byMonth[m] = (byMonth[m]||0)+1;
  });
  const compl = yr.filter(r => r.complicaciones_intra && !["ninguna","no",""].includes((r.complicaciones_intra||"").toLowerCase().trim())).length;
  const reint = yr.filter(r => r.reintervencion === "Sí").length;

  const ws1 = XLSX.utils.json_to_sheet([
    {"Métrica":"Total cirugías registradas","Valor":yr.length},
    {"Métrica":"Tasa de complicaciones intraop.","Valor": yr.length ? `${((compl/yr.length)*100).toFixed(1)}%` : "—"},
    {"Métrica":"Tasa de reintervención","Valor": yr.length ? `${((reint/yr.length)*100).toFixed(1)}%` : "—"},
  ]);
  const ws2 = XLSX.utils.json_to_sheet(Object.entries(byType).map(([k,v])=>({Tipo:k,Casos:v})));
  const ws3 = XLSX.utils.json_to_sheet(Object.entries(byImplant).sort((a,b)=>b[1]-a[1]).slice(0,20).map(([k,v])=>({Implante:k,Casos:v})));
  const ws4 = XLSX.utils.json_to_sheet(Object.entries(byMonth).sort().map(([k,v])=>({Mes:k,Casos:v})));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, "Resumen");
  XLSX.utils.book_append_sheet(wb, ws2, "Por tipo");
  XLSX.utils.book_append_sheet(wb, ws3, "Implantes top 20");
  XLSX.utils.book_append_sheet(wb, ws4, "Por mes");
  XLSX.writeFile(wb, `QxLog_Memoria_${year}.xlsx`);
};

// ── UI COMPONENTS ─────────────────────────────────────────────────────────────
const SF = ({ label, value, onChange, options, required }) => (
  <div className="fg">
    <label>{label}{required && <span className="req">*</span>}</label>
    <select value={value} onChange={e=>onChange(e.target.value)}>
      <option value="">— Seleccionar —</option>
      {options.map(o=><option key={typeof o==="string"?o:o.value} value={typeof o==="string"?o:o.value}>{typeof o==="string"?o:o.label}</option>)}
    </select>
  </div>
);
const TF = ({ label, value, onChange, placeholder, required, type="text" }) => (
  <div className="fg">
    <label>{label}{required && <span className="req">*</span>}</label>
    <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder||""} />
  </div>
);
const TAF = ({ label, value, onChange, placeholder }) => (
  <div className="fg">
    <label>{label}</label>
    <textarea value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder||""} rows={3} />
  </div>
);
const CF = ({ label, value, onChange }) => (
  <label className="cl">
    <input type="checkbox" checked={value} onChange={e=>onChange(e.target.checked)} />
    <span>{label}</span>
  </label>
);

// ── CHART: simple bar ────────────────────────────────────────────────────────
const BarChart = ({ data, color = "#58a6ff" }) => {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="chart">
      {data.map((d, i) => (
        <div key={i} className="bar-row">
          <div className="bar-label">{d.label}</div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(d.value / max) * 100}%`, background: color }} />
          </div>
          <div className="bar-val">{d.value}</div>
        </div>
      ))}
    </div>
  );
};

// ── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState("home");
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(INITIAL_FORM);
  const [records, setRecords] = useState([]);
  const [selected, setSelected] = useState(null);
  const [followForm, setFollowForm] = useState({});
  const [filter, setFilter] = useState("");
  const [filterTipo, setFilterTipo] = useState("");
  const [filterImplante, setFilterImplante] = useState("");
  const [filterYear, setFilterYear] = useState("");
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dbError, setDbError] = useState(false);
  const [quickMode, setQuickMode] = useState(false);
  const [imgPreview, setImgPreview] = useState(null);
  const imgRef = useRef();

  const showToast = (msg, type="success") => { setToast({msg,type}); setTimeout(()=>setToast(null),2500); };

  useEffect(() => {
    if (!SUPABASE_URL||!SUPABASE_KEY) { setDbError(true); return; }
    setLoading(true);
    db.getAll().then(setRecords).catch(()=>{ setDbError(true); showToast("Error de conexión","error"); }).finally(()=>setLoading(false));
  }, []);

  const set = f => v => setForm(p=>({...p,[f]:v}));

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { setImgPreview(ev.target.result); setForm(p=>({...p, imagen_url: ev.target.result})); };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!form.fecha||!form.nhc||!form.diagnostico) { showToast("Fecha, NHC y diagnóstico son obligatorios","error"); return; }
    setLoading(true);
    try {
      const [saved] = await db.insert({...form, follow_ups:[]});
      setRecords(p=>[saved,...p]);
      setForm(INITIAL_FORM); setStep(1); setImgPreview(null);
      showToast("✓ Cirugía registrada"); setView("list");
    } catch { showToast("Error al guardar","error"); }
    finally { setLoading(false); }
  };

  const handleDelete = async (id) => {
    if (!confirm("¿Eliminar este registro?")) return;
    setLoading(true);
    try { await db.delete(id); setRecords(p=>p.filter(r=>r.id!==id)); showToast("Eliminado"); setView("list"); }
    catch { showToast("Error al eliminar","error"); }
    finally { setLoading(false); }
  };

  const handleAddFollowUp = async (id) => {
    const record = records.find(r=>r.id===id);
    const updatedFu = [...(record.follow_ups||[]), {...followForm, date: new Date().toISOString()}];
    setLoading(true);
    try {
      const [updated] = await db.update(id,{follow_ups:updatedFu});
      setRecords(p=>p.map(r=>r.id===id?updated:r)); setSelected(updated); setFollowForm({});
      showToast("✓ Revisión guardada");
    } catch { showToast("Error al guardar revisión","error"); }
    finally { setLoading(false); }
  };

  // Filtros
  const years = [...new Set(records.map(r=>(r.fecha||"").slice(0,4)).filter(Boolean))].sort().reverse();
  const tipos = [...new Set(records.map(r=>r.tipo_cirugia).filter(Boolean))];
  const implantes = [...new Set(records.map(r=>r.implante_tipo).filter(Boolean))];

  const filtered = records.filter(r => {
    const q = filter.toLowerCase();
    const matchQ = !filter || (r.diagnostico||"").toLowerCase().includes(q)||(r.nhc||"").includes(q)||(r.implante_tipo||"").toLowerCase().includes(q)||(r.abordaje||"").toLowerCase().includes(q);
    const matchTipo = !filterTipo || r.tipo_cirugia===filterTipo;
    const matchImp = !filterImplante || r.implante_tipo===filterImplante;
    const matchYear = !filterYear || (r.fecha||"").startsWith(filterYear);
    return matchQ && matchTipo && matchImp && matchYear;
  });

  // Stats
  const stats = {
    total: records.length,
    fracturas: records.filter(r=>r.tipo_cirugia==="Fractura aguda").length,
    electivas: records.filter(r=>r.tipo_cirugia==="Electiva").length,
    artroscopias: records.filter(r=>r.tipo_cirugia==="Artroscopia").length,
    complicaciones: records.filter(r=>r.complicaciones_intra&&!["ninguna","no",""].includes((r.complicaciones_intra||"").toLowerCase().trim())).length,
    reintervenciones: records.filter(r=>r.reintervencion==="Sí").length,
  };

  const byType = tipos.map(t=>({label:t, value:records.filter(r=>r.tipo_cirugia===t).length})).sort((a,b)=>b.value-a.value);
  const byImplant = [...new Set(records.map(r=>r.implante_tipo).filter(Boolean))].map(i=>({label:i, value:records.filter(r=>r.implante_tipo===i).length})).sort((a,b)=>b.value-a.value).slice(0,8);
  const byMonth = (() => {
    const m = {}; records.forEach(r=>{ const k=(r.fecha||"").slice(0,7); if(k) m[k]=(m[k]||0)+1; });
    return Object.entries(m).sort().slice(-12).map(([k,v])=>({label:k.slice(5)+"/"+k.slice(2,4),value:v}));
  })();

  const tagClass = t => t==="Fractura aguda"?"tf":t==="Electiva"?"te":t==="Artroscopia"?"ta":"to";

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

        /* HEADER */
        .hdr{background:var(--s1);border-bottom:1px solid var(--bd);padding:0 24px;display:flex;align-items:center;justify-content:space-between;height:60px;position:sticky;top:0;z-index:100;}
        .logo{font-family:'DM Serif Display',serif;font-size:20px;color:var(--ac);}
        .logo span{color:var(--tm);font-size:12px;font-family:'DM Mono',monospace;margin-left:8px;}
        .hdr-r{display:flex;align-items:center;gap:6px;}
        .nav{display:flex;gap:4px;}
        .nb{background:none;border:none;color:var(--tm);font-family:'DM Mono',monospace;font-size:12px;padding:6px 10px;border-radius:var(--rr);cursor:pointer;transition:all .15s;}
        .nb:hover{background:var(--s2);color:var(--tx);}
        .nb.act{background:var(--ac);color:#000;font-weight:500;}
        .nb.quick{background:var(--g);color:#000;font-weight:500;}
        .nb.xls{background:var(--s2);border:1px solid var(--bd);color:var(--g);font-size:11px;}
        .nb.xls:hover{border-color:var(--g);}
        .nb.rep{background:var(--s2);border:1px solid var(--bd);color:var(--p);font-size:11px;}
        .nb.rep:hover{border-color:var(--p);}

        .banner{background:rgba(248,81,73,.1);border-bottom:1px solid var(--red);padding:8px 24px;font-size:12px;color:var(--red);text-align:center;}
        .lbar{height:2px;background:var(--s1);position:fixed;top:60px;left:0;right:0;z-index:99;}
        .lbar::after{content:'';display:block;height:100%;background:var(--ac);width:60%;animation:lp 1s ease-in-out infinite alternate;}
        @keyframes lp{from{opacity:.4}to{opacity:1}}

        /* MAIN */
        .main{flex:1;padding:32px 24px;max-width:960px;margin:0 auto;width:100%;}

        /* HOME */
        .hero{text-align:center;padding:48px 0 36px;}
        .ht{font-family:'DM Serif Display',serif;font-size:44px;line-height:1.1;margin-bottom:10px;}
        .ht em{color:var(--ac);font-style:italic;}
        .hs{color:var(--tm);font-size:13px;max-width:400px;margin:0 auto 36px;line-height:1.6;}
        .sg{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:36px;}
        .sc{background:var(--s1);border:1px solid var(--bd);border-radius:var(--rr);padding:16px 10px;text-align:center;}
        .sn{font-family:'DM Serif Display',serif;font-size:30px;color:var(--ac);line-height:1;}
        .sl{font-size:9px;color:var(--tm);margin-top:4px;text-transform:uppercase;letter-spacing:.5px;}
        .ha{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;}

        /* STATS PAGE */
        .stats-grid2{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:24px;}
        .stat-block{background:var(--s1);border:1px solid var(--bd);border-radius:var(--rr);padding:20px;}
        .stat-block-title{font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:var(--tm);margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid var(--bd);}
        .chart{display:flex;flex-direction:column;gap:8px;}
        .bar-row{display:flex;align-items:center;gap:8px;}
        .bar-label{font-size:11px;color:var(--tm);min-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .bar-track{flex:1;background:var(--s2);border-radius:4px;height:8px;overflow:hidden;}
        .bar-fill{height:100%;border-radius:4px;transition:width .4s ease;}
        .bar-val{font-size:11px;color:var(--tx);min-width:24px;text-align:right;}
        .kpi-row{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px;}
        .kpi{background:var(--s1);border:1px solid var(--bd);border-radius:var(--rr);padding:16px;text-align:center;}
        .kpi-n{font-family:'DM Serif Display',serif;font-size:28px;line-height:1;}
        .kpi-l{font-size:10px;color:var(--tm);margin-top:4px;text-transform:uppercase;}

        /* BUTTONS */
        .btn{font-family:'DM Mono',monospace;font-size:13px;padding:10px 18px;border-radius:var(--rr);border:1px solid transparent;cursor:pointer;transition:all .15s;font-weight:500;}
        .btn:disabled{opacity:.5;cursor:not-allowed;}
        .bp{background:var(--ac);color:#000;border-color:var(--ac);}
        .bp:hover:not(:disabled){background:#79c0ff;}
        .bs{background:var(--s1);color:var(--tx);border-color:var(--bd);}
        .bs:hover:not(:disabled){border-color:var(--ac);color:var(--ac);}
        .bd2{background:var(--s1);color:var(--red);border-color:var(--bd);}
        .bd2:hover:not(:disabled){border-color:var(--red);background:rgba(248,81,73,.1);}
        .bg2{background:var(--g);color:#000;border-color:var(--g);}
        .bsm{font-size:11px;padding:6px 12px;}
        .bq{background:var(--g);color:#000;border-color:var(--g);}

        /* STEPPER */
        .stp{display:flex;align-items:center;margin-bottom:28px;}
        .si{display:flex;align-items:center;flex:1;}
        .sd{width:30px;height:30px;border-radius:50%;border:2px solid var(--bd);display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;background:var(--s1);transition:all .2s;cursor:pointer;}
        .sd.act{border-color:var(--ac);background:var(--ac);}
        .sd.done{border-color:var(--g);background:var(--g);}
        .sl2{flex:1;height:1px;background:var(--bd);}
        .sl2.done{background:var(--g);}

        /* FORM */
        .fh{margin-bottom:24px;}
        .ft{font-family:'DM Serif Display',serif;font-size:22px;margin-bottom:4px;}
        .fs{font-size:12px;color:var(--tm);}
        .fg{display:flex;flex-direction:column;gap:5px;}
        .fg label{font-size:10px;color:var(--tm);text-transform:uppercase;letter-spacing:.5px;}
        .req{color:var(--red);margin-left:3px;}
        .fg input,.fg select,.fg textarea{background:var(--s1);border:1px solid var(--bd);border-radius:var(--rr);color:var(--tx);font-family:'DM Mono',monospace;font-size:13px;padding:8px 11px;outline:none;transition:border-color .15s;width:100%;}
        .fg input:focus,.fg select:focus,.fg textarea:focus{border-color:var(--ac);}
        .fg select option{background:var(--s2);}
        .fg textarea{resize:vertical;}
        .g2{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px;}
        .g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:16px;}
        .g1{display:grid;grid-template-columns:1fr;gap:14px;margin-bottom:16px;}
        .cl{display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;}
        .cl input[type=checkbox]{accent-color:var(--ac);width:14px;height:14px;}
        .cr{display:flex;flex-wrap:wrap;gap:14px;margin-bottom:14px;}
        .div{border:none;border-top:1px solid var(--bd);margin:16px 0;}
        .fa{display:flex;justify-content:space-between;align-items:center;margin-top:28px;padding-top:16px;border-top:1px solid var(--bd);}

        /* IMAGE UPLOAD */
        .img-box{border:2px dashed var(--bd);border-radius:var(--rr);padding:20px;text-align:center;cursor:pointer;transition:border-color .15s;background:var(--s1);}
        .img-box:hover{border-color:var(--ac);}
        .img-box input{display:none;}
        .img-preview{max-width:100%;border-radius:var(--rr);margin-top:10px;border:1px solid var(--bd);}
        .img-label{font-size:12px;color:var(--tm);}

        /* LIST */
        .lh{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;gap:12px;flex-wrap:wrap;}
        .lt{font-family:'DM Serif Display',serif;font-size:26px;}
        .lc{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
        .sb{background:var(--s1);border:1px solid var(--bd);border-radius:var(--rr);color:var(--tx);font-family:'DM Mono',monospace;font-size:12px;padding:7px 10px;outline:none;width:180px;}
        .sb:focus{border-color:var(--ac);}
        .sf2{background:var(--s1);border:1px solid var(--bd);border-radius:var(--rr);color:var(--tx);font-family:'DM Mono',monospace;font-size:11px;padding:7px 10px;outline:none;}
        .sf2:focus{border-color:var(--ac);}
        .rc{background:var(--s1);border:1px solid var(--bd);border-radius:var(--rr);padding:14px 18px;margin-bottom:8px;cursor:pointer;transition:all .15s;display:flex;align-items:center;gap:14px;}
        .rc:hover{border-color:var(--ac);background:var(--s2);}
        .rd{font-size:11px;color:var(--tm);min-width:85px;}
        .rx{flex:1;font-size:13px;}
        .rx strong{color:var(--tx);display:block;margin-bottom:2px;}
        .rx span{color:var(--tm);font-size:11px;}
        .tag{font-size:10px;padding:3px 8px;border-radius:20px;border:1px solid;white-space:nowrap;font-weight:500;}
        .tf{color:var(--r);border-color:var(--r);background:rgba(247,129,102,.1);}
        .te{color:var(--p);border-color:var(--p);background:rgba(210,168,255,.1);}
        .ta{color:var(--g);border-color:var(--g);background:rgba(63,185,80,.1);}
        .to{color:var(--yl);border-color:var(--yl);background:rgba(227,179,65,.1);}
        .tfu{color:var(--ac);border-color:var(--ac);background:rgba(88,166,255,.1);}

        /* DETAIL */
        .dh{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px;gap:14px;}
        .dt{font-family:'DM Serif Display',serif;font-size:28px;line-height:1.2;}
        .dm{font-size:12px;color:var(--tm);margin-top:5px;}
        .da{display:flex;gap:8px;flex-shrink:0;}
        .ib{background:var(--s1);border:1px solid var(--bd);border-radius:var(--rr);padding:18px;margin-bottom:14px;}
        .ibt{font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:var(--tm);margin-bottom:12px;padding-bottom:7px;border-bottom:1px solid var(--bd);}
        .ig{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}
        .ii label{font-size:10px;color:var(--td);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:2px;}
        .ii span{font-size:12px;}
        .empty{color:var(--td);}
        .fui{background:var(--s2);border:1px solid var(--bd);border-radius:var(--rr);padding:10px 14px;margin-bottom:7px;font-size:12px;}
        .fud{font-size:10px;color:var(--tm);margin-bottom:5px;}
        .afs{background:var(--s1);border:1px dashed var(--bd);border-radius:var(--rr);padding:18px;margin-top:14px;}
        .aft{font-size:11px;color:var(--ac);margin-bottom:14px;text-transform:uppercase;letter-spacing:.5px;}

        /* TOAST */
        .toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);font-family:'DM Mono',monospace;font-size:13px;font-weight:500;padding:11px 22px;border-radius:40px;z-index:999;animation:fu .3s ease;}
        .toast.success{background:var(--g);color:#000;}
        .toast.error{background:var(--red);color:#fff;}
        @keyframes fu{from{opacity:0;transform:translateX(-50%) translateY(12px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}

        .empty-state{text-align:center;padding:60px 0;color:var(--tm);font-size:13px;}
        .empty-state .big{font-size:44px;margin-bottom:10px;}

        .pg-title{font-family:'DM Serif Display',serif;font-size:28px;margin-bottom:24px;}

        /* QUICK MODE */
        .qm-badge{background:var(--g);color:#000;font-size:10px;padding:2px 8px;border-radius:20px;font-weight:500;margin-left:8px;}

        @media(max-width:600px){
          .sg{grid-template-columns:repeat(3,1fr);}
          .g2,.g3{grid-template-columns:1fr;}
          .ig{grid-template-columns:1fr 1fr;}
          .logo span{display:none;}
          .stats-grid2{grid-template-columns:1fr;}
          .kpi-row{grid-template-columns:1fr 1fr;}
        }
      `}</style>

      {/* HEADER */}
      <header className="hdr">
        <div className="logo">QxLog <span>COT · Manises</span></div>
        <div className="hdr-r">
          <nav className="nav">
            <button className={`nb ${view==="home"?"act":""}`} onClick={()=>setView("home")}>Inicio</button>
            <button className={`nb ${view==="new"?"act":""}`} onClick={()=>{setView("new");setStep(1);setForm(INITIAL_FORM);setImgPreview(null);setQuickMode(false);}}>+ Nueva</button>
            <button className={`nb quick`} onClick={()=>{setView("new");setStep(1);setForm(INITIAL_FORM);setImgPreview(null);setQuickMode(true);}}>⚡ Rápido</button>
            <button className={`nb ${view==="list"?"act":""}`} onClick={()=>setView("list")}>Registro ({records.length})</button>
            <button className={`nb ${view==="stats"?"act":""}`} onClick={()=>setView("stats")}>Estadísticas</button>
          </nav>
          {records.length>0 && <>
            <button className="nb xls" onClick={()=>exportToExcel(records)}>↓ Excel</button>
            <button className="nb rep" onClick={()=>generateAnnualReport(records)}>📄 Memoria</button>
          </>}
        </div>
      </header>

      {dbError && <div className="banner">⚠️ Sin conexión a Supabase — configura VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY</div>}
      {loading && <div className="lbar" />}

      <main className="main">

        {/* HOME */}
        {view==="home" && <>
          <div className="hero">
            <div className="ht">Registro<br/><em>quirúrgico</em><br/>personal</div>
            <div className="hs">Base de datos permanente · R3 COT · Hospital de Manises</div>
          </div>
          <div className="sg">
            <div className="sc"><div className="sn">{stats.total}</div><div className="sl">Total</div></div>
            <div className="sc"><div className="sn" style={{color:"var(--r)"}}>{stats.fracturas}</div><div className="sl">Fracturas</div></div>
            <div className="sc"><div className="sn" style={{color:"var(--p)"}}>{stats.electivas}</div><div className="sl">Electivas</div></div>
            <div className="sc"><div className="sn" style={{color:"var(--g)"}}>{stats.artroscopias}</div><div className="sl">Artroscopias</div></div>
            <div className="sc"><div className="sn" style={{color:"var(--red)"}}>{stats.complicaciones}</div><div className="sl">Complicaciones</div></div>
            <div className="sc"><div className="sn" style={{color:"var(--yl)"}}>{stats.reintervenciones}</div><div className="sl">Reintervenciones</div></div>
          </div>
          <div className="ha">
            <button className="btn bp" onClick={()=>{setView("new");setStep(1);setForm(INITIAL_FORM);setImgPreview(null);setQuickMode(false);}}>+ Registrar cirugía</button>
            <button className="btn bq" onClick={()=>{setView("new");setStep(1);setForm(INITIAL_FORM);setImgPreview(null);setQuickMode(true);}}>⚡ Modo rápido</button>
            <button className="btn bs" onClick={()=>setView("stats")}>Ver estadísticas</button>
            {records.length>0 && <button className="btn bs" onClick={()=>generateAnnualReport(records)}>📄 Generar memoria</button>}
          </div>
        </>}

        {/* ESTADÍSTICAS */}
        {view==="stats" && <>
          <div className="pg-title">Estadísticas</div>
          <div className="kpi-row">
            <div className="kpi"><div className="kpi-n">{stats.total}</div><div className="kpi-l">Total cirugías</div></div>
            <div className="kpi"><div className="kpi-n" style={{color:"var(--red)"}}>{stats.total?((stats.complicaciones/stats.total)*100).toFixed(1):0}%</div><div className="kpi-l">Tasa complicaciones</div></div>
            <div className="kpi"><div className="kpi-n" style={{color:"var(--yl)"}}>{stats.total?((stats.reintervenciones/stats.total)*100).toFixed(1):0}%</div><div className="kpi-l">Tasa reintervención</div></div>
          </div>
          {records.length===0 ? <div className="empty-state"><div className="big">📊</div>Sin datos aún.</div> :
          <div className="stats-grid2">
            <div className="stat-block"><div className="stat-block-title">Casos por tipo de cirugía</div><BarChart data={byType} color="#58a6ff"/></div>
            <div className="stat-block"><div className="stat-block-title">Implantes más usados (top 8)</div><BarChart data={byImplant} color="#d2a8ff"/></div>
            <div className="stat-block" style={{gridColumn:"1/-1"}}><div className="stat-block-title">Casos por mes (últimos 12 meses)</div><BarChart data={byMonth} color="#3fb950"/></div>
          </div>}
        </>}

        {/* NUEVO REGISTRO */}
        {view==="new" && <>
          {quickMode && <div style={{marginBottom:16,display:"flex",alignItems:"center"}}><span style={{fontSize:14,color:"var(--g)",fontWeight:500}}>⚡ Modo rápido</span><span className="qm-badge">Solo campos esenciales</span></div>}

          {!quickMode && <div className="stp">
            {STEPS.map((s,i)=>(
              <div key={s.id} className="si">
                <div className={`sd ${step===s.id?"act":step>s.id?"done":""}`} onClick={()=>step>s.id&&setStep(s.id)} title={s.label}>{step>s.id?"✓":s.icon}</div>
                {i<STEPS.length-1 && <div className={`sl2 ${step>s.id?"done":""}`}/>}
              </div>
            ))}
          </div>}

          {/* QUICK MODE — todo en una pantalla */}
          {quickMode && <>
            <div className="g3">
              <TF label="Fecha de cirugía" value={form.fecha} onChange={set("fecha")} type="date" required/>
              <TF label="NHC" value={form.nhc} onChange={set("nhc")} placeholder="Nº historia" required/>
              <TF label="Edad" value={form.edad} onChange={set("edad")} type="number"/>
            </div>
            <div className="g3">
              <SF label="Sexo" value={form.sexo} onChange={set("sexo")} options={["Hombre","Mujer"]}/>
              <SF label="Lado" value={form.lado} onChange={set("lado")} options={["Derecho","Izquierdo","Bilateral","No aplica"]}/>
              <SF label="Tipo de cirugía" value={form.tipo_cirugia} onChange={set("tipo_cirugia")} required options={["Fractura aguda","Electiva","Artroscopia","Revisión / reintervención","Urgencia no traumática","Otra"]}/>
            </div>
            <div className="g2">
              <TF label="Diagnóstico" value={form.diagnostico} onChange={set("diagnostico")} placeholder="fractura distal de radio…" required/>
              <TF label="Código AO/OTA" value={form.clasificacion_ao} onChange={set("clasificacion_ao")} placeholder="23-C2…"/>
            </div>
            <div className="g2">
              <SF label="Posición" value={form.posicion} onChange={set("posicion")} options={["Decúbito supino","Decúbito prono","Decúbito lateral derecho","Decúbito lateral izquierdo","Silla de playa","Trendelenburg","Otra"]}/>
              <TF label="Abordaje" value={form.abordaje} onChange={set("abordaje")} placeholder="volar de Henry…"/>
            </div>
            <div className="g2">
              <TF label="Implante marca" value={form.implante_marca} onChange={set("implante_marca")} placeholder="Synthes, Stryker…"/>
              <TF label="Implante tipo/ref." value={form.implante_tipo} onChange={set("implante_tipo")} placeholder="LCP 3.5 volar…"/>
            </div>
            <div className="g1">
              <TF label="Complicaciones intraoperatorias" value={form.complicaciones_intra} onChange={set("complicaciones_intra")} placeholder="Ninguna / describir…"/>
            </div>
            <div className="g1">
              <TF label="Carga prescrita" value={form.carga_prescrita} onChange={set("carga_prescrita")} placeholder="sin carga 6 semanas…"/>
            </div>
            <div className="fa">
              <button className="btn bs" onClick={()=>setView("home")}>Cancelar</button>
              <button className="btn bg2" onClick={handleSave} disabled={loading}>{loading?"Guardando…":"✓ Guardar rápido"}</button>
            </div>
          </>}

          {/* FULL MODE */}
          {!quickMode && <>
            {step===1 && <>
              <div className="fh"><div className="ft">Identificación del paciente</div><div className="fs">Datos básicos del caso</div></div>
              <div className="g3"><TF label="Fecha de cirugía" value={form.fecha} onChange={set("fecha")} type="date" required/><TF label="NHC" value={form.nhc} onChange={set("nhc")} placeholder="Nº historia clínica" required/><TF label="Edad" value={form.edad} onChange={set("edad")} placeholder="años" type="number"/></div>
              <div className="g3"><SF label="Sexo" value={form.sexo} onChange={set("sexo")} options={["Hombre","Mujer"]}/><SF label="Lado" value={form.lado} onChange={set("lado")} options={["Derecho","Izquierdo","Bilateral","No aplica"]}/></div>
            </>}
            {step===2 && <>
              <div className="fh"><div className="ft">Comorbilidades y riesgo</div><div className="fs">Estado preoperatorio</div></div>
              <div className="g2">
                <SF label="ASA" value={form.asa} onChange={set("asa")} options={[{value:"I",label:"ASA I — Sano"},{value:"II",label:"ASA II — Enfermedad leve"},{value:"III",label:"ASA III — Enfermedad severa"},{value:"IV",label:"ASA IV — Riesgo vital constante"}]}/>
                <SF label="Anticoagulación" value={form.anticoagulacion} onChange={set("anticoagulacion")} options={["No","Sí — suspendida","Sí — mantenida","Bridging"]}/>
              </div>
              {form.anticoagulacion&&form.anticoagulacion!=="No"&&<div className="g1"><TF label="Fármaco anticoagulante" value={form.anticoagulacion_farmaco} onChange={set("anticoagulacion_farmaco")} placeholder="acenocumarol, rivaroxabán…"/></div>}
              <div className="g1"><SF label="Osteoporosis" value={form.osteoporosis} onChange={set("osteoporosis")} options={["No","Osteopenia","Osteoporosis confirmada","Desconocido"]}/></div>
              <hr className="div"/>
              <div className="cr"><CF label="HTA" value={form.hta} onChange={set("hta")}/><CF label="Diabetes" value={form.diabetes} onChange={set("diabetes")}/><CF label="IRC" value={form.irc} onChange={set("irc")}/><CF label="EPOC" value={form.epoc} onChange={set("epoc")}/></div>
              <div className="g1"><TF label="Otras comorbilidades" value={form.otras_comorbilidades} onChange={set("otras_comorbilidades")} placeholder="hepatopatía, neoplasia…"/></div>
            </>}
            {step===3 && <>
              <div className="fh"><div className="ft">Diagnóstico y clasificación</div><div className="fs">Patología intervenida</div></div>
              <div className="g2">
                <SF label="Tipo de cirugía" value={form.tipo_cirugia} onChange={set("tipo_cirugia")} required options={["Fractura aguda","Electiva","Artroscopia","Revisión / reintervención","Urgencia no traumática","Otra"]}/>
                <TF label="Diagnóstico" value={form.diagnostico} onChange={set("diagnostico")} placeholder="fractura distal de radio…" required/>
              </div>
              <hr className="div"/>
              <div className="g1"><TF label="Código AO/OTA" value={form.clasificacion_ao} onChange={set("clasificacion_ao")} placeholder="23-C2, 31-A2…"/></div>
              <hr className="div"/>
              <div className="g2">
                <SF label="Clasificación adicional" value={form.clasificacion_nombre} onChange={set("clasificacion_nombre")} options={CLASIFICACIONES}/>
                <TF label="Grado / subtipo" value={form.clasificacion_especifica} onChange={set("clasificacion_especifica")} placeholder="Garden III, Schatzker V…"/>
              </div>
            </>}
            {step===4 && <>
              <div className="fh"><div className="ft">Detalles quirúrgicos</div><div className="fs">Técnica, implante y equipo</div></div>
              <div className="g2">
                <SF label="Posición del paciente" value={form.posicion} onChange={set("posicion")} options={["Decúbito supino","Decúbito prono","Decúbito lateral derecho","Decúbito lateral izquierdo","Silla de playa","Trendelenburg","Otra"]}/>
                <SF label="Torniquete" value={form.torniquete} onChange={set("torniquete")} options={["No","Sí — isquemia total","Sí — isquemia parcial"]}/>
              </div>
              <div className="g1"><TF label="Abordaje quirúrgico" value={form.abordaje} onChange={set("abordaje")} placeholder="volar de Henry, posterolateral de codo…"/></div>
              <div className="g1"><TAF label="Técnica quirúrgica" value={form.tecnica} onChange={set("tecnica")} placeholder="Descripción breve"/></div>
              <hr className="div"/>
              <div className="g2">
                <TF label="Implante — Marca" value={form.implante_marca} onChange={set("implante_marca")} placeholder="Synthes, Stryker, Arthrex…"/>
                <TF label="Implante — Tipo/referencia" value={form.implante_tipo} onChange={set("implante_tipo")} placeholder="LCP 3.5 volar, Expert tibial nail…"/>
              </div>
              <div className="g2">
                <SF label="Injerto / material biológico" value={form.injerto} onChange={set("injerto")} options={["No","Autoinjerto esponjoso","Aloinjerto","Sustituto sintético","PRF/PRP","Otro"]}/>
                <TF label="Ayudante" value={form.ayudante} onChange={set("ayudante")} placeholder="R1, R2, adjunto…"/>
              </div>
              {form.injerto&&form.injerto!=="No"&&<div className="g1"><TF label="Detalle del injerto" value={form.injerto_cual} onChange={set("injerto_cual")} placeholder="Zona donante, marca comercial…"/></div>}
              <hr className="div"/>
              <div className="fg" style={{marginBottom:16}}>
                <label>Imagen radiológica (Rx pre/postoperatoria)</label>
                <div className="img-box" onClick={()=>imgRef.current.click()}>
                  <input ref={imgRef} type="file" accept="image/*" onChange={handleImageUpload}/>
                  {imgPreview ? <img src={imgPreview} alt="Rx" className="img-preview"/> : <div className="img-label">📷 Toca para adjuntar imagen (Rx, foto intraop…)</div>}
                </div>
              </div>
            </>}
            {step===5 && <>
              <div className="fh"><div className="ft">Postoperatorio inmediato</div><div className="fs">Incidencias y prescripción al alta</div></div>
              <div className="g1"><TAF label="Complicaciones intraoperatorias" value={form.complicaciones_intra} onChange={set("complicaciones_intra")} placeholder="Ninguna / sangrado mayor, dificultad técnica, conversión…"/></div>
              <div className="g1"><TF label="Prescripción de carga / movilización" value={form.carga_prescrita} onChange={set("carga_prescrita")} placeholder="sin carga 6 semanas, carga parcial inmediata…"/></div>
              <div className="g1"><TAF label="Observaciones" value={form.observaciones} onChange={set("observaciones")} placeholder="Cualquier dato relevante adicional"/></div>
            </>}
            {step===6 && <>
              <div className="fh"><div className="ft">Seguimiento inicial (opcional)</div><div className="fs">Puedes añadirlo después desde el registro</div></div>
              <div className="g2">
                <TF label="Fecha de primera revisión" value={form.fecha_revision} onChange={set("fecha_revision")} type="date"/>
                <SF label="Consolidación radiológica" value={form.consolidacion} onChange={set("consolidacion")} options={["Sí — completa","Parcial / callo incipiente","No consolidado / retardo","No aplica"]}/>
              </div>
              <div className="g1"><TAF label="Complicación tardía" value={form.complicacion_tardia} onChange={set("complicacion_tardia")} placeholder="Ninguna / describir…"/></div>
              <div className="g2">
                <SF label="Escala funcional" value={form.resultado_escala} onChange={set("resultado_escala")} options={["QuickDASH","DASH","WOMAC","Oxford Knee","Oxford Hip","AOFAS","EVA dolor","Otra"]}/>
                <TF label="Puntuación" value={form.resultado_funcional} onChange={set("resultado_funcional")} type="number"/>
              </div>
              <div className="g2">
                <SF label="Reintervención" value={form.reintervencion} onChange={set("reintervencion")} options={["No","Sí"]}/>
                {form.reintervencion==="Sí"&&<TF label="Motivo" value={form.reintervencion_motivo} onChange={set("reintervencion_motivo")}/>}
              </div>
            </>}
            <div className="fa">
              <button className="btn bs" onClick={()=>step>1?setStep(s=>s-1):setView("home")}>{step>1?"← Anterior":"Cancelar"}</button>
              <div style={{fontSize:11,color:"var(--tm)"}}>Paso {step} de {STEPS.length}</div>
              {step<STEPS.length?<button className="btn bp" onClick={()=>setStep(s=>s+1)}>Siguiente →</button>:<button className="btn bg2" onClick={handleSave} disabled={loading}>{loading?"Guardando…":"✓ Guardar registro"}</button>}
            </div>
          </>}
        </>}

        {/* LISTA */}
        {view==="list" && <>
          <div className="lh">
            <div className="lt">Registro quirúrgico</div>
            <div className="lc">
              <input className="sb" placeholder="Buscar…" value={filter} onChange={e=>setFilter(e.target.value)}/>
              <select className="sf2" value={filterTipo} onChange={e=>setFilterTipo(e.target.value)}>
                <option value="">Todos los tipos</option>
                {tipos.map(t=><option key={t} value={t}>{t}</option>)}
              </select>
              <select className="sf2" value={filterImplante} onChange={e=>setFilterImplante(e.target.value)}>
                <option value="">Todos los implantes</option>
                {implantes.map(i=><option key={i} value={i}>{i}</option>)}
              </select>
              <select className="sf2" value={filterYear} onChange={e=>setFilterYear(e.target.value)}>
                <option value="">Todos los años</option>
                {years.map(y=><option key={y} value={y}>{y}</option>)}
              </select>
              {records.length>0&&<button className="nb xls bsm" onClick={()=>exportToExcel(filtered)}>↓ Excel ({filtered.length})</button>}
            </div>
          </div>
          {filtered.length===0?<div className="empty-state"><div className="big">🦴</div>{records.length===0?"Aún no hay cirugías registradas.":"Sin resultados."}</div>:
          filtered.map(r=>(
            <div key={r.id} className="rc" onClick={()=>{setSelected(r);setView("detail");}}>
              <div className="rd">{r.fecha||"—"}</div>
              <div className="rx"><strong>{r.diagnostico||"Sin diagnóstico"}</strong><span>{r.nhc?`NHC: ${r.nhc}`:""}{r.edad?` · ${r.edad}a`:""}{r.clasificacion_ao?` · AO: ${r.clasificacion_ao}`:""}{r.implante_tipo?` · ${r.implante_tipo}`:""}</span></div>
              {r.tipo_cirugia&&<span className={`tag ${tagClass(r.tipo_cirugia)}`}>{r.tipo_cirugia}</span>}
              {r.follow_ups?.length>0&&<span className="tag tfu">{r.follow_ups.length} rev.</span>}
              {r.imagen_url&&<span title="Tiene imagen" style={{fontSize:16}}>📷</span>}
              <span style={{color:"var(--tm)",fontSize:16}}>›</span>
            </div>
          ))}
        </>}

        {/* DETALLE */}
        {view==="detail" && selected && <>
          <div className="dh">
            <div>
              <div className="dt">{selected.diagnostico||"Sin diagnóstico"}</div>
              <div className="dm">NHC: {selected.nhc||"—"} · {selected.edad?`${selected.edad} años`:"—"} · {selected.sexo||"—"} · {selected.fecha||"—"}</div>
            </div>
            <div className="da">
              <button className="btn bs bsm" onClick={()=>setView("list")}>← Volver</button>
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
            {selected.imagen_url&&<div style={{marginTop:14}}><div className="ii"><label>Imagen radiológica</label></div><img src={selected.imagen_url} alt="Rx" style={{maxWidth:"100%",borderRadius:"var(--rr)",marginTop:8,border:"1px solid var(--bd)"}}/></div>}
          </div>

          <div className="ib">
            <div className="ibt">Postoperatorio</div>
            <div className="ig">
              <div className="ii"><label>Complicaciones intraop.</label><span className={selected.complicaciones_intra?"":"empty"}>{selected.complicaciones_intra||"—"}</span></div>
              <div className="ii"><label>Carga prescrita</label><span className={selected.carga_prescrita?"":"empty"}>{selected.carga_prescrita||"—"}</span></div>
            </div>
            {selected.observaciones&&<div style={{marginTop:10}}><div className="ii"><label>Observaciones</label><span>{selected.observaciones}</span></div></div>}
          </div>

          <div className="ib">
            <div className="ibt">Seguimiento</div>
            {(selected.follow_ups||[]).length>0?selected.follow_ups.map((fu,i)=>(
              <div key={i} className="fui">
                <div className="fud">Revisión {i+1} — {fu.fecha_revision||new Date(fu.date).toLocaleDateString("es-ES")}</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,fontSize:12}}>
                  <div><label style={{fontSize:10,color:"var(--tm)",display:"block"}}>Consolidación</label>{fu.consolidacion||"—"}</div>
                  <div><label style={{fontSize:10,color:"var(--tm)",display:"block"}}>Escala funcional</label>{fu.resultado_escala?`${fu.resultado_escala}: ${fu.resultado_funcional}`:"—"}</div>
                  <div><label style={{fontSize:10,color:"var(--tm)",display:"block"}}>Reintervención</label>{fu.reintervencion||"—"}</div>
                </div>
                {fu.complicacion_tardia&&<div style={{marginTop:6,fontSize:12}}><label style={{fontSize:10,color:"var(--tm)",display:"block"}}>Complicación tardía</label>{fu.complicacion_tardia}</div>}
              </div>
            )):<div style={{fontSize:12,color:"var(--tm)",marginBottom:12}}>Sin revisiones aún.</div>}

            <div className="afs">
              <div className="aft">+ Añadir revisión de consulta</div>
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
              <button className="btn bp bsm" style={{marginTop:12}} onClick={()=>handleAddFollowUp(selected.id)} disabled={loading}>{loading?"Guardando…":"Guardar revisión"}</button>
            </div>
          </div>
        </>}
      </main>

      {toast&&<div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
