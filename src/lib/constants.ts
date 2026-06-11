import {
  Activity,
  ArrowRightLeft,
  CloudDownload,
  DatabaseZap,
  FileCode2,
  ServerCog,
  Settings2,
  Archive,
  ArrowUpCircle,
  Wand2,
  MonitorDown,
  Braces,
  Terminal
} from "lucide-react";
import type { MigrationModuleType, PlanId } from "@/types/domain";
import type { Locale } from "@/lib/preference-shared";

export const MODULE_DEFINITIONS: Array<{
  id: MigrationModuleType;
  icon: typeof ArrowRightLeft;
  copy: Record<Locale, {
    title: string;
    description: string;
    badge: string;
    deliveryLabel: string;
  }>;
  usageUnits: number;
}> = [
  {
    id: "self_hosted_migration",
    icon: ArrowRightLeft,
    copy: {
      tr: {
        title: "Sunucudan sunucuya migration",
        description: "Self-hosted ortamınızı yeni sunucuya uçtan uca taşır.",
        badge: "Otomasyonlu akış",
        deliveryLabel: "Tam geçiş"
      },
      en: {
        title: "Server-to-server migration",
        description: "Moves your self-hosted stack to a new server, end to end.",
        badge: "Automated flow",
        deliveryLabel: "Full move"
      }
    },
    usageUnits: 3
  },
  {
    id: "cloud_to_self_hosted",
    icon: CloudDownload,
    copy: {
      tr: {
        title: "Cloud'dan self-hosted'a geçiş",
        description: "Cloud projenizi kendi sunucunuza indirir.",
        badge: "Popüler paket",
        deliveryLabel: "Tam geçiş"
      },
      en: {
        title: "Cloud to self-hosted",
        description: "Brings your Cloud project onto your own server.",
        badge: "Popular package",
        deliveryLabel: "Full move"
      }
    },
    usageUnits: 3
  },
  {
    id: "clean_install",
    icon: ServerCog,
    copy: {
      tr: {
        title: "Yeni Supabase kurulumu",
        description: "Sıfır sunucuya üretime hazır Supabase kurar.",
        badge: "Hızlı kurulum",
        deliveryLabel: "Başlangıç"
      },
      en: {
        title: "Fresh Supabase install",
        description: "Installs production-ready Supabase on a fresh server.",
        badge: "Fast setup",
        deliveryLabel: "Launch"
      }
    },
    usageUnits: 2
  },
  {
    id: "settings_update",
    icon: Settings2,
    copy: {
      tr: {
        title: "Ayar ve domain yönetimi",
        description: "Domain, SSL ve ayarları kontrollü günceller.",
        badge: "Operasyon",
        deliveryLabel: "Güncelleme"
      },
      en: {
        title: "Settings and domain management",
        description: "Updates domains, SSL, and config with control.",
        badge: "Operations",
        deliveryLabel: "Update"
      }
    },
    usageUnits: 1
  },
  {
    id: "schema_compare",
    icon: DatabaseZap,
    copy: {
      tr: {
        title: "Şema fark analizi",
        description: "Şema ve RLS farklarını okunur rapora çevirir.",
        badge: "Analiz",
        deliveryLabel: "Rapor"
      },
      en: {
        title: "Schema difference report",
        description: "Turns schema and RLS diffs into a readable report.",
        badge: "Analysis",
        deliveryLabel: "Report"
      }
    },
    usageUnits: 1
  },
  {
    id: "db_compare",
    icon: Activity,
    copy: {
      tr: {
        title: "Taşıma doğrulaması",
        description: "Tablo ve storage sayımlarıyla taşımayı doğrular.",
        badge: "Doğrulama",
        deliveryLabel: "Rapor"
      },
      en: {
        title: "Migration verification",
        description: "Verifies the move with table and storage counts.",
        badge: "Verification",
        deliveryLabel: "Report"
      }
    },
    usageUnits: 1
  },
  {
    id: "structure_export",
    icon: FileCode2,
    copy: {
      tr: {
        title: "SQL yapı çıktısı",
        description: "Veriye dokunmadan yapıyı SQL dosyasına çıkarır.",
        badge: "Export",
        deliveryLabel: "Dosya"
      },
      en: {
        title: "SQL structure export",
        description: "Exports your database structure as SQL, data untouched.",
        badge: "Export",
        deliveryLabel: "File"
      }
    },
    usageUnits: 1
  },
  {
    id: "setup_automated_backup",
    icon: Archive,
    copy: {
      tr: {
        title: "S3 Otomatik Yedekleme Kurulumu",
        description: "Sunucunuza S3/R2 cron yedekleme görevini kurar.",
        badge: "Cron Kurulumu",
        deliveryLabel: "Kurulum"
      },
      en: {
        title: "Automated S3 Backup Setup",
        description: "Installs a cron job on your server to backup to S3/R2.",
        badge: "Cron Setup",
        deliveryLabel: "Installation"
      }
    },
    usageUnits: 2
  },
  {
    id: "supabase_upgrade",
    icon: ArrowUpCircle,
    copy: {
      tr: {
        title: "Tek Tıkla Güncelleme",
        description: "Self-Hosted Supabase sürümünüzü yedekleyip günceller.",
        badge: "Yeni Sürüm",
        deliveryLabel: "Güncelleme"
      },
      en: {
        title: "One-Click Upgrade",
        description: "Safely backs up and upgrades your self-hosted Supabase.",
        badge: "New Version",
        deliveryLabel: "Upgrade"
      }
    },
    usageUnits: 2
  },
  {
    id: "ai_seeder",
    icon: Wand2,
    copy: {
      tr: {
        title: "AI Veri Üretici",
        description: "Yapay zeka ile tablolarınıza gerçekçi sahte veriler ekler.",
        badge: "Magic",
        deliveryLabel: "Üretim"
      },
      en: {
        title: "AI Data Seeder",
        description: "Generates realistic dummy data using AI for your tables.",
        badge: "Magic",
        deliveryLabel: "Seed"
      }
    },
    usageUnits: 1
  },
  {
    id: "prod_to_local",
    icon: MonitorDown,
    copy: {
      tr: {
        title: "Prod'dan Local'e Klonlama",
        description: "Canlı veriyi maskeleyerek güvenle bilgisayarınıza indirir.",
        badge: "Indie Dev",
        deliveryLabel: "Klonla"
      },
      en: {
        title: "Prod to Local Clone",
        description: "Safely clones production data to your local machine with masking.",
        badge: "Indie Dev",
        deliveryLabel: "Clone"
      }
    },
    usageUnits: 2
  },
  {
    id: "edge_functions_migrator",
    icon: Braces,
    copy: {
      tr: {
        title: "Edge Functions Taşıyıcı",
        description: "Cloud'daki Deno fonksiyonlarını yeni sunucunuza aktarır.",
        badge: "Yeni",
        deliveryLabel: "Taşı"
      },
      en: {
        title: "Edge Functions Migrator",
        description: "Migrates your Deno edge functions to your new server.",
        badge: "New",
        deliveryLabel: "Migrate"
      }
    },
    usageUnits: 2
  },
  {
    id: "infra_inspector",
    icon: Terminal,
    copy: {
      tr: {
        title: "Docker Sağlık Yöneticisi",
        description: "Sunucudaki Supabase container'larını tarar ve teşhis eder.",
        badge: "Teşhis",
        deliveryLabel: "Tarama"
      },
      en: {
        title: "Docker Health Inspector",
        description: "Scans and diagnoses Supabase containers on your server.",
        badge: "Diagnostic",
        deliveryLabel: "Scan"
      }
    },
    usageUnits: 1
  }
];

export const PLAN_LIMITS: Record<PlanId, {
  label: string;
  monthlyJobs: number;
  parallelJobs: number;
  legacyBridge: boolean;
}> = {
  trial: {
    label: "Trial",
    monthlyJobs: 10,
    parallelJobs: 1,
    legacyBridge: false
  },
  growth: {
    label: "Growth",
    monthlyJobs: 100,
    parallelJobs: 3,
    legacyBridge: true
  },
  scale: {
    label: "Scale",
    monthlyJobs: 500,
    parallelJobs: 10,
    legacyBridge: true
  }
};

export function getModuleMeta(type: MigrationModuleType) {
  return getModules("tr").find(module => module.id === type) ?? getModules("tr")[0];
}

export function getModuleMetaForLocale(type: MigrationModuleType, locale: Locale) {
  return getModules(locale).find(module => module.id === type) ?? getModules(locale)[0];
}

export function getModules(locale: Locale) {
  return MODULE_DEFINITIONS.map(module => ({
    ...module,
    ...module.copy[locale]
  }));
}
