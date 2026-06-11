import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getModules } from "@/lib/constants";
import type { AppCopy } from "@/lib/i18n";
import type { Locale } from "@/lib/preference-shared";

type PackageGridCopy = {
  cta: string;
  credits: string;
  eyebrow: string;
};

const GRID_COPY: Record<Locale, PackageGridCopy> = {
  tr: {
    cta: "İşlemi başlat",
    credits: "kredi",
    eyebrow: "İşlemler"
  },
  en: {
    cta: "Start operation",
    credits: "credits",
    eyebrow: "Operations"
  }
};

export function PackageGrid({
  locale,
  title
}: {
  locale: Locale;
  title: AppCopy["home"]["packagesTitle"];
}) {
  const modules = getModules(locale);
  const copy = GRID_COPY[locale];

  return (
    <section className="package-catalog" id="tools">
      <div className="package-catalog-heading">
        <div className="eyebrow">{copy.eyebrow}</div>
        <h2>{title}</h2>
      </div>

      <div className="package-grid">
        {modules.map((module, index) => {
          const Icon = module.icon;
          return (
            <Link
              className={index === 0 ? "package-card featured" : "package-card"}
              href={`/app/new-job?module=${module.id}`}
              key={module.id}
            >
              <span className="package-card-icon">
                <Icon size={index === 0 ? 26 : 22} />
              </span>
              <div className="package-card-body">
                <h3>{module.title}</h3>
                <p>{module.description}</p>
              </div>
              <div className="package-card-foot">
                <div className="meta-row">
                  <span className="tag">{module.badge}</span>
                  <span className="tag">{module.usageUnits} {copy.credits}</span>
                </div>
                <span className="package-card-cta">
                  {copy.cta}
                  <ArrowRight size={15} />
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
