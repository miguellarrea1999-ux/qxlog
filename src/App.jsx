
import { useState, useEffect } from "react";
import * as XLSX from "xlsx";

// ── SUPABASE CONFIG ──────────────────────────────────────────────────────────
// En Vercel: añade estas variables de entorno en Project Settings → Environment Variables
// En desarrollo local: crea un archivo .env con estas variables
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

console.log("URL:", import.meta.env.VITE_SUPABASE_URL);
console.log("KEY:", import.meta.env.VITE_SUPABASE_ANON_KEY);

const supabase = {
  async getAll() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/cirugias?order=fecha.desc`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    if (!res.ok) throw new Error("Error al cargar datos");
    return res.json();
  },
  async insert(record) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/cirugias`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(record),
    });
    if (!res.ok) throw new Error("Error al guardar");
    return res.json();
  },
  async update(id, data) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/cirugias?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
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

// ── CONSTANTES ────────────────────────────────────────────────────────────────
const INITIAL_FORM = {
  fecha: "", nhc: "", edad: "", sexo: "", lado: "",
  asa: "", anticoagulacion: "", anticoagulacion_farmaco: "",
  osteoporosis: "", diabetes: false, irc: false, hta: false, epoc: false,
  otras_comorbilidades: "",
  tipo_cirugia: "", diagnostico: "", clasificacion_ao: "",
  clasificacion_especifica: "", clasificacion_nombre: "",
  posicion: "", abordaje: "", tecnica: "", implante_marca: "",
  implante_tipo: "", injerto: "", injerto_cual: "",
  torniquete: "", ayudante: "",
  complicaciones_intra: "", carga_prescrita: "", observaciones: "",
  fecha_revision: "", consolidacion: "", complicacion_tardia: "",
  resultado_funcional: "", resultado_escala: "",
  reintervencion: "", reintervencion_motivo: "",
};

const STEPS = [
  { id: 1, label: "Paciente", icon: "👤" },
  { id: 2, label: "Riesgo", icon: "🫀" },
  { id: 3, label: "Diagnóstico", icon: "🦴" },
  { id: 4, label: "Cirugía", icon: "🔧" },
  { id: 5, label: "Postop", icon: "📋" },
  { id: 6, label: "Seguimiento", icon: "📅" },
];

const CLASIFICACIONES_COMUNES = [
  "AO/OTA", "Garden", "Neer", "Schatzker", "Tile/AO Pelvis", "Denis", "TLICS",
  "Gustilo-Anderson", "Lauge-Hansen", "Weber", "Hawkins", "Gartland",
  "Salter-Harris", "Pipkin", "Pauwels", "Singh (osteoporosis)", "Otra",
];

// ── EXPORTACIÓN EXCEL ────────────────────────────────────────────────────────
const exportToExcel = (records) => {
  const rows = records.map((r) => ({
    "Fecha": r.fecha || "",
    "NHC": r.nhc || "",
    "Edad": r.edad || "",
    "Sexo": r.sexo || "",
    "Lado": r.lado || "",
    "ASA": r.asa || "",
    "Anticoagulación": r.anticoagulacion || "",
    "Fármaco anticoag.": r.anticoagulacion_farmaco || "",
    "Osteoporosis": r.osteoporosis || "",
    "HTA": r.hta ? "Sí" : "No",
    "Diabetes": r.diabetes ? "Sí" : "No",
    "IRC": r.irc ? "Sí" : "No",
    "EPOC": r.epoc ? "Sí" : "No",
    "Otras comorbilidades": r.otras_comorbilidades || "",
    "Tipo cirugía": r.tipo_cirugia || "",
    "Diagnóstico": r.diagnostico || "",
    "Clasificación AO/OTA": r.clasificacion_ao || "",
    "Sistema clasificación": r.clasificacion_nombre || "",
    "Grado/subtipo": r.clasificacion_especifica || "",
    "Posición": r.posicion || "",
    "Torniquete": r.torniquete || "",
    "Abordaje": r.abordaje || "",
    "Técnica": r.tecnica || "",
    "Implante marca": r.implante_marca || "",
    "Implante tipo/ref.": r.implante_tipo || "",
    "Injerto": r.injerto || "",
    "Detalle injerto": r.injerto_cual || "",
    "Ayudante": r.ayudante || "",
    "Complicaciones intraop.": r.complicaciones_intra || "",
    "Carga prescrita": r.carga_prescrita || "",
    "Observaciones": r.observaciones || "",
    "Fecha revisión": r.fecha_revision || "",
    "Consolidación": r.consolidacion || "",
    "Complicación tardía": r.complicacion_tardia || "",
    "Escala funcional": r.resultado_escala || "",
    "Puntuación funcional": r.resultado_funcional || "",
    "Reintervención": r.reintervencion || "",
    "Motivo reintervención": r.reintervencion_motivo || "",
    "Nº revisiones": (r.follow_ups || []).length,
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Cirugías");

  // Segunda hoja: follow-ups detallados
  const fuRows = [];
  records.forEach((r) => {
    (r.follow_ups || []).forEach((fu, i) => {
      fuRows.push({
        "NHC": r.nhc || "",
        "Diagnóstico": r.diagnostico || "",
        "Fecha cirugía": r.fecha || "",
        "Revisión nº": i + 1,
        "Fecha revisión": fu.fecha_revision || "",
        "Consolidación": fu.consolidacion || "",
        "Complicación tardía": fu.complicacion_tardia || "",
        "Escala funcional": fu.resultado_escala || "",
        "Puntuación": fu.resultado_funcional || "",
        "Reintervención": fu.reintervencion || "",
        "Motivo": fu.reintervencion_motivo || "",
      });
    });
  });

  if (fuRows.length > 0) {
    const ws2 = XLSX.utils.json_to_sheet(fuRows);
    XLSX.utils.book_append_sheet(wb, ws2, "Seguimientos");
  }

  const fecha = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `QxLog_export_${fecha}.xlsx`);
};

// ── COMPONENTES UI ────────────────────────────────────────────────────────────
const SelectField = ({ label, value, onChange, options, required }) => (
  <div className="field-group">
    <label>{label}{required && <span className="req">*</span>}</label>
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— Seleccionar —</option>
      {options.map((o) => (
        <option key={typeof o === "string" ? o : o.value} value={typeof o === "string" ? o : o.value}>
          {typeof o === "string" ? o : o.label}
        </option>
      ))}
    </select>
  </div>
);

const TextField = ({ label, value, onChange, placeholder, required, type = "text" }) => (
  <div className="field-group">
    <label>{label}{required && <span className="req">*</span>}</label>
    <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder || ""} />
  </div>
);

const TextAreaField = ({ label, value, onChange, placeholder }) => (
  <div className="field-group">
    <label>{label}</label>
    <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder || ""} rows={3} />
  </div>
);

