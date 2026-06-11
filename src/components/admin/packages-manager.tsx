"use client";

import { useState } from "react";
import { Plus, Trash2, Edit2, Check, X } from "lucide-react";
import type { Package } from "@/lib/admin";

export function PackagesManager({ initialPackages }: { initialPackages: Package[] }) {
  const [packages, setPackages] = useState<Package[]>(initialPackages);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  
  const [formData, setFormData] = useState<Partial<Package>>({});

  const handleEdit = (pkg: Package) => {
    setEditingId(pkg.id);
    setFormData({ ...pkg });
  };

  const handleCancel = () => {
    setEditingId(null);
    setFormData({});
  };

  const handleSave = async (id: string) => {
    setLoading(id);
    setMessage("");

    const action = id === "new" ? "create" : "update";
    const body = {
      action,
      ...formData,
      ...(id !== "new" && { id }),
    };

    const res = await fetch("/api/admin/packages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json();
      if (action === "create") {
        setPackages([...packages, data.package]);
      } else {
        setPackages(packages.map(p => p.id === id ? { ...p, ...formData } : p));
      }
      setEditingId(null);
      setMessage(`✅ Paket başarıyla ${action === "create" ? "oluşturuldu" : "güncellendi"}.`);
    } else {
      const err = await res.json();
      setMessage(`❌ Hata: ${err.error || "Bilinmeyen hata"}`);
    }
    setLoading(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Bu paketi silmek istediğinize emin misiniz?")) return;
    
    setLoading(id);
    setMessage("");

    const res = await fetch("/api/admin/packages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });

    if (res.ok) {
      setPackages(packages.filter(p => p.id !== id));
      setMessage("✅ Paket silindi.");
    } else {
      setMessage("❌ Hata oluştu.");
    }
    setLoading(null);
  };

  const addNew = () => {
    setEditingId("new");
    setFormData({
      slug: "yeni-paket",
      name: "Yeni Paket",
      description: "",
      price_kurus: 0,
      currency: "TL",
      billing_period: "monthly",
      plan_id: "trial",
      monthly_job_limit: 10,
      parallel_job_limit: 1,
      features: [],
      is_active: true,
      sort_order: packages.length,
    });
  };

  return (
    <div>
      {message && <div className="notice" style={{ marginBottom: 16 }}>{message}</div>}
      
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <button className="button primary" onClick={addNew} disabled={editingId !== null}>
          <Plus size={16} /> Yeni Paket Ekle
        </button>
      </div>

      <div className="table-list">
        {editingId === "new" && (
          <div className="table-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 12, background: "var(--bg-subtle)" }}>
             <h3 style={{ margin: 0 }}>Yeni Paket Oluştur</h3>
             <PackageForm formData={formData} setFormData={setFormData} />
             <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
               <button className="button ghost" onClick={handleCancel} disabled={loading === "new"}><X size={16} /> İptal</button>
               <button className="button primary" onClick={() => handleSave("new")} disabled={loading === "new"}><Check size={16} /> Kaydet</button>
             </div>
          </div>
        )}

        {packages.map(pkg => (
          editingId === pkg.id ? (
            <div key={pkg.id} className="table-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 12, background: "var(--bg-subtle)" }}>
               <h3 style={{ margin: 0 }}>Paket Düzenle: {pkg.name}</h3>
               <PackageForm formData={formData} setFormData={setFormData} />
               <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                 <button className="button ghost" onClick={handleCancel} disabled={loading === pkg.id}><X size={16} /> İptal</button>
                 <button className="button primary" onClick={() => handleSave(pkg.id)} disabled={loading === pkg.id}><Check size={16} /> Kaydet</button>
               </div>
            </div>
          ) : (
            <div key={pkg.id} className="table-row" style={{ gap: 16 }}>
              <div style={{ flex: 1 }}>
                <strong>{pkg.name}</strong>
                <div className="muted" style={{ fontSize: 13 }}>{pkg.slug} · {pkg.plan_id} · {pkg.monthly_job_limit} İş/Ay</div>
              </div>
              <div>
                <strong>{(pkg.price_kurus / 100).toLocaleString("tr-TR")} {pkg.currency}</strong>
                <div className="muted" style={{ fontSize: 13, textAlign: "right" }}>/{pkg.billing_period}</div>
              </div>
              <div style={{ width: 80, textAlign: "center" }}>
                <span className="tag" style={{ background: pkg.is_active ? "var(--success)" : "var(--error)", color: "#fff" }}>
                  {pkg.is_active ? "Aktif" : "Pasif"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="button ghost icon-only" onClick={() => handleEdit(pkg)} disabled={loading !== null} aria-label="Düzenle">
                  <Edit2 size={16} />
                </button>
                <button className="button ghost icon-only" onClick={() => handleDelete(pkg.id)} disabled={loading !== null} style={{ color: "var(--error)" }} aria-label="Sil">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          )
        ))}
      </div>
    </div>
  );
}

function PackageForm({ formData, setFormData }: { formData: Partial<Package>, setFormData: (data: Partial<Package>) => void }) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    let finalValue: any = value;
    
    if (type === "number") finalValue = Number(value);
    if (type === "checkbox") finalValue = (e.target as HTMLInputElement).checked;

    setFormData({ ...formData, [name]: finalValue });
  };

  const handleFeaturesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const features = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
    setFormData({ ...formData, features });
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <div className="field">
        <label>İsim</label>
        <input name="name" value={formData.name || ""} onChange={handleChange} />
      </div>
      <div className="field">
        <label>Slug</label>
        <input name="slug" value={formData.slug || ""} onChange={handleChange} />
      </div>
      <div className="field">
        <label>Fiyat (Kuruş - 100 TL için 10000)</label>
        <input name="price_kurus" type="number" value={formData.price_kurus || 0} onChange={handleChange} />
      </div>
      <div className="field" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label>Para Birimi</label>
          <select name="currency" value={formData.currency || "TL"} onChange={handleChange}>
            <option value="TL">TL</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </div>
        <div>
          <label>Periyot</label>
          <select name="billing_period" value={formData.billing_period || "monthly"} onChange={handleChange}>
            <option value="monthly">Aylık</option>
            <option value="yearly">Yıllık</option>
            <option value="one_time">Tek Sefer</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label>Eşleşen Sistem Planı</label>
        <select name="plan_id" value={formData.plan_id || "trial"} onChange={handleChange}>
          <option value="trial">Trial</option>
          <option value="growth">Growth</option>
          <option value="scale">Scale</option>
        </select>
      </div>
      <div className="field" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label>Aylık İş Limiti</label>
          <input name="monthly_job_limit" type="number" value={formData.monthly_job_limit || 0} onChange={handleChange} />
        </div>
        <div>
          <label>Paralel İş Limiti</label>
          <input name="parallel_job_limit" type="number" value={formData.parallel_job_limit || 0} onChange={handleChange} />
        </div>
      </div>
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label>Özellikler (Virgülle ayırın)</label>
        <input 
          value={(formData.features || []).join(", ")} 
          onChange={handleFeaturesChange} 
          placeholder="Örn: 50 İş/Ay, Sınırsız Takım, 7/24 Destek" 
        />
      </div>
      <div className="field" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input name="is_active" type="checkbox" checked={formData.is_active !== false} onChange={handleChange} style={{ width: "auto" }} />
        <label style={{ margin: 0 }}>Aktif (Satın alınabilir)</label>
      </div>
      <div className="field">
        <label>Sıralama (Küçük olan önce çıkar)</label>
        <input name="sort_order" type="number" value={formData.sort_order || 0} onChange={handleChange} />
      </div>
    </div>
  );
}
