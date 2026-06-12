const fs = require('fs');
const path = require('path');

const blogDir = path.join(__dirname, 'src', 'content', 'blog');

if (!fs.existsSync(blogDir)) {
  fs.mkdirSync(blogDir, { recursive: true });
}

const enPosts = [
  {
    title: "The Ultimate Guide to Supabase Database Migration",
    slug: "ultimate-guide-supabase-migration",
    desc: "A complete walkthrough on how to migrate your Supabase project securely and efficiently without losing data.",
    body: "Migrating a Supabase project is a critical task for many growing companies. In this ultimate guide, we will break down the essential steps required to migrate your database schema, Row Level Security (RLS) policies, and actual data securely.\n\n## Why Migrate?\n\nAs your application scales, you might need to move from a shared instance to a dedicated Supabase project, or simply sync your local development environment with production.\n\n## The Baseup Solution\n\nBaseup automates this entire process, ensuring that your data remains intact and your application experiences zero downtime."
  },
  {
    title: "How to Backup and Restore Your Supabase Project",
    slug: "backup-restore-supabase-project",
    desc: "Learn the best practices for backing up your Supabase PostgreSQL database and restoring it efficiently.",
    body: "Backups are your first line of defense against data loss. Supabase provides daily backups on paid plans, but understanding how to manually backup and restore your database is crucial.\n\n## Using pg_dump\n\nThe traditional way to backup a PostgreSQL database is using `pg_dump`. While effective, it can be slow for very large databases.\n\n## Fast Restores with Baseup\n\nWith Baseup, you can create point-in-time snapshots and restore them to any environment instantly, saving hours of manual DBA work."
  },
  {
    title: "Migrating Large PostgreSQL Databases to Supabase",
    slug: "migrating-large-postgresql-to-supabase",
    desc: "Techniques and strategies for migrating massive PostgreSQL databases into Supabase without downtime.",
    body: "Moving gigabytes or terabytes of data into Supabase requires careful planning. Standard inserts will take too long and block your application.\n\n## Logical Replication\n\nFor large datasets, PostgreSQL Logical Replication is the recommended approach. It allows you to stream changes continuously from the source to Supabase.\n\n## Baseup's Migration Engine\n\nBaseup utilizes advanced logical replication under the hood, enabling seamless, zero-downtime migrations for massive enterprise databases."
  },
  {
    title: "Supabase Auth Migration: Moving Users and Passwords Safely",
    slug: "supabase-auth-migration-secure",
    desc: "How to migrate Supabase Auth users, retaining their encrypted passwords and session integrity.",
    body: "One of the most complex parts of a migration is moving user authentication data. You cannot simply copy plaintext passwords; you must transfer the exact Bcrypt/Argon2 hashes.\n\n## The auth.users Table\n\nSupabase stores users in the `auth.users` table. Moving this table requires elevated privileges that standard users don't have.\n\n## Automated Auth Transfer\n\nBaseup safely transfers your entire `auth` schema, ensuring users can log in to your new project without needing to reset their passwords."
  },
  {
    title: "Automating Supabase Environment Syncing",
    slug: "automating-supabase-environment-sync",
    desc: "Keep your Supabase staging and production environments perfectly in sync automatically.",
    body: "Maintaining parity between staging and production is difficult. Schema drift can cause bugs that only appear in production.\n\n## CI/CD and Supabase CLI\n\nUsing GitHub Actions alongside the Supabase CLI is a great way to push schema changes automatically.\n\n## Baseup Environment Sync\n\nBaseup goes a step further by allowing you to sync not just the schema, but also anonymized production data back to staging for realistic testing."
  },
  {
    title: "PostgreSQL Logical Replication vs. pg_dump for Supabase",
    slug: "logical-replication-vs-pg-dump-supabase",
    desc: "Comparing the two main methods for database migration and when to use them for your Supabase project.",
    body: "When migrating a database, you typically choose between a logical dump (`pg_dump`) or logical replication.\n\n## pg_dump: The Standard\n\n`pg_dump` is reliable but requires downtime. You must stop your app, dump the data, and restore it.\n\n## Logical Replication: Zero Downtime\n\nReplication streams data live. It's complex to set up but provides zero downtime. Baseup provides a visual interface for managing logical replication natively."
  },
  {
    title: "Handling Foreign Key Constraints During Database Migration",
    slug: "handling-foreign-keys-migration",
    desc: "Solve the most common error in database migration: foreign key constraint violations.",
    body: "Foreign key constraints ensure data integrity, but during a migration, they can be a nightmare. If you import a child record before its parent, PostgreSQL will throw an error.\n\n## Deferring Constraints\n\nYou can defer constraints or disable triggers during a migration using `session_replication_role`.\n\n## Baseup's Smart Ordering\n\nBaseup automatically calculates the correct topological insertion order of your tables, ensuring foreign keys never break during the transfer."
  },
  {
    title: "Supabase Storage Migration: Transferring Files Between Projects",
    slug: "supabase-storage-migration-guide",
    desc: "A guide to moving S3-compatible storage buckets and files across Supabase projects.",
    body: "Your database is only half the picture. Modern applications rely heavily on Supabase Storage for avatars, documents, and media.\n\n## The Manual Way\n\nYou can use S3 CLI tools or rclone to copy files between buckets. However, this doesn't migrate the metadata stored in the `storage.objects` table.\n\n## Complete Storage Migration\n\nBaseup transfers both the physical files and the underlying metadata tables simultaneously, keeping your application's file references intact."
  },
  {
    title: "Top 5 Mistakes to Avoid When Migrating Supabase Projects",
    slug: "top-5-mistakes-supabase-migration",
    desc: "Avoid these critical errors that can lead to data loss or security breaches during a Supabase migration.",
    body: "Migrating a database is risky. Here are the top mistakes we see teams make:\n\n1. **Forgetting RLS Policies**: Leaving tables open to the public.\n2. **Ignoring Sequences**: Not updating primary key sequences, causing duplicate key errors.\n3. **Downtime Underestimation**: Assuming a massive data dump will be fast.\n\nUsing Baseup eliminates these human errors by automating the entire migration lifecycle."
  },
  {
    title: "Scaling Supabase: When and How to Upgrade Your Project",
    slug: "scaling-supabase-when-to-upgrade",
    desc: "Signs that your Supabase project needs to scale and how to safely transition to a larger compute instance.",
    body: "As your user base grows, you will eventually hit compute limits on your Supabase instance.\n\n## Monitoring Metrics\n\nWatch out for high CPU usage, RAM constraints, and Disk IOPS limits in your Supabase dashboard.\n\n## Upgrading Instances\n\nYou can upgrade your compute directly in the Supabase dashboard. For complex architectural changes or migrating to a dedicated enterprise cluster, Baseup provides the safest transition path."
  }
];

