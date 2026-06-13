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
import type { MigrationModuleType } from "@/types/domain";
import type { Locale } from "@/lib/preference-shared";

export const MODULE_DEFINITIONS: Array<{
  id: MigrationModuleType;
  icon: typeof ArrowRightLeft;
  copy: Record<Locale, {
    title: string;
    description: string;
    badge: string;
    deliveryLabel: string;
    features: string[];
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
        deliveryLabel: "Tam geçiş",
        features: [
          "Kaynak sunucudan veritabanı yedeğini alır",
          "Hedef sunucuya Supabase kurar",
          "Tüm tablo, yetki ve ayarları güvenle yeni sunucuya taşır"
        ]
      },
      en: {
        title: "Server-to-server migration",
        description: "Moves your self-hosted stack to a new server, end to end.",
        badge: "Automated flow",
        deliveryLabel: "Full move",
        features: [
          "Takes database backup from source server",
          "Installs Supabase on target server",
          "Safely migrates all tables, roles, and settings"
        ]
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
        deliveryLabel: "Tam geçiş",
        features: [
          "Supabase Cloud projenizdeki verileri indirir",
          "Kendi sunucunuza Docker tabanlı Supabase kurar",
          "Bağımsız ve limitsiz ortama geçişinizi tamamlar"
        ]
      },
      en: {
        title: "Cloud to self-hosted",
        description: "Brings your Cloud project onto your own server.",
        badge: "Popular package",
        deliveryLabel: "Full move",
        features: [
          "Downloads data from your Supabase Cloud project",
          "Installs Docker-based Supabase on your own server",
          "Completes transition to a self-hosted environment"
        ]
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
        deliveryLabel: "Başlangıç",
        features: [
          "Boş bir Ubuntu sunucusuna gerekli bağımlılıkları kurar",
          "En güncel Supabase sürümünü indirir",
          "Canlı (production) kullanıma uygun şekilde yapılandırır"
        ]
      },
      en: {
        title: "Fresh Supabase install",
        description: "Installs production-ready Supabase on a fresh server.",
        badge: "Fast setup",
        deliveryLabel: "Launch",
        features: [
          "Installs dependencies on a fresh Ubuntu server",
          "Downloads the latest Supabase version",
          "Configures for production-ready usage"
        ]
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
        deliveryLabel: "Güncelleme",
        features: [
          "Domain (alan adı) adreslerini günceller",
          "SSL sertifikalarını yeniler veya kurar",
          "SMTP (E-posta), Auth ve API anahtarı ayarlarını değiştirir"
        ]
      },
      en: {
        title: "Settings and domain management",
        description: "Updates domains, SSL, and config with control.",
        badge: "Operations",
        deliveryLabel: "Update",
        features: [
          "Updates domain addresses",
          "Renews or installs SSL certificates",
          "Changes SMTP, Auth, and API key settings"
        ]
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
        deliveryLabel: "Rapor",
        features: [
          "İki veritabanı arasındaki şema farklarını bulur",
          "RLS (Row Level Security) kural değişikliklerini analiz eder",
          "Okunabilir, detaylı bir karşılaştırma raporu sunar"
        ]
      },
      en: {
        title: "Schema difference report",
        description: "Turns schema and RLS diffs into a readable report.",
        badge: "Analysis",
        deliveryLabel: "Report",
        features: [
          "Finds schema differences between two databases",
          "Analyzes changes in RLS (Row Level Security) rules",
          "Presents a readable, detailed comparison report"
        ]
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
        deliveryLabel: "Rapor",
        features: [
          "Kaynak ve hedef sunucudaki tablo sayılarını karşılaştırır",
          "Storage bucket ve dosya sayılarını doğrular",
          "Eksik veya hatalı aktarılmış veri olup olmadığını kontrol eder"
        ]
      },
      en: {
        title: "Migration verification",
        description: "Verifies the move with table and storage counts.",
        badge: "Verification",
        deliveryLabel: "Report",
        features: [
          "Compares table counts between source and target",
          "Verifies storage bucket and file counts",
          "Checks for missing or incorrectly transferred data"
        ]
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
        deliveryLabel: "Dosya",
        features: [
          "Veritabanındaki tabloların ve fonksiyonların SQL dökümünü alır",
          "Sadece yapısal verileri (şema) çeker, müşteri verilerini dahil etmez",
          "Yedekleme veya versiyon kontrolü (Git) için hazırlar"
        ]
      },
      en: {
        title: "SQL structure export",
        description: "Exports your database structure as SQL, data untouched.",
        badge: "Export",
        deliveryLabel: "File",
        features: [
          "Dumps SQL structure of tables and functions",
          "Only extracts structural data (schema), excludes customer data",
          "Prepares structure for backup or version control (Git)"
        ]
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
        deliveryLabel: "Kurulum",
        features: [
          "Sunucunuza günlük otomatik yedekleme scripti (cron) ekler",
          "Yedekleri S3 veya Cloudflare R2 gibi bulut depolamalara gönderir",
          "Veri kaybı riskine karşı otomatik rotasyon sağlar"
        ]
      },
      en: {
        title: "Automated S3 Backup Setup",
        description: "Installs a cron job on your server to backup to S3/R2.",
        badge: "Cron Setup",
        deliveryLabel: "Installation",
        features: [
          "Adds a daily automated backup script (cron) to your server",
          "Uploads backups to cloud storage like S3 or R2",
          "Provides automatic rotation against data loss risk"
        ]
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
        deliveryLabel: "Güncelleme",
        features: [
          "Mevcut Supabase kurulumunun tam yedeğini alır",
          "Docker imajlarını ve ayar dosyalarını son sürüme günceller",
          "Gerekli veritabanı migration'larını otomatik çalıştırır"
        ]
      },
      en: {
        title: "One-Click Upgrade",
        description: "Safely backs up and upgrades your self-hosted Supabase.",
        badge: "New Version",
        deliveryLabel: "Upgrade",
        features: [
          "Takes a full backup of current Supabase installation",
          "Updates Docker images and config files to the latest version",
          "Runs required database migrations automatically"
        ]
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
        deliveryLabel: "Üretim",
        features: [
          "Tablo yapılarınızı yapay zeka ile analiz eder",
          "Gerçekçi isim, e-posta, tarih gibi test verileri (mock data) üretir",
          "Geliştirme ve test süreçlerinizi hızlandırır"
        ]
      },
      en: {
        title: "AI Data Seeder",
        description: "Generates realistic dummy data using AI for your tables.",
        badge: "Magic",
        deliveryLabel: "Seed",
        features: [
          "Analyzes your table structures using AI",
          "Generates realistic mock data (names, emails, dates)",
          "Accelerates your development and testing process"
        ]
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
        deliveryLabel: "Klonla",
        features: [
          "Canlı (production) veritabanı yedeğini alır",
          "Kişisel verileri (şifre, e-posta vb.) güvenlik amacıyla maskeler",
          "Local ortamınızda test edebilmeniz için indirilebilir hale getirir"
        ]
      },
      en: {
        title: "Prod to Local Clone",
        description: "Safely clones production data to your local machine with masking.",
        badge: "Indie Dev",
        deliveryLabel: "Clone",
        features: [
          "Takes production database backup",
          "Masks personal data (passwords, emails, etc.) for security",
          "Makes it downloadable for local testing"
        ]
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
        deliveryLabel: "Taşı",
        features: [
          "Cloud projenizdeki Edge Function (Deno) kodlarını indirir",
          "Self-hosted sunucunuza uygun şekilde yapılandırır",
          "Fonksiyonlarınızı yeni sunucunuzda ayağa kaldırır"
        ]
      },
      en: {
        title: "Edge Functions Migrator",
        description: "Migrates your Deno edge functions to your new server.",
        badge: "New",
        deliveryLabel: "Migrate",
        features: [
          "Downloads Edge Function (Deno) codes from your Cloud project",
          "Configures them for your self-hosted server",
          "Deploys your functions on your new server"
        ]
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
        deliveryLabel: "Tarama",
        features: [
          "Docker container'larının çalışma durumlarını (RAM/CPU) kontrol eder",
          "Supabase servislerinin (Auth, Realtime vb.) loglarını tarar",
          "Olası hataları ve performans sorunlarını raporlar"
        ]
      },
      en: {
        title: "Docker Health Inspector",
        description: "Scans and diagnoses Supabase containers on your server.",
        badge: "Diagnostic",
        deliveryLabel: "Scan",
        features: [
          "Checks Docker container status (RAM/CPU)",
          "Scans logs of Supabase services (Auth, Realtime etc.)",
          "Reports potential errors and performance bottlenecks"
        ]
      }
    },
    usageUnits: 1
  }
];

export const PLAN_LIMITS: Record<string, {
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
    parallelJobs: 1,
    legacyBridge: true
  },
  scale: {
    label: "Scale",
    monthlyJobs: 500,
    parallelJobs: 1,
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
