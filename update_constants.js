const fs = require('fs');

let content = fs.readFileSync('src/lib/constants.ts', 'utf8');

const featuresMap = {
  "self_hosted_migration": {
    tr: ['"Kaynak sunucudan veritabanı yedeğini alır"', '"Hedef sunucuya Supabase kurar"', '"Tüm tablo, yetki ve ayarları güvenle yeni sunucuya taşır"'],
    en: ['"Takes database backup from source server"', '"Installs Supabase on target server"', '"Safely migrates all tables, roles, and settings"']
  },
  "cloud_to_self_hosted": {
    tr: ['"Supabase Cloud projenizdeki verileri indirir"', '"Kendi sunucunuza Docker tabanlı Supabase kurar"', '"Bağımsız ve limitsiz ortama geçişinizi tamamlar"'],
    en: ['"Downloads data from your Supabase Cloud project"', '"Installs Docker-based Supabase on your own server"', '"Completes transition to a self-hosted environment"']
  },
  "clean_install": {
    tr: ['"Boş bir Ubuntu sunucusuna gerekli bağımlılıkları kurar"', '"En güncel Supabase sürümünü indirir"', '"Canlı (production) kullanıma uygun şekilde yapılandırır"'],
    en: ['"Installs dependencies on a fresh Ubuntu server"', '"Downloads the latest Supabase version"', '"Configures for production-ready usage"']
  },
  "settings_update": {
    tr: ['"Domain (alan adı) adreslerini günceller"', '"SSL sertifikalarını yeniler veya kurar"', '"SMTP (E-posta), Auth ve API anahtarı ayarlarını değiştirir"'],
    en: ['"Updates domain addresses"', '"Renews or installs SSL certificates"', '"Changes SMTP, Auth, and API key settings"']
  },
  "schema_compare": {
    tr: ['"İki veritabanı arasındaki şema farklarını bulur"', '"RLS (Row Level Security) kural değişikliklerini analiz eder"', '"Okunabilir, detaylı bir karşılaştırma raporu sunar"'],
    en: ['"Finds schema differences between two databases"', '"Analyzes changes in RLS (Row Level Security) rules"', '"Presents a readable, detailed comparison report"']
  },
  "db_compare": {
    tr: ['"Kaynak ve hedef sunucudaki tablo sayılarını karşılaştırır"', '"Storage bucket ve dosya sayılarını doğrular"', '"Eksik veya hatalı aktarılmış veri olup olmadığını kontrol eder"'],
    en: ['"Compares table counts between source and target"', '"Verifies storage bucket and file counts"', '"Checks for missing or incorrectly transferred data"']
  },
  "structure_export": {
    tr: ['"Veritabanındaki tabloların ve fonksiyonların SQL dökümünü alır"', '"Sadece yapısal verileri (şema) çeker, müşteri verilerini dahil etmez"', '"Yedekleme veya versiyon kontrolü (Git) için hazırlar"'],
    en: ['"Dumps SQL structure of tables and functions"', '"Only extracts structural data (schema), excludes customer data"', '"Prepares structure for backup or version control (Git)"']
  },
  "setup_automated_backup": {
    tr: ['"Sunucunuza günlük otomatik yedekleme scripti (cron) ekler"', '"Yedekleri S3 veya Cloudflare R2 gibi bulut depolamalara gönderir"', '"Veri kaybı riskine karşı otomatik rotasyon sağlar"'],
    en: ['"Adds a daily automated backup script (cron) to your server"', '"Uploads backups to cloud storage like S3 or R2"', '"Provides automatic rotation against data loss risk"']
  },
  "supabase_upgrade": {
    tr: ['"Mevcut Supabase kurulumunun tam yedeğini alır"', '"Docker imajlarını ve ayar dosyalarını son sürüme günceller"', '"Gerekli veritabanı migration\'larını otomatik çalıştırır"'],
    en: ['"Takes a full backup of current Supabase installation"', '"Updates Docker images and config files to the latest version"', '"Runs required database migrations automatically"']
  },
  "ai_seeder": {
    tr: ['"Tablo yapılarınızı yapay zeka ile analiz eder"', '"Gerçekçi isim, e-posta, tarih gibi test verileri (mock data) üretir"', '"Geliştirme ve test süreçlerinizi hızlandırır"'],
    en: ['"Analyzes your table structures using AI"', '"Generates realistic mock data (names, emails, dates)"', '"Accelerates your development and testing process"']
  },
  "prod_to_local": {
    tr: ['"Canlı (production) veritabanı yedeğini alır"', '"Kişisel verileri (şifre, e-posta vb.) güvenlik amacıyla maskeler"', '"Local ortamınızda test edebilmeniz için indirilebilir hale getirir"'],
    en: ['"Takes production database backup"', '"Masks personal data (passwords, emails, etc.) for security"', '"Makes it downloadable for local testing"']
  },
  "edge_functions_migrator": {
    tr: ['"Cloud projenizdeki Edge Function (Deno) kodlarını indirir"', '"Self-hosted sunucunuza uygun şekilde yapılandırır"', '"Fonksiyonlarınızı yeni sunucunuzda ayağa kaldırır"'],
    en: ['"Downloads Edge Function (Deno) codes from your Cloud project"', '"Configures them for your self-hosted server"', '"Deploys your functions on your new server"']
  },
  "infra_inspector": {
    tr: ['"Docker container\'larının çalışma durumlarını (RAM/CPU) kontrol eder"', '"Supabase servislerinin (Auth, Realtime vb.) loglarını tarar"', '"Olası hataları ve performans sorunlarını raporlar"'],
    en: ['"Checks Docker container status (RAM/CPU)"', '"Scans logs of Supabase services (Auth, Realtime etc.)"', '"Reports potential errors and performance bottlenecks"']
  }
};

for (const [id, langs] of Object.entries(featuresMap)) {
  // We need to inject features: [...] into the tr and en copy objects
  
  // Find block for id
  const idRegex = new RegExp(`(id:\\s*"${id}"[\\s\\S]*?copy:\\s*\\{)`, "g");
  const match = idRegex.exec(content);
  if (match) {
    // Find 'tr: {' block
    const trRegex = /(tr:\s*\{[^\}]*?)(deliveryLabel:[^\n]*)/;
    // Find 'en: {' block
    const enRegex = /(en:\s*\{[^\}]*?)(deliveryLabel:[^\n]*)/;
    
    // We will do a local replace around the id
    const startIdx = match.index;
    const endIdx = content.indexOf('usageUnits:', startIdx);
    
    if (startIdx !== -1 && endIdx !== -1) {
      let block = content.substring(startIdx, endIdx);
      
      block = block.replace(trRegex, `$1$2,\n        features: [\n          ${langs.tr.join(',\n          ')}\n        ]`);
      block = block.replace(enRegex, `$1$2,\n        features: [\n          ${langs.en.join(',\n          ')}\n        ]`);
      
      content = content.substring(0, startIdx) + block + content.substring(endIdx);
    }
  }
}

// Add features property to the type signature
content = content.replace(
  'deliveryLabel: string;',
  'deliveryLabel: string;\n    features: string[];'
);

fs.writeFileSync('src/lib/constants.ts', content);
console.log('Updated constants.ts');