const trPosts = [
  {
    title: "Supabase Veritabanı Taşıma: Kapsamlı Rehber",
    slug: "supabase-veritabani-tasima-kapsamli-rehber",
    desc: "Supabase projenizi veri kaybı yaşamadan güvenli ve verimli bir şekilde nasıl taşıyacağınız hakkında eksiksiz bir rehber.",
    body: "Büyüyen uygulamalar için Supabase projesini taşımak kritik bir süreçtir. Bu rehberde, veritabanı şemanızı, Row Level Security (RLS) politikalarınızı ve verilerinizi nasıl güvenle aktaracağınızı inceleyeceğiz.\n\n## Neden Taşımalıyız?\n\nUygulamanız ölçeklendikçe paylaşımlı bir sunucudan özel bir Supabase projesine geçmeniz gerekebilir.\n\n## Baseup Çözümü\n\nBaseup bu süreci otomatikleştirerek verilerinizin güvende kalmasını ve uygulamanızın kesintisiz çalışmasını sağlar."
  },
  {
    title: "Supabase Projenizi Nasıl Yedekler ve Geri Yüklersiniz?",
    slug: "supabase-projesi-yedekleme-ve-geri-yukleme",
    desc: "Supabase PostgreSQL veritabanınızı yedeklemenin ve verimli bir şekilde geri yüklemenin en iyi yolları.",
    body: "Yedeklemeler, veri kaybına karşı ilk savunma hattınızdır. Supabase ücretli planlarda günlük yedekleme sunsa da, manuel olarak nasıl yedek alıp döneceğinizi bilmek önemlidir.\n\n## pg_dump Kullanımı\n\nPostgreSQL veritabanını yedeklemenin geleneksel yolu `pg_dump` kullanmaktır.\n\n## Baseup ile Hızlı Geri Yükleme\n\nBaseup ile anlık snapshot'lar alabilir ve bunları herhangi bir ortama saniyeler içinde geri yükleyebilirsiniz."
  },
  {
    title: "Büyük PostgreSQL Veritabanlarını Supabase'e Taşıma",
    slug: "buyuk-postgresql-veritabanlarini-supabase-tasima",
    desc: "Devasa PostgreSQL veritabanlarını kesinti yaşamadan Supabase'e taşımak için teknikler ve stratejiler.",
    body: "Gigabaytlarca veriyi Supabase'e taşımak dikkatli bir planlama gerektirir. Standart veri ekleme işlemleri çok uzun sürecek ve uygulamanızı engelleyecektir.\n\n## Logical Replication\n\nBüyük veri setleri için PostgreSQL Mantıksal Replikasyonu (Logical Replication) önerilir.\n\n## Baseup Taşıma Motoru\n\nBaseup, arka planda gelişmiş replikasyon teknolojisi kullanarak devasa kurumsal veritabanları için kesintisiz taşıma sağlar."
  },
  {
    title: "Supabase Auth Taşıma: Kullanıcıları ve Şifreleri Güvenle Aktarma",
    slug: "supabase-auth-tasima-kullanici-sifre",
    desc: "Şifrelenmiş parolaları ve oturum bütünlüğünü koruyarak Supabase Auth kullanıcılarını nasıl taşıyabilirsiniz?",
    body: "Bir taşıma işleminin en karmaşık kısmı kullanıcı kimlik doğrulama verilerini aktarmaktır. Düz metin şifreleri kopyalayamazsınız; Bcrypt/Argon2 özetlerini (hash) birebir aktarmanız gerekir.\n\n## auth.users Tablosu\n\nSupabase kullanıcıları `auth.users` tablosunda saklar. Bu tablonun taşınması özel yetkiler gerektirir.\n\n## Otomatik Auth Aktarımı\n\nBaseup tüm `auth` şemasını güvenle aktarır ve kullanıcıların şifre sıfırlamasına gerek kalmadan yeni projeye giriş yapmalarını sağlar."
  },
  {
    title: "Supabase Ortam Senkronizasyonunu (Staging) Otomatize Etme",
    slug: "supabase-ortam-senkronizasyonu-otomasyon",
    desc: "Supabase staging ve production ortamlarınızı otomatik olarak kusursuz bir şekilde senkronize edin.",
    body: "Staging (test) ve production (canlı) ortamları arasında paralelliği korumak zordur. Şema kaymaları (schema drift) sadece canlı ortamda ortaya çıkan hatalara neden olabilir.\n\n## CI/CD ve Supabase CLI\n\nSupabase CLI ile birlikte GitHub Actions kullanmak harika bir yöntemdir.\n\n## Baseup ile Ortam Senkronizasyonu\n\nBaseup sadece şemayı değil, aynı zamanda gerçekçi testler yapabilmeniz için anonimleştirilmiş canlı veriyi de staging ortamına senkronize etmenizi sağlar."
  },
  {
    title: "PostgreSQL Logical Replication ile Sıfır Kesintili Supabase Taşıma",
    slug: "postgresql-logical-replication-ile-sifir-kesinti",
    desc: "Supabase projeleriniz için iki ana veritabanı taşıma yönteminin karşılaştırılması ve ne zaman kullanılacakları.",
    body: "Veritabanı taşırken genellikle mantıksal döküm (`pg_dump`) veya mantıksal replikasyon (Logical Replication) arasında seçim yaparsınız.\n\n## pg_dump: Standart Yöntem\n\n`pg_dump` güvenilirdir ancak kesinti gerektirir.\n\n## Mantıksal Replikasyon: Sıfır Kesinti\n\nReplikasyon, verileri canlı olarak yayınlar. Kurulumu karmaşıktır ancak kesintiyi sıfıra indirir. Baseup, replikasyon sürecini yerleşik bir görsel arayüz ile yönetmenizi sağlar."
  },
  {
    title: "Veritabanı Taşırken Foreign Key Çakışmalarını Nasıl Çözersiniz?",
    slug: "veritabani-tasima-foreign-key-cakismalari",
    desc: "Veritabanı taşımalarındaki en yaygın hatayı çözün: Yabancı anahtar (Foreign Key) kısıtlama ihlalleri.",
    body: "Yabancı anahtar (Foreign Key) kısıtlamaları veri bütünlüğünü sağlar, ancak taşıma sırasında bir kabusa dönüşebilir.\n\n## Kısıtlamaları Ertelemek\n\nTaşıma sırasında `session_replication_role` kullanarak kısıtlamaları erteleyebilir veya trigger'ları devre dışı bırakabilirsiniz.\n\n## Baseup'ın Akıllı Sıralaması\n\nBaseup, tablolarınızın doğru topolojik ekleme sırasını otomatik olarak hesaplayarak aktarım sırasında foreign key hatalarının asla oluşmamasını garanti eder."
  },
  {
    title: "Supabase Storage Taşıma: Dosyaları Projeler Arası Aktarmak",
    slug: "supabase-storage-tasima-dosya-aktarimi",
    desc: "S3 uyumlu depolama alanlarını (bucket) ve dosyaları Supabase projeleri arasında taşıma rehberi.",
    body: "Veritabanınız sadece işin yarısıdır. Modern uygulamalar avatarlar, belgeler ve medya için büyük ölçüde Supabase Storage kullanır.\n\n## Manuel Yöntem\n\nDosyaları kopyalamak için S3 CLI araçlarını veya rclone'u kullanabilirsiniz, ancak bu işlem `storage.objects` tablosunu güncellemez.\n\n## Eksiksiz Storage Taşıma\n\nBaseup, uygulamanızın dosya referanslarının bozulmaması için hem fiziksel dosyaları hem de altyapıdaki metadataları eşzamanlı olarak aktarır."
  },
  {
    title: "Supabase Projenizi Taşırken Yapmamanız Gereken 5 Hata",
    slug: "supabase-tasirken-yapilmamasi-gereken-5-hata",
    desc: "Bir Supabase taşıması sırasında veri kaybına veya güvenlik ihlallerine yol açabilecek bu kritik hatalardan kaçının.",
    body: "Veritabanı taşımak risklidir. İşte ekiplerin en sık yaptığı hatalar:\n\n1. **RLS Politikalarını Unutmak**: Tabloları herkese açık (public) bırakmak.\n2. **Sekansları (Sequences) Göz Ardı Etmek**: Primary key dizilerini güncellememek.\n3. **Kesinti Süresini Hafife Almak**: Dev bir veri aktarımının çok kısa süreceğini sanmak.\n\nBaseup kullanmak, tüm taşıma yaşam döngüsünü otomatikleştirerek bu insan hatalarını ortadan kaldırır."
  },
  {
    title: "Supabase Ölçeklendirme: Projenizi Ne Zaman ve Nasıl Büyütmelisiniz?",
    slug: "supabase-olceklendirme-ne-zaman-buyutmeli",
    desc: "Supabase projenizin ölçeklenmesi gerektiğine dair işaretler ve daha büyük bir sunucuya nasıl güvenle geçiş yapılacağı.",
    body: "Kullanıcı tabanınız büyüdükçe, Supabase sunucunuzun işlem limitlerine takılabilirsiniz.\n\n## Metrikleri İzlemek\n\nSupabase panelinizdeki yüksek CPU kullanımı, RAM darboğazları ve Disk IOPS limitlerine dikkat edin.\n\n## Sunucu Yükseltmek\n\nDoğrudan panelden donanım yükseltmesi yapabilirsiniz. Karmaşık mimari değişiklikler veya özel kurumsal cluster'lara geçiş için Baseup en güvenli geçiş yolunu sunar."
  }
];

const writePost = (post) => {
  const filePath = path.join(blogDir, `${post.slug}.md`);
  const content = `---
title: "${post.title}"
date: "2026-06-12"
description: "${post.desc}"
author: "Baseup SEO Team"
---

${post.body}
`;
  fs.writeFileSync(filePath, content);
  console.log(`Generated: ${post.slug}.md`);
};

enPosts.forEach(writePost);
trPosts.forEach(writePost);

console.log("20 posts generated successfully!");
