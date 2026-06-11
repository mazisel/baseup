"use client";

import { useState } from "react";
import { Plus, Trash2, Edit2, Check, X } from "lucide-react";
import type { Package } from "@/lib/admin";
import { formatMoney, fromMinorUnit, toMinorUnit } from "@/lib/money";

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
    const normalizedData = normalizePackageForm(formData);
    const body = {
      action,
      ...normalizedData,
      ...(id !== "new" && { id, updates: normalizedData }),
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
        setPackages(packages.map(p => p.id === id ? { ...p, ...normalizedData } : p));
      }
      setEditingId(null);
      setMessage(`✅ Plan başarıyla ${action === "create" ? "oluşturuldu" : "güncellendi"}.`);
    } else {
      const err = await res.json();
      setMessage(`❌ Hata: ${err.error || "Bilinmeyen hata"}`);
    }
    setLoading(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Bu planı silmek istediğinize emin misiniz?")) return;
    
    setLoading(id);
    setMessage("");

    const res = await fetch("/api/admin/packages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });

    if (res.ok) {
      setPackages(packages.filter(p => p.id !== id));
      setMessage("✅ Plan silindi.");
    } else {
      setMessage("❌ Hata oluştu.");
    }
    setLoading(null);
  };

  const addNew = () => {
    setEditingId("new");
    setFormData({
      slug: "basic",
      name: "Basic",
      description: "",
      price_kurus: 0,
      currency: "USD",
      billing_period: "monthly",
      plan_id: "basic",
      monthly_job_limit: 10,
      parallel_job_limit: 1,
      features: [],
      is_active: true,
      sort_order: packages.length,
    });
  };

  return (
    <div className="admin-manager">
      {message && <div className="notice" style={{ marginBottom: 16 }}>{message}</div>}
      
      <div className="admin-manager-toolbar">
        <button className="button primary" onClick={addNew} disabled={editingId !== null}>
          <Plus size={16} /> Yeni Plan Ekle
        </button>
      </div>

      <div className="admin-list">
        {editingId === "new" && (
          <div className="admin-edit-card">
             <h3>Yeni Sistem Planı Oluştur</h3>
             <PackageForm formData={formData} setFormData={setFormData} />
             <div className="admin-form-actions">
               <button className="button ghost" onClick={handleCancel} disabled={loading === "new"}><X size={16} /> İptal</button>
               <button className="button primary" onClick={() => handleSave("new")} disabled={loading === "new"}><Check size={16} /> Kaydet</button>
             </div>
          </div>
        )}

        {packages.map(pkg => (
          editingId === pkg.id ? (
            <div key={pkg.id} className="admin-edit-card">
               <h3>Plan Düzenle: {pkg.name}</h3>
               <PackageForm formData={formData} setFormData={setFormData} />
               <div className="admin-form-actions">
                 <button className="button ghost" onClick={handleCancel} disabled={loading === pkg.id}><X size={16} /> İptal</button>
                 <button className="button primary" onClick={() => handleSave(pkg.id)} disabled={loading === pkg.id}><Check size={16} /> Kaydet</button>
               </div>
            </div>
          ) : (
            <div key={pkg.id} className="admin-list-row package-admin-row">
              <div>
                <strong>{pkg.name}</strong>
                <div className="muted" style={{ fontSize: 13 }}>{pkg.slug} · {pkg.monthly_job_limit} işlem/ay</div>
              </div>
              <div>
                <strong>{formatMoney(pkg.price_kurus, pkg.currency)}</strong>
                <div className="muted" style={{ fontSize: 13, textAlign: "right" }}>/{pkg.billing_period}</div>
              </div>
              <div style={{ width: 80, textAlign: "center" }}>
                <span className="tag" style={{ background: pkg.is_active ? "var(--success)" : "var(--error)", color: "#fff" }}>
                  {pkg.is_active ? "Aktif" : "Pasif"}
                </span>
              </div>
              <div className="admin-row-actions">
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
    let finalValue: string | number | boolean = value;
    
    if (type === "number") finalValue = Number(value);
    if (type === "checkbox") finalValue = (e.target as HTMLInputElement).checked;

    setFormData({ ...formData, [name]: finalValue });
  };

  const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, price_kurus: toMinorUnit(Number(e.target.value)), currency: "USD" });
  };

  const handleFeaturesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const features = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
    setFormData({ ...formData, features });
  };

  return (
    <div className="admin-form-grid">
      <div className="field">
        <label>İsim</label>
        <input name="name" value={formData.name || ""} onChange={handleChange} />
      </div>
      <div className="field">
        <label>Slug / Sistem plan kodu</label>
        <input name="slug" value={formData.slug || ""} onChange={handleChange} />
      </div>
      <div className="field">
        <label>Fiyat (USD)</label>
        <input
          name="price_usd"
          type="number"
          min="0"
          step="0.01"
          value={fromMinorUnit(formData.price_kurus)}
          onChange={handlePriceChange}
          placeholder="Örn: 29"
        />
      </div>
      <div className="field">
        <label>Periyot</label>
        <select name="billing_period" value={formData.billing_period || "monthly"} onChange={handleChange}>
          <option value="monthly">Aylık</option>
          <option value="yearly">Yıllık</option>
          <option value="one_time">Tek Sefer</option>
        </select>
      </div>
      <div className="field admin-field-pair">
        <div className="field">
          <label>Aylık İş Limiti</label>
          <input name="monthly_job_limit" type="number" value={formData.monthly_job_limit || 0} onChange={handleChange} />
        </div>
        <div className="field">
          <label>Paralel İş Limiti</label>
          <input name="parallel_job_limit" type="number" value={formData.parallel_job_limit || 0} onChange={handleChange} />
        </div>
      </div>
      <div className="field full">
        <label>Özellikler (Virgülle ayırın)</label>
        <input 
          value={(formData.features || []).join(", ")} 
          onChange={handleFeaturesChange} 
          placeholder="Örn: 50 İş/Ay, Sınırsız Takım, 7/24 Destek" 
        />
      </div>
      <div className="field checkbox-field">
        <input name="is_active" type="checkbox" checked={formData.is_active !== false} onChange={handleChange} style={{ width: "auto" }} />
        <label>Aktif (Satın alınabilir)</label>
      </div>
      <div className="field">
        <label>Sıralama (Küçük olan önce çıkar)</label>
        <input name="sort_order" type="number" value={formData.sort_order || 0} onChange={handleChange} />
      </div>
    </div>
  );
}

function normalizePackageForm(formData: Partial<Package>): Partial<Package> {
  const slug = normalizeSlug(formData.slug || formData.name || "plan");
  return {
    ...formData,
    slug,
    plan_id: slug,
    currency: "USD",
    price_kurus: Math.max(0, Math.round(formData.price_kurus || 0))
  };
}

function normalizeSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "plan";
}