const CheckField = ({ label, value, onChange }) => (
  <label className="check-label">
    <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    <span>{label}</span>
  </label>
);

// ── APP PRINCIPAL ─────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState("home");
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(INITIAL_FORM);
  const [records, setRecords] = useState([]);
  const [selected, setSelected] = useState(null);
  const [followForm, setFollowForm] = useState({});
  const [filter, setFilter] = useState("");
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dbError, setDbError] = useState(false);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  // Cargar datos de Supabase al montar
  useEffect(() => {
    if (!SUPABASE_URL || !SUPABASE_KEY) { setDbError(true); return; }
    setLoading(true);
    supabase.getAll()
      .then(setRecords)
      .catch(() => { setDbError(true); showToast("Error de conexión con la base de datos", "error"); })
      .finally(() => setLoading(false));
  }, []);

  const set = (field) => (val) => setForm((f) => ({ ...f, [field]: val }));

  const handleSave = async () => {
    if (!form.fecha || !form.nhc || !form.diagnostico) {
      showToast("Fecha, NHC y diagnóstico son obligatorios", "error");
      return;
    }
    setLoading(true);
    try {
      const record = { ...form, follow_ups: [] };
      const [saved] = await supabase.insert(record);
      setRecords((prev) => [saved, ...prev]);
      setForm(INITIAL_FORM);
      setStep(1);
      showToast("✓ Cirugía registrada correctamente");
      setView("list");
    } catch {
      showToast("Error al guardar. Comprueba la conexión.", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("¿Eliminar este registro? Esta acción no se puede deshacer.")) return;
    setLoading(true);
    try {
      await supabase.delete(id);
      setRecords((prev) => prev.filter((r) => r.id !== id));
      showToast("Registro eliminado");
      setView("list");
    } catch {
      showToast("Error al eliminar", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleAddFollowUp = async (id) => {
    const record = records.find((r) => r.id === id);
    const updatedFu = [...(record.follow_ups || []), { ...followForm, date: new Date().toISOString() }];
    setLoading(true);
    try {
      const [updated] = await supabase.update(id, { follow_ups: updatedFu });
      setRecords((prev) => prev.map((r) => (r.id === id ? updated : r)));
      setSelected(updated);
      setFollowForm({});
      showToast("✓ Revisión guardada");
    } catch {
      showToast("Error al guardar revisión", "error");
    } finally {
      setLoading(false);
    }
  };

  const filtered = records.filter((r) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      (r.diagnostico || "").toLowerCase().includes(q) ||
      (r.nhc || "").includes(q) ||
      (r.tipo_cirugia || "").toLowerCase().includes(q) ||
      (r.implante_tipo || "").toLowerCase().includes(q) ||
      (r.fecha || "").includes(q)
    );
  });

  const stats = {
    total: records.length,
    fracturas: records.filter((r) => r.tipo_cirugia === "Fractura aguda").length,
    electivas: records.filter((r) => r.tipo_cirugia === "Electiva").length,
    artroscopias: records.filter((r) => r.tipo_cirugia === "Artroscopia").length,
    complicaciones: records.filter(
      (r) => r.complicaciones_intra && !["ninguna", "no", ""].includes((r.complicaciones_intra || "").toLowerCase().trim())
    ).length,
  };

  return (
    <div className="app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Mono:wght@300;400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --bg: #0d1117; --surface: #161b22; --surface2: #1c2330; --border: #30363d;
          --accent: #58a6ff; --accent2: #3fb950; --accent3: #f78166; --accent4: #d2a8ff;
          --text: #e6edf3; --text-muted: #7d8590; --text-dim: #484f58;
          --red: #f85149; --yellow: #e3b341; --radius: 8px;
        }
        body { background: var(--bg); color: var(--text); font-family: 'DM Mono', monospace; }
        .app { min-height: 100vh; display: flex; flex-direction: column; }

        .header {
          background: var(--surface); border-bottom: 1px solid var(--border);
          padding: 0 24px; display: flex; align-items: center;
          justify-content: space-between; height: 60px;
          position: sticky; top: 0; z-index: 100;
        }
        .header-logo { font-family: 'DM Serif Display', serif; font-size: 20px; color: var(--accent); }
        .header-logo span { color: var(--text-muted); font-size: 13px; font-family: 'DM Mono', monospace; margin-left: 10px; }
        .header-right { display: flex; align-items: center; gap: 8px; }
        .nav { display: flex; gap: 4px; }
        .nav-btn {
          background: none; border: none; color: var(--text-muted);
          font-family: 'DM Mono', monospace; font-size: 12px; padding: 6px 12px;
          border-radius: var(--radius); cursor: pointer; transition: all 0.15s;
        }
        .nav-btn:hover { background: var(--surface2); color: var(--text); }
        .nav-btn.active { background: var(--accent); color: #000; font-weight: 500; }
        .export-btn {
          background: var(--surface2); border: 1px solid var(--border);
          color: var(--accent2); font-family: 'DM Mono', monospace; font-size: 11px;
          padding: 6px 12px; border-radius: var(--radius); cursor: pointer;
          transition: all 0.15s; font-weight: 500;
        }
        .export-btn:hover { border-color: var(--accent2); background: rgba(63,185,80,0.1); }

        .db-banner {
          background: rgba(248,81,73,0.1); border-bottom: 1px solid var(--red);
          padding: 8px 24px; font-size: 12px; color: var(--red); text-align: center;
        }
        .loading-bar {
          height: 2px; background: var(--surface);
          position: fixed; top: 60px; left: 0; right: 0; z-index: 99;
        }
        .loading-bar::after {
          content: ''; display: block; height: 100%;
          background: var(--accent); width: 60%;
          animation: loadpulse 1s ease-in-out infinite alternate;
        }
        @keyframes loadpulse { from { opacity: 0.4; } to { opacity: 1; } }

        .main { flex: 1; padding: 32px 24px; max-width: 900px; margin: 0 auto; width: 100%; }

        .home-hero { text-align: center; padding: 60px 0 48px; }
        .home-title { font-family: 'DM Serif Display', serif; font-size: 48px; line-height: 1.1; margin-bottom: 12px; }
        .home-title em { color: var(--accent); font-style: italic; }
        .home-sub { color: var(--text-muted); font-size: 13px; max-width: 400px; margin: 0 auto 40px; line-height: 1.6; }

        .stats-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 40px; }
        .stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px 16px; text-align: center; }
        .stat-num { font-family: 'DM Serif Display', serif; font-size: 36px; color: var(--accent); line-height: 1; }
        .stat-label { font-size: 10px; color: var(--text-muted); margin-top: 6px; text-transform: uppercase; letter-spacing: 0.5px; }

        .home-actions { display: flex; gap: 12px; justify-content: center; }
        .btn { font-family: 'DM Mono', monospace; font-size: 13px; padding: 10px 20px; border-radius: var(--radius); border: 1px solid transparent; cursor: pointer; transition: all 0.15s; font-weight: 500; }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-primary { background: var(--accent); color: #000; border-color: var(--accent); }
        .btn-primary:hover:not(:disabled) { background: #79c0ff; }
        .btn-secondary { background: var(--surface); color: var(--text); border-color: var(--border); }
        .btn-secondary:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
        .btn-danger { background: var(--surface); color: var(--red); border-color: var(--border); }
        .btn-danger:hover:not(:disabled) { border-color: var(--red); background: rgba(248,81,73,0.1); }
        .btn-success { background: var(--accent2); color: #000; border-color: var(--accent2); }
        .btn-sm { font-size: 11px; padding: 6px 12px; }

        .stepper { display: flex; align-items: center; margin-bottom: 32px; }
        .step-item { display: flex; align-items: center; flex: 1; }
        .step-dot {
          width: 32px; height: 32px; border-radius: 50%; border: 2px solid var(--border);
          display: flex; align-items: center; justify-content: center; font-size: 14px;
          flex-shrink: 0; background: var(--surface); transition: all 0.2s; cursor: pointer;
        }
        .step-dot.active { border-color: var(--accent); background: var(--accent); }
        .step-dot.done { border-color: var(--accent2); background: var(--accent2); }
        .step-line { flex: 1; height: 1px; background: var(--border); }
        .step-line.done { background: var(--accent2); }

        .form-header { margin-bottom: 28px; }
        .form-block-title { font-family: 'DM Serif Display', serif; font-size: 22px; margin-bottom: 4px; }
        .form-block-sub { font-size: 12px; color: var(--text-muted); }

        .fields-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
        .fields-grid.three { grid-template-columns: 1fr 1fr 1fr; }
        .fields-grid.one { grid-template-columns: 1fr; }

        .field-group { display: flex; flex-direction: column; gap: 6px; }
        .field-group label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
        .req { color: var(--red); margin-left: 3px; }
        .field-group input, .field-group select, .field-group textarea {
          background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
          color: var(--text); font-family: 'DM Mono', monospace; font-size: 13px;
          padding: 9px 12px; outline: none; transition: border-color 0.15s; width: 100%;
        }
        .field-group input:focus, .field-group select:focus, .field-group textarea:focus { border-color: var(--accent); }
        .field-group select option { background: var(--surface2); }
        .field-group textarea { resize: vertical; }

        .check-row { display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 16px; }
        .check-label { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; }
        .check-label input[type="checkbox"] { accent-color: var(--accent); width: 15px; height: 15px; }

        .form-actions {
          display: flex; justify-content: space-between; align-items: center;
          margin-top: 32px; padding-top: 20px; border-top: 1px solid var(--border);
        }
        .section-divider { border: none; border-top: 1px solid var(--border); margin: 20px 0; }

        .list-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; gap: 16px; }
        .list-title { font-family: 'DM Serif Display', serif; font-size: 28px; }
        .list-controls { display: flex; gap: 8px; align-items: center; }
        .search-box {
          background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
          color: var(--text); font-family: 'DM Mono', monospace; font-size: 13px;
          padding: 8px 12px; outline: none; width: 220px;
        }
        .search-box:focus { border-color: var(--accent); }

        .record-card {
          background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
          padding: 16px 20px; margin-bottom: 10px; cursor: pointer;
          transition: all 0.15s; display: flex; align-items: center; gap: 16px;
        }
        .record-card:hover { border-color: var(--accent); background: var(--surface2); }
        .record-date { font-size: 11px; color: var(--text-muted); min-width: 90px; }
        .record-dx { flex: 1; font-size: 13px; }
        .record-dx strong { color: var(--text); display: block; margin-bottom: 2px; }
        .record-dx span { color: var(--text-muted); font-size: 11px; }

        .tag { font-size: 10px; padding: 3px 8px; border-radius: 20px; border: 1px solid; white-space: nowrap; font-weight: 500; }
        .tag-fractura { color: var(--accent3); border-color: var(--accent3); background: rgba(247,129,102,0.1); }
        .tag-electiva { color: var(--accent4); border-color: var(--accent4); background: rgba(210,168,255,0.1); }
        .tag-artroscopia { color: var(--accent2); border-color: var(--accent2); background: rgba(63,185,80,0.1); }
        .tag-otra { color: var(--yellow); border-color: var(--yellow); background: rgba(227,179,65,0.1); }
        .tag-followup { color: var(--accent); border-color: var(--accent); background: rgba(88,166,255,0.1); }

        .detail-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 28px; gap: 16px; }
        .detail-title { font-family: 'DM Serif Display', serif; font-size: 30px; line-height: 1.2; }
        .detail-meta { font-size: 12px; color: var(--text-muted); margin-top: 6px; }
        .detail-actions { display: flex; gap: 8px; flex-shrink: 0; }

        .info-block { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; margin-bottom: 16px; }
        .info-block-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-muted); margin-bottom: 14px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
        .info-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
        .info-item label { font-size: 10px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 3px; }
        .info-item span { font-size: 13px; }
        .info-item span.empty { color: var(--text-dim); }

        .follow-up-item { background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 16px; margin-bottom: 8px; font-size: 12px; }
        .follow-up-date { font-size: 10px; color: var(--text-muted); margin-bottom: 6px; }

        .add-follow-section { background: var(--surface); border: 1px dashed var(--border); border-radius: var(--radius); padding: 20px; margin-top: 16px; }
        .add-follow-title { font-size: 12px; color: var(--accent); margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.5px; }

        .toast {
          position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
          font-family: 'DM Mono', monospace; font-size: 13px; font-weight: 500;
          padding: 12px 24px; border-radius: 40px; z-index: 999;
          animation: fadeUp 0.3s ease;
        }
        .toast.success { background: var(--accent2); color: #000; }
        .toast.error { background: var(--red); color: #fff; }
        @keyframes fadeUp { from { opacity: 0; transform: translateX(-50%) translateY(12px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }

        .empty-state { text-align: center; padding: 60px 0; color: var(--text-muted); font-size: 13px; }
        .empty-state .big { font-size: 48px; margin-bottom: 12px; }

        @media (max-width: 600px) {
          .stats-grid { grid-template-columns: repeat(3, 1fr); }
          .fields-grid, .fields-grid.three { grid-template-columns: 1fr; }
          .info-grid { grid-template-columns: 1fr 1fr; }
          .header-logo span { display: none; }
        }
      `}</style>

      <header className="header">
        <div className="header-logo">
          QxLog <span>Registro Quirúrgico · COT · Manises</span>
        </div>
        <div className="header-right">
          <nav className="nav">
            <button className={`nav-btn ${view === "home" ? "active" : ""}`} onClick={() => setView("home")}>Inicio</button>
            <button className={`nav-btn ${view === "new" ? "active" : ""}`} onClick={() => { setView("new"); setStep(1); setForm(INITIAL_FORM); }}>+ Nueva cirugía</button>
            <button className={`nav-btn ${view === "list" ? "active" : ""}`} onClick={() => setView("list")}>Registro ({records.length})</button>
          </nav>
          {records.length > 0 && (
            <button className="export-btn" onClick={() => exportToExcel(records)} title="Exportar a Excel para SPSS/análisis">
              ↓ Excel
            </button>
          )}
        </div>
      </header>

      {dbError && (
        <div className="db-banner">
          ⚠️ Sin conexión a Supabase — configura VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en tus variables de entorno
        </div>
      )}
      {loading && <div className="loading-bar" />}

      <main className="main">

        {/* HOME */}
        {view === "home" && (
          <>
            <div className="home-hero">
              <div className="home-title">Registro<br /><em>quirúrgico</em><br />personal</div>
              <div className="home-sub">Base de datos permanente para tu actividad como cirujano principal. R3 COT · Hospital de Manises</div>
            </div>
            <div className="stats-grid">
              <div className="stat-card"><div className="stat-num">{stats.total}</div><div className="stat-label">Total cirugías</div></div>
              <div className="stat-card"><div className="stat-num" style={{ color: "var(--accent3)" }}>{stats.fracturas}</div><div className="stat-label">Fracturas</div></div>
              <div className="stat-card"><div className="stat-num" style={{ color: "var(--accent4)" }}>{stats.electivas}</div><div className="stat-label">Electivas</div></div>
              <div className="stat-card"><div className="stat-num" style={{ color: "var(--accent2)" }}>{stats.artroscopias}</div><div className="stat-label">Artroscopias</div></div>
              <div className="stat-card"><div className="stat-num" style={{ color: "var(--red)" }}>{stats.complicaciones}</div><div className="stat-label">Complicaciones</div></div>
            </div>
            <div className="home-actions">
              <button className="btn btn-primary" onClick={() => { setView("new"); setStep(1); setForm(INITIAL_FORM); }}>+ Registrar nueva cirugía</button>
              <button className="btn btn-secondary" onClick={() => setView("list")}>Ver registro completo</button>
              {records.length > 0 && <button className="btn btn-secondary" onClick={() => exportToExcel(records)}>↓ Exportar Excel</button>}
            </div>
          </>
        )}

        {/* NUEVO REGISTRO */}
        {view === "new" && (
          <>
            <div className="stepper">
              {STEPS.map((s, i) => (
                <div key={s.id} className="step-item">
                  <div className={`step-dot ${step === s.id ? "active" : step > s.id ? "done" : ""}`} onClick={() => step > s.id && setStep(s.id)} title={s.label}>
                    {step > s.id ? "✓" : s.icon}
                  </div>
                  {i < STEPS.length - 1 && <div className={`step-line ${step > s.id ? "done" : ""}`} />}
                </div>
              ))}
            </div>

            {step === 1 && (
              <>
                <div className="form-header"><div className="form-block-title">Identificación del paciente</div><div className="form-block-sub">Datos básicos del caso</div></div>
                <div className="fields-grid three">
                  <TextField label="Fecha de cirugía" value={form.fecha} onChange={set("fecha")} type="date" required />
                  <TextField label="NHC" value={form.nhc} onChange={set("nhc")} placeholder="Nº historia clínica" required />
                  <TextField label="Edad" value={form.edad} onChange={set("edad")} placeholder="años" type="number" />
                </div>
                <div className="fields-grid three">
                  <SelectField label="Sexo" value={form.sexo} onChange={set("sexo")} options={["Hombre", "Mujer"]} />
                  <SelectField label="Lado" value={form.lado} onChange={set("lado")} options={["Derecho", "Izquierdo", "Bilateral", "No aplica"]} />
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <div className="form-header"><div className="form-block-title">Comorbilidades y riesgo quirúrgico</div><div className="form-block-sub">Estado preoperatorio del paciente</div></div>
                <div className="fields-grid">
                  <SelectField label="ASA" value={form.asa} onChange={set("asa")} options={[{ value: "I", label: "ASA I — Sano" }, { value: "II", label: "ASA II — Enfermedad leve" }, { value: "III", label: "ASA III — Enfermedad severa" }, { value: "IV", label: "ASA IV — Riesgo vital constante" }]} />
                  <SelectField label="Anticoagulación / antiagregación" value={form.anticoagulacion} onChange={set("anticoagulacion")} options={["No", "Sí — suspendida", "Sí — mantenida", "Bridging"]} />
                </div>
                {form.anticoagulacion && form.anticoagulacion !== "No" && (
                  <div className="fields-grid one"><TextField label="Fármaco anticoagulante" value={form.anticoagulacion_farmaco} onChange={set("anticoagulacion_farmaco")} placeholder="acenocumarol, rivaroxabán, AAS…" /></div>
                )}
                <div className="fields-grid one"><SelectField label="Osteoporosis conocida / DXA patológica" value={form.osteoporosis} onChange={set("osteoporosis")} options={["No", "Osteopenia", "Osteoporosis confirmada", "Desconocido"]} /></div>
                <hr className="section-divider" />
                <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>Otras comorbilidades</div>
                <div className="check-row">
                  <CheckField label="HTA" value={form.hta} onChange={set("hta")} />
                  <CheckField label="Diabetes" value={form.diabetes} onChange={set("diabetes")} />
                  <CheckField label="IRC" value={form.irc} onChange={set("irc")} />
                  <CheckField label="EPOC" value={form.epoc} onChange={set("epoc")} />
                </div>
                <div className="fields-grid one"><TextField label="Otras (texto libre)" value={form.otras_comorbilidades} onChange={set("otras_comorbilidades")} placeholder="hepatopatía, neoplasia activa…" /></div>
              </>
            )}

            {step === 3 && (
              <>
                <div className="form-header"><div className="form-block-title">Diagnóstico y clasificación</div><div className="form-block-sub">Patología intervenida y sistemas de clasificación</div></div>
                <div className="fields-grid">
                  <SelectField label="Tipo de cirugía" value={form.tipo_cirugia} onChange={set("tipo_cirugia")} required options={["Fractura aguda", "Electiva", "Artroscopia", "Revisión / reintervención", "Urgencia no traumática", "Otra"]} />
                  <TextField label="Diagnóstico" value={form.diagnostico} onChange={set("diagnostico")} placeholder="fractura distal de radio, gonartosis…" required />
                </div>
                <hr className="section-divider" />
                <div className="fields-grid one"><TextField label="Código AO/OTA (si aplica)" value={form.clasificacion_ao} onChange={set("clasificacion_ao")} placeholder="23-C2, 31-A2…" /></div>
                <hr className="section-divider" />
                <div className="fields-grid">
                  <SelectField label="Sistema de clasificación adicional" value={form.clasificacion_nombre} onChange={set("clasificacion_nombre")} options={CLASIFICACIONES_COMUNES} />
                  <TextField label="Grado / subtipo" value={form.clasificacion_especifica} onChange={set("clasificacion_especifica")} placeholder="Garden III, Schatzker V…" />
                </div>
              </>
            )}

            {step === 4 && (
              <>
                <div className="form-header"><div className="form-block-title">Detalles quirúrgicos</div><div className="form-block-sub">Técnica, implante y equipo</div></div>
                <div className="fields-grid">
                  <SelectField label="Posición del paciente" value={form.posicion} onChange={set("posicion")} options={["Decúbito supino", "Decúbito prono", "Decúbito lateral derecho", "Decúbito lateral izquierdo", "Silla de playa", "Trendelenburg", "Otra"]} />
                  <SelectField label="Torniquete" value={form.torniquete} onChange={set("torniquete")} options={["No", "Sí — isquemia total", "Sí — isquemia parcial"]} />
                </div>
                <div className="fields-grid one"><TextField label="Abordaje quirúrgico" value={form.abordaje} onChange={set("abordaje")} placeholder="volar de Henry, posterolateral de codo, lateral de cadera…" /></div>
                <div className="fields-grid one"><TextAreaField label="Técnica quirúrgica (resumen)" value={form.tecnica} onChange={set("tecnica")} placeholder="Descripción breve de la técnica empleada" /></div>
                <hr className="section-divider" />
                <div className="fields-grid">
                  <TextField label="Marca del implante" value={form.implante_marca} onChange={set("implante_marca")} placeholder="Synthes, Stryker, Arthrex…" />
                  <TextField label="Tipo / referencia" value={form.implante_tipo} onChange={set("implante_tipo")} placeholder="LCP 3.5 volar, TEN 3.0, Expert tibial nail…" />
                </div>
                <div className="fields-grid">
                  <SelectField label="Injerto / material biológico" value={form.injerto} onChange={set("injerto")} options={["No", "Autoinjerto esponjoso", "Aloinjerto", "Sustituto sintético", "PRF/PRP", "Otro"]} />
                  <TextField label="Ayudante (nombre o código)" value={form.ayudante} onChange={set("ayudante")} placeholder="R1, R2, adjunto…" />
                </div>
                {form.injerto && form.injerto !== "No" && (
                  <div className="fields-grid one"><TextField label="Detalle del injerto" value={form.injerto_cual} onChange={set("injerto_cual")} placeholder="Zona donante, marca comercial…" /></div>
                )}
              </>
            )}

            {step === 5 && (
              <>
                <div className="form-header"><div className="form-block-title">Postoperatorio inmediato</div><div className="form-block-sub">Incidencias y prescripción al alta</div></div>
                <div className="fields-grid one"><TextAreaField label="Complicaciones intraoperatorias" value={form.complicaciones_intra} onChange={set("complicaciones_intra")} placeholder="Ninguna / describir: sangrado mayor, dificultad técnica, conversión…" /></div>
                <div className="fields-grid one"><TextField label="Prescripción de carga / movilización" value={form.carga_prescrita} onChange={set("carga_prescrita")} placeholder="sin carga 6 semanas, carga parcial inmediata, movilización libre…" /></div>
                <div className="fields-grid one"><TextAreaField label="Observaciones / notas adicionales" value={form.observaciones} onChange={set("observaciones")} placeholder="Cualquier dato relevante no recogido anteriormente" /></div>
              </>
            )}

            {step === 6 && (
              <>
                <div className="form-header"><div className="form-block-title">Seguimiento inicial (opcional)</div><div className="form-block-sub">Puedes completarlo ahora o añadirlo desde el registro en cualquier momento</div></div>
                <div className="fields-grid">
                  <TextField label="Fecha de primera revisión" value={form.fecha_revision} onChange={set("fecha_revision")} type="date" />
                  <SelectField label="Consolidación radiológica" value={form.consolidacion} onChange={set("consolidacion")} options={["Sí — completa", "Parcial / callo incipiente", "No consolidado / retardo", "No aplica"]} />
                </div>
                <div className="fields-grid one"><TextAreaField label="Complicación tardía" value={form.complicacion_tardia} onChange={set("complicacion_tardia")} placeholder="Ninguna / describir…" /></div>
                <div className="fields-grid">
                  <SelectField label="Escala resultado funcional" value={form.resultado_escala} onChange={set("resultado_escala")} options={["QuickDASH", "DASH", "WOMAC", "Oxford Knee", "Oxford Hip", "AOFAS", "EVA dolor", "Otra"]} />
                  <TextField label="Puntuación obtenida" value={form.resultado_funcional} onChange={set("resultado_funcional")} type="number" />
                </div>
                <div className="fields-grid">
                  <SelectField label="Reintervención" value={form.reintervencion} onChange={set("reintervencion")} options={["No", "Sí"]} />
                  {form.reintervencion === "Sí" && <TextField label="Motivo de reintervención" value={form.reintervencion_motivo} onChange={set("reintervencion_motivo")} />}
                </div>
              </>
            )}

            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => step > 1 ? setStep((s) => s - 1) : setView("home")}>
                {step > 1 ? "← Anterior" : "Cancelar"}
              </button>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Paso {step} de {STEPS.length}</div>
              {step < STEPS.length
                ? <button className="btn btn-primary" onClick={() => setStep((s) => s + 1)}>Siguiente →</button>
                : <button className="btn btn-success" onClick={handleSave} disabled={loading}>{loading ? "Guardando…" : "✓ Guardar registro"}</button>
              }
            </div>
          </>
        )}

        {/* LISTA */}
        {view === "list" && (
          <>
            <div className="list-header">
              <div className="list-title">Registro quirúrgico</div>
              <div className="list-controls">
                <input className="search-box" placeholder="Buscar diagnóstico, NHC…" value={filter} onChange={(e) => setFilter(e.target.value)} />
                {records.length > 0 && <button className="btn btn-secondary btn-sm" onClick={() => exportToExcel(records)}>↓ Excel</button>}
              </div>
            </div>
            {filtered.length === 0 ? (
              <div className="empty-state">
                <div className="big">🦴</div>
                {records.length === 0 ? "Aún no hay cirugías registradas." : "Sin resultados para esa búsqueda."}
              </div>
            ) : (
              filtered.map((r) => {
                const tagClass = r.tipo_cirugia === "Fractura aguda" ? "tag-fractura" : r.tipo_cirugia === "Electiva" ? "tag-electiva" : r.tipo_cirugia === "Artroscopia" ? "tag-artroscopia" : "tag-otra";
                return (
                  <div key={r.id} className="record-card" onClick={() => { setSelected(r); setView("detail"); }}>
                    <div className="record-date">{r.fecha || "—"}</div>
                    <div className="record-dx">
                      <strong>{r.diagnostico || "Sin diagnóstico"}</strong>
                      <span>{r.nhc ? `NHC: ${r.nhc}` : ""}{r.edad ? ` · ${r.edad}a` : ""}{r.clasificacion_ao ? ` · AO: ${r.clasificacion_ao}` : ""}</span>
                    </div>
                    {r.tipo_cirugia && <span className={`tag ${tagClass}`}>{r.tipo_cirugia}</span>}
                    {r.follow_ups?.length > 0 && <span className="tag tag-followup">{r.follow_ups.length} rev.</span>}
                    <span style={{ color: "var(--text-muted)", fontSize: 16 }}>›</span>
                  </div>
                );
              })
            )}
          </>
        )}

        {/* DETALLE */}
        {view === "detail" && selected && (
          <>
            <div className="detail-header">
              <div>
                <div className="detail-title">{selected.diagnostico || "Sin diagnóstico"}</div>
                <div className="detail-meta">NHC: {selected.nhc || "—"} · {selected.edad ? `${selected.edad} años` : "—"} · {selected.sexo || "—"} · {selected.fecha || "—"}</div>
              </div>
              <div className="detail-actions">
                <button className="btn btn-secondary btn-sm" onClick={() => setView("list")}>← Volver</button>
                <button className="btn btn-danger btn-sm" onClick={() => handleDelete(selected.id)} disabled={loading}>Eliminar</button>
              </div>
            </div>

            <div className="info-block">
              <div className="info-block-title">Riesgo y comorbilidades</div>
              <div className="info-grid">
                <div className="info-item"><label>ASA</label><span className={selected.asa ? "" : "empty"}>{selected.asa || "—"}</span></div>
                <div className="info-item"><label>Anticoagulación</label><span className={selected.anticoagulacion ? "" : "empty"}>{selected.anticoagulacion || "—"}{selected.anticoagulacion_farmaco ? ` (${selected.anticoagulacion_farmaco})` : ""}</span></div>
                <div className="info-item"><label>Osteoporosis</label><span className={selected.osteoporosis ? "" : "empty"}>{selected.osteoporosis || "—"}</span></div>
                <div className="info-item"><label>Otras</label><span>{[selected.hta && "HTA", selected.diabetes && "DM", selected.irc && "IRC", selected.epoc && "EPOC", selected.otras_comorbilidades].filter(Boolean).join(", ") || <span className="empty">—</span>}</span></div>
              </div>
            </div>

            <div className="info-block">
              <div className="info-block-title">Diagnóstico y clasificación</div>
              <div className="info-grid">
                <div className="info-item"><label>Tipo</label><span className={selected.tipo_cirugia ? "" : "empty"}>{selected.tipo_cirugia || "—"}</span></div>
                <div className="info-item"><label>AO/OTA</label><span className={selected.clasificacion_ao ? "" : "empty"}>{selected.clasificacion_ao || "—"}</span></div>
                <div className="info-item"><label>Clasificación específica</label><span className={selected.clasificacion_nombre ? "" : "empty"}>{selected.clasificacion_nombre ? `${selected.clasificacion_nombre}: ${selected.clasificacion_especifica}` : "—"}</span></div>
              </div>
            </div>

            <div className="info-block">
              <div className="info-block-title">Cirugía</div>
              <div className="info-grid">
                <div className="info-item"><label>Posición</label><span className={selected.posicion ? "" : "empty"}>{selected.posicion || "—"}</span></div>
                <div className="info-item"><label>Torniquete</label><span className={selected.torniquete ? "" : "empty"}>{selected.torniquete || "—"}</span></div>
                <div className="info-item"><label>Ayudante</label><span className={selected.ayudante ? "" : "empty"}>{selected.ayudante || "—"}</span></div>
                <div className="info-item"><label>Abordaje</label><span className={selected.abordaje ? "" : "empty"}>{selected.abordaje || "—"}</span></div>
                <div className="info-item"><label>Implante</label><span className={selected.implante_marca ? "" : "empty"}>{[selected.implante_marca, selected.implante_tipo].filter(Boolean).join(" — ") || "—"}</span></div>
                <div className="info-item"><label>Injerto</label><span className={selected.injerto && selected.injerto !== "No" ? "" : "empty"}>{selected.injerto || "—"}</span></div>
              </div>
              {selected.tecnica && <div style={{ marginTop: 12 }}><div className="info-item"><label>Técnica</label><span>{selected.tecnica}</span></div></div>}
            </div>

            <div className="info-block">
              <div className="info-block-title">Postoperatorio</div>
              <div className="info-grid">
                <div className="info-item"><label>Complicaciones intraop.</label><span className={selected.complicaciones_intra ? "" : "empty"}>{selected.complicaciones_intra || "—"}</span></div>
                <div className="info-item"><label>Carga prescrita</label><span className={selected.carga_prescrita ? "" : "empty"}>{selected.carga_prescrita || "—"}</span></div>
              </div>
              {selected.observaciones && <div style={{ marginTop: 12 }}><div className="info-item"><label>Observaciones</label><span>{selected.observaciones}</span></div></div>}
            </div>

            <div className="info-block">
              <div className="info-block-title">Seguimiento</div>
              {(selected.follow_ups || []).length > 0 ? (
                selected.follow_ups.map((fu, i) => (
                  <div key={i} className="follow-up-item">
                    <div className="follow-up-date">Revisión {i + 1} — {fu.fecha_revision || new Date(fu.date).toLocaleDateString("es-ES")}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                      <div><label style={{ fontSize: 10, color: "var(--text-muted)", display: "block" }}>Consolidación</label>{fu.consolidacion || "—"}</div>
                      <div><label style={{ fontSize: 10, color: "var(--text-muted)", display: "block" }}>Escala funcional</label>{fu.resultado_escala ? `${fu.resultado_escala}: ${fu.resultado_funcional}` : "—"}</div>
                      <div><label style={{ fontSize: 10, color: "var(--text-muted)", display: "block" }}>Reintervención</label>{fu.reintervencion || "—"}</div>
                    </div>
                    {fu.complicacion_tardia && <div style={{ marginTop: 6 }}><label style={{ fontSize: 10, color: "var(--text-muted)", display: "block" }}>Complicación tardía</label>{fu.complicacion_tardia}</div>}
                  </div>
                ))
              ) : (
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>Sin revisiones registradas aún.</div>
              )}

              <div className="add-follow-section">
                <div className="add-follow-title">+ Añadir revisión de consulta</div>
                <div className="fields-grid">
                  <TextField label="Fecha de revisión" value={followForm.fecha_revision || ""} onChange={(v) => setFollowForm((f) => ({ ...f, fecha_revision: v }))} type="date" />
                  <SelectField label="Consolidación" value={followForm.consolidacion || ""} onChange={(v) => setFollowForm((f) => ({ ...f, consolidacion: v }))} options={["Sí — completa", "Parcial / callo incipiente", "No consolidado / retardo", "No aplica"]} />
                </div>
                <div className="fields-grid">
                  <SelectField label="Escala funcional" value={followForm.resultado_escala || ""} onChange={(v) => setFollowForm((f) => ({ ...f, resultado_escala: v }))} options={["QuickDASH", "DASH", "WOMAC", "Oxford Knee", "Oxford Hip", "AOFAS", "EVA dolor", "Otra"]} />
                  <TextField label="Puntuación" value={followForm.resultado_funcional || ""} onChange={(v) => setFollowForm((f) => ({ ...f, resultado_funcional: v }))} type="number" />
                </div>
                <div className="fields-grid one"><TextAreaField label="Complicación tardía" value={followForm.complicacion_tardia || ""} onChange={(v) => setFollowForm((f) => ({ ...f, complicacion_tardia: v }))} placeholder="Ninguna / describir…" /></div>
                <div className="fields-grid">
                  <SelectField label="Reintervención" value={followForm.reintervencion || ""} onChange={(v) => setFollowForm((f) => ({ ...f, reintervencion: v }))} options={["No", "Sí"]} />
                  {followForm.reintervencion === "Sí" && <TextField label="Motivo" value={followForm.reintervencion_motivo || ""} onChange={(v) => setFollowForm((f) => ({ ...f, reintervencion_motivo: v }))} />}
                </div>
                <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={() => handleAddFollowUp(selected.id)} disabled={loading}>
                  {loading ? "Guardando…" : "Guardar revisión"}
                </button>
              </div>
            </div>
          </>
        )}
      </main>

      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}